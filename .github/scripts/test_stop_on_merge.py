"""Tests for stop-on-merge.sh (endless.sh's side, the stop file, is tested in the kernel repo):
python3 -m unittest discover -s .github/scripts

It runs for real, with a fake `gh` first on PATH."""

import os
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
WATCHER = os.path.join(HERE, "stop-on-merge.sh")


def fake(bin_dir, name, body):
    path = os.path.join(bin_dir, name)
    with open(path, "w") as f:
        f.write("#!/usr/bin/env bash\n" + body)
    os.chmod(path, 0o755)


class Watcher(unittest.TestCase):
    """stop-on-merge.sh with a fake `gh` that prints the given PR states, one per line."""

    def watch(self, gh_body, seconds=1.0):
        with tempfile.TemporaryDirectory() as d:
            fake(d, "gh", gh_body)
            stop = os.path.join(d, "stop")
            env = dict(os.environ, PATH=d + os.pathsep + os.environ["PATH"], STOP_POLL_SECONDS="0.05", GITHUB_REPOSITORY="o/r")
            try:
                out = subprocess.run(["bash", WATCHER, "claude/x", stop], env=env, capture_output=True, text=True, timeout=seconds)
                stopped = True
            except subprocess.TimeoutExpired as e:
                out, stopped = e, False
            return stopped, os.path.exists(stop), out

    def test_merged_or_closed_stops(self):
        for states in ("MERGED", "CLOSED", "MERGED\\nCLOSED"):
            stopped, made, out = self.watch(f'printf "{states}\\n"')
            self.assertTrue(stopped and made, states)
            self.assertIn("has merged or closed", out.stdout)

    def test_open_or_no_pull_request_keeps_testing(self):
        # No PR yet (empty answer), one open, or an old one closed and a new
        # one open: the branch is still live, so the watcher never stops.
        for body in ("true", 'printf "OPEN\\n"', 'printf "CLOSED\\nOPEN\\n"'):
            stopped, made, _ = self.watch(body)
            self.assertFalse(stopped or made, body)

    def test_a_failed_lookup_waits_for_the_next_one(self):
        # The first two answers fail, the third says merged.
        with tempfile.TemporaryDirectory() as count:
            n = os.path.join(count, "n")
            body = f'echo x >>{n}; [ $(wc -l <{n}) -ge 3 ] || exit 1; echo MERGED\n'
            stopped, made, _ = self.watch(body, seconds=5)
            self.assertTrue(stopped and made)
            with open(n) as f:
                self.assertEqual(len(f.read().split()), 3)

    def test_it_asks_about_this_branch(self):
        with tempfile.TemporaryDirectory() as log:
            args = os.path.join(log, "args")
            stopped, _, _ = self.watch(f'echo "$@" >{args}; echo MERGED\n')
            self.assertTrue(stopped)
            with open(args) as f:
                asked = f.read()
            self.assertIn("--repo o/r --head claude/x --state all", asked)
            self.assertIn('select(.headRepositoryOwner.login == "o")', asked)

    def test_a_forks_pull_request_with_the_same_branch_name_is_ignored(self):
        # The fake gh runs the script's real --jq filter over what GitHub
        # would answer: a fork's merged pull request from claude/x and none
        # of ours, so testing goes on; with ours merged too, it stops.
        # (branch_testing.py's `gh api` lookups fail here, so they never stop it.)
        jq = '[ "$1" = api ] && exit 1; while [ "$1" != --jq ]; do shift; done; jq -r "$2" <<<\'%s\'\n'
        fork = '{"state":"MERGED","headRepositoryOwner":{"login":"someone"}}'
        ours = '{"state":"MERGED","headRepositoryOwner":{"login":"o"}}'
        stopped, made, _ = self.watch(jq % f"[{fork}]", seconds=0.5)
        self.assertFalse(stopped or made)
        stopped, made, _ = self.watch(jq % f"[{fork},{ours}]")
        self.assertTrue(stopped and made)


    def test_an_open_pull_request_gives_the_runners_up_when_ci_waits(self):
        # The pull request is open; branch_testing.py's lookups find one CI
        # run whose "kernel" job has been queued since 2020, far past CI_WAIT:
        # the rounds stop, saying why. With the job running instead, testing goes on.
        def gh(job_status):
            runs = '{"workflow_runs":[{"id":5,"status":"in_progress","event":"pull_request","head_branch":"claude/y","head_repository":{"full_name":"o/r"}}]}'
            jobs = '{"jobs":[{"name":"kernel","status":"%s","created_at":"2020-01-01T00:00:00Z"}]}' % job_status
            return (f'case "$*" in pr\\ *) echo OPEN;; *nightly.yml*) echo \'{{"workflow_runs":[]}}\';; '
                    f'*ci.yml*) echo \'{runs}\';; *runs/5/jobs*) echo \'{jobs}\';; *) exit 1;; esac\n')
        stopped, made, out = self.watch(gh("queued"), seconds=5)
        self.assertTrue(stopped and made, out)
        self.assertIn('stops after the round in progress: CI job "kernel" has waited', out.stdout)
        stopped, made, _ = self.watch(gh("in_progress"))
        self.assertFalse(stopped or made)

class KernelWatcher(unittest.TestCase):
    """stop-on-merge.sh for the private kernel's branches (KERNEL_REPO set): GitHub's compare of main with the branch."""

    def watch(self, gh_body, seconds=1.0, branch="claude/k"):
        with tempfile.TemporaryDirectory() as d:
            fake(d, "gh", gh_body)
            stop = os.path.join(d, "stop")
            env = dict(os.environ, PATH=d + os.pathsep + os.environ["PATH"], STOP_POLL_SECONDS="0.05", GITHUB_REPOSITORY="o/r",
                       KERNEL_REPO="o/k", KERNEL_READ="key")
            try:
                out = subprocess.run(["bash", WATCHER, branch, stop], env=env, capture_output=True, text=True, timeout=seconds)
                stopped = True
            except subprocess.TimeoutExpired as e:
                out, stopped = e, False
            return stopped, os.path.exists(stop), out

    def test_merged_or_deleted_stops(self):
        # "behind": main has every commit of the branch and more (merged); "identical": nothing of its own
        # left; a 404: the branch is gone. branch_testing.py's lookups (`gh api repos/o/r/...`) fail here.
        for answer in ("echo behind", "echo identical", "echo 'gh: Not Found (HTTP 404)' >&2; exit 1"):
            stopped, made, out = self.watch(f'case "$2" in repos/o/k/*) {answer};; *) exit 1;; esac\n')
            self.assertTrue(stopped and made, answer)
            self.assertIn("has merged into main or is gone", out.stdout)

    def test_unmerged_or_a_failed_lookup_keeps_testing(self):
        # "ahead"/"diverged": the branch has commits main lacks; a 500 or no answer: ask again later.
        for answer in ("echo ahead", "echo diverged", "echo 'HTTP 500' >&2; exit 1", "true"):
            stopped, made, _ = self.watch(f'case "$2" in repos/o/k/*) {answer};; *) exit 1;; esac\n')
            self.assertFalse(stopped or made, answer)

    def test_it_asks_with_the_kernel_key_about_this_branch(self):
        with tempfile.TemporaryDirectory() as log:
            args = os.path.join(log, "args")
            stopped, _, _ = self.watch(f'[ "$1" = api ] && [ "$2" != "${{2#repos/o/k}}" ] && {{ echo "$GH_TOKEN $*" >{args}; echo behind; exit 0; }}; exit 1\n')
            self.assertTrue(stopped)
            with open(args) as f:
                self.assertEqual(f.read().strip(), "key api repos/o/k/compare/main...claude/k --jq .status")

    def test_tonights_run_on_main_stops_only_for_starved_ci(self):
        # main...main is "identical", which would stop a branch's run at once; on main it is never asked.
        stopped, made, _ = self.watch('case "$2" in repos/o/k/*) echo identical;; *) exit 1;; esac\n', branch="main")
        self.assertFalse(stopped or made)
        # A CI job queued since 2020: the night gives that job's runner back.
        runs = '{"workflow_runs":[{"id":5,"status":"in_progress","event":"pull_request","head_branch":"claude/y","head_repository":{"full_name":"o/r"}}]}'
        jobs = '{"jobs":[{"name":"kernel","status":"queued","created_at":"2020-01-01T00:00:00Z"}]}'
        body = (f'case "$*" in *repos/o/k/*) echo identical;; *nightly.yml*) echo \'{{"workflow_runs":[]}}\';; '
                f'*ci.yml*) echo \'{runs}\';; *runs/5/jobs*) echo \'{jobs}\';; *) exit 1;; esac\n')
        stopped, made, out = self.watch(body, seconds=5, branch="main")
        self.assertTrue(stopped and made, out)
        self.assertIn('Random testing on main stops after the round in progress: CI job "kernel" has waited', out.stdout)


if __name__ == "__main__":
    unittest.main()

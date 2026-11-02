"""kernel_ci.sh filter lets only the kernel ci scripts' public lines through:
python3 -m unittest discover -s .github/scripts

kernel-ci.yml runs the private kernel's checks on this public repo's
runners, whose logs anyone can read, so every line of their output passes
through this filter first. Hand-worked cases: each allowed form, and lines a
leak would look like (a panic naming a source file, a mutant quoting a
source line, a RESULT line with something extra after it)."""

import os
import re
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "kernel_ci.sh")


def filtered(text):
    return subprocess.run(["bash", SCRIPT, "filter"], input=text, capture_output=True, text=True, check=True).stdout


class Filter(unittest.TestCase):
    def test_public_lines_pass(self):
        lines = "RESULT clippy PASS 12\nRESULT boolean-facts FAIL 340\nRESULT mutants-shard-3 PASS 900\ncount 41\ncount error\nshards [0,1]\nshards []\nmissed 0\n"
        self.assertEqual(filtered(lines), lines)

    def test_leaks_are_dropped(self):
        leaks = [
            "thread 'main' panicked at src/widget/gear.rs:812:9",
            "src/widget/cog.rs:40:5: replace + with - in Cog::from_teeth",
            "RESULT clippy PASS 12 fn spin_gear(g: Gear)",
            "RESULT Clippy PASS 12",
            "result clippy PASS 12",
            "count 4 mutants in fn x",
            "shards [0,1] ok",
            "missed 1: src/x.rs",
            "",
        ]
        self.assertEqual(filtered("\n".join(leaks) + "\n"), "")

    def test_mixed_keeps_only_the_safe_lines_in_order(self):
        text = "RESULT tests FAIL 30\ntest boolean::facts::corner ... FAILED\nRESULT all FAIL 31\n"
        self.assertEqual(filtered(text), "RESULT tests FAIL 30\nRESULT all FAIL 31\n")


class Run(unittest.TestCase):
    """kernel_ci.sh run: the command's output only in its log, one RESULT line in public, its exit code kept."""

    def run_it(self, *command):
        d = tempfile.mkdtemp()
        out = subprocess.run(["bash", SCRIPT, "run", "rounds", d, *command], capture_output=True, text=True)
        with open(os.path.join(d, "rounds.log")) as f:
            return out, f.read()

    def test_a_pass_prints_one_line_and_logs_the_rest(self):
        out, log = self.run_it("bash", "-c", "echo 'panicked at src/widget/gear.rs:812:9'; echo seed 42 >&2")
        self.assertRegex(out.stdout, r"^RESULT rounds PASS [0-9]+\n$")
        self.assertEqual((out.stderr, out.returncode), ("", 0))
        self.assertEqual(log, "panicked at src/widget/gear.rs:812:9\nseed 42\n")

    def test_a_failure_keeps_its_exit_code(self):
        out, log = self.run_it("bash", "-c", "echo leak >&2; exit 3")
        self.assertRegex(out.stdout, r"^RESULT rounds FAIL [0-9]+\n$")
        self.assertEqual((out.stderr, out.returncode, log), ("", 3, "leak\n"))

    def test_the_line_passes_the_filter(self):
        out, _ = self.run_it("true")
        self.assertEqual(filtered(out.stdout), out.stdout)


class Describe(unittest.TestCase):
    """kernel_ci.sh describe: the kernel commit's status text. It once printed the failing list twice
    ("Failed: tests,clippytests,clippy") from ${failing:+...}${failing:-...}."""

    def describe(self, results, outcome="failure"):
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            f.write(results)
        return subprocess.run(["bash", SCRIPT, "describe", f.name, outcome], capture_output=True, text=True, check=True).stdout

    def test_failing_checks_are_named_once(self):
        # Worked by hand: tests and boolean-facts failed, "all" is the summary line, not a check.
        text = "RESULT clippy PASS 3\nRESULT tests FAIL 40\nRESULT boolean-facts FAIL 9\nRESULT all FAIL 52\n"
        self.assertEqual(self.describe(text), "Failed: tests,boolean-facts\n")

    def test_at_most_five_are_named(self):
        text = "".join(f"RESULT c{i} FAIL 1\n" for i in range(7))
        self.assertEqual(self.describe(text), "Failed: c0,c1,c2,c3,c4\n")

    def test_no_failing_check_gives_the_outcome(self):
        self.assertEqual(self.describe("RESULT clippy PASS 3\nRESULT all PASS 3\n", "success"), "success\n")
        # A step that died before any RESULT line (no file at all) still says what happened.
        self.assertEqual(subprocess.run(["bash", SCRIPT, "describe", "/nonexistent", "cancelled"], capture_output=True, text=True).stdout, "cancelled\n")

    def test_the_old_expression_repeats_the_list(self):
        old = subprocess.run(["bash", "-c", 'failing=tests,clippy; OUTCOME=failure; echo "${failing:+Failed: $failing}${failing:-$OUTCOME}"'],
                             capture_output=True, text=True).stdout
        self.assertEqual(old, "Failed: tests,clippytests,clippy\n")




class Save(unittest.TestCase):
    """kernel_ci.sh save against a local bare repo standing in for
    kernel-results (RESULTS_REPO)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        t = self.tmp.name
        self.remote = os.path.join(t, "results.git")
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", self.remote], check=True)
        seed = os.path.join(t, "seed")
        subprocess.run(["git", "clone", "-q", self.remote, seed], check=True, capture_output=True)
        open(os.path.join(seed, "README"), "w").close()
        git = ["git", "-C", seed, "-c", "user.name=t", "-c", "user.email=t@t"]
        subprocess.run(git + ["add", "README"], check=True)
        subprocess.run(git + ["commit", "-qm", "seed"], check=True)
        subprocess.run(git + ["push", "-q", "origin", "HEAD:main"], check=True, capture_output=True)
        self.logs = os.path.join(t, "logs")
        os.makedirs(os.path.join(self.logs, "release"))
        with open(os.path.join(self.logs, "tests.log"), "w") as f:
            f.write("all passed\n")

    def save(self):
        env = dict(os.environ, RESULTS_REPO=self.remote, RESULTS_PATH="ci/pr-3/abc/1-1", LABEL="pr-3", HEAD_SHA="abc")
        return subprocess.run(["bash", SCRIPT, "save", "checks", self.logs], capture_output=True, text=True, env=env)

    def saved(self):
        return subprocess.run(["git", "-C", self.remote, "ls-tree", "-r", "--name-only", "main"], capture_output=True, text=True, check=True).stdout.split()

    def test_files_over_50_mb_stay_behind_and_are_counted(self):
        # 50 MiB + 1 byte is over the limit (find -size +50M counts whole
        # MiB: over 50 means at least 50 MiB + 1 byte); exactly 50 MiB is
        # not. Sparse files, so the test writes almost nothing.
        for name, size in [("release/plain.jsonl", 50 * 2**20 + 1), ("release/at-limit.bin", 50 * 2**20)]:
            with open(os.path.join(self.logs, name), "wb") as f:
                f.truncate(size)
        out = self.save()
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout, "saved checks (1 over 50 MB left out)\n")
        files = self.saved()
        self.assertIn("ci/pr-3/abc/1-1/checks/tests.log", files)
        self.assertIn("ci/pr-3/abc/1-1/checks/release/at-limit.bin", files)
        self.assertNotIn("ci/pr-3/abc/1-1/checks/release/plain.jsonl", files)

    def test_small_logs_save_with_no_note(self):
        out = self.save()
        self.assertEqual((out.returncode, out.stdout), (0, "saved checks\n"))
        self.assertIn("ci/pr-3/abc/1-1/checks/tests.log", self.saved())

    def test_random_testing_saves_without_a_label(self):
        # Regression: random testing's and fuzzing's jobs set RESULTS_PATH but
        # not LABEL or HEAD_SHA, and the commit message read both, so every
        # save there died with "LABEL: unbound variable" (set -u).
        env = {k: v for k, v in os.environ.items() if k not in ("LABEL", "HEAD_SHA")}
        env.update(RESULTS_REPO=self.remote, RESULTS_PATH="runs/7-1")
        out = subprocess.run(["bash", SCRIPT, "save", "test-0", self.logs], capture_output=True, text=True, env=env)
        self.assertEqual((out.returncode, out.stdout, out.stderr), (0, "saved test-0\n", ""))
        self.assertIn("runs/7-1/test-0/tests.log", self.saved())

    def test_a_refused_push_says_why_without_naming_files(self):
        # The way GitHub refuses a file over 100 MB, from a hook.
        hook = os.path.join(self.remote, "hooks", "pre-receive")
        with open(hook, "w") as f:
            f.write("#!/bin/sh\necho 'error: GH001: Large files detected.' >&2\n"
                    "echo 'error: File ci/pr-3/abc/1-1/checks/secret_name.rs is 1242 MB; this exceeds the limit' >&2\nexit 1\n")
        os.chmod(hook, 0o755)
        out = self.save()
        self.assertEqual(out.returncode, 1)
        self.assertEqual(out.stdout, "could not save checks (GH001,exceeds,rejected)\n")
        self.assertNotIn("secret_name", out.stdout + out.stderr)


def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class Checkout(unittest.TestCase):
    """kernel_ci.sh checkout against a local repo standing in for the kernel
    (KERNEL_SOURCE). actions/checkout printed the kernel commit's subject
    ("HEAD is now at <sha> <subject>") and, with fetch-depth 0, every kernel
    branch and tag name into the public log; this prints nothing.

    The repo, worked by hand: base (on main) <- feature (branch
    "claude/secret-branch", subject "Secret subject"), and merge, GitHub's
    merge of feature into main: parents base (first) and feature (second).
    So for a pull request run sha=merge, the statuses may go on feature
    (merge's second parent) and nowhere else; for main, sha=head=base."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        t = self.tmp.name
        self.src = os.path.join(t, "kernel")
        g = lambda *a: git("-c", "user.name=t", "-c", "user.email=t@t", *a, cwd=self.src)
        os.makedirs(os.path.join(self.src, "prototypes", "oracle"))
        os.makedirs(os.path.join(self.src, "kernel"))
        git("init", "-q", "-b", "main", self.src)
        g("config", "uploadpack.allowAnySHA1InWant", "true")
        for name in ("prototypes/oracle/o.py", "kernel/lib.txt"):
            with open(os.path.join(self.src, name), "w") as f:
                f.write("base\n")
        g("add", "-A"); g("commit", "-qm", "Base")
        self.base = g("rev-parse", "HEAD")
        g("checkout", "-qb", "claude/secret-branch")
        with open(os.path.join(self.src, "kernel", "lib.txt"), "w") as f:
            f.write("feature\n")
        g("commit", "-qam", "Secret subject"); g("tag", "kernel-9.9.9-secret-tag")
        self.feature = g("rev-parse", "HEAD")
        g("checkout", "-q", "main")
        g("merge", "-q", "--no-ff", "-m", "Merge", self.feature)
        self.merge = g("rev-parse", "HEAD")
        self.dest = os.path.join(t, "k")

    def checkout(self, *args, **env):
        e = {k: v for k, v in os.environ.items() if k not in ("HEAD_SHA", "SPARSE")}
        e.update(KERNEL_SOURCE=self.src, KERNEL_READ="the-secret-key", **env)
        return subprocess.run(["bash", SCRIPT, "checkout", self.dest, *args], capture_output=True, text=True, env=e)

    def assert_quiet_ok(self, out):
        self.assertEqual((out.returncode, out.stdout, out.stderr), (0, "", ""))

    def test_checks_out_the_commit_and_prints_nothing(self):
        out = self.checkout(self.merge, self.base)
        self.assert_quiet_ok(out)
        self.assertEqual(git("rev-parse", "HEAD", cwd=self.dest), self.merge)
        with open(os.path.join(self.dest, "kernel", "lib.txt")) as f:
            self.assertEqual(f.read(), "feature\n")
        # The mutants' base is there too, for git diff BASE HEAD.
        git("cat-file", "-e", self.base + "^{commit}", cwd=self.dest)
        # No other branch or tag came along, and the key is nowhere in .git.
        self.assertEqual(git("for-each-ref", "--format=%(refname)", cwd=self.dest), "refs/heads/tested")
        config = open(os.path.join(self.dest, ".git", "config")).read()
        self.assertNotIn("the-secret-key", config)

    def test_the_history_comes_along(self):
        # Regression: a depth-1 checkout broke the release build, which
        # numbers itself from the merge order in main's history (every
        # Kernel CI run's release-build failed, 2026-10-29). Merge's history
        # holds three commits: base, feature and merge itself.
        self.assert_quiet_ok(self.checkout(self.merge))
        self.assertEqual(git("rev-parse", "--is-shallow-repository", cwd=self.dest), "false")
        self.assertEqual(git("rev-list", "--count", "HEAD", cwd=self.dest), "3")

    def test_a_sparse_checkout_stays_shallow(self):
        self.assert_quiet_ok(self.checkout("main", SPARSE="prototypes/oracle"))
        self.assertEqual(git("rev-parse", "--is-shallow-repository", cwd=self.dest), "true")

    def test_a_branch_name_works(self):
        self.assert_quiet_ok(self.checkout("main"))
        self.assertEqual(git("rev-parse", "HEAD", cwd=self.dest), self.merge)

    def test_sparse_limits_the_files(self):
        self.assert_quiet_ok(self.checkout("main", SPARSE="prototypes/oracle"))
        self.assertTrue(os.path.exists(os.path.join(self.dest, "prototypes", "oracle", "o.py")))
        self.assertFalse(os.path.exists(os.path.join(self.dest, "kernel", "lib.txt")))

    def test_a_failed_fetch_says_so_in_words_only(self):
        out = self.checkout("claude/no-such-branch")
        self.assertEqual((out.returncode, out.stdout, out.stderr), (1, "could not check out the kernel\n", ""))

    def test_bad_refs_are_refused_before_git_runs(self):
        for args in (["-x"], ["main;id"], ["main", "not-a-sha"]):
            out = self.checkout(*args)
            self.assertEqual((out.returncode, out.stdout), (1, "bad kernel ref\n"), args)

    def test_statuses_go_on_the_tested_head_only(self):
        # Pull request: merge tested, statuses on feature (its second parent).
        self.assert_quiet_ok(self.checkout(self.merge, HEAD_SHA=self.feature))
        # main: tested and statuses on the same commit.
        shutil.rmtree(self.dest)
        self.assert_quiet_ok(self.checkout(self.base, HEAD_SHA=self.base))
        # Refused: the first parent (main's tip, not the pull request), and a
        # commit merge doesn't contain at all (base tested, feature marked).
        for sha, head in ((self.merge, self.base), (self.base, self.feature)):
            shutil.rmtree(self.dest)
            out = self.checkout(sha, HEAD_SHA=head)
            self.assertEqual((out.returncode, out.stdout), (1, "the statuses' commit is not the one tested\n"))


class NoNoisyKernelCheckout(unittest.TestCase):
    """No workflow checks the kernel out with actions/checkout, which prints
    the commit's subject (and with fetch-depth 0 every branch and tag name)
    into the public log: they use kernel_ci.sh checkout."""

    WORKFLOWS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "workflows")

    @staticmethod
    def noisy(text):
        return re.findall(r"repository:\s*[\w.-]+/kernel\s*$", text, re.M)

    def test_no_workflow_uses_it(self):
        for name in sorted(os.listdir(self.WORKFLOWS)):
            with open(os.path.join(self.WORKFLOWS, name)) as f:
                self.assertEqual(self.noisy(f.read()), [], name)

    def test_the_check_catches_it(self):
        planted = "      - uses: actions/checkout@abc # v7\n        with:\n          repository: SpindleLabs-app/kernel\n"
        self.assertEqual(len(self.noisy(planted)), 1)
        self.assertEqual(self.noisy("repository: SpindleLabs-app/kernel-results\n"), [])


def jobs(text):
    """{job name: its lines} of a workflow, read by hand (no YAML library on
    the runners): each job starts at a two-space-indented key under jobs:."""
    body = text[text.index("\njobs:\n"):]
    found = {}
    # Any key GitHub takes as a job id: letters, digits, "_" and "-", any case (my_job, Build).
    for part in re.split(r"(?m)^(?=  [A-Za-z_][A-Za-z0-9_-]*:\n)", body)[1:]:
        found[part.split(":", 1)[0].strip()] = part
    return found


class SecretsOnlyOnMain(unittest.TestCase):
    """Every job that uses the kernel's keys or the merge queue's token names
    the environment holding them, which only main may use: as plain
    repository secrets, any branch's workflow could read them (and the key
    clones the private kernel). No such job runs npm, so no npm package's
    install or test code ever runs beside the key (nor npx, yarn, pnpm or
    a node script). A secret this check doesn't know, one named at the
    workflow's top level (every job would get it), and `secrets: inherit`
    are refused too, so a new key can't slip past it (weak-spot hunt 10-29).
    It reads the workflows only: a script a job runs (the kernel's
    ci/checks.sh runs npm ci for its dump-viewer check) is out of its sight,
    which is why the keys are step-scoped and the environments main-only."""

    WORKFLOWS = NoNoisyKernelCheckout.WORKFLOWS
    NEEDS = {"KERNEL_READ": "kernel", "RESULTS_WRITE": "kernel", "MERGE_QUEUE_TOKEN": "merge"}
    # Secrets that are no key: GitHub's own per-run token.
    PLAIN = {"GITHUB_TOKEN"}
    SECRET = re.compile(r"""secrets\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([^'"]+)['"]\s*\])""")

    @classmethod
    def secrets(cls, text):
        return {a or b for a, b in cls.SECRET.findall(text)}

    def problems(self, name, text):
        out = []
        top = text[: text.index("\njobs:\n")]
        if self.secrets(top):
            out.append(f"{name}: secrets named for the whole workflow ({', '.join(sorted(self.secrets(top)))})")
        for job, lines in jobs(text).items():
            # Comments say nothing: "# environment: kernel" is no environment.
            code = "\n".join(line for line in lines.split("\n") if not line.lstrip().startswith("#"))
            if re.search(r"(?m)^\s*secrets:\s*inherit\b", code):
                out.append(f"{name} {job}: passes every secret on (secrets: inherit)")
            named = self.secrets(code)
            for unknown in sorted(named - set(self.NEEDS) - self.PLAIN):
                out.append(f"{name} {job}: uses {unknown}, which this check doesn't know")
            used = {env for secret, env in self.NEEDS.items() if secret in named}
            if not used:
                continue
            m = re.search(r"(?m)^    environment: (\S+)$", code) or re.search(r"(?m)^    environment:\n      name: (\S+)$", code)
            if len(used) > 1 or not m or m.group(1) not in used:
                out.append(f"{name} {job}: needs environment {'/'.join(sorted(used))}")
            # A command, not a name: setup-node and node-version are no node run.
            if re.search(r"(?<![\w-])(npm (ci|install|run|exec)|npx|yarn|pnpm|node)(?![\w-])", code):
                out.append(f"{name} {job}: runs npm beside a key")
        return out

    def test_every_workflow(self):
        found = []
        for name in sorted(os.listdir(self.WORKFLOWS)):
            with open(os.path.join(self.WORKFLOWS, name)) as f:
                found += self.problems(name, f.read())
        self.assertEqual(found, [])

    def test_the_check_catches_each_break(self):
        def wf(job):
            return "on: push\njobs:\n  a:\n    runs-on: x\n" + job
        ok = "    environment: kernel\n    steps:\n      - env:\n          K: ${{ secrets.KERNEL_READ }}\n"
        self.assertEqual(self.problems("w", wf(ok)), [])
        # No environment, the wrong one, and npm beside the key.
        self.assertEqual(self.problems("w", wf(ok.replace("    environment: kernel\n", ""))), ["w a: needs environment kernel"])
        self.assertEqual(self.problems("w", wf(ok.replace("kernel", "merge"))), ["w a: needs environment kernel"])
        self.assertEqual(self.problems("w", wf(ok + "      - run: npm ci\n")), ["w a: runs npm beside a key"])
        # Weak-spot hunt 10-29: each form the check used to miss, caught.
        key = "    steps:\n      - env:\n          K: ${{ secrets.KERNEL_READ }}\n"
        self.assertEqual(self.problems("w", "on: push\njobs:\n  my_job:\n    runs-on: x\n" + key), ["w my_job: needs environment kernel"])
        self.assertEqual(self.problems("w", "on: push\njobs:\n  Build:\n    runs-on: x\n" + key), ["w Build: needs environment kernel"])
        self.assertEqual(self.problems("w", wf(key.replace("secrets.KERNEL_READ", "secrets['KERNEL_READ']"))), ["w a: needs environment kernel"])
        self.assertEqual(self.problems("w", wf(key.replace("secrets.KERNEL_READ", 'secrets["MERGE_QUEUE_TOKEN"]'))), ["w a: needs environment merge"])
        self.assertEqual(self.problems("w", "on: push\nenv:\n  K: ${{ secrets.KERNEL_READ }}\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo\n"),
                         ["w: secrets named for the whole workflow (KERNEL_READ)"])
        self.assertEqual(self.problems("w", "on: push\njobs:\n  a:\n    uses: ./.github/workflows/x.yml\n    secrets: inherit\n"), ["w a: passes every secret on (secrets: inherit)"])
        for runner in ("npx something", "pnpm install", "yarn", "node scripts/x.js"):
            self.assertEqual(self.problems("w", wf(ok + f"      - run: {runner}\n")), ["w a: runs npm beside a key"], runner)
        self.assertEqual(self.problems("w", wf("    # environment: kernel\n" + key)), ["w a: needs environment kernel"], "a comment is no environment")
        self.assertEqual(self.problems("w", wf("    environment:\n      name: kernel\n" + key)), [], "the mapping form names it too")
        self.assertEqual(self.problems("w", wf(key.replace("KERNEL_READ", "SOME_NEW_KEY"))), ["w a: uses SOME_NEW_KEY, which this check doesn't know"])
        self.assertEqual(self.problems("w", wf(key.replace("KERNEL_READ", "GITHUB_TOKEN"))), [])


if __name__ == "__main__":
    unittest.main()

"""Tests for monkey_night.py and the monkey's part of collect-results.sh and
file_issues.py (hunt 3f): python3 -m unittest discover -s .github/scripts

The logs below are written the way apps/fission/e2e/monkey.mjs prints
(its `report`): one "seed N: pass (K actions)" or "seed N: FAIL at action K:
<check>: <message>" line per seed, the shrunk list after a failure.
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest

import monkey_night
from file_issues import kinds_of

HERE = os.path.dirname(os.path.abspath(__file__))

LOG = """seed 20261025: pass (2000 actions)
seed 20261026: FAIL at action 65: no sideways scrolling: the page is 4 px wider than the window
  shrunk to 3 actions in 41 replays:
    {"kind":"phone"}
  saved to /x/e2e/monkey-results/seed-20261026.json
monkey: 1 failed
"""


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


class Night(unittest.TestCase):
    def night(self, log, first=20261025, count=2, steps=2000, saved=()):
        """Runs monkey_night.write; returns (failed, {relative path: text})."""
        with tempfile.TemporaryDirectory() as d:
            results, out = os.path.join(d, "results"), os.path.join(d, "out")
            os.makedirs(results)
            for seed in saved:
                with open(os.path.join(results, f"seed-{seed}.json"), "w") as f:
                    json.dump({"seed": seed, "actions": [{"kind": "phone"}]}, f)
            failed = monkey_night.write(log, results, out, first, count, steps)
            files = {}
            for root, _, names in os.walk(out):
                for n in names:
                    with open(os.path.join(root, n)) as f:
                        files[os.path.relpath(os.path.join(root, n), out)] = f.read()
            return failed, files

    def test_one_seed_failing_gets_its_folder(self):
        failed, files = self.night(LOG, saved=[20261026])
        self.assertEqual(failed, 1)
        # Worked from the log: seeds 20261025 and 20261026 (first 20261025, 2 seeds), the second failed.
        self.assertEqual(files["report.txt"],
                         "Monkey, seeds 20261025-20261026: 2 session(s) of 2000 actions in Chromium; 1 FAILED\n"
                         "seed 20261025: pass (2000 actions)\n"
                         "seed 20261026: FAIL: no sideways scrolling: the page is 4 px wider than the window\n")
        report = files["seed-monkey-20261026/monkey-report.txt"].splitlines()
        self.assertEqual(report[1],
                         "failure: no sideways scrolling: the page is 4 px wider than the window | seed 20261026 at action 65; "
                         "replay: cd apps/fission && npm run build && FISSION_SEED=20261026 MONKEY_STEPS=2000 node e2e/monkey.mjs")
        self.assertEqual(json.loads(files["seed-monkey-20261026/actions.json"])["actions"], [{"kind": "phone"}])
        self.assertNotIn("seed-monkey-20261025/monkey-report.txt", files)

    def test_a_clean_night(self):
        failed, files = self.night("seed 5: pass (2000 actions)\nseed 6: pass (2000 actions; known bug seen: x)\n", first=5)
        self.assertEqual(failed, 0)
        self.assertEqual(files["report.txt"].splitlines()[0],
                         "Monkey, seeds 5-6: 2 session(s) of 2000 actions in Chromium; every check passed after every action")
        self.assertEqual(sorted(files), ["report.txt"])

    def test_a_seed_never_reported_is_a_failure(self):
        # The job ran out of time during the second session: an empty
        # second line must not read as a clean night.
        failed, files = self.night("seed 5: pass (2000 actions)\n", first=5)
        self.assertEqual(failed, 1)
        self.assertIn("1 FAILED", files["report.txt"])
        self.assertIn("failure: no result: the session never finished", files["seed-monkey-6/monkey-report.txt"])
        # Nothing at all (the tester crashed before its first line): both seeds.
        failed, _ = self.night("", first=5)
        self.assertEqual(failed, 2)

    def test_regression_and_replay_lines_are_not_seeds(self):
        # Only the night's own seeds count, not a kept regression's line.
        failed, files = self.night("regression monkey-x.json: FAIL at action 3: a: b\nseed 1: pass (2000 actions)\n", first=1, count=1)
        self.assertEqual(failed, 0)

    def test_the_kind_takes_numbers_out(self):
        _, files = self.night(LOG, saved=[20261026])
        kinds = kinds_of({"monkey-report.txt": files["seed-monkey-20261026/monkey-report.txt"]})
        self.assertEqual(list(kinds), ["monkey no sideways scrolling: the page is # px wider than the window"])


class Collect(unittest.TestCase):
    def test_a_failing_night_reaches_the_branch_and_files_its_kind(self):
        with tempfile.TemporaryDirectory() as d:
            origin, work, incoming = (os.path.join(d, x) for x in ("origin.git", "work", "in"))
            git(d, "init", "-q", "--bare", origin)
            git(d, "init", "-q", work)
            git(work, "remote", "add", "origin", origin)
            monkey_night.write(LOG, os.path.join(d, "none"), os.path.join(incoming, "monkey"), 20261025, 2, 2000)
            env = {k: v for k, v in os.environ.items() if k not in ("GH_TOKEN", "GITHUB_STEP_SUMMARY")}
            env.update(IN=incoming, RUN_URL="https://example.invalid/runs/1", COMMIT="abcdef1234567", BRANCH="main",
                       GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
            for s in ("collect-results.sh", "file_issues.py"):
                shutil.copy(os.path.join(HERE, s), d)
            out = subprocess.run(["bash", os.path.join(d, "collect-results.sh")], cwd=work, env=env, capture_output=True, text=True)
            self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
            check = os.path.join(d, "check")
            git(d, "clone", "-q", "-b", "test-results", origin, check)

            def read(path):
                with open(os.path.join(check, path)) as f:
                    return f.read()
            self.assertIn("failure: no sideways scrolling", read("failures/seed-monkey-20261026/monkey-report.txt"))
            self.assertIn("tested commit abcdef1234567 on branch main", read("failures/seed-monkey-20261026/commit.txt"))
            self.assertIn("Latest monkey sessions", read("summary.txt"))
            self.assertIn("  seed 20261026: FAIL: no sideways scrolling", read("summary.txt"))
            self.assertRegex(read("monkey/log.txt"), r"^\d{4}-\d\d-\d\d \d\d:\d\d,abcdef1,main,Monkey, seeds 20261025-20261026: .*1 FAILED\n$")
            # No GH_TOKEN: file_issues.py says what it would file.
            self.assertIn("create  monkey no sideways scrolling: the page is # px wider than the window", out.stdout)


if __name__ == "__main__":
    unittest.main()

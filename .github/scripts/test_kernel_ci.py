"""kernel_ci.sh filter lets only the kernel ci scripts' public lines through:
python3 -m unittest discover -s .github/scripts

kernel-ci.yml runs the private kernel's checks on this public repo's
runners, whose logs anyone can read, so every line of their output passes
through this filter first. Hand-worked cases: each allowed form, and lines a
leak would look like (a panic naming a source file, a mutant quoting a
source line, a RESULT line with something extra after it)."""

import os
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
            "thread 'main' panicked at src/boolean/facts.rs:812:9",
            "src/ops/profile.rs:40:5: replace + with - in Seg::from_bulge",
            "RESULT clippy PASS 12 fn split_edge(e: Edge)",
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
        out, log = self.run_it("bash", "-c", "echo 'panicked at src/boolean/facts.rs:812:9'; echo seed 42 >&2")
        self.assertRegex(out.stdout, r"^RESULT rounds PASS [0-9]+\n$")
        self.assertEqual((out.stderr, out.returncode), ("", 0))
        self.assertEqual(log, "panicked at src/boolean/facts.rs:812:9\nseed 42\n")

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


if __name__ == "__main__":
    unittest.main()


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

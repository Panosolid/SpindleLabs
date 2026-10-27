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

"""The private oracle's errors stay out of the public logs: python3 -m unittest discover -s .github/scripts

Random testing and fuzzing run the OpenCascade oracle, checked out from the
private kernel repository, on this public repository's runners, whose logs
anyone can read. An error the oracle doesn't catch (a cut-off results file,
a failed install) prints a Python traceback on stderr, and a traceback names
the oracle's files and lines and quotes its source. So every run of an
oracle script sends stderr to a file of the runner's that is never uploaded,
or runs inside `kernel_ci.sh run`, which keeps all its output in the private
log (sweep 2026-10-28: four runs left it on the log)."""

import glob
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
WORKFLOWS = os.path.join(os.path.dirname(HERE), "workflows")

ORACLE = re.compile(r"\bpython3?\b[^#\n]*\b(?:golden_step|sketch_extrude)\.py\b|\bpython3?\b[^#\n]*\bprototypes/")
STDERR_KEPT = re.compile(r"\s2>>?\s*\S")


def problem(line, wrapped=False):
    """Why a workflow line lets an oracle script's errors reach the log, or None.

    `wrapped`: the line continues a `kernel_ci.sh run` command."""
    if not ORACLE.search(line):
        return None
    if wrapped or "kernel_ci.sh run" in line or STDERR_KEPT.search(line):
        return None
    return "runs the private oracle without sending its stderr to a file"


def oracle_problems():
    for path in sorted(glob.glob(os.path.join(WORKFLOWS, "*.yml"))):
        with open(path) as f:
            wrapped = False
            for number, line in enumerate(f, 1):
                if line.lstrip().startswith("#"):
                    continue
                why = problem(line, wrapped)
                if why:
                    yield f"{os.path.basename(path)}:{number} {why}"
                # A command continued on the next line keeps its wrapper.
                wrapped = line.rstrip().endswith("\\") and (wrapped or "kernel_ci.sh run" in line)


class CheckerTest(unittest.TestCase):
    """The checker itself, so a weakened pattern can't pass the workflows unnoticed."""

    def test_an_oracle_run_with_stderr_on_the_log_is_caught(self):
        self.assertIsNotNone(problem('python3 k/prototypes/oracle/golden_step.py "$OUT/a.jsonl" >"$T/a.txt" || code=$?'))
        self.assertIsNotNone(problem('if ! python3 sketch_extrude.py "$OUT/oracle.jsonl" "$OUT/d.txt"; then'))
        self.assertIsNotNone(problem("cd k/prototypes/oracle && python3 sketch_extrude.py a b --planted"))

    def test_stdout_alone_is_not_enough(self):
        # `>file` hides only stdout; the traceback is on stderr.
        self.assertIsNotNone(problem("python3 golden_step.py in.jsonl >out.txt"))

    def test_an_oracle_run_with_stderr_in_a_file_passes(self):
        self.assertIsNone(problem('python3 golden_step.py in.jsonl >out.txt 2>"$RUNNER_TEMP/oracle-errors.txt" || code=$?'))
        self.assertIsNone(problem('python3 sketch_extrude.py a b --planted 2>>"$RUNNER_TEMP/oracle-errors.txt"'))

    def test_a_run_inside_kernel_ci_passes(self):
        self.assertIsNone(problem("kernel_ci.sh run oracle logs python3 ../prototypes/oracle/fuzz_shapes.py a b"))
        self.assertIsNone(problem("'cd k && python3 ../prototypes/oracle/fuzz_shapes.py a b' && exit 0", wrapped=True))

    def test_other_python_is_left_alone(self):
        self.assertIsNone(problem("python3 .github/scripts/monkey_night.py log.txt"))


class WorkflowsTest(unittest.TestCase):
    def test_the_workflows_run_the_oracle(self):
        # The check below must have something to look at.
        found = 0
        for path in glob.glob(os.path.join(WORKFLOWS, "*.yml")):
            with open(path) as f:
                found += sum(1 for line in f if ORACLE.search(line) and not line.lstrip().startswith("#"))
        self.assertGreaterEqual(found, 4)

    def test_no_oracle_run_lets_its_errors_reach_the_log(self):
        self.assertEqual(list(oracle_problems()), [])


if __name__ == "__main__":
    unittest.main()

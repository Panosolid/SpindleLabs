"""kernel_ci.sh filter lets only the kernel ci scripts' public lines through:
python3 -m unittest discover -s .github/scripts

kernel-ci.yml runs the private kernel's checks on this public repo's
runners, whose logs anyone can read, so every line of their output passes
through this filter first. Hand-worked cases: each allowed form, and lines a
leak would look like (a panic naming a source file, a mutant quoting a
source line, a RESULT line with something extra after it)."""

import os
import subprocess
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


if __name__ == "__main__":
    unittest.main()

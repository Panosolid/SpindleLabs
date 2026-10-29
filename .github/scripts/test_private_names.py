"""No public file names the private kernel's source files: python3 -m unittest discover -s .github/scripts

The kernel moved to a private repository (2026-10-27, Ben's decision) so it
is hard to copy, and public text says what changed, never how. A comment
pointing at `kernel/src/<file>.rs`, or naming an internal part like the
"facts table", is a map of that private code (sweep 2026-10-29 found 45).
This repository's files say "the kernel's", or name the published limits in
kernel.json, instead. The changelog has its own guard (changelog.py leaks);
the CI scripts' own tests use made-up names (widget.rs) and are left out."""

import os
import re
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NAMES = re.compile(r"\b[a-z_]+\.rs\b|\bfacts table\b", re.I)
SKIP = re.compile(r"^(packages/core/src/kernel/wasm/|\.github/scripts/test_[a-z_]+\.py$|\.github/scripts/changelog\.py$)")


def leaks(path, text):
    """'path:line: name' for each private name in a public file's text."""
    if SKIP.match(path):
        return []
    return [f"{path}:{n}: {m.group(0)}" for n, line in enumerate(text.splitlines(), 1) for m in NAMES.finditer(line)]


def tracked():
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout
    return [p for p in out.decode().split("\0") if p]


class CheckerTest(unittest.TestCase):
    def test_a_kernel_file_or_part_is_caught(self):
        # By hand: one .rs name on line 2, the part's name on line 3.
        text = "// fine\n// see kernel/src/ops/place.rs\n// the Facts Table says\n"
        self.assertEqual(leaks("workspaces/design/src/x.ts", text), [
            "workspaces/design/src/x.ts:2: place.rs", "workspaces/design/src/x.ts:3: Facts Table"])

    def test_plain_words_pass(self):
        self.assertEqual(leaks("a.ts", "// the kernel's LINEAR (kernel.json); first.rsvp is not Rust\n"), [])

    def test_the_ci_tests_made_up_names_are_left_out(self):
        self.assertEqual(leaks(".github/scripts/test_file_issues.py", "src/widget.rs"), [])
        self.assertNotEqual(leaks(".github/scripts/file_issues.py", "src/widget.rs"), [])


class RepositoryTest(unittest.TestCase):
    def test_no_public_file_names_the_kernels_files(self):
        found = []
        for path in tracked():
            try:
                with open(os.path.join(ROOT, path), encoding="utf-8") as f:
                    found += leaks(path, f.read())
            except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
                continue  # binary files and deleted ones
        self.assertEqual(found, [])


if __name__ == "__main__":
    unittest.main()

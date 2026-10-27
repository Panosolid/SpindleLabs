"""Tests for check_kernel_build.py: python3 -m unittest discover -s .github/scripts"""

import hashlib
import json
import os
import shutil
import tempfile
import unittest

import check_kernel_build as ckb


class Folder(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        for name in ckb.FILES:
            with open(os.path.join(self.dir, name), "w") as f:
                f.write("x")
        with open(os.path.join(self.dir, "fission_kernel_bg.wasm"), "wb") as f:
            f.write(b"\0asm\1\0\0\0")
        # Worked by hand: the sha256 of those 8 bytes (an empty module's header).
        self.sha = hashlib.sha256(b"\0asm\1\0\0\0").hexdigest()
        self.info = {"version": "0.32.26", "build": "5eb448f3f0f5755e", "handshake": "75c476008f976db63b56621c58ca2eb3", "sha256": self.sha}
        self.write()

    def tearDown(self):
        shutil.rmtree(self.dir)

    def write(self):
        with open(os.path.join(self.dir, "kernel.json"), "w") as f:
            json.dump(self.info, f)

    def test_a_release_passes(self):
        self.assertEqual(ckb.problems(self.dir), [])

    def test_another_wasm_fails(self):
        with open(os.path.join(self.dir, "fission_kernel_bg.wasm"), "ab") as f:
            f.write(b"\0")
        self.assertIn("not the released build", ckb.problems(self.dir)[0])

    def test_a_plain_builds_kernel_json_fails(self):
        # What release/build.sh writes for a plain build: no key, no hash.
        self.info = {"handshake": None}
        self.write()
        found = ckb.problems(self.dir)
        self.assertTrue(any("no handshake key" in p for p in found), found)
        self.assertTrue(any("sha256" in p for p in found), found)

    def test_a_missing_file_is_named(self):
        os.remove(os.path.join(self.dir, "crates.json"))
        self.assertEqual(ckb.problems(self.dir), ["crates.json is missing"])


if __name__ == "__main__":
    unittest.main()

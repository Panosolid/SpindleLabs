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
        # The key's sha256 by hand: `printf %s 0123456789abcdef0123456789abcdef | sha256sum`.
        self.key = "0123456789abcdef0123456789abcdef"
        self.info = {"version": "0.32.26", "build": "5eb448f3f0f5755e", "sha256": self.sha,
                     "handshake_sha256": "3eb1bd439947eb762998e566ccc2e099c791118b2f40579cc4f7da2b5061b7f9"}
        self.key_file = os.path.join(self.dir, "kernel-key.ts")
        self.write()
        self.write_key(f'// Written by the kernel repo\'s Release workflow.\nexport const KERNEL_KEY = "{self.key}";\n')

    def tearDown(self):
        shutil.rmtree(self.dir)

    def write(self):
        with open(os.path.join(self.dir, "kernel.json"), "w") as f:
            json.dump(self.info, f)

    def write_key(self, text):
        with open(self.key_file, "w") as f:
            f.write(text)

    def problems(self):
        return ckb.problems(self.dir, self.key_file)

    def test_a_release_passes(self):
        self.assertEqual(self.problems(), [])

    def test_the_key_beside_the_build_fails(self):
        # What a release from before 2026-10-29 wrote: the key in kernel.json.
        self.info["handshake"] = self.key
        self.write()
        self.assertEqual(self.problems(), ["kernel.json holds a handshake key: the key must only be in kernel-key.ts"])

    def test_another_key_fails(self):
        # One digit changed: its sha256 is not kernel.json's.
        self.write_key(f'export const KERNEL_KEY = "{self.key[:-1]}e";\n')
        self.assertEqual(self.problems(), ["kernel-key.ts's key doesn't hash to kernel.json's handshake_sha256: not this build's key"])

    def test_a_missing_or_malformed_key_fails(self):
        for text in ("", f'export const KERNEL_KEY = "{self.key.upper()}";\n', f'export const KERNEL_KEY = "{self.key[:-1]}";\n'):
            self.write_key(text)
            self.assertEqual(self.problems(), ["kernel-key.ts has no 32-digit KERNEL_KEY"], text)
        os.remove(self.key_file)
        self.assertEqual(self.problems(), ["kernel-key.ts has no 32-digit KERNEL_KEY"])

    def test_another_wasm_fails(self):
        with open(os.path.join(self.dir, "fission_kernel_bg.wasm"), "ab") as f:
            f.write(b"\0")
        self.assertIn("not the released build", self.problems()[0])

    def test_a_plain_builds_kernel_json_fails(self):
        # What release/build.sh writes for a plain build: no key, no hash.
        self.info = {"handshake_sha256": None}
        self.write()
        found = self.problems()
        self.assertTrue(any("no handshake key sha256" in p for p in found), found)
        self.assertTrue(any("sha256" in p for p in found), found)

    def test_a_missing_file_is_named(self):
        os.remove(os.path.join(self.dir, "crates.json"))
        self.assertEqual(self.problems(), ["crates.json is missing"])


if __name__ == "__main__":
    unittest.main()

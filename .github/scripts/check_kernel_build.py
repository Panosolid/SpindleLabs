"""The committed kernel build is the release it says it is:
python3 .github/scripts/check_kernel_build.py [WASM_DIR]

packages/core/src/kernel/wasm/ holds the build the kernel repo's Release
workflow made (2026-10-27: the kernel's source is private). kernel.json's
sha256 must be the .wasm's, it must carry a build id and its handshake
key's sha256, and every file the app loads must be there, so a local
wasm-pack build tried and committed by mistake (no key, another hash) fails
CI instead of shipping. The key itself is never beside the build (since
2026-10-29: those files lifted out of the app must not start): it is in the
app's own code, ../kernel-key.ts (KERNEL_KEY, from the same Release
workflow), and must hash to kernel.json's handshake_sha256.
Exit 1 naming each problem. Tested in test_check_kernel_build.py."""

import hashlib
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WASM = os.path.join(ROOT, "packages", "core", "src", "kernel", "wasm")
FILES = ("fission_kernel.js", "fission_kernel.d.ts", "fission_kernel_bg.wasm", "fission_kernel_bg.wasm.d.ts",
         "kernel.json", "crates.json", "LICENSE-KERNEL.txt")


KEY = re.compile(r'^export const KERNEL_KEY = "([0-9a-f]{32})";$', re.M)


def problems(folder, key_file=None):
    key_file = key_file or os.path.join(folder, "..", "kernel-key.ts")
    found = [f"{name} is missing" for name in FILES if not os.path.isfile(os.path.join(folder, name))]
    if found:
        return found
    with open(os.path.join(folder, "kernel.json")) as f:
        info = json.load(f)
    with open(os.path.join(folder, "fission_kernel_bg.wasm"), "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    if info.get("sha256") != sha:
        found.append(f"fission_kernel_bg.wasm's sha256 is {sha}, kernel.json says {info.get('sha256')}: not the released build")
    if "handshake" in info:
        found.append("kernel.json holds a handshake key: the key must only be in kernel-key.ts")
    if not re.fullmatch(r"[0-9a-f]{64}", str(info.get("handshake_sha256"))):
        found.append("kernel.json has no handshake key sha256: not a release build")
    key = None
    if os.path.isfile(key_file):
        with open(key_file) as f:
            m = KEY.search(f.read())
        key = m and m.group(1)
    if not key:
        found.append("kernel-key.ts has no 32-digit KERNEL_KEY")
    elif hashlib.sha256(key.encode()).hexdigest() != info.get("handshake_sha256"):
        found.append("kernel-key.ts's key doesn't hash to kernel.json's handshake_sha256: not this build's key")
    if not re.fullmatch(r"[0-9a-f]{16}", str(info.get("build"))):
        found.append("kernel.json has no build id")
    return found


def main(argv):
    folder = argv[1] if len(argv) > 1 else WASM
    found = problems(folder)
    for p in found:
        print(p)
    if not found:
        with open(os.path.join(folder, "kernel.json")) as f:
            info = json.load(f)
        print(f"kernel {info['version']} build {info['build']}: the released build")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

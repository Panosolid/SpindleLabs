"""The committed kernel build is the release it says it is:
python3 .github/scripts/check_kernel_build.py [WASM_DIR]

packages/core/src/kernel/wasm/ holds the build the kernel repo's Release
workflow made (2026-10-27: the kernel's source is private). kernel.json's
sha256 must be the .wasm's, it must carry a build id and handshake key, and
every file the app loads must be there, so a local wasm-pack build tried and
committed by mistake (no key, another hash) fails CI instead of shipping.
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


def problems(folder):
    found = [f"{name} is missing" for name in FILES if not os.path.isfile(os.path.join(folder, name))]
    if found:
        return found
    with open(os.path.join(folder, "kernel.json")) as f:
        info = json.load(f)
    with open(os.path.join(folder, "fission_kernel_bg.wasm"), "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    if info.get("sha256") != sha:
        found.append(f"fission_kernel_bg.wasm's sha256 is {sha}, kernel.json says {info.get('sha256')}: not the released build")
    if not re.fullmatch(r"[0-9a-f]{32}", str(info.get("handshake"))):
        found.append("kernel.json has no handshake key: not a release build")
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

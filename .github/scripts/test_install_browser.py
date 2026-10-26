"""Tests for install-browser.sh:
python3 -m unittest discover -s .github/scripts

The script runs for real against a copy of an Ubuntu 24.04 runner's apt files
(APT_DIR), with fake `sudo` (runs the command as is), `npx` (follows a plan:
one line per call, an exit code or `sleep N`) and `dpkg` first on PATH."""

import os
import subprocess
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "install-browser.sh")

# /etc/apt/apt-mirrors.txt on GitHub's ubuntu-24.04 image: the Azure mirror first.
MIRRORS = "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttp://archive.ubuntu.com/ubuntu/\tpriority:2\nhttp://security.ubuntu.com/ubuntu/\tpriority:3\n"
# Its sources point at that list, so a sed over sources.list alone changes nothing.
SOURCES = "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-backports\nComponents: main universe restricted multiverse\n"
# An older image (ubuntu-22.04) named the mirror here instead.
OLD_SOURCES_LIST = "deb http://azure.archive.ubuntu.com/ubuntu/ jammy main restricted\n"


def fake(bin_dir, name, body):
    path = os.path.join(bin_dir, name)
    with open(path, "w") as f:
        f.write("#!/usr/bin/env bash\n" + body)
    os.chmod(path, 0o755)


class InstallBrowser(unittest.TestCase):
    def run_script(self, plan, env=None, browser="firefox"):
        """Runs the script with `npx` following `plan` (one entry per call: an exit code, or "sleep N" which
        sleeps N seconds then exits 0 if not killed first). Returns (exit code, stderr, apt dir contents, npx calls)."""
        with tempfile.TemporaryDirectory() as d:
            bins, apt = os.path.join(d, "bin"), os.path.join(d, "apt")
            os.makedirs(bins)
            os.makedirs(os.path.join(apt, "apt.conf.d"))
            os.makedirs(os.path.join(apt, "sources.list.d"))
            with open(os.path.join(apt, "apt-mirrors.txt"), "w") as f:
                f.write(MIRRORS)
            with open(os.path.join(apt, "sources.list.d", "ubuntu.sources"), "w") as f:
                f.write(SOURCES)
            with open(os.path.join(apt, "sources.list"), "w") as f:
                f.write(OLD_SOURCES_LIST)
            plan_file, log = os.path.join(d, "plan"), os.path.join(d, "npx.log")
            with open(plan_file, "w") as f:
                f.write("\n".join(plan) + "\n")
            fake(bins, "sudo", 'exec "$@"\n')
            fake(bins, "dpkg", f'echo "dpkg $*" >> "{log}"\n')
            fake(
                bins,
                "npx",
                f'echo "npx $*" >> "{log}"\n'
                f'step=$(head -n 1 "{plan_file}"); tail -n +2 "{plan_file}" > "{plan_file}.next"; mv "{plan_file}.next" "{plan_file}"\n'
                'case "$step" in sleep\\ *) sleep "${step#sleep }"; exit 0;; "") exit 99;; *) exit "$step";; esac\n',
            )
            run_env = {**os.environ, "PATH": bins + os.pathsep + os.environ["PATH"], "APT_DIR": apt, "RETRY_SLEEP": "0"}
            run_env.update(env or {})
            started = time.monotonic()
            p = subprocess.run([SCRIPT, browser], env=run_env, capture_output=True, text=True, timeout=120)
            self.elapsed = time.monotonic() - started
            files = {}
            for root, _, names in os.walk(apt):
                for n in names:
                    with open(os.path.join(root, n)) as f:
                        files[os.path.relpath(os.path.join(root, n), apt)] = f.read()
            calls = []
            if os.path.exists(log):
                with open(log) as f:
                    calls = f.read().splitlines()
            return p.returncode, p.stderr, files, calls

    def test_a_healthy_run_installs_the_packages_then_the_browser_in_one_try(self):
        code, err, files, calls = self.run_script(["0", "0"])
        self.assertEqual(code, 0, err)
        self.assertEqual(calls, ["npx playwright install-deps firefox", "npx playwright install firefox"])
        # apt's retry and stall settings are written before anything runs.
        self.assertEqual(files["apt.conf.d/80-retries"], 'Acquire::Retries "3";\nAcquire::http::Timeout "30";\nDPkg::Lock::Timeout "120";\n')
        # The first try keeps the runner's own mirror.
        self.assertEqual(files["apt-mirrors.txt"], MIRRORS)
        self.assertEqual(files["sources.list"], OLD_SOURCES_LIST)
        self.assertEqual(err, "")

    def test_after_a_failed_try_the_mirror_list_leads_with_archive_ubuntu_com(self):
        # Try 1's packages fail; try 2 installs both. The 2026-10-26 run: the old script changed sources.list only, so
        # a 24.04 runner (whose sources point at apt-mirrors.txt) kept downloading from the slow Azure mirror.
        code, err, files, calls = self.run_script(["1", "0", "0"])
        self.assertEqual(code, 0, err)
        self.assertIn("install-browser: try 1 of 3 failed", err)
        self.assertEqual(calls, ["npx playwright install-deps firefox", "dpkg --configure -a", "npx playwright install-deps firefox", "npx playwright install firefox"])
        self.assertNotIn("azure", files["apt-mirrors.txt"])
        self.assertTrue(files["apt-mirrors.txt"].startswith("http://archive.ubuntu.com/ubuntu/\tpriority:1\n"), files["apt-mirrors.txt"])
        self.assertEqual(files["apt-mirrors.txt"].count("\n"), 3, "the list keeps its three lines (archive.ubuntu.com now twice)")
        self.assertEqual(files["sources.list"], "deb http://archive.ubuntu.com/ubuntu/ jammy main restricted\n")
        self.assertEqual(files["sources.list.d/ubuntu.sources"], SOURCES, "the sources file names no mirror, so it is unchanged")

    def test_a_browser_download_that_fails_is_tried_again_after_the_packages(self):
        code, err, files, calls = self.run_script(["0", "1", "0", "0"])
        self.assertEqual(code, 0, err)
        self.assertEqual(calls[:2], ["npx playwright install-deps firefox", "npx playwright install firefox"])
        self.assertEqual(calls[-2:], ["npx playwright install-deps firefox", "npx playwright install firefox"])

    def test_three_failed_tries_fail_the_script(self):
        code, err, files, calls = self.run_script(["1", "1", "1"])
        self.assertEqual(code, 1)
        self.assertIn("try 3 of 3 failed", err)
        self.assertEqual(len([c for c in calls if c.startswith("npx")]), 3)
        self.assertEqual(len([c for c in calls if c.startswith("dpkg")]), 2, "a killed install is repaired before each later try")

    def test_the_package_limit_cuts_a_try_at_1_1x_and_not_at_0_9x(self):
        # PACKAGE_SECONDS = 2: a 1.8 s install (0.9×) finishes; a 2.2 s one (1.1×) is killed and the try fails.
        code, err, _, calls = self.run_script(["sleep 1.8", "0"], env={"PACKAGE_SECONDS": "2"})
        self.assertEqual(code, 0, err)
        self.assertEqual(len(calls), 2)
        code, err, _, calls = self.run_script(["sleep 2.2", "0", "0"], env={"PACKAGE_SECONDS": "2"})
        self.assertEqual(code, 0, err)
        self.assertIn("try 1 of 3 failed", err)
        self.assertEqual(len([c for c in calls if "install-deps" in c]), 2)

    def test_the_total_budget_ends_the_script_whatever_the_try(self):
        # Hand-worked: TOTAL_SECONDS = 3 with installs that would take 10 s each. Try 1 gets min(420, 3) = 3 s and is
        # killed; the time is up, so no second try starts. Done in well under the 30 s three full tries would take.
        code, err, _, calls = self.run_script(["sleep 10", "sleep 10", "sleep 10"], env={"TOTAL_SECONDS": "3"})
        self.assertEqual(code, 1)
        self.assertIn("try 1 of 3 failed", err)
        self.assertIn("out of time", err)
        self.assertEqual(len([c for c in calls if c.startswith("npx")]), 1)
        self.assertLess(self.elapsed, 20)


if __name__ == "__main__":
    unittest.main()

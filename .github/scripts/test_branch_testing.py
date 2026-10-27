"""Tests for branch_testing.py: python3 -m unittest discover -s .github/scripts

Times are worked by hand from one clock: NOW is 2026-10-26 04:00:00 UTC,
1792987200 (2026-10-26 is day 20752 since 1970: 20752 x 86400 = 1792972800,
plus 4 h = 14400)."""

import os
import subprocess
import tempfile
import unittest

import branch_testing as bt

HERE = os.path.dirname(os.path.abspath(__file__))
NOW = 1792987200
REPO = "o/r"


def run(id, branch, status, event="workflow_dispatch", repo=REPO):
    return {"id": id, "head_branch": branch, "status": status, "event": event, "head_repository": {"full_name": repo}}


def kernel_run(id, branch, status, event="workflow_dispatch"):
    """kernel-nightly.yml's runs all start from this repository's main; the kernel branch is in the title."""
    return dict(run(id, "main", status, event), display_title=f"Kernel random testing on {branch}")


def job(name, status, created):
    return {"name": name, "status": status, "created_at": created}


def reason(nightly=(), jobs=(), started=NOW - 600, branch="claude/a", own=1):
    return bt.yield_reason(NOW, started, branch, own, REPO, list(nightly), list(jobs))


class Clock(unittest.TestCase):
    def test_stamp_is_utc(self):
        self.assertEqual(bt.stamp("2026-10-26T04:00:00Z"), NOW)
        self.assertEqual(bt.stamp("2026-10-26T03:58:00Z"), NOW - 120)


class Yield(unittest.TestCase):
    def test_nothing_waiting_keeps_testing(self):
        # Our own run in progress, an old finished one, a CI job running: no reason.
        self.assertIsNone(reason([run(1, "claude/a", "in_progress"), run(2, "claude/b", "completed")],
                                 [job("kernel", "in_progress", "2026-10-26T03:00:00Z")]))

    def test_a_newer_run_on_this_branch_stops_it_at_once(self):
        # Waiting on our branch, 10 minutes in: well inside our share, still stops.
        r = reason([run(1, "claude/a", "in_progress"), run(7, "claude/a", "pending")])
        self.assertEqual(r, "a newer random-testing run on claude/a is waiting (run 7): this one tests older code")

    def test_a_ci_job_waiting_past_ci_wait_stops_it(self):
        # CI_WAIT is 120 s. Queued at 03:57:52 is 128 s ago, past it (1.0667x);
        # 03:58:12 is 108 s ago, 0.9x of it, so not yet; a running job never counts.
        r = reason(jobs=[job("e2e (2)", "queued", "2026-10-26T03:57:52Z")])
        self.assertEqual(r, 'CI job "e2e (2)" has waited 2 min for a runner: merges come first')
        self.assertIsNone(reason(jobs=[job("e2e (2)", "queued", "2026-10-26T03:58:12Z")]))
        self.assertIsNone(reason(jobs=[job("e2e (2)", "in_progress", "2026-10-26T03:00:00Z")]))

    def test_the_ci_wait_boundary_at_0_9_and_1_1(self):
        # 0.9 x 120 = 108 s keeps testing; 1.1 x 120 = 132 s stops.
        for waited, stops in ((108, False), (132, True)):
            created = bt.datetime.datetime.fromtimestamp(NOW - waited, bt.datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            self.assertEqual(reason(jobs=[job("app", "queued", created)]) is not None, stops, waited)

    def test_the_longest_waiting_job_is_named(self):
        # Waited 5 min (300 s) and 3 min: the 5-minute one, "5 min".
        r = reason(jobs=[job("app", "queued", "2026-10-26T03:57:00Z"), job("kernel", "queued", "2026-10-26T03:55:00Z")])
        self.assertEqual(r, 'CI job "kernel" has waited 5 min for a runner: merges come first')

    def test_another_branch_waits_until_this_run_has_had_its_hour(self):
        # SHARE is 3600 s. 0.9 x = 3240 s in: keep going; 1.1 x = 3960 s in: give way.
        waiting = [run(1, "claude/a", "in_progress"), run(9, "claude/b", "pending")]
        self.assertIsNone(reason(waiting, started=NOW - 3240))
        self.assertEqual(reason(waiting, started=NOW - 3960), "random testing on claude/b is waiting and this run has had its 60 minutes")

    def test_mains_and_the_nightlys_runs_and_forks_never_count(self):
        # A run waiting on main (by hand), the scheduled night run, and a
        # fork's run of a branch named like ours: none is a branch run of ours.
        others = [run(3, "main", "pending"), run(4, "main", "pending", event="schedule"), run(5, "claude/a", "pending", repo="x/r")]
        self.assertIsNone(reason(others, started=NOW - 9000))

    def test_its_own_run_is_never_newer(self):
        # Our own id listed as waiting (a stale answer): no reason.
        self.assertIsNone(reason([run(1, "claude/a", "queued")]))


class Cancel(unittest.TestCase):
    def test_only_this_branchs_unfinished_runs_by_hand(self):
        runs = [run(1, "claude/a", "in_progress"), run(2, "claude/a", "pending"), run(3, "claude/a", "completed"),
                run(4, "claude/b", "in_progress"), run(5, "claude/a", "in_progress", repo="x/r"), run(6, "main", "in_progress")]
        self.assertEqual(bt.to_cancel(runs, "claude/a", REPO), [1, 2])
        self.assertEqual(bt.to_cancel(runs, "claude/c", REPO), [])


class KernelRuns(unittest.TestCase):
    """The private kernel's random testing (kernel-nightly.yml): runs from main, branch named in the title."""

    def test_the_branch_comes_from_the_title(self):
        # Worked by hand: the title "Kernel random testing on claude/k-1" names claude/k-1; GitHub's own
        # head_branch says main (where the workflow file lives); a run without such a title keeps its own.
        self.assertEqual(bt.run_branch(kernel_run(1, "claude/k-1", "pending")), "claude/k-1")
        self.assertEqual(bt.run_branch(run(2, "claude/a", "pending")), "claude/a")
        self.assertEqual(bt.run_branch(dict(run(3, "main", "pending"), display_title="Kernel random testing")), "main")

    def test_a_newer_kernel_run_on_this_branch_stops_it(self):
        r = bt.yield_reason(NOW, NOW - 600, "claude/k", 1, REPO, [kernel_run(1, "claude/k", "in_progress"), kernel_run(2, "claude/k", "pending")], [])
        self.assertIn("newer random-testing run on claude/k is waiting (run 2)", r)

    def test_another_kernel_branch_waits_its_hour(self):
        waiting = [kernel_run(2, "claude/other", "pending")]
        self.assertIsNone(bt.yield_reason(NOW, NOW - 3599, "claude/k", 1, REPO, waiting, []))
        self.assertIn("random testing on claude/other is waiting", bt.yield_reason(NOW, NOW - 3600, "claude/k", 1, REPO, waiting, []))

    def test_kernel_mains_and_scheduled_runs_never_count(self):
        runs = [kernel_run(2, "main", "pending"), kernel_run(3, "claude/k", "pending", event="schedule")]
        self.assertIsNone(bt.yield_reason(NOW, NOW - 7200, "claude/k", 1, REPO, runs, []))
        self.assertEqual(bt.to_cancel(runs, "claude/k", REPO), [])

    def test_cancel_finds_the_kernel_branch_by_title(self):
        runs = [kernel_run(1, "claude/k", "in_progress"), kernel_run(2, "claude/k", "completed"), kernel_run(3, "claude/j", "pending"),
                run(4, "claude/k", "pending")]
        # Run 4 is a run of this repository's own branch claude/k (no kernel title): the same name, so it counts too.
        self.assertEqual(bt.to_cancel(runs, "claude/k", REPO), [1, 4])


def fake_gh(d, body):
    path = os.path.join(d, "gh")
    with open(path, "w") as f:
        f.write("#!/usr/bin/env bash\necho \"$*\" >>" + os.path.join(d, "calls") + "\n" + body)
    os.chmod(path, 0o755)


class Command(unittest.TestCase):
    """The script for real, with a fake `gh` first on PATH that logs its arguments."""

    def cli(self, body, *args, workflow=None):
        with tempfile.TemporaryDirectory() as d:
            fake_gh(d, body)
            env = dict(os.environ, PATH=d + os.pathsep + os.environ["PATH"], GITHUB_REPOSITORY=REPO, GITHUB_RUN_ID="1")
            if workflow:
                env["TESTING_WORKFLOW"] = workflow
            out = subprocess.run(["python3", os.path.join(HERE, "branch_testing.py"), *args], env=env, capture_output=True, text=True, timeout=30)
            with open(os.path.join(d, "calls")) as f:
                return out, f.read().splitlines()

    def test_cancel_asks_for_the_branchs_runs_and_cancels_the_unfinished_ones(self):
        listing = '{"workflow_runs":[%s]}' % ",".join(
            '{"id":%d,"head_branch":"claude/a","status":"%s","event":"workflow_dispatch","head_repository":{"full_name":"o/r"}}' % (i, s)
            for i, s in ((11, "in_progress"), (12, "completed"), (13, "pending")))
        out, calls = self.cli(f"case \"$*\" in *POST*) ;; *) echo '{listing}';; esac\n", "cancel", "claude/a")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(calls[0], "api -X GET repos/o/r/actions/workflows/nightly.yml/runs -f event=workflow_dispatch -f per_page=50 -f branch=claude/a")
        self.assertEqual(calls[1:], ["api -X POST repos/o/r/actions/runs/11/cancel", "api -X POST repos/o/r/actions/runs/13/cancel"])
        self.assertIn("cancelled random-testing run 13 on claude/a", out.stdout)

    def test_cancel_with_a_failed_lookup_fails(self):
        out, _ = self.cli("exit 1\n", "cancel", "claude/a")
        self.assertNotEqual(out.returncode, 0)

    def test_yield_with_a_failed_lookup_says_nothing(self):
        out, calls = self.cli("exit 1\n", "yield", "claude/a", str(NOW))
        self.assertEqual((out.returncode, out.stdout), (0, ""))
        self.assertEqual(len(calls), 1)

    def test_yield_reads_ci_jobs_only_of_unfinished_ci_runs(self):
        # Run 8 is finished, so its jobs are never asked for; run 9's queued job is old enough to stop.
        ci = '{"workflow_runs":[{"id":8,"status":"completed"},{"id":9,"status":"in_progress"}]}'
        jobs = '{"jobs":[{"name":"app","status":"queued","created_at":"2020-01-01T00:00:00Z"}]}'
        body = (f"case \"$*\" in *nightly.yml*) echo '{{\"workflow_runs\":[]}}';; *kernel-ci.yml*) echo '{{\"workflow_runs\":[]}}';; "
                f"*ci.yml*) echo '{ci}';; *runs/9/jobs*) echo '{jobs}';; *) exit 1;; esac\n")
        out, calls = self.cli(body, "yield", "claude/a", str(NOW))
        self.assertIn('CI job "app" has waited', out.stdout)
        self.assertEqual([c for c in calls if "/jobs" in c], ["api repos/o/r/actions/runs/9/jobs?filter=latest&per_page=100"])

    def test_yield_counts_the_kernels_ci_jobs_too(self):
        # The kernel's checks run here too (kernel-ci.yml): its queued job starves merges just the same.
        ci = '{"workflow_runs":[{"id":7,"status":"queued"}]}'
        jobs = '{"jobs":[{"name":"checks","status":"queued","created_at":"2020-01-01T00:00:00Z"}]}'
        body = (f"case \"$*\" in *kernel-nightly.yml*) echo '{{\"workflow_runs\":[]}}';; *kernel-ci.yml*) echo '{ci}';; "
                f"*/ci.yml*) echo '{{\"workflow_runs\":[]}}';; *runs/7/jobs*) echo '{jobs}';; *) exit 1;; esac\n")
        out, calls = self.cli(body, "yield", "claude/k", str(NOW), workflow="kernel-nightly.yml")
        self.assertIn('CI job "checks" has waited', out.stdout)
        self.assertEqual(calls[0], "api repos/o/r/actions/workflows/kernel-nightly.yml/runs?per_page=30")

    def test_cancel_kernel_runs_asks_without_githubs_branch_filter(self):
        listing = '{"workflow_runs":[%s]}' % ",".join(
            '{"id":%d,"head_branch":"main","display_title":"Kernel random testing on %s","status":"in_progress","event":"workflow_dispatch","head_repository":{"full_name":"o/r"}}' % (i, b)
            for i, b in ((21, "claude/k"), (22, "claude/j")))
        out, calls = self.cli(f"case \"$*\" in *POST*) ;; *) echo '{listing}';; esac\n", "cancel", "claude/k", workflow="kernel-nightly.yml")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(calls[0], "api -X GET repos/o/r/actions/workflows/kernel-nightly.yml/runs -f event=workflow_dispatch -f per_page=50")
        self.assertEqual(calls[1:], ["api -X POST repos/o/r/actions/runs/21/cancel"])


if __name__ == "__main__":
    unittest.main()

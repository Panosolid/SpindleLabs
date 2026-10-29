"""Random testing started on a branch (nightly.yml's workflow_dispatch) shares
the account's 20 runners with every pull request's CI, and merges come first
(Ben, 2026-10-26, after merges waited half an hour behind day runs). Three
commands:

  branch_testing.py yield <branch> <started>
      Asked by stop-on-merge.sh every few minutes while a branch run's random
      rounds go on. Prints why the rounds should stop after the one in
      progress, or nothing: a newer run on the same branch is waiting (this
      one tests older code); a CI job has waited more than CI_WAIT seconds
      for a runner (merges first); or another branch's run is waiting and
      this one has had its SHARE seconds since <started> (a unix time).
      Branch runs share one concurrency group, so only one runs at a time.

      On main (tonight's run; its jobs past the first two ask too, so the
      night always keeps two), only a starved CI job counts.

  branch_testing.py wait-idle <max seconds>
      The first job of every random-testing and fuzzing workflow (Ben,
      2026-10-29: they start only when the queue is idle): returns once no
      CI job waits for a runner and no merge queue run is going, or after
      <max seconds> however busy (so a night is never skipped). Asks every
      IDLE_POLL_SECONDS (default 60); a failed lookup counts as busy.

  branch_testing.py cancel <branch>
      Run by stop-testing.yml when a pull request merges or closes: cancels
      every random-testing run on its branch still running or waiting.
      Cancelled jobs still upload what they finished and collect still
      files it (both run `if: always()`); tonight's run on main tests the
      merged code.

The private kernel's random testing (kernel-nightly.yml) runs from this
repository's main and names the kernel branch it tests in its title
("Kernel random testing on <branch>"); with TESTING_WORKFLOW=kernel-nightly.yml
both commands work on those runs and their titles' branches, and `cancel` is
run by the kernel repository when its pull request merges or closes.

Both need GH_TOKEN and GITHUB_REPOSITORY. A failed lookup is no answer:
`yield` prints nothing and asks again next time, `cancel` exits 1.
Tests: test_branch_testing.py."""

import datetime
import json
import os
import re
import subprocess
import sys
import time

CI_WAIT = 120
SHARE = 3600
WAITING = {"queued", "pending", "waiting", "requested"}
TITLE = re.compile(r"^Kernel random testing on (\S+)$")
# Both CI workflows share the runners: this repository's and the kernel's.
CI_WORKFLOWS = ("ci.yml", "kernel-ci.yml")


def stamp(text):
    """GitHub's 2026-10-26T03:00:00Z as a unix time."""
    return datetime.datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp()


def run_branch(run):
    """The branch a run tests: a kernel run's from its title, any other run's own."""
    m = TITLE.match(run.get("display_title") or "")
    return m.group(1) if m else run["head_branch"]


def branch_runs(runs, repo):
    """The runs started by hand on a branch (never main's, never the nightly's), from this repository."""
    return [r for r in runs if r["event"] == "workflow_dispatch" and run_branch(r) != "main" and (r.get("head_repository") or {}).get("full_name") == repo]


def yield_reason(now, started, branch, own_id, repo, nightly_runs, ci_jobs, ci_wait=CI_WAIT, share=SHARE):
    """Why this branch run's random rounds should stop now, or None. `nightly_runs` are nightly.yml's recent runs, `ci_jobs` the jobs of CI runs not yet finished.
    On main (the nightly run) only a starved CI job counts: branch runs wait for the night, not the other way round."""
    if branch == "main":
        nightly_runs = []
    waiting = [r for r in branch_runs(nightly_runs, repo) if r["status"] in WAITING and r["id"] != own_id]
    newer = [r for r in waiting if run_branch(r) == branch]
    if newer:
        return f"a newer random-testing run on {branch} is waiting (run {newer[0]['id']}): this one tests older code"
    starved = [j for j in ci_jobs if j["status"] == "queued" and now - stamp(j["created_at"]) > ci_wait]
    if starved:
        j = max(starved, key=lambda j: now - stamp(j["created_at"]))
        return f"CI job \"{j['name']}\" has waited {int(now - stamp(j['created_at'])) // 60} min for a runner: merges come first"
    if waiting and now - started >= share:
        return f"random testing on {run_branch(waiting[0])} is waiting and this run has had its {share // 60} minutes"
    return None


def busy_reason(now, ci_runs, ci_jobs):
    """Why random testing should not start yet, or None. `ci_runs` are the CI runs not yet finished, `ci_jobs` their jobs."""
    queued = [j for j in ci_jobs if j["status"] in WAITING]
    if queued:
        j = min(queued, key=lambda j: j["created_at"])
        return f"CI job \"{j['name']}\" is waiting for a runner ({int(now - stamp(j['created_at'])) // 60} min)"
    group = [r for r in ci_runs if r.get("event") == "merge_group"]
    if group:
        return f"the merge queue is testing (run {group[0]['id']})"
    return None


def ci_now(repo):
    """The CI runs not yet finished (this repository's and the kernel's) and their jobs."""
    ci = [r for w in CI_WORKFLOWS for r in gh(f"repos/{repo}/actions/workflows/{w}/runs?per_page=20")["workflow_runs"] if r["status"] != "completed"]
    return ci, [j for r in ci for j in gh(f"repos/{repo}/actions/runs/{r['id']}/jobs?filter=latest&per_page=100")["jobs"]]


def wait_idle(limit, poll, look, now=time.time, sleep=time.sleep, log=print):
    """Waits until `look()` (a busy reason, or None when idle; it may raise) says idle, at most `limit` seconds. Returns how it ended."""
    start = now()
    while True:
        try:
            reason = look()
        except (subprocess.SubprocessError, ValueError, KeyError, TypeError) as e:
            reason = f"couldn't read the queue ({type(e).__name__})"
        if reason is None:
            return "idle"
        waited = now() - start
        if waited >= limit:
            log(f"still busy after {int(waited) // 60} min ({reason}); starting anyway")
            return "timeout"
        log(f"waiting: {reason}")
        sleep(poll)


def to_cancel(runs, branch, repo):
    """The ids of this branch's runs started by hand that are still running or waiting."""
    return [r["id"] for r in branch_runs(runs, repo) if run_branch(r) == branch and r["status"] != "completed"]


def gh(*args):
    return json.loads(subprocess.run(["gh", "api", *args], check=True, capture_output=True, text=True, timeout=60).stdout)


def main(argv):
    repo = os.environ["GITHUB_REPOSITORY"]
    workflow = os.environ.get("TESTING_WORKFLOW", "nightly.yml")
    if len(argv) == 4 and argv[1] == "yield":
        try:
            nightly = gh(f"repos/{repo}/actions/workflows/{workflow}/runs?per_page=30")["workflow_runs"]
            _, jobs = ci_now(repo)
        except (subprocess.SubprocessError, ValueError, KeyError, TypeError):
            return 0
        reason = yield_reason(time.time(), float(argv[3]), argv[2], int(os.environ.get("GITHUB_RUN_ID", "0")), repo, nightly, jobs)
        if reason:
            print(reason)
        return 0
    if len(argv) == 3 and argv[1] == "wait-idle" and argv[2].isdigit():
        how = wait_idle(int(argv[2]), float(os.environ.get("IDLE_POLL_SECONDS", "60")),
                        lambda: busy_reason(time.time(), *ci_now(repo)))
        print("CI is idle: starting" if how == "idle" else "CI still busy: starting anyway")
        return 0
    if len(argv) == 3 and argv[1] == "cancel":
        # A kernel run's branch is in its title, not GitHub's branch filter.
        only = ["-f", f"branch={argv[2]}"] if workflow == "nightly.yml" else []
        runs = gh("-X", "GET", f"repos/{repo}/actions/workflows/{workflow}/runs", "-f", "event=workflow_dispatch", "-f", "per_page=50", *only)["workflow_runs"]
        ids = to_cancel(runs, argv[2], repo)
        for i in ids:
            subprocess.run(["gh", "api", "-X", "POST", f"repos/{repo}/actions/runs/{i}/cancel"], check=False, timeout=60)
            print(f"cancelled random-testing run {i} on {argv[2]}")
        if not ids:
            print(f"no random-testing run on {argv[2]} to cancel")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))

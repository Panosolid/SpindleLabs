"""Random testing started on a branch (nightly.yml's workflow_dispatch) shares
the account's 20 runners with every pull request's CI, and merges come first
(Ben, 2026-10-26, after merges waited half an hour behind day runs). Two
commands:

  branch_testing.py yield <branch> <started>
      Asked by stop-on-merge.sh every few minutes while a branch run's random
      rounds go on. Prints why the rounds should stop after the one in
      progress, or nothing: a newer run on the same branch is waiting (this
      one tests older code); a CI job has waited more than CI_WAIT seconds
      for a runner (merges first); or another branch's run is waiting and
      this one has had its SHARE seconds since <started> (a unix time).
      Branch runs share one concurrency group, so only one runs at a time.

  branch_testing.py cancel <branch>
      Run by stop-testing.yml when a pull request merges or closes: cancels
      every random-testing run on its branch still running or waiting.
      Cancelled jobs still upload what they finished and collect still
      files it (both run `if: always()`); tonight's run on main tests the
      merged code.

Both need GH_TOKEN and GITHUB_REPOSITORY. A failed lookup is no answer:
`yield` prints nothing and asks again next time, `cancel` exits 1.
Tests: test_branch_testing.py."""

import datetime
import json
import os
import subprocess
import sys
import time

CI_WAIT = 120
SHARE = 3600
WAITING = {"queued", "pending", "waiting", "requested"}


def stamp(text):
    """GitHub's 2026-10-26T03:00:00Z as a unix time."""
    return datetime.datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp()


def branch_runs(runs, repo):
    """The runs started by hand on a branch of this repository (never main's, never the nightly's)."""
    return [r for r in runs if r["event"] == "workflow_dispatch" and r["head_branch"] != "main" and (r.get("head_repository") or {}).get("full_name") == repo]


def yield_reason(now, started, branch, own_id, repo, nightly_runs, ci_jobs, ci_wait=CI_WAIT, share=SHARE):
    """Why this branch run's random rounds should stop now, or None. `nightly_runs` are nightly.yml's recent runs, `ci_jobs` the jobs of CI runs not yet finished."""
    waiting = [r for r in branch_runs(nightly_runs, repo) if r["status"] in WAITING and r["id"] != own_id]
    newer = [r for r in waiting if r["head_branch"] == branch]
    if newer:
        return f"a newer random-testing run on {branch} is waiting (run {newer[0]['id']}): this one tests older code"
    starved = [j for j in ci_jobs if j["status"] == "queued" and now - stamp(j["created_at"]) > ci_wait]
    if starved:
        j = max(starved, key=lambda j: now - stamp(j["created_at"]))
        return f"CI job \"{j['name']}\" has waited {int(now - stamp(j['created_at'])) // 60} min for a runner: merges come first"
    if waiting and now - started >= share:
        return f"random testing on {waiting[0]['head_branch']} is waiting and this run has had its {share // 60} minutes"
    return None


def to_cancel(runs, branch, repo):
    """The ids of this branch's runs started by hand that are still running or waiting."""
    return [r["id"] for r in branch_runs(runs, repo) if r["head_branch"] == branch and r["status"] != "completed"]


def gh(*args):
    return json.loads(subprocess.run(["gh", "api", *args], check=True, capture_output=True, text=True, timeout=60).stdout)


def main(argv):
    repo = os.environ["GITHUB_REPOSITORY"]
    if len(argv) == 4 and argv[1] == "yield":
        try:
            nightly = gh(f"repos/{repo}/actions/workflows/nightly.yml/runs?per_page=30")["workflow_runs"]
            ci = [r for r in gh(f"repos/{repo}/actions/workflows/ci.yml/runs?per_page=20")["workflow_runs"] if r["status"] != "completed"]
            jobs = [j for r in ci for j in gh(f"repos/{repo}/actions/runs/{r['id']}/jobs?filter=latest&per_page=100")["jobs"]]
        except (subprocess.SubprocessError, ValueError, KeyError, TypeError):
            return 0
        reason = yield_reason(time.time(), float(argv[3]), argv[2], int(os.environ.get("GITHUB_RUN_ID", "0")), repo, nightly, jobs)
        if reason:
            print(reason)
        return 0
    if len(argv) == 3 and argv[1] == "cancel":
        runs = gh("-X", "GET", f"repos/{repo}/actions/workflows/nightly.yml/runs", "-f", "event=workflow_dispatch", "-f", "per_page=50", "-f", f"branch={argv[2]}")["workflow_runs"]
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

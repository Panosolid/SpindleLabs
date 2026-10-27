#!/usr/bin/env bash
# Used by .github/workflows/nightly.yml beside run-until.sh, in random testing
# started from a push (workflow_dispatch on a branch): once the branch's pull
# request has merged or closed, creates the stop file endless.sh watches
# (FISSION_ENDLESS_STOP_FILE), so the round in progress finishes and is kept,
# no new round starts, and the run's results are collected as usual. Tonight's
# run on main tests the merged code; this frees the runners (owner's decision,
# 2026-10-17). A branch with no pull request yet, or with one open, keeps
# testing; a failed lookup just waits for the next one.
#
# While the pull request is open it also asks branch_testing.py whether to
# give the runners up (Ben, 2026-10-26: merges first, one branch run at a
# time): a newer run on this branch is waiting, a CI job has waited too long
# for a runner, or another branch's run is waiting and this one has had its
# hour. It stops the same way, saying why.
#
# The private kernel's random testing (kernel-nightly.yml) sets KERNEL_REPO
# and KERNEL_READ: <branch> is then that repository's, and it has finished once
# main holds every commit of it (GitHub's compare says identical or behind) or
# it was deleted; the kernel repository has no pull requests this key can read.
#
# Usage: stop-on-merge.sh <branch> <stop file>
# Asks every STOP_POLL_SECONDS (default 180); needs GH_TOKEN and GITHUB_REPOSITORY.
set -u
branch=$1 stop_file=$2
here=$(cd "$(dirname "$0")" && pwd)
started=$(date +%s)
while sleep "${STOP_POLL_SECONDS:-180}"; do
  if [ -n "${KERNEL_REPO:-}" ]; then
    answer=$(GH_TOKEN="${KERNEL_READ:-}" gh api "repos/$KERNEL_REPO/compare/main...$branch" --jq .status 2>&1)
    case $answer in
    identical | behind | *"HTTP 404"*)
      echo "The kernel branch $branch has merged into main or is gone: random testing stops after the round in progress."
      touch "$stop_file"
      exit 0
      ;;
    ahead | diverged) ;;
    *) continue ;;
    esac
  else
    # Only pull requests from this repository: a fork's pull request from a
    # branch with the same name must not stop our run.
    states=$(gh pr list --repo "$GITHUB_REPOSITORY" --head "$branch" --state all --json state,headRepositoryOwner \
      --jq ".[] | select(.headRepositoryOwner.login == \"${GITHUB_REPOSITORY%%/*}\") | .state") || continue
    if [ -n "$states" ] && ! grep -qx OPEN <<<"$states"; then
      echo "The pull request for $branch has merged or closed: random testing stops after the round in progress."
      touch "$stop_file"
      exit 0
    fi
  fi
  reason=$(python3 "$here/branch_testing.py" yield "$branch" "$started" 2>/dev/null)
  if [ -n "$reason" ]; then
    echo "Random testing on $branch stops after the round in progress: $reason."
    touch "$stop_file"
    exit 0
  fi
done

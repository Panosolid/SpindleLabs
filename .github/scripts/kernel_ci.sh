#!/usr/bin/env bash
# Helpers for kernel-ci.yml, which runs the private kernel repo's checks
# (Panosolid/kernel) on this public repo's runners.
#
#   kernel_ci.sh status CONTEXT STATE DESCRIPTION [URL]
#       sets a commit status on the kernel commit $HEAD_SHA (KERNEL_READ key:
#       contents read-only, commit statuses read and write)
#   kernel_ci.sh save JOB DIR
#       pushes DIR to the private kernel-results repo under
#       ci/$LABEL/$HEAD_SHA/$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT/JOB/
#       (RESULTS_WRITE key) and prints nothing but the folder's name; with
#       RESULTS_PATH set, under $RESULTS_PATH/JOB/ instead (random testing's
#       and fuzzing's jobs: their collect job reads them from there); files
#       over 50 MB stay behind, and a failed push says why in words only
#       (RESULTS_REPO: another repo to push to, for the tests)
#   kernel_ci.sh run NAME LOGDIR COMMAND...
#       runs COMMAND with all its output in LOGDIR/NAME.log and prints only
#       RESULT NAME PASS|FAIL <seconds>; exits with COMMAND's exit code
#   kernel_ci.sh describe RESULTS OUTCOME
#       the status description for kernel-ci/checks: "Failed: " and the first
#       five failing checks' names in RESULTS (RESULT lines), or else OUTCOME
#   kernel_ci.sh filter
#       copies to stdout only the lines the kernel's ci scripts may print in
#       public: RESULT, count, shards and missed lines; drops everything else
#
# Anything this log shows is public, so the full output of every check only
# ever goes to kernel-results. Tested in test_kernel_ci.py.
set -euo pipefail

results_url() {
  echo "https://github.com/Panosolid/kernel-results/tree/main/ci/$LABEL/$HEAD_SHA/$GITHUB_RUN_ID-${GITHUB_RUN_ATTEMPT:-1}"
}

case ${1:-} in
status)
  context=$2 state=$3 description=$4 url=${5:-$(results_url)}
  body=$(python3 -c 'import json,sys; print(json.dumps({"state": sys.argv[1], "context": sys.argv[2], "description": sys.argv[3][:140], "target_url": sys.argv[4]}))' \
    "$state" "$context" "$description" "$url")
  curl -sS --fail -o /dev/null -X POST \
    -H "Authorization: Bearer $KERNEL_READ" -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/Panosolid/kernel/statuses/$HEAD_SHA" -d "$body"
  ;;
save)
  job=$2 dir=$3
  work=$(mktemp -d)
  git clone -q --depth 1 "${RESULTS_REPO:-https://x-access-token:$RESULTS_WRITE@github.com/Panosolid/kernel-results.git}" "$work/r" 2>/dev/null
  dest="${RESULTS_PATH:-ci/$LABEL/$HEAD_SHA/$GITHUB_RUN_ID-${GITHUB_RUN_ATTEMPT:-1}}/$job"
  mkdir -p "$work/r/$dest"
  # GitHub refuses a push with a file over 100 MB, so files over 50 MB stay
  # behind (the release check's three 1.3 GB answer files made every save
  # of the checks fail, 2026-10-28); the line says how many.
  (cd "$dir" && find . -type f -size +50M) >"$work/big"
  tar -C "$dir" -cf - -X "$work/big" . 2>/dev/null | tar -C "$work/r/$dest" -xf - 2>/dev/null || true
  big=$(wc -l <"$work/big" | tr -d ' ')
  left=""
  [ "$big" = 0 ] || left=" ($big over 50 MB left out)"
  cd "$work/r"
  git -c user.name=kernel-ci -c user.email=kernel-ci@users.noreply.github.com add -A >/dev/null
  git -c user.name=kernel-ci -c user.email=kernel-ci@users.noreply.github.com commit -qm "kernel-ci $LABEL $HEAD_SHA $job" >/dev/null
  # Several jobs save at once: rebase onto whatever landed meanwhile.
  for _ in 1 2 3 4 5 6; do
    git push -q origin HEAD:main 2>"$work/push" && { echo "saved $job$left"; exit 0; }
    sleep $((RANDOM % 5 + 1))
    git pull -q --rebase origin main 2>/dev/null || true
  done
  # Why, in words only: the push's own message can name private files.
  why=$(grep -oE 'GH001|exceeds|rejected|non-fast-forward|denied|403|timed out|Could not resolve' "$work/push" | sort -u | paste -sd, - || true)
  echo "could not save $job (${why:-no reason given})"; exit 1
  ;;
run)
  name=$2 dir=$3
  shift 3
  mkdir -p "$dir"
  start=$SECONDS code=0
  "$@" >"$dir/$name.log" 2>&1 </dev/null || code=$?
  echo "RESULT $name $([ $code = 0 ] && echo PASS || echo FAIL) $((SECONDS - start))"
  exit $code
  ;;
describe)
  failing=$({ sed -n 's/^RESULT \([a-z0-9-]*\) FAIL .*/\1/p' "$2" 2>/dev/null || true; } | { grep -v '^all$' || true; } | head -5 | paste -sd, -)
  if [ -n "$failing" ]; then echo "Failed: $failing"; else echo "$3"; fi
  ;;
filter)
  grep -E '^(RESULT [a-z0-9-]+ (PASS|FAIL) [0-9]+|count ([0-9]+|error)|shards \[[0-9,]*\]|missed [0-9]+)$' || true
  ;;
*)
  echo "usage: kernel_ci.sh status|save|run|describe|filter"; exit 2 ;;
esac

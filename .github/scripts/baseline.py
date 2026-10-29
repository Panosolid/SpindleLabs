"""Speed and memory against tests/baseline.json (test audit item 3).

Measures the app's key operations (packages/testing/baseline/app.ts: JavaScript heap
kept, the kernel's WebAssembly memory, time relative to a fixed workload, and
the kernel calls and bodies built by one edit of a 20-feature part),
compares each with the baseline and prints a table. Margins live in the
baseline file ("margins", one per kind of metric, the kind being the last
part of the metric's name):
- "fail": worse by more than this many percent fails the check (exit 1);
- "flag": worse by more than this only warns (noisy metrics: time, which
  also has a much wider "fail", so a gross slowdown still fails);
- "floor": changes smaller than this, in the metric's own unit, are noise;
- a metric better by more than its margin is pointed out, so the baseline
  can be lowered (with the owner's OK; root CLAUDE.md, Metrics and
  baselines); a metric the baseline has but the run doesn't fails, a new
  one is listed; a kind with no margin (the kernel's wall time, `nanos`)
  is only shown, and not kept in the baseline.

Time against main on the same runner: a runner's speed moves the time
metrics by more than their fail margin from one run to the next (10-29: the
same code read 0.0088 and 0.0182), so a time metric that is flagged or
fails against the fixed baseline is measured again, in turns with main's
code checked out beside it (--reference REF): main, this, this, main. Its
verdict is then the median of the two this/main ratios against the same
margins, so only code slower than main's on the same machine fails, and
the fixed baseline still catches the rest (memory, counts). Without a
reference (it couldn't be built), the fixed baseline's verdict stands.

`compare` and `rejudge` are pure (tested in test_baseline.py); `measure` runs things.

Usage: baseline.py [--update] [--measured FILE] [--only PREFIX] [--save FILE] [--reference REF]
  --reference REF  re-judge flagged or failing time metrics against REF
                   (a branch, fetched and built beside this checkout)
  --measured FILE  compare metrics saved earlier instead of measuring
  --only PREFIX    judge only the metrics whose names start with PREFIX
                   (the nightly golden run measures only app.golden*, so
                   the rest would read as missing); not with --update
  --save FILE      also write what was measured to FILE
  --update         write what was measured into tests/baseline.json (only
                   when the owner has confirmed the change is intended)
Needs the WASM build. The kernel's own metrics (peak heap, allocations and
callgrind's instructions per operation) moved with it to its private repo,
which checks them in its CI (2026-10-27).
"""

import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BASELINE = os.path.join(ROOT, "tests", "baseline.json")


def kind_of(metric):
    return metric.rsplit(".", 1)[-1]


def compare(baseline, measured, only=None):
    """Rows (metric, old, new, percent change or None, verdict); verdict is
    one of ok, fail, flag, better, new, missing, info. With `only`, just the
    metrics (baseline or measured) whose names start with it."""
    margins = baseline["margins"]
    old_all = baseline["metrics"]
    if only is not None:
        old_all = {m: v for m, v in old_all.items() if m.startswith(only)}
        measured = {m: v for m, v in measured.items() if m.startswith(only)}
    rows = []
    for metric in sorted(set(old_all) | set(measured)):
        old, new = old_all.get(metric), measured.get(metric)
        rule = margins.get(kind_of(metric))
        if rule is None:  # no margin for this kind (wall time): shown, never judged
            rows.append((metric, old, new, None if not old or new is None else (new - old) / old * 100, "info"))
            continue
        if old is None:
            rows.append((metric, None, new, None, "new"))
            continue
        if new is None:
            rows.append((metric, old, None, None, "missing"))
            continue
        change = None if old == 0 else (new - old) / old * 100
        fail, flag = rule.get("fail"), rule.get("flag")
        if abs(new - old) <= rule.get("floor", 0):
            verdict = "ok"
        elif change is None:  # from zero: any growth past the floor is worse
            verdict = ("fail" if fail is not None else "flag") if new > old else "better"
        elif fail is not None and change > fail:
            verdict = "fail"
        elif flag is not None and change > flag:
            verdict = "flag"
        elif change < -min(x for x in (fail, flag) if x is not None):
            verdict = "better"
        else:
            verdict = "ok"
        rows.append((metric, old, new, change, verdict))
    return rows


TIME = "relative_time"


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    return None if n == 0 else xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def needs_reference(rows):
    """The time metrics worth measuring again against main: flagged or failed."""
    return [r[0] for r in rows if kind_of(r[0]) == TIME and r[4] in ("fail", "flag")]


def rejudge(baseline, rows, ours, mains):
    """Rows with each re-measured time metric judged by this code against
    main's on the same runner: `ours` and `mains` are lists of measurements
    taken in turns (ours[i] beside mains[i]). The row's old value becomes
    main's median and its change the median ratio's; its verdict takes the
    margins as compare does, from that change. Other rows are kept."""
    out = []
    for metric, old, new, change, verdict in rows:
        pairs = [(o[metric], m[metric]) for o, m in zip(ours, mains) if o.get(metric) and m.get(metric)]
        if kind_of(metric) != TIME or verdict not in ("fail", "flag") or not pairs:
            out.append((metric, old, new, change, verdict))
            continue
        rule = baseline["margins"][TIME]
        ratio = median([a / b for a, b in pairs])
        change = (ratio - 1) * 100
        fail, flag = rule.get("fail"), rule.get("flag")
        if fail is not None and change > fail:
            verdict = "fail"
        elif flag is not None and change > flag:
            verdict = "flag"
        else:
            verdict = "ok"
        out.append((f"{metric} (vs main)", median([m for _, m in pairs]), median([a for a, _ in pairs]), change, verdict))
    return out


def reference(ref):
    """A checkout of `ref` beside this one with its packages installed, or None."""
    where = os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "baseline-reference")
    try:
        # A clone of its own: fetching into this checkout would make it shallow (found locally: a full clone lost its history).
        url = run(["git", "remote", "get-url", "origin"], cwd=ROOT).stdout.strip()
        if os.path.exists(where):
            shutil.rmtree(where)
        run(["git", "clone", "--quiet", "--depth=1", "--branch", ref, url, where])
        run(["npm", "ci", "--no-audit", "--no-fund"], cwd=where)
    except (subprocess.CalledProcessError, OSError) as e:
        print(f"No reference build of {ref} ({e}); the fixed baseline's verdict stands")
        return None
    return where


def fmt(x):
    if x is None:
        return "-"
    return f"{x:,.4f}".rstrip("0").rstrip(".") if isinstance(x, float) and x < 100 else f"{x:,.0f}"


def table(rows):
    lines = ["| metric | baseline | now | change | |", "|---|---:|---:|---:|---|"]
    for metric, old, new, change, verdict in rows:
        mark = {"ok": "", "fail": "FAIL", "flag": "slower (flag)", "better": "better: lower the baseline?",
                "new": "new: add to the baseline", "missing": "MISSING", "info": "report only"}[verdict]
        lines.append(f"| {metric} | {fmt(old)} | {fmt(new)} | {'-' if change is None else f'{change:+.1f}%'} | {mark} |")
    return "\n".join(lines)


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def measure(root=ROOT):
    metrics = {}
    app = run(["node", "--expose-gc", "--experimental-strip-types", "--no-warnings", "packages/testing/baseline/app.ts"], cwd=root).stdout
    for op, m in json.loads(app).items():
        for name, value in m.items():
            metrics[f"app.{op}.{name}"] = value
    return metrics


def main(argv):
    with open(BASELINE) as f:
        baseline = json.load(f)
    if "--measured" in argv:
        with open(argv[argv.index("--measured") + 1]) as f:
            measured = json.load(f)
    else:
        measured = measure()
    if "--save" in argv:
        with open(argv[argv.index("--save") + 1], "w") as f:
            json.dump(measured, f, indent=2, sort_keys=True)
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    if only is not None and "--update" in argv:
        print("--only judges part of the baseline; --update writes all of it, so they don't go together")
        return 2
    rows = compare(baseline, measured, only)
    again = needs_reference(rows)
    if again and "--reference" in argv and "--measured" not in argv:
        ref = argv[argv.index("--reference") + 1]
        where = reference(ref)
        if where is not None:
            print(f"Time past its margin ({', '.join(again)}): measuring again in turns with {ref} on this runner")
            mains, ours = [measure(where)], []
            ours += [measure(), measure()]
            mains.append(measure(where))
            rows = rejudge(baseline, rows, ours, mains)
    text = table(rows)
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write("## Speed and memory against tests/baseline.json\n\n" + text + "\n")
    for metric, old, new, change, verdict in rows:
        if verdict == "fail":
            print(f"::error title=Baseline: {metric}::{metric} is {fmt(new)}, baseline {fmt(old)} ({change:+.1f}%), past the {baseline['margins'][kind_of(metric.split(' ')[0])]['fail']}% margin")
        elif verdict == "missing":
            print(f"::error title=Baseline: {metric}::{metric} is in tests/baseline.json but was not measured")
        elif verdict == "flag":
            print(f"::warning title=Baseline: {metric}::{metric} is {fmt(new)}, baseline {fmt(old)} ({change:+.1f}%), slower than the {baseline['margins'][kind_of(metric.split(' ')[0])]['flag']}% margin (time is noisy: check before acting)")
    print("\nMeasured (for --update or a new baseline):\n" + json.dumps(measured, indent=2, sort_keys=True))
    if "--update" in argv:
        baseline["metrics"] = {m: v for m, v in sorted(measured.items()) if kind_of(m) in baseline["margins"]}
        with open(BASELINE, "w") as f:
            json.dump(baseline, f, indent=2)
            f.write("\n")
        print(f"Wrote {BASELINE}")
        return 0
    failed = [r for r in rows if r[4] in ("fail", "missing")]
    print(f"\n{len(failed)} metric(s) failed, {sum(r[4] == 'flag' for r in rows)} flagged, {sum(r[4] == 'better' for r in rows)} better.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

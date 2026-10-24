"""The nightly long monkey sessions (hunt 3f): turns apps/fission/e2e/monkey.mjs's
output into the night's report and one failure folder per failing seed.

  python3 monkey_night.py <monkey log> <monkey-results dir> <out dir> <first seed> <seeds> <steps>

The monkey prints one line per seed ("seed 7: pass (2000 actions)" or
"seed 7: FAIL at action 65: <check>: <message>"), then for a failure the
shrunk action list, saved as <monkey-results>/seed-7.json. This writes
<out>/report.txt (a first line counting the night, then each seed's line)
and, per failing seed, <out>/seed-monkey-<seed>/monkey-report.txt (the
same first line, then 'failure: <check>: <message> | <where>; replay: ...',
the line file_issues.py reads) next to the shrunk list as actions.json.
A seed the log never reports (the job ran out of time, or the tester
crashed) is a failure of its own: a night that tested nothing must not read
as clean.

Exit code: 1 when any seed failed or went unreported, else 0."""

import os
import re
import shutil
import sys

LINE = re.compile(r"^seed (\d+): (pass \((\d+) actions.*\)|FAIL at action (\d+): (.*))$")


def parse(log):
    """{seed: (passed, actions, failure text)} from the monkey's output."""
    seen = {}
    for line in log.splitlines():
        m = LINE.match(line.strip())
        if not m:
            continue
        seed = int(m.group(1))
        if m.group(3) is not None:
            seen[seed] = (True, int(m.group(3)), "")
        else:
            seen[seed] = (False, int(m.group(4)), m.group(5))
    return seen


def write(log, results, out, first, count, steps):
    """Writes the report and failure folders; returns the number of failed seeds."""
    seeds = list(range(first, first + count))
    seen = parse(log)
    failed = [s for s in seeds if s not in seen or not seen[s][0]]
    head = (f"Monkey, seeds {first}-{first + count - 1}: {count} session(s) of {steps} actions in Chromium; "
            + (f"{len(failed)} FAILED" if failed else "every check passed after every action"))
    replay = "cd apps/fission && npm run build && FISSION_SEED={seed} MONKEY_STEPS={steps} node e2e/monkey.mjs"
    lines = [head]
    os.makedirs(out, exist_ok=True)
    for seed in seeds:
        if seed not in seen:
            text = "no result: the session never finished (job out of time, or the tester crashed)"
            where = f"seed {seed}"
        else:
            passed, actions, text = seen[seed]
            if passed:
                lines.append(f"seed {seed}: pass ({actions} actions)")
                continue
            where = f"seed {seed} at action {actions}"
        lines.append(f"seed {seed}: FAIL: {text}")
        folder = os.path.join(out, f"seed-monkey-{seed}")
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, "monkey-report.txt"), "w") as f:
            f.write(f"{head}\nfailure: {text} | {where}; replay: {replay.format(seed=seed, steps=steps)}\n")
        saved = os.path.join(results, f"seed-{seed}.json")
        if os.path.isfile(saved):
            shutil.copy(saved, os.path.join(folder, "actions.json"))
    with open(os.path.join(out, "report.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    return len(failed)


def main(argv):
    log_path, results, out, first, count, steps = argv
    log = open(log_path, errors="replace").read() if os.path.isfile(log_path) else ""
    failed = write(log, results, out, int(first), int(count), int(steps))
    print(open(os.path.join(out, "report.txt")).read(), end="")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

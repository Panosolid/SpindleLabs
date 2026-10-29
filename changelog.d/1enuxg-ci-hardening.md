fix

- The nightly testing files every new kind of failure again: one refused call no longer stops the rest, a crashed run is reported even when another run of the same job found something, and a failed memory soak is reported.
- The nightly stacked-sketch check counts the checks it really ran, so its planted-bug total is right (issue #63).
- CI is harder to misuse: a change that gives a workflow more access, a new trigger or the engine's keys fails CI; the test machines install exact, checked copies of their Python tools; the live site is only ever built from main; and public logs and files say less about the private engine.
- A warning issue opens three weeks before one of the engine's access keys runs out.
- A pull request whose final test run only ran out of time is put back in the merge queue once by itself.

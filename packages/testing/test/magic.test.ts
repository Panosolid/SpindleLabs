import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  JOURNEYS,
  MAGIC_JOURNEYS,
  baselineLine,
  compareToBaseline,
  judge,
  parseBaselines,
  reportLine,
  seeded,
  type JourneyBaseline,
  type MagicJourney,
} from "../src/index.ts";

const ready: MagicJourney = { name: "ready one", steps: ["a"], clickLimit: 3, secondsLimit: 5, status: "ready" };
const waiting: MagicJourney = { ...ready, name: "waiting one", status: { waitsFor: "Laser (L1)" } };

test("hand-worked: 3 clicks in 2.4 s against limits of 3 clicks and 5 s passes", () => {
  // 3 ≤ 3 clicks and 2,400 ms ≤ 5 × 1,000 ms, so it passes; seconds = 2400 / 1000 = 2.4.
  assert.deepEqual(judge(ready, { clicks: 3, ms: 2400 }), { kind: "pass", clicks: 3, seconds: 2.4 });
  assert.equal(reportLine(ready, judge(ready, { clicks: 3, ms: 2400 })), "PASS ready one: 3 clicks (limit 3), 2.40 s (limit 5 s)");
});

test("time limit boundaries: 0.9× passes, exactly the limit passes, 1.1× fails", () => {
  // 0.9 × 5 s = 4,500 ms; 1.1 × 5 s = 5,500 ms.
  assert.equal(judge(ready, { clicks: 1, ms: 4500 }).kind, "pass");
  assert.equal(judge(ready, { clicks: 1, ms: 5000 }).kind, "pass");
  assert.deepEqual(judge(ready, { clicks: 1, ms: 5500 }), { kind: "fail", reasons: ["5.50 s, limit 5 s"] });
});

test("click limit boundaries: the limit passes, one more click fails", () => {
  // Clicks are whole, so 0.9×/1.1× of 3 (2.7, 3.3) round to the limit and one over it.
  assert.equal(judge(ready, { clicks: 3, ms: 1 }).kind, "pass");
  assert.deepEqual(judge(ready, { clicks: 4, ms: 1 }), { kind: "fail", reasons: ["4 clicks, limit 3"] });
  assert.deepEqual(judge(ready, { clicks: 4, ms: 6000 }), { kind: "fail", reasons: ["4 clicks, limit 3", "6.00 s, limit 5 s"] });
});

test("a pending journey never passes, even with a perfect run", () => {
  for (const run of [null, { clicks: 1, ms: 1 }, { clicks: 99, ms: 1e9 }]) {
    assert.deepEqual(judge(waiting, run), { kind: "pending", waitsFor: "Laser (L1)" });
  }
  assert.equal(reportLine(waiting, judge(waiting, null)), "PENDING waiting one: waits for Laser (L1)");
});

test("a ready journey not walked, or measured wrongly, fails", () => {
  assert.deepEqual(judge(ready, null), { kind: "fail", reasons: ["not walked"] });
  for (const run of [{ clicks: 0, ms: 10 }, { clicks: 1.5, ms: 10 }, { clicks: 2, ms: NaN }, { clicks: 2, ms: -1 }, { clicks: 2, ms: Infinity }]) {
    assert.equal(judge(ready, run).kind, "fail", JSON.stringify(run));
  }
  assert.deepEqual(judge(ready, { clicks: 0, ms: NaN }), { kind: "fail", reasons: ["bad click count 0", "bad time NaN ms"] });
});

test("seeded random runs agree with a simple model (5 seeds × 500 runs)", () => {
  for (const seed of [1n, 2n, 3n, 4n, 5n]) {
    const r = seeded(seed);
    for (let i = 0; i < 500; i++) {
      const journey: MagicJourney = {
        ...ready,
        clickLimit: 1 + Math.floor(r.next() * 10),
        secondsLimit: 1 + Math.floor(r.next() * 30),
        status: r.next() < 0.2 ? { waitsFor: "x" } : "ready",
      };
      const run = r.next() < 0.05 ? null : { clicks: 1 + Math.floor(r.next() * 12), ms: r.next() * 35000 };
      const got = judge(journey, run).kind;
      const model =
        journey.status !== "ready" ? "pending" : run === null ? "fail" : run.clicks <= journey.clickLimit && run.ms <= journey.secondsLimit * 1000 ? "pass" : "fail";
      assert.equal(got, model, `seed ${seed} run ${i}: ${JSON.stringify({ journey, run })}`);
    }
  }
});

test("the list: exactly the two Design-only journeys are ready; every other one says what it waits for", () => {
  assert.deepEqual(MAGIC_JOURNEYS.filter((j) => j.status === "ready").map((j) => j.name), ["Design: shape to STL", "Design: sketch to STL"]);
  const names = MAGIC_JOURNEYS.map((j) => j.name);
  assert.equal(new Set(names).size, names.length, "names are unique");
  for (const j of MAGIC_JOURNEYS) {
    assert.ok(j.steps.length > 0 && Number.isInteger(j.clickLimit) && j.clickLimit > 0 && j.secondsLimit > 0, j.name);
    if (j.status !== "ready") assert.ok(j.status.waitsFor.length > 0, j.name);
  }
  // Every waiting "zero exports" journey also has a magic moment, so none is forgotten.
  for (const z of JOURNEYS.filter((j) => j.status !== "ready")) assert.ok(names.includes(z.name), z.name);
});

// X8b: against the baseline in tests/baseline.json.
const base: JourneyBaseline = { clicks: 3, slowestMs: 700 };

test("hand-worked: the confirmed baseline flags above 805 ms and above 3 clicks", () => {
  // 700 ms × 1.15 = 805 ms: 805 is exactly 15% over (not "more than"), so OK; 806 is flagged.
  assert.deepEqual(compareToBaseline(ready, { clicks: 3, slowestMs: 805 }, base), { kind: "ok" });
  assert.deepEqual(compareToBaseline(ready, { clicks: 3, slowestMs: 806 }, base), {
    kind: "flag",
    // 806 / 700 = 1.1514…, so 15% over when rounded, and above the 15% line.
    flags: [{ kind: "time", text: "slowest 0.81 s, baseline 0.70 s (15% over, flag above 15%)" }],
  });
  // One click more than 3 is flagged whatever the time.
  assert.deepEqual(compareToBaseline(ready, { clicks: 4, slowestMs: 100 }, base), {
    kind: "flag",
    flags: [{ kind: "clicks", text: "4 clicks, baseline 3 (1 extra)" }],
  });
  const m = { clicks: 3, slowestMs: 650 };
  assert.equal(baselineLine(ready, m, base, compareToBaseline(ready, m, base)), "OK ready one: 3 clicks (baseline 3), slowest 0.65 s (baseline 0.70 s)");
});

test("time margin boundaries: 0.9× of the 15% margin is OK, 1.1× is flagged", () => {
  // 0.9 × 15% = 13.5% over: 700 × 1.135 = 794.5 ms. 1.1 × 15% = 16.5% over: 700 × 1.165 = 815.5 ms.
  assert.equal(compareToBaseline(ready, { clicks: 3, slowestMs: 794.5 }, base).kind, "ok");
  assert.equal(compareToBaseline(ready, { clicks: 3, slowestMs: 815.5 }, base).kind, "flag");
  // Faster is always fine.
  assert.equal(compareToBaseline(ready, { clicks: 3, slowestMs: 1 }, base).kind, "ok");
});

test("click boundaries: the baseline is OK, one over is flagged, fewer is OK with a note", () => {
  assert.equal(compareToBaseline(ready, { clicks: 3, slowestMs: 700 }, base).kind, "ok");
  assert.equal(compareToBaseline(ready, { clicks: 4, slowestMs: 700 }, base).kind, "flag");
  const fewer = compareToBaseline(ready, { clicks: 2, slowestMs: 700 }, base);
  assert.deepEqual(fewer, { kind: "ok", note: "2 clicks, fewer than the baseline 3: ask the owner to lower it" });
  // Both over: both flags, clicks first.
  const both = compareToBaseline(ready, { clicks: 5, slowestMs: 1400 }, base);
  assert.equal(both.kind, "flag");
  assert.deepEqual(both.kind === "flag" && both.flags.map((f) => f.kind), ["clicks", "time"]);
  assert.equal(baselineLine(ready, null, base, both), "FLAG ready one: 5 clicks, baseline 3 (2 extra); slowest 1.40 s, baseline 0.70 s (100% over, flag above 15%)");
});

test("a ready journey with no baseline or not walked is flagged; a pending one stays pending", () => {
  assert.deepEqual(compareToBaseline(ready, { clicks: 3, slowestMs: 1 }, undefined), {
    kind: "flag",
    flags: [{ kind: "missing", text: "no baseline in tests/baseline.json" }],
  });
  assert.deepEqual(compareToBaseline(ready, null, base), { kind: "flag", flags: [{ kind: "missing", text: "not walked" }] });
  for (const m of [null, { clicks: 99, slowestMs: 1e9 }]) {
    assert.deepEqual(compareToBaseline(waiting, m, base), { kind: "pending", waitsFor: "Laser (L1)" });
  }
});

test("the baseline file: tests/baseline.json holds the owner's numbers for every ready journey", () => {
  const file = JSON.parse(readFileSync(new URL("../../../tests/baseline.json", import.meta.url), "utf8"));
  const baselines = parseBaselines(file.journeys);
  // Confirmed by the owner on 2026-10-16: Design shape to STL, 3 clicks; slowest walk re-measured
  // on GitHub's runners the same day (owner chose "Re-measure"): 1.23 s, the worst of 12 runs.
  // 4 clicks from 2026-10-24 (owner's OK: presets moved into Insert ▾, U0d); the time re-measured on
  // 2026-10-25 UTC, slowest of 12 GitHub runs: 1.157 s (the walks ranged 0.44-1.16 s).
  assert.deepEqual(baselines.get("Design: shape to STL"), { clicks: 4, slowestMs: 1157 });
  for (const j of MAGIC_JOURNEYS) assert.equal(baselines.has(j.name), j.status === "ready", j.name);
});

test("a broken baseline throws, naming the entry", () => {
  const journeys = [ready];
  assert.throws(() => parseBaselines(null, journeys), /not an object/);
  assert.throws(() => parseBaselines([], journeys), /not an object/);
  assert.throws(() => parseBaselines({ "gone one": base }, journeys), /no journey named "gone one"/);
  for (const bad of [{ clicks: 0, slowestMs: 700 }, { clicks: 2.5, slowestMs: 700 }, { slowestMs: 700 }, null]) {
    assert.throws(() => parseBaselines({ "ready one": bad }, journeys), /"ready one": clicks/, JSON.stringify(bad));
  }
  for (const bad of [{ clicks: 3, slowestMs: 0 }, { clicks: 3, slowestMs: -1 }, { clicks: 3, slowestMs: NaN }, { clicks: 3, slowestMs: "700" }]) {
    assert.throws(() => parseBaselines({ "ready one": bad }, journeys), /"ready one": slowestMs/, JSON.stringify(bad));
  }
  assert.deepEqual(parseBaselines({}, journeys).size, 0);
});

test("hand-worked: a relative baseline judges the slowest walk as a multiple of the fixed workload, not in seconds", () => {
  // The 10-26 runs: the slowest walk 1,372.8 ms where the fixed workload's fastest run took 650 ms on the same (busy)
  // runner, so 1372.8 / 650 = 2.112 (to 4 decimals 2.1120). The baseline day: 1,157 ms slowest with the workload at
  // 550 ms, 1157 / 550 = 2.1036. 2.1120 / 2.1036 = 1.0040, 0.4% over: fine, where 1372.8 / 1157 = 1.1865, 19% over,
  // flags in seconds. The relative baseline is what makes a slow runner cancel out.
  const measured = { clicks: 4, slowestMs: 1372.8, slowestRelative: 2.112 };
  assert.deepEqual(compareToBaseline(ready, measured, { clicks: 4, slowestMs: 1157, slowestRelative: 2.1036 }), { kind: "ok" });
  const absolute = compareToBaseline(ready, measured, { clicks: 4, slowestMs: 1157 });
  assert.deepEqual(absolute.kind === "flag" && absolute.flags.map((f) => f.kind), ["time"]);
  // The seconds flag carries the relative number along, so the nightly summaries collect it before the owner sets the baseline.
  assert.deepEqual(absolute.kind === "flag" && absolute.flags[0].text, "slowest 1.37 s = 2.11× the fixed workload, baseline 1.16 s (19% over, flag above 15%)");
  // The OK line shows both numbers too.
  assert.equal(
    baselineLine(ready, measured, { clicks: 4, slowestMs: 1157, slowestRelative: 2.1036 }, { kind: "ok" }),
    "OK ready one: 4 clicks (baseline 4), slowest 1.37 s = 2.11× the fixed workload (baseline 2.10×) (baseline 1.16 s)",
  );
  assert.equal(baselineLine(ready, measured, { clicks: 4, slowestMs: 1157 }, { kind: "ok" }), "OK ready one: 4 clicks (baseline 4), slowest 1.37 s = 2.11× the fixed workload (baseline 1.16 s)");
});

test("relative margin boundaries: 0.9× of the 15% margin passes, exactly 15% passes, 1.1× of it flags", () => {
  // Baseline 2.0×: the margin allows up to 2.0 × 1.15 = 2.3. 0.9 × 15% = 13.5% over is 2.27; 1.1 × 15% = 16.5% over is 2.33.
  const base = { clicks: 4, slowestMs: 1000, slowestRelative: 2 };
  assert.deepEqual(compareToBaseline(ready, { clicks: 4, slowestMs: 5000, slowestRelative: 2.27 }, base), { kind: "ok" });
  assert.deepEqual(compareToBaseline(ready, { clicks: 4, slowestMs: 5000, slowestRelative: 2.3 }, base), { kind: "ok" });
  // 2.33 / 2 − 1 = 16.5% over, which prints rounded to 17%.
  const slow = compareToBaseline(ready, { clicks: 4, slowestMs: 5000, slowestRelative: 2.33 }, base);
  assert.deepEqual(slow, { kind: "flag", flags: [{ kind: "time", text: "slowest 5.00 s = 2.33× the fixed workload, baseline 2.00× (17% over, flag above 15%)" }] });
  // With a relative baseline the seconds are only shown: 5 s against a 1 s baseline passed above. Without it, 5 s flags.
  assert.equal(compareToBaseline(ready, { clicks: 4, slowestMs: 5000, slowestRelative: 2.27 }, { clicks: 4, slowestMs: 1000 }).kind, "flag");
});

test("a relative baseline with a measurement that did not time the workload is flagged as missing, never quietly passed", () => {
  const got = compareToBaseline(ready, { clicks: 4, slowestMs: 1 }, { clicks: 4, slowestMs: 1000, slowestRelative: 2 });
  assert.deepEqual(got, { kind: "flag", flags: [{ kind: "missing", text: "the fixed workload was not timed, so the slowest walk cannot be judged against the relative baseline" }] });
});

test("the baseline's slowestRelative is optional, and when given must be a number > 0", () => {
  const journeys = [ready];
  assert.deepEqual(parseBaselines({ "ready one": { clicks: 3, slowestMs: 700 } }, journeys).get("ready one"), { clicks: 3, slowestMs: 700 });
  assert.deepEqual(parseBaselines({ "ready one": { clicks: 3, slowestMs: 700, slowestRelative: 2.1036 } }, journeys).get("ready one"), { clicks: 3, slowestMs: 700, slowestRelative: 2.1036 });
  for (const bad of [0, -1, NaN, Infinity, "2.1", null]) {
    assert.throws(() => parseBaselines({ "ready one": { clicks: 3, slowestMs: 700, slowestRelative: bad } }, journeys), /"ready one": slowestRelative/, JSON.stringify(bad));
  }
});

test("seeded random measurements agree with a simple baseline model (5 seeds × 500)", () => {
  for (const seed of [11n, 12n, 13n, 14n, 15n]) {
    const r = seeded(seed);
    for (let i = 0; i < 500; i++) {
      const b = { clicks: 1 + Math.floor(r.next() * 8), slowestMs: 1 + Math.floor(r.next() * 5000) };
      const m = r.next() < 0.05 ? null : { clicks: 1 + Math.floor(r.next() * 10), slowestMs: Math.floor(r.next() * 8000) };
      const journey = r.next() < 0.2 ? waiting : ready;
      const bl = r.next() < 0.05 ? undefined : b;
      const got = compareToBaseline(journey, m, bl);
      // The model, in floating point the other way round: flagged when over baseline × 1.15 (1e-9 absorbs rounding).
      const model =
        journey !== ready ? "pending" : !bl || m === null ? "flag" : m.clicks > bl.clicks || m.slowestMs > bl.slowestMs * 1.15 + 1e-9 ? "flag" : "ok";
      assert.equal(got.kind, model, `seed ${seed} run ${i}: ${JSON.stringify({ b, m, got })}`);
    }
  }
});

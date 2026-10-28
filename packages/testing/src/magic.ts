// "Magic moment" journeys (X8, docs/integration.md "Measuring the magic"):
// browser walks with a click limit and a time limit. The browser test
// (apps/fission/e2e/journeys.mjs) walks each ready one, counts the user's
// clicks and times it from the first click to the result, then asks
// `judge` for the verdict. A journey waiting for a workspace is pending and
// is never reported as passing, whatever was measured.

export interface MagicJourney {
  name: string;
  /** The steps, in the user's words. */
  steps: string[];
  /** The most clicks the journey may take; one more fails. */
  clickLimit: number;
  /** The most seconds from the first click to the result. */
  secondsLimit: number;
  status: "ready" | { waitsFor: string };
}

/** What a walk measured: the user's clicks and the milliseconds taken. */
export interface JourneyRun {
  clicks: number;
  ms: number;
}

export type JourneyVerdict =
  | { kind: "pass"; clicks: number; seconds: number }
  | { kind: "fail"; reasons: string[] }
  | { kind: "pending"; waitsFor: string };

export const MAGIC_JOURNEYS: MagicJourney[] = [
  {
    name: "Design: shape to STL",
    steps: ["insert a shape", "change a size", "Download STL"],
    // From an empty design (a new project, U0c): Insert ▾ and its Box (U0d: the presets live in a menu), the size field, the STL button.
    clickLimit: 4,
    secondsLimit: 5,
    status: "ready",
  },
  {
    // Step 25c4: a part from a sketch, from an empty design (a new project, U0c).
    name: "Design: sketch to STL",
    steps: ["start a sketch on the ground", "draw a rectangle", "extrude it", "Download STL"],
    // Create Sketch and the plane, the rectangle tool and its two corners, Extrude and OK, the STL button.
    clickLimit: 8,
    // 2.7 s in this project's sandbox and about 3.6 times that on GitHub's runners (as the shape journey is):
    // a limit with room, the baseline's 15% catching any slowdown nightly.
    secondsLimit: 20,
    status: "ready",
  },
  {
    name: "Box to laser panels",
    steps: ["draw a box", "click Cut on laser", "change the thickness to 6 mm", "the panels update"],
    clickLimit: 5,
    secondsLimit: 10,
    status: { waitsFor: "Laser (L1–L3), X13" },
  },
  {
    name: "Logo to everything",
    steps: ["draw a logo", "emboss it in Design", "engrave it in Laser", "render it"],
    clickLimit: 8,
    secondsLimit: 15,
    status: { waitsFor: "Vector (V3), Laser (L1), Render (R1)" },
  },
  {
    name: "Enclosure and board",
    steps: ["model an enclosure", "board outline from it", "mounting holes linked both ways", "print the enclosure"],
    clickLimit: 10,
    secondsLimit: 20,
    status: { waitsFor: "Circuit (E3), Slice (P1)" },
  },
  {
    name: "Photo to lithophane",
    steps: ["edit a photo", "make a lithophane", "slice it"],
    clickLimit: 6,
    secondsLimit: 15,
    status: { waitsFor: "Image (G2), Slice (P2)" },
  },
  {
    name: "Part to simulation and back",
    steps: ["model a part", "simulate it", "change a parameter", "rerun"],
    clickLimit: 6,
    secondsLimit: 30,
    status: { waitsFor: "Simulate (S3), parameters (50, I18)" },
  },
];

/**
 * The verdict on one journey. Pending journeys stay pending even with a
 * run; a ready one with no run, a bad measurement, too many clicks or too
 * long fails, naming each reason.
 */
export function judge(journey: MagicJourney, run: JourneyRun | null): JourneyVerdict {
  if (journey.status !== "ready") return { kind: "pending", waitsFor: journey.status.waitsFor };
  if (run === null) return { kind: "fail", reasons: ["not walked"] };
  const reasons: string[] = [];
  if (!Number.isInteger(run.clicks) || run.clicks < 1) reasons.push(`bad click count ${run.clicks}`);
  if (!Number.isFinite(run.ms) || run.ms < 0) reasons.push(`bad time ${run.ms} ms`);
  if (reasons.length > 0) return { kind: "fail", reasons };
  if (run.clicks > journey.clickLimit) reasons.push(`${run.clicks} clicks, limit ${journey.clickLimit}`);
  if (run.ms > journey.secondsLimit * 1000) reasons.push(`${(run.ms / 1000).toFixed(2)} s, limit ${journey.secondsLimit} s`);
  if (reasons.length > 0) return { kind: "fail", reasons };
  return { kind: "pass", clicks: run.clicks, seconds: run.ms / 1000 };
}

/** One line per journey for a run's report: PASS/FAIL/PENDING, clicks and seconds or why. */
export function reportLine(journey: MagicJourney, verdict: JourneyVerdict): string {
  switch (verdict.kind) {
    case "pass":
      return `PASS ${journey.name}: ${verdict.clicks} clicks (limit ${journey.clickLimit}), ${verdict.seconds.toFixed(2)} s (limit ${journey.secondsLimit} s)`;
    case "fail":
      return `FAIL ${journey.name}: ${verdict.reasons.join("; ")}`;
    case "pending":
      return `PENDING ${journey.name}: waits for ${verdict.waitsFor}`;
  }
}

// The baseline (X8b): what each ready journey took when the owner confirmed
// it, kept in tests/baseline.json under "journeys". The nightly run fails any
// click over the baseline, flags a slowest walk more than 15% over it (root
// CLAUDE.md, "Metrics and baselines") and fails one more than twice over or,
// on a branch, more than 30% slower than main's build on the same runner.
// Clicks are deterministic, so PR CI fails on an extra click too; time is
// only judged nightly.

/**
 * A ready journey's confirmed numbers: clicks, the slowest of the walks in
 * ms and, once the owner has set it, `slowestRelative`: that slowest walk as
 * a multiple of a fixed JavaScript workload's fastest run timed in the same
 * browser (as `relative_time` in tests/baseline.json), so a slow or busy
 * runner mostly cancels out. With it set, the time is judged relative and
 * `slowestMs` is only shown.
 */
export interface JourneyBaseline {
  clicks: number;
  slowestMs: number;
  slowestRelative?: number;
}

/**
 * What one browser run measured for a journey: the most clicks, the slowest
 * walk, that walk relative to the fixed workload when it was timed, and,
 * when main's build was walked in turns with this one on the same runner
 * (the nightly run on a branch), `referenceRatio`: the median of the pairs'
 * times, this build's over main's.
 */
export interface JourneyMeasured {
  clicks: number;
  slowestMs: number;
  slowestRelative?: number;
  referenceRatio?: number;
}

/** How far over the baseline the slowest walk may be, in percent, before it is flagged (a warning: one runner's time varies more than this). */
export const SLOWEST_MARGIN_PERCENT = 15;
/** How far over the baseline the slowest walk may be, in percent, before it fails: twice as slow, as `relative_time` in tests/baseline.json. */
export const SLOWEST_FAIL_PERCENT = 100;
/**
 * Against main's build walked in turns on the same runner, where a slow
 * runner slows both alike: more than 15% slower is flagged, more than 30%
 * fails. The same build against itself read 0.99–1.02 (2026-10-28, 4
 * cores, idle and loaded), and a deliberately 2× slower app 1.72.
 */
export const REFERENCE_FLAG_PERCENT = 15;
export const REFERENCE_FAIL_PERCENT = 30;

/**
 * "time" is a warning (listed, never failing on its own); "slower" fails the
 * nightly run: more than 30% slower than main's build on the same runner,
 * or more than twice the baseline.
 */
export type BaselineFlag = { kind: "clicks" | "time" | "slower" | "missing"; text: string };

export type JourneyCheck =
  | { kind: "ok"; note?: string }
  | { kind: "flag"; flags: BaselineFlag[] }
  | { kind: "pending"; waitsFor: string };

/**
 * Reads the "journeys" part of tests/baseline.json. Every entry must name a
 * journey in `MAGIC_JOURNEYS` and hold whole clicks ≥ 1, a slowest time
 * > 0 ms and, when given, a relative slowest > 0; anything else throws,
 * naming the entry, so a broken baseline can never quietly pass.
 */
export function parseBaselines(json: unknown, journeys: MagicJourney[] = MAGIC_JOURNEYS): Map<string, JourneyBaseline> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error("journey baseline: not an object");
  const out = new Map<string, JourneyBaseline>();
  for (const [name, value] of Object.entries(json)) {
    if (!journeys.some((j) => j.name === name)) throw new Error(`journey baseline: no journey named "${name}"`);
    const v = value as Partial<JourneyBaseline> | null;
    if (typeof v !== "object" || v === null || !Number.isInteger(v.clicks) || (v.clicks as number) < 1) {
      throw new Error(`journey baseline "${name}": clicks must be a whole number ≥ 1`);
    }
    if (typeof v.slowestMs !== "number" || !Number.isFinite(v.slowestMs) || v.slowestMs <= 0) {
      throw new Error(`journey baseline "${name}": slowestMs must be a number > 0`);
    }
    if (v.slowestRelative !== undefined && (typeof v.slowestRelative !== "number" || !Number.isFinite(v.slowestRelative) || v.slowestRelative <= 0)) {
      throw new Error(`journey baseline "${name}": slowestRelative, when given, must be a number > 0`);
    }
    out.set(name, { clicks: v.clicks as number, slowestMs: v.slowestMs, ...(v.slowestRelative !== undefined ? { slowestRelative: v.slowestRelative } : {}) });
  }
  return out;
}

/**
 * One journey against its baseline. Pending journeys stay pending. A ready
 * journey with no baseline or no measurement is flagged ("missing"); more
 * clicks than the baseline is flagged ("clicks"); a slowest walk more than
 * 15% over is flagged ("time"; exactly 15% over is not). With a relative
 * baseline (`slowestRelative`) the walk is judged as a multiple of the fixed
 * workload instead, and a measurement that did not time the workload is
 * flagged ("missing"). Fewer clicks or a faster walk is fine, with a note
 * when the clicks could tighten the baseline.
 */
export function compareToBaseline(journey: MagicJourney, measured: JourneyMeasured | null, baseline: JourneyBaseline | undefined): JourneyCheck {
  if (journey.status !== "ready") return { kind: "pending", waitsFor: journey.status.waitsFor };
  const flags: BaselineFlag[] = [];
  if (baseline === undefined) flags.push({ kind: "missing", text: "no baseline in tests/baseline.json" });
  if (measured === null) flags.push({ kind: "missing", text: "not walked" });
  if (baseline === undefined || measured === null) return { kind: "flag", flags };
  if (measured.clicks > baseline.clicks) {
    const extra = measured.clicks - baseline.clicks;
    flags.push({ kind: "clicks", text: `${measured.clicks} clicks, baseline ${baseline.clicks} (${extra} extra)` });
  }
  const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
  const times = (relative: number) => `${relative.toFixed(2)}× the fixed workload`;
  // Integer-safe "more than p% over": measured × 100 > baseline × (100 + p).
  const overBy = (m: number, b: number) => (m * 100 > b * (100 + SLOWEST_FAIL_PERCENT) ? "slower" : m * 100 > b * (100 + SLOWEST_MARGIN_PERCENT) ? "time" : null);
  const limits = `flag above ${SLOWEST_MARGIN_PERCENT}%, fail above ${SLOWEST_FAIL_PERCENT}%`;
  if (baseline.slowestRelative !== undefined) {
    // Relative: the slowest walk as a multiple of the fixed workload timed in the same browser.
    if (measured.slowestRelative === undefined) {
      flags.push({ kind: "missing", text: "the fixed workload was not timed, so the slowest walk cannot be judged against the relative baseline" });
    } else {
      const kind = overBy(measured.slowestRelative, baseline.slowestRelative);
      const over = (measured.slowestRelative / baseline.slowestRelative - 1) * 100;
      if (kind) flags.push({ kind, text: `slowest ${seconds(measured.slowestMs)} = ${times(measured.slowestRelative)}, baseline ${baseline.slowestRelative.toFixed(2)}× (${over.toFixed(0)}% over, ${limits})` });
    }
  } else {
    // Absolute, as before the relative baseline is set; the relative number rides along so the nightly summaries collect it.
    const kind = overBy(measured.slowestMs, baseline.slowestMs);
    const over = (measured.slowestMs / baseline.slowestMs - 1) * 100;
    const relative = measured.slowestRelative === undefined ? "" : ` = ${times(measured.slowestRelative)}`;
    if (kind) flags.push({ kind, text: `slowest ${seconds(measured.slowestMs)}${relative}, baseline ${seconds(baseline.slowestMs)} (${over.toFixed(0)}% over, ${limits})` });
  }
  if (measured.referenceRatio !== undefined) {
    // Main's build on the same runner, in turns: the runner's own speed cancels out, so this is the check that fails a real slowdown.
    const r = measured.referenceRatio;
    const kind = r * 100 > 100 + REFERENCE_FAIL_PERCENT ? "slower" : r * 100 > 100 + REFERENCE_FLAG_PERCENT ? "time" : null;
    if (kind) {
      flags.push({ kind, text: `${r.toFixed(2)}× main's build walked in turns on the same runner (flag above ${REFERENCE_FLAG_PERCENT}% slower, fail above ${REFERENCE_FAIL_PERCENT}%)` });
    }
  }
  if (flags.length > 0) return { kind: "flag", flags };
  if (measured.clicks < baseline.clicks) return { kind: "ok", note: `${measured.clicks} clicks, fewer than the baseline ${baseline.clicks}: ask the owner to lower it` };
  return { kind: "ok" };
}

/** One line per journey for the nightly summary: OK/FLAG/PENDING with the numbers. */
export function baselineLine(journey: MagicJourney, measured: JourneyMeasured | null, baseline: JourneyBaseline | undefined, check: JourneyCheck): string {
  switch (check.kind) {
    case "pending":
      return `PENDING ${journey.name}: waits for ${check.waitsFor}`;
    case "flag":
      return `FLAG ${journey.name}: ${check.flags.map((f) => f.text).join("; ")}`;
    case "ok": {
      const m = measured as JourneyMeasured;
      const b = baseline as JourneyBaseline;
      const relative =
        m.slowestRelative === undefined ? "" : ` = ${m.slowestRelative.toFixed(2)}× the fixed workload${b.slowestRelative === undefined ? "" : ` (baseline ${b.slowestRelative.toFixed(2)}×)`}`;
      const reference = m.referenceRatio === undefined ? "" : `, ${m.referenceRatio.toFixed(2)}× main's build on the same runner`;
      const line = `OK ${journey.name}: ${m.clicks} clicks (baseline ${b.clicks}), slowest ${(m.slowestMs / 1000).toFixed(2)} s${relative} (baseline ${(b.slowestMs / 1000).toFixed(2)} s)${reference}`;
      return check.note ? `${line}; ${check.note}` : line;
    }
  }
}

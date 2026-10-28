// Regression tests for the 2026-10-28 sketch hunt (its failing tests, moved
// here as they were fixed), and the checks the fixes needed: a centre arc's
// end within MIN_CHORD (0.001 mm) of its start is refused, an end clicked
// on a point of its circle is that point (ON_CIRCLE), an arc or circle on
// top of one already there is refused like a line on a line, and Enter
// while a typed-size box is red places nothing.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SketchXY } from "@fission/core";
import { partDocument, type DesignDocument } from "../src/document.ts";
import { addSketch, drawLine, sketchCurves } from "../src/sketch.ts";
import { clickAt, hoverTool, SAME_CIRCLE, startTool, type ArcTool, type CircleTool, type SketchTool } from "../src/sketch-tool.ts";
import { centreArc, MIN_CHORD, NO_TURN, ON_CIRCLE, SAME_ARC } from "../src/centre-arc.ts";
import { snapPointer, snapTargets } from "../src/snap.ts";
import { aimOf, withLocks, type Locks } from "../src/typed-entry.ts";
import { typedBoxes } from "../src/typed-boxes.ts";
const { Window } = await import("happy-dom");

function clicks<T extends SketchTool>(doc: DesignDocument, tool: T, at: SketchXY[]) {
  let drew = 0;
  let note: string | undefined;
  for (const p of at) {
    const r = clickAt(doc, tool, p);
    doc = r.doc;
    tool = r.tool as T;
    note = r.note;
    if (r.drew) drew++;
  }
  return { doc, tool, drew, note };
}

const fresh = () => addSketch(partDocument("box", 40, 30, 20));

/** Mulberry32: a small seeded generator, so a failing case replays from its seed. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Centre arc ends (hunt-arc-1, hunt-arc-2, hunt-snap-2) ----

test("hunt-arc-1: a centre arc's end clicked on its own start draws nothing (NO_TURN)", () => {
  const { doc, id } = fresh();
  // Grid clicks (0.1 mm grid, as snapped: 17 × 0.1 etc. are what the grid produces).
  const c: SketchXY = [-1.7000000000000002, 1.4000000000000001];
  const s: SketchXY = [-1.9000000000000001, -0.4];
  // Hand-worked: the end is on the ray from c through the click at radius |s − c|; the click IS s, so the end
  // is s itself: no turn, nothing drawn. Before the fix, c + (s − c)·1 came out 2.2e-16 mm off s and an arc
  // that small was drawn, and the kernel then refused the whole sketch.
  const r = clicks(doc, startTool("centre", id), [c, s, s]);
  assert.equal(r.drew, 0, `drew an arc ${JSON.stringify(sketchCurves(r.doc.sketches[0]).arcs)}`);
  assert.equal(r.note, NO_TURN);
});

test("hunt-arc-2: a centre arc ending on an existing point on its circle shares that point", () => {
  const { doc, id } = fresh();
  const s: SketchXY = [-1.9000000000000001, -0.4];
  const c: SketchXY = [-1.7000000000000002, 1.4000000000000001];
  const e: SketchXY = [-1.5, 3.2]; // c + (c − s) on the grid: |e − c|² = 0.04 + 3.24 = |s − c|², on the circle
  const line = clicks(doc, startTool("line", id), [s, e]);
  const arc = clicks(line.doc, startTool("centre", id), [c, s, e]);
  // Hand-worked: the click is on the circle, so the end is the click itself, the line's end: 3 points (s, e, c), not 4.
  assert.equal(arc.drew, 1);
  assert.equal(arc.doc.sketches[0].points.length, 3, `points ${JSON.stringify(arc.doc.sketches[0].points)}`);
});

test("hunt-snap-2: a D shape, centre arc on a line's midpoint from one end to the other, shares both ends", () => {
  const s = fresh();
  // A line from (0.1·3, 0.2) to (4, 3.9): what clicking on a 0.1 mm grid gives (0.1·3 = 0.30000000000000004).
  let doc: DesignDocument = drawLine(s.doc, s.id, [0.1 * 3, 0.2], [4, 3.9]).doc;
  let tool: SketchTool = startTool("centre", s.id);
  const snap = (raw: SketchXY) => snapPointer(raw, raw, snapTargets(doc.sketches[0], tool), 0.1).at;
  assert.deepEqual(snap([2.16, 2.04]), [(0.1 * 3 + 4) / 2, (0.2 + 3.9) / 2]); // the midpoint target, exactly
  for (const raw of [[2.16, 2.04], [0.31, 0.21], [3.99, 3.91]] as SketchXY[]) {
    const r = clickAt(doc, tool, snap(raw));
    doc = r.doc;
    tool = r.tool;
  }
  // The end click snapped onto (4, 3.9), the line's end, on the circle (c the midpoint): 2 ends + the centre = 3 points.
  const sk = doc.sketches[0];
  assert.ok(sk.curves.some((c) => c.kind === "arc"), "the arc was drawn");
  assert.equal(sk.points.length, 3, `points: ${JSON.stringify(sk.points)}`);
});

test("hand-worked: an end clicked on its circle is that click, an end off it is on the ray", () => {
  // Centre (0, 0), start (10, 0). A click at (6, 8): |(6, 8)| = 10, on the circle, so the end is (6, 8).
  assert.deepEqual(centreArc([0, 0], [10, 0], [6, 8], true)!.end, [6, 8]);
  // A click at (3, 4): |(3, 4)| = 5, half the radius, so the end is (3, 4)·2 = (6, 8).
  assert.deepEqual(centreArc([0, 0], [10, 0], [3, 4], true)!.end, [6, 8]);
});

test("ON_CIRCLE boundary: a click 0.9× its bound off the circle is the end, 1.1× is moved onto the ray", () => {
  // Centre (0, 0), start (10, 0), click (0, 10 + δ): d − r = δ, M = 10 + δ. The bound is ON_CIRCLE·M ≈ 3.55e-14 mm
  // (about 20 doubles apart at 10), so δ = 0.9× and 1.1× of it are each distinct doubles off 10.
  const bound = ON_CIRCLE * 10;
  const near: SketchXY = [0, 10 + 0.9 * bound];
  const far: SketchXY = [0, 10 + 1.1 * bound];
  assert.notEqual(near[1], 10);
  assert.deepEqual(centreArc([0, 0], [10, 0], near, true)!.end, near, "0.9×: the click is on the circle to within rounding");
  const moved = centreArc([0, 0], [10, 0], far, true)!.end;
  assert.notDeepEqual(moved, far, "1.1×: the click is off the circle, the end is put on it");
  assert.ok(Math.abs(moved[1] - 10) <= 2e-15 && moved[0] === 0, `${moved}`);
});

test("MIN_CHORD boundary: ends 0.0011 mm apart (1.1×) draw, 0.0009 mm apart (0.9×) don't", () => {
  // Centre (0, 0), start (10, 0). A click at angle θ ends at 10·(cos θ, sin θ); the chord to the start is
  // 2·10·sin(θ/2), so chord L is θ = 2·asin(L / 20).
  const at = (L: number): SketchXY => {
    const t = 2 * Math.asin(L / 20);
    return [10 * Math.cos(t), 10 * Math.sin(t)];
  };
  const { doc, id } = fresh();
  const wide = clicks(doc, startTool("centre", id), [[0, 0], [10, 0], at(1.1 * MIN_CHORD)]);
  assert.equal(wide.drew, 1);
  const arc = sketchCurves(wide.doc.sketches[0]).arcs[0];
  assert.ok(Math.abs(Math.hypot(arc.end[0] - arc.start[0], arc.end[1] - arc.start[1]) - 0.0011) < 1e-12);
  const narrow = clicks(doc, startTool("centre", id), [[0, 0], [10, 0], at(0.9 * MIN_CHORD)]);
  assert.equal(narrow.drew, 0);
  assert.equal(narrow.note, NO_TURN);
});

test("an arc swept nearly a whole turn, its end 0.0009 mm short of the start, is refused too", () => {
  // The pointer goes round counter-clockwise past three quarters and on to just below the start: the sweep is
  // 2π − θ with chord 2·10·sin(θ/2) = 0.0009 mm, the ends as close as the narrow arc above.
  const { doc, id } = fresh();
  let tool: SketchTool = clicks(doc, startTool("centre", id), [[0, 0], [10, 0]]).tool;
  for (const h of [[0, 10], [-10, 0], [0, -10]] as SketchXY[]) tool = hoverTool(tool, h);
  const t = 2 * Math.asin(0.0009 / 20);
  const r = clickAt(doc, tool, [10 * Math.cos(t), -10 * Math.sin(t)]);
  assert.equal(r.drew, false);
  assert.equal(r.note, NO_TURN);
});

test("seeded: 3,000 centre arcs on a 0.1 mm grid, each end on the start, on the far side of the circle, or anywhere", () => {
  const seed = Number(process.env.FISSION_SEED ?? 20261028);
  const random = rng(seed);
  const grid = (): number => Math.round((random() * 2 - 1) * 400) * 0.1; // −40 … 40 mm, as the grid snaps
  let onStart = 0, opposite = 0, anywhere = 0;
  for (let i = 0; i < 3000; i++) {
    const c: SketchXY = [grid(), grid()];
    const s: SketchXY = [grid(), grid()];
    if (c[0] === s[0] && c[1] === s[1]) continue;
    const where = `seed ${seed} case ${i}: c ${c}, s ${s}`;
    const { doc, id } = fresh();
    // The end on the start: never drawn.
    const back = clicks(doc, startTool("centre", id), [c, s, s]);
    assert.equal(back.drew, 0, `${where}: an arc back onto its start`);
    assert.equal(back.note, NO_TURN, where);
    onStart++;
    // The far side, q = 2c − s (a grid point on the circle, the model says, by symmetry), after a line s → q:
    // the arc ends on the line's two points, so the sketch holds s, q and c.
    const q: SketchXY = [Math.round((2 * c[0] - s[0]) * 10) * 0.1, Math.round((2 * c[1] - s[1]) * 10) * 0.1];
    const exact = Math.abs((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 - ((s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2)) <= 1e-9;
    if (exact) {
      const line = clicks(doc, startTool("line", id), [s, q]);
      const d = clicks(line.doc, startTool("centre", id), [c, s, q]);
      assert.equal(d.drew, 1, where);
      assert.equal(d.doc.sketches[0].points.length, 3, `${where}: the half disc shares its ends, ${JSON.stringify(d.doc.sketches[0].points)}`);
      opposite++;
    }
    // Anywhere: drawn when the model's end (on the ray, at radius r) is at least MIN_CHORD from the start.
    const p: SketchXY = [grid(), grid()];
    if (p[0] === c[0] && p[1] === c[1]) continue;
    const r = Math.sqrt((s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2);
    const dp = Math.sqrt((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2);
    const e: SketchXY = [c[0] + ((p[0] - c[0]) / dp) * r, c[1] + ((p[1] - c[1]) / dp) * r];
    const chord = Math.sqrt((e[0] - s[0]) ** 2 + (e[1] - s[1]) ** 2);
    if (Math.abs(chord - MIN_CHORD) < 1e-9) continue;
    const any = clicks(doc, startTool("centre", id), [c, s, p]);
    assert.equal(any.drew, chord >= MIN_CHORD ? 1 : 0, `${where}, p ${p}: chord ${chord}`);
    if (any.drew) {
      const a = sketchCurves(any.doc.sketches[0]).arcs[0];
      const other = a.start[0] === s[0] && a.start[1] === s[1] ? a.end : a.start;
      assert.ok(Math.hypot(other[0] - e[0], other[1] - e[1]) <= 1e-12 * 100, `${where}, p ${p}: end ${other}, the model's ${e}`);
    }
    anywhere++;
  }
  assert.ok(onStart >= 2900 && opposite >= 2900 && anywhere >= 2900, `${onStart} on the start, ${opposite} opposite, ${anywhere} anywhere`);
});

// ---- Arcs and circles on top of others (hunt-snap-1) ----

test("hunt-snap-1: a 3-point arc drawn exactly over an existing arc is refused like a line on a line", () => {
  const s = fresh();
  const arc: ArcTool = { kind: "arc", sketch: s.id, start: null, end: null };
  // Ends (0,0) and (20,0), through (10,10): centre (10,0), radius 10, a half circle.
  const once = clicks(s.doc, arc, [[0, 0], [20, 0], [10, 10]]);
  assert.equal(once.drew, 1);
  // The same three clicks again: every point (both ends and the centre (10,0)) is shared, so the second arc
  // would lie exactly on the first. Nothing drawn, and why.
  const twice = clicks(once.doc, once.tool, [[0, 0], [20, 0], [10, 10]]);
  assert.equal(twice.drew, 0);
  assert.equal(twice.note, SAME_ARC);
  assert.equal(twice.doc.sketches[0].curves.filter((c) => c.kind === "arc").length, 1);
  // The other half, through (10, −10), is the rest of the circle (ends swapped round the same centre): drawn.
  const other = clicks(once.doc, once.tool, [[0, 0], [20, 0], [10, -10]]);
  assert.equal(other.drew, 1);
});

test("hunt-snap-1: a circle drawn exactly over an existing circle is refused; another radius round it is drawn", () => {
  const s = fresh();
  const circle: CircleTool = { kind: "circle", sketch: s.id, centre: null };
  // Centre (0,0), through (10,0): radius 10. Again through (0,10): radius 10 again, the same circle.
  const twice = clicks(s.doc, circle, [[0, 0], [10, 0], [0, 0], [0, 10]]);
  assert.equal(twice.drew, 1);
  assert.equal(twice.note, SAME_CIRCLE);
  assert.equal(twice.doc.sketches[0].curves.filter((c) => c.kind === "circle").length, 1);
  // The centre stays down: a click at (6, 8) is radius 10 again (refused), one at (0, 5) radius 5 (drawn).
  const more = clicks(twice.doc, twice.tool, [[6, 8], [0, 0], [0, 5]]);
  assert.equal(more.drew, 1);
  assert.equal(more.doc.sketches[0].curves.filter((c) => c.kind === "circle").length, 2);
});

test("a centre arc drawn over an existing one is refused", () => {
  const { doc, id } = fresh();
  // Centre (0, 0), start (10, 0), end (0, 10): a quarter. The same clicks again share all three points.
  const once = clicks(doc, startTool("centre", id), [[0, 0], [10, 0], [0, 10]]);
  const twice = clicks(once.doc, once.tool, [[0, 0], [10, 0], [0, 10]]);
  assert.equal(twice.drew, 0);
  assert.equal(twice.note, SAME_ARC);
});

// ---- Enter on a red typed-size box (hunt-typed-5) ----

function boxSession(texts: string[]) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const host = doc.createElement("div");
  doc.body.append(host);
  const s = fresh();
  let design = s.doc;
  let tool: SketchTool = clickAt(design, startTool("line", s.id), [0, 0]).tool;
  const pointer: SketchXY = [37, 3]; // where the mouse happens to rest
  let locks: Locks = {};
  let drew = 0;
  // What workspace.ts placeTyped does on the boxes' enter(): aimOf with the locks it has, then clickAt there.
  const b = typedBoxes(host, {
    locks: (l) => (locks = l),
    enter: () => {
      const aim = aimOf(design, tool, pointer, locks);
      if (!aim) return;
      const o = clickAt(design, withLocks(tool, locks, pointer), aim);
      if (o.drew) drew++;
      design = o.doc;
      tool = o.tool;
    },
    escape: () => {},
  });
  b.show(["length", "angle"], { length: 37.1, angle: 4.6 }, 0, 0);
  b.start("1");
  const length = doc.getElementById("typed-length") as HTMLInputElement;
  const angle = doc.getElementById("typed-angle") as HTMLInputElement;
  const type = (input: HTMLInputElement, text: string) => {
    input.value = text;
    input.dispatchEvent(new window.Event("input") as unknown as Event);
  };
  const enter = (input: HTMLInputElement) => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }) as unknown as Event);
  type(length, texts[0]);
  if (texts[1] !== undefined) type(angle, texts[1]);
  return { doc, length, angle, type, enter, drew: () => drew, points: () => design.sketches[0].points.map((p) => [p.x, p.y]) };
}

test("hunt-typed-5: Enter with 12,5, 1.. or 0.0005 in the Length box draws nothing and puts the keys in that box", () => {
  for (const text of ["12,5", "1..", "0.0005"]) {
    const s = boxSession([text]);
    assert.equal(s.length.getAttribute("aria-invalid"), "true", `the box shows ${text} is refused`);
    s.enter(s.length);
    // By hand: the user meant a typed length; the box refused the text, so nothing should be drawn. A line to
    // the pointer (37, 3), √(37² + 3²) ≈ 37.12 mm long, is not what was typed.
    assert.equal(s.drew(), 0, `${text}: drew a line to the pointer: ${JSON.stringify(s.points())}`);
    assert.equal(s.doc.activeElement, s.length, `${text}: the keys are in the red box`);
  }
});

test("Enter in a good box while the other box is red draws nothing; mended, Enter draws the typed line", () => {
  const s = boxSession(["10", "4o"]); // a letter o for a zero in the angle
  assert.equal(s.angle.getAttribute("aria-invalid"), "true");
  s.enter(s.length);
  assert.equal(s.drew(), 0);
  assert.equal(s.doc.activeElement, s.angle, "the keys go to the red box");
  s.type(s.angle, "90");
  s.enter(s.angle);
  // By hand: 10 mm at 90° from (0, 0) is (0, 10), exactly (direction(90) is (0, 1)).
  assert.equal(s.drew(), 1);
  assert.deepEqual(s.points(), [[0, 0], [0, 10]]);
});

test("Enter with one box typed and the other left empty still places (an empty box is not red)", () => {
  const s = boxSession(["12.5"]);
  s.enter(s.length);
  // By hand: 12.5 mm along the pointer's way (37, 3) from (0, 0): (37, 3)·12.5/√1378.
  assert.equal(s.drew(), 1);
  const [, end] = s.points();
  assert.ok(Math.abs(Math.hypot(end[0], end[1]) - 12.5) < 1e-12 && Math.abs(end[1] / end[0] - 3 / 37) < 1e-12, `${end}`);
});

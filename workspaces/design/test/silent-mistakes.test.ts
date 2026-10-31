// The beginner play-test's silent outcomes (hunt 2026-10-28), each now in
// plain words: a shape left half drawn when Extrude or Finish sketch is
// pressed (`unfinishedWords`), a circle the grid pulled onto its own
// centre (`GRID_ATE_RADIUS`), a refused size in the properties that went
// back without a word (`revertedNote`), hidden bodies left out of the
// whole design's STL (`hiddenStlNote`), and an outline whose curves cross
// or touch, which the kernel answered as "pieces (0, 0) and (0, 2)
// (loop, piece) are 0e0 mm apart" (`askOutline`, the real kernel). The
// browser side (the hint by the pointer on a phone, the second press) is
// in apps/fission/e2e/beginner-mistakes.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { bodyIdOf, partDocument, type DesignDocument } from "../src/document.ts";
import { addSketch, askOutline, drawRectangle, plainOutline, sketchCurves, TOUCHING_CURVES } from "../src/sketch.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { hideBody } from "../src/timeline-edits.ts";
import { bodyFeatures } from "../src/browser.ts";
import { hiddenStlNote } from "../src/actions.ts";
import { revertedNote } from "../src/properties.ts";
import { clickAt, GRID_ATE_RADIUS, NO_RADIUS, startTool, unfinishedWords, type SketchTool } from "../src/sketch-tool.ts";

const sketch = () => addSketch(partDocument("box", 40, 30, 20));

test("hand-worked: a shape with a click not yet a point of the sketch is unfinished, in words naming the next click and the second press", () => {
  const s = sketch();
  const tool = (kind: Parameters<typeof startTool>[0]) => startTool(kind, s.id);
  // Nothing clicked yet: nothing would be lost.
  for (const k of ["line", "rectangle", "circle", "arc", "centre", "tangent", "project"] as const) assert.equal(unfinishedWords(tool(k), "Extrude"), null, k);
  // A circle's centre down: the circle is lost unless its rim is clicked.
  const circle = clickAt(s.doc, tool("circle"), [5, 5]).tool;
  assert.equal(unfinishedWords(circle, "Extrude"), "The circle isn't finished: click a point on the circle to finish it, or press Extrude again to go on without it.");
  assert.equal(unfinishedWords(circle, "Finish sketch"), "The circle isn't finished: click a point on the circle to finish it, or press Finish sketch again to go on without it.");
  const rect = clickAt(s.doc, tool("rectangle"), [0, 0]).tool;
  assert.match(unfinishedWords(rect, "Extrude")!, /^The rectangle isn't finished: click its opposite corner/);
  // A line's start alone is only where a line would begin; once a line is drawn the chain carries on from a point the
  // sketch has. Neither loses anything.
  const start = clickAt(s.doc, tool("line"), [0, 0]);
  assert.equal(unfinishedWords(start.tool, "Extrude"), null, "a line's start alone");
  const drawn = clickAt(start.doc, start.tool, [10, 0]);
  assert.equal(drawn.drew, true);
  assert.equal(unfinishedWords(drawn.tool, "Extrude"), null, "a chain going has drawn its lines already");
  // A 3-point arc: its start, then its end, each says what is still to click.
  const a1 = clickAt(s.doc, tool("arc"), [0, 0]).tool;
  assert.match(unfinishedWords(a1, "Extrude")!, /^The arc isn't finished: click its end, then a point on the arc/);
  const a2 = clickAt(s.doc, a1, [10, 0]).tool;
  assert.match(unfinishedWords(a2, "Extrude")!, /^The arc isn't finished: click a point on the arc/);
  // A centre arc: its centre, then its start.
  const c1 = clickAt(s.doc, tool("centre"), [0, 0]).tool as SketchTool;
  assert.match(unfinishedWords(c1, "Extrude")!, /^The arc isn't finished: click its start, then its end/);
});

test("hand-worked: a circle's second click on its centre draws nothing, and the grid's words say what pulled it there", () => {
  const s = sketch();
  const centre = clickAt(s.doc, startTool("circle", s.id), [0, 0]);
  // With a 10 mm grid a tap 4 mm out rounds to the nearest node, (0, 0): √(0² + 0²) = 0, no radius.
  const second = clickAt(centre.doc, centre.tool, [0, 0]);
  assert.equal(second.drew, false);
  assert.equal(second.note, NO_RADIUS);
  assert.match(GRID_ATE_RADIUS, /grid/i);
  assert.notEqual(GRID_ATE_RADIUS, NO_RADIUS);
});

test("hand-worked: a refused size that went back says so, and a negative distance names Flip", () => {
  assert.equal(revertedNote("The width must be more than 0 mm.", "0", "40", false), "The width must be more than 0 mm. It is back to 40 mm.");
  assert.equal(revertedNote("The distance must be more than 0 mm.", "-60", "20", true), "The distance must be more than 0 mm. It is back to 20 mm. To extrude the other way, tick Flip in Edit feature.");
  // 0 is no direction, so no Flip; a negative width isn't an extrude.
  assert.doesNotMatch(revertedNote("The distance must be more than 0 mm.", "0", "20", true), /Flip/);
  assert.doesNotMatch(revertedNote("The width must be more than 0 mm.", "-5", "40", false), /Flip/);
});

/** The box (Body 1), and two extrudes of one 40 × 30 rectangle (Body 2, Body 3). */
function threeBodies(): DesignDocument {
  const s = sketch();
  const rect = drawRectangle(s.doc, s.id, [0, 0], [40, 30]);
  const one = extrudeSketch(rect.doc, s.id, 10).doc;
  return extrudeSketch(one, s.id, 5).doc;
}

test("hand-worked: the whole design's STL names the hidden bodies it leaves out, by their browser numbers", () => {
  const d = threeBodies();
  const ids = bodyFeatures(d).map((f) => f.id);
  assert.equal(ids.length, 3);
  assert.equal(hiddenStlNote(d), "", "nothing hidden, nothing to say");
  const two = hideBody(d, bodyIdOf(ids[1]), true);
  assert.equal(hiddenStlNote(two), "Body 2 is hidden, so it is not in the STL: show it with its eye in the browser to include it.");
  const both = hideBody(two, bodyIdOf(ids[2]), true);
  assert.equal(hiddenStlNote(both), "Bodies 2 and 3 are hidden, so they are not in the STL: show them with their eyes in the browser to include them.");
  // A hidden body that failed to build is not in the STL either way: it isn't named.
  assert.equal(hiddenStlNote(both, new Set([ids[2]])), "Body 2 is hidden, so it is not in the STL: show it with its eye in the browser to include it.");
});

test("hand-worked, real kernel: an outline touching or crossing itself is refused in plain words, never as 0e0 mm", async () => {
  const kernel = nodeKernel();
  const ring = (corners: [number, number][]) => {
    const s = sketch();
    let doc = s.doc;
    let tool: SketchTool = startTool("line", s.id);
    for (const p of [...corners, corners[0]]) ({ doc, tool } = clickAt(doc, tool, p));
    return sketchCurves(doc.sketches.find((x) => x.id === s.id)!);
  };
  // Touching: corner (10, 0) lies on the first line, (0, 0)→(20, 0), so the two are 0 mm apart there.
  const touch = await askOutline(kernel, ring([[0, 0], [20, 0], [20, 10], [10, 0], [0, 10]]));
  assert.ok("open" in touch);
  assert.equal(touch.open, TOUCHING_CURVES);
  assert.doesNotMatch(touch.open, /0e0|piece|loop/);
  assert.equal(touch.invalid?.length, 2, "the two curves are still named, for the red marks");
  // A bow tie: (0,0)→(10,10) and (10,0)→(0,10) cross at (5, 5).
  const bow = await askOutline(kernel, ring([[0, 0], [10, 10], [10, 0], [0, 10]]));
  assert.ok("open" in bow);
  assert.equal(bow.open, TOUCHING_CURVES);
  // Anything else keeps the kernel's own words: a loose end.
  const s = sketch();
  const one = clickAt(clickAt(s.doc, startTool("line", s.id), [0, 0]).doc, clickAt(s.doc, startTool("line", s.id), [0, 0]).tool, [10, 0]);
  const loose = await askOutline(kernel, sketchCurves(one.doc.sketches.find((x) => x.id === s.id)!));
  assert.ok("open" in loose);
  assert.match(loose.open, /not joined/);
});

test("real kernel: an extrude whose sketch touches itself fails in the same plain words, its two curves named", async () => {
  const s = sketch();
  let doc = s.doc;
  let tool: SketchTool = startTool("line", s.id);
  const corners: [number, number][] = [[0, 0], [20, 0], [20, 10], [10, 0], [0, 10]];
  for (const p of [...corners, corners[0]]) ({ doc, tool } = clickAt(doc, tool, p));
  const made = extrudeSketch(doc, s.id, 10);
  const build = await rebuildTimeline(made.doc, new BodyCache(nodeKernel()), nodeKernel());
  const r = build.results[made.id];
  assert.equal(r.status, "failed");
  assert.ok(r.status === "failed");
  // No kept shape (the sketch never closed), so the extrude fails, saying why in the words the sketch status uses.
  assert.equal(r.message, `Sketch 1 has no closed outline: ${TOUCHING_CURVES}`);
  assert.equal(r.curves?.length, 2);
});

test("plainOutline: only an answer naming two curves is reworded", () => {
  const closed = { closed: { outer: { circle: { center: [0, 0] as [number, number], radius: 1 } }, holes: [] } };
  assert.equal(plainOutline(closed), closed);
  const one = { open: "profile loop 0, piece 3: arc radius must be within [0.001, 1e6] mm", invalid: [{ input: "line" as const, index: 3 }] };
  assert.equal(plainOutline(one), one, "one curve keeps the kernel's words");
  const none = { open: "the end at (1, 2) is not joined to another line or arc" };
  assert.equal(plainOutline(none), none);
  const two = { open: "pieces (0, 0) and (0, 2) (loop, piece) are 0e0 mm apart", invalid: [{ input: "line" as const, index: 0 }, { input: "line" as const, index: 2 }] };
  assert.deepEqual(plainOutline(two), { open: TOUCHING_CURVES, invalid: two.invalid });
});

// Hunt: a centre arc's third click on its own start (snapping lands there) should draw nothing and say
// NO_TURN ("click its end away from its start"), as centre-arc.ts promises. On a 0.1 mm grid the end is
// recomputed as c + (p − c)·k with k = r/d = 1, and c + (s − c) is not s in floating point
// (−1.7 + (−1.9 − −1.7) = −1.9000000000000001 ≠ −1.9), so the exact e === s check misses and an arc whose
// ends are 2.2e-16 mm apart is drawn, with a new point beside the start; the kernel then refuses the
// whole sketch ("arc has its ends 0.0000000000000002 mm apart").
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument } from "../../src/document.ts";
import { addSketch, sketchCurves } from "../../src/sketch.ts";
import { clickAt, startTool } from "../../src/sketch-tool.ts";
import { NO_TURN } from "../../src/centre-arc.ts";

test("centre arc: clicking the end on the start itself draws nothing (NO_TURN)", () => {
  const { doc, id } = addSketch(partDocument("box", 40, 30, 20));
  let tool: any = startTool("centre", id);
  let d = doc;
  // Grid clicks (0.1 mm grid, as snapped: 17 × 0.1 etc. are what the grid produces).
  const c: [number, number] = [-1.7000000000000002, 1.4000000000000001];
  const s: [number, number] = [-1.9000000000000001, -0.4];
  for (const at of [c, s]) ({ doc: d, tool } = clickAt(d, tool, at));
  const r = clickAt(d, tool, s); // third click exactly on the start
  // Hand-worked: the end is on the ray from c through the click at radius |s − c|; the click IS s, so the
  // end is s itself: no turn, nothing drawn.
  const arcs = sketchCurves(r.doc.sketches.find((x) => x.id === id)!).arcs;
  assert.equal(r.drew, false, `drew an arc ${JSON.stringify(arcs)}`);
  assert.equal(r.note, NO_TURN);
});

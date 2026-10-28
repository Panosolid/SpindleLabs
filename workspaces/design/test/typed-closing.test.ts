// Typed ends that land a rounding error off a point already there join it
// (sketch.ts pointNear, within SAME_PLACE), so a typed shape closes on its
// first corner and leaves no stray point beside another. From the sketch
// hunt of 2026-10-28 (its hunt-typed-1, 2 and 4 cases), each failing on
// main: the end landed 1 ulp off the point and a second point was made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument } from "../src/document.ts";
import { addSketch } from "../src/sketch.ts";
import { clickAt, startTool } from "../src/sketch-tool.ts";
import { aimOf } from "../src/typed-entry.ts";

test("a typed-length line onto an existing point joins it, no stray point", () => {
  const s = addSketch(partDocument("box", 40, 30, 20));
  let doc = s.doc;
  let tool: any = startTool("line", s.id);
  // an existing chain end at (1, 4.1): line (1, 0) -> (1, 4.1), then start a new line at (-2, 0.1)
  let o = clickAt(doc, tool, [1, 0]); tool = o.tool;
  o = clickAt(doc, tool, [1, 4.1]); doc = o.doc; tool = startTool("line", s.id);
  o = clickAt(doc, tool, [-2, 0.1]); tool = o.tool;
  const aim = aimOf(doc, tool, [1, 4.1], { length: 5 })!; // pointer snapped on (1, 4.1), typed 5 (it is 5 away)
  o = clickAt(doc, tool, aim); doc = o.doc;
  const pts = doc.sketches.find((x: any) => x.id === s.id)!.points;
  // hand count: (1,0), (1,4.1), (-2,0.1) = 3 points; the new line ends on (1, 4.1)
  assert.equal(pts.length, 3, `points: ${JSON.stringify(pts.map((p: any) => [p.x, p.y]))}`);
});

test("closing onto an existing point with only the angle typed joins it", () => {
  const s = addSketch(partDocument("box", 40, 30, 20));
  let doc = s.doc;
  let tool: any = startTool("line", s.id);
  // an L: (-0.9, 0.5) -> (-0.9, 3) -> (-3, 3) -> (-3, 0.5), then type angle 0 and click on (-0.9, 0.5) to close.
  for (const p of [[-0.9, 0.5], [-0.9, 3], [-3, 3], [-3, 0.5]] as [number, number][]) { const o = clickAt(doc, tool, p); doc = o.doc; tool = o.tool; }
  const aim = aimOf(doc, tool, [-0.9, 0.5], { angle: 0 })!;
  const o = clickAt(doc, tool, aim);
  const pts = o.doc.sketches.find((x: any) => x.id === s.id)!.points;
  // hand count: the four corners, closed: 4 points, and the chain ends (tool.from null).
  assert.equal(pts.length, 4, `points: ${JSON.stringify(pts.map((p: any) => [p.x, p.y]))}`);
});

test("a 25.4 mm (1 inch) square typed from (-2, -1.7) closes exactly", () => {
  const s = addSketch(partDocument("box", 40, 30, 20));
  let doc = s.doc;
  let tool: any = startTool("line", s.id);
  let o = clickAt(doc, tool, [-2, -1.7]); tool = o.tool;
  for (const a of [0, 90, 180, 270]) { const aim = aimOf(doc, tool, null, { length: 25.4, angle: a })!; o = clickAt(doc, tool, aim); doc = o.doc; tool = o.tool; }
  const pts = doc.sketches.find((x: any) => x.id === s.id)!.points;
  // By hand: corners (-2,-1.7), (23.4,-1.7), (23.4,23.7), (-2,23.7), and the fourth side ends back on (-2,-1.7): 4 points.
  assert.equal(pts.length, 4, `points: ${JSON.stringify(pts.map((p: any) => [p.x, p.y]))}`);
  assert.equal(tool.from, null, "closing on the first corner ends the chain");
});

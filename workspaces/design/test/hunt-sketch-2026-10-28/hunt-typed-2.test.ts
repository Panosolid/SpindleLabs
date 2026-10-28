// Hunt: a locked angle with the pointer already on that ray (snapped on an existing point) must end on the pointer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument } from "../../src/document.ts";
import { addSketch } from "../../src/sketch.ts";
import { clickAt, startTool } from "../../src/sketch-tool.ts";
import { aimOf, lineEnd } from "../../src/typed-entry.ts";

test("angle 0 locked, pointer level with the start: the end is the pointer (lineEnd)", () => {
  // start (-3, 0.5), pointer (-0.9, 0.5): the pointer is on the 0° ray already, so the
  // projection start + u·((p − start)·u) is p itself, (-0.9, 0.5).
  assert.deepEqual(lineEnd([-3, 0.5], [-0.9, 0.5], { angle: 0 }), [-0.9, 0.5]);
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

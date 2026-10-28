// Hunt: a square typed side by side (length 25.4, angles 0/90/180/270) must close on its first corner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument } from "../../src/document.ts";
import { addSketch } from "../../src/sketch.ts";
import { clickAt, startTool } from "../../src/sketch-tool.ts";
import { aimOf } from "../../src/typed-entry.ts";

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

// Hunt: a typed length equal to the distance to the point the pointer is on must end on that point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument } from "../../src/document.ts";
import { addSketch } from "../../src/sketch.ts";
import { clickAt, startTool } from "../../src/sketch-tool.ts";
import { aimOf, lineEnd } from "../../src/typed-entry.ts";

test("typed length = distance to the hovered point lands on that point (lineEnd)", () => {
  // start (-2, 0.1), pointer on (1, 4.1): dx = 3, dy = 4.1 - 0.1 = 3.9999999999999996, |d| rounds to exactly 5 (the box shows 5).
  // With L = 5 the end is start + d·5/5 = start + d = the pointer itself, (1, 4.1).
  const e = lineEnd([-2, 0.1], [1, 4.1], { length: 5 });
  assert.deepEqual(e, [1, 4.1]);
});

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

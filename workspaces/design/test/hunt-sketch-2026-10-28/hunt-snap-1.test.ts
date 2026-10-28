// Hunt: an arc or circle drawn exactly on top of one already there is drawn, while the line
// tool refuses the same thing for lines (SAME_LINE, 25a5: "three ends meet ... would break the outline").
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SketchXY } from "@fission/core";
import { partDocument, type DesignDocument } from "../../src/document.ts";
import { addSketch } from "../../src/sketch.ts";
import { clickAt, type ArcTool, type CircleTool, type SketchTool } from "../../src/sketch-tool.ts";

function clicks<T extends SketchTool>(doc: DesignDocument, tool: T, at: SketchXY[]) {
  let drew = 0;
  for (const p of at) { const r = clickAt(doc, tool, p); doc = r.doc; tool = r.tool; if (r.drew) drew++; }
  return { doc, tool, drew };
}

test("a 3-point arc drawn exactly over an existing arc is refused like a line on a line", () => {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const arc: ArcTool = { kind: "arc", sketch: s.id, start: null, end: null };
  // Ends (0,0) and (20,0), through (10,10): centre (10,0), radius 10, a half circle.
  const once = clicks(s.doc, arc, [[0, 0], [20, 0], [10, 10]]);
  assert.equal(once.drew, 1);
  // The same three clicks again: every point (both ends and the centre (10,0)) is shared, so the second arc
  // lies exactly on the first and each end has two arcs on top of each other (the outline's "3 ends meet" once
  // anything else joins). Expected: nothing drawn, as the line tool does.
  const twice = clicks(once.doc, once.tool, [[0, 0], [20, 0], [10, 10]]);
  const arcs = twice.doc.sketches[0].curves.filter((c) => c.kind === "arc");
  assert.equal(arcs.length, 1, `a second identical arc was drawn: ${JSON.stringify(arcs)}`);
});

test("a circle drawn exactly over an existing circle is refused", () => {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const circle: CircleTool = { kind: "circle", sketch: s.id, centre: null };
  // Centre (0,0), through (10,0): radius 10. Twice: same centre point shared, same radius exactly.
  const twice = clicks(s.doc, circle, [[0, 0], [10, 0], [0, 0], [0, 10]]);
  const circles = twice.doc.sketches[0].curves.filter((c) => c.kind === "circle");
  assert.equal(circles.length, 1, `a second identical circle was drawn: ${JSON.stringify(circles)}`);
});

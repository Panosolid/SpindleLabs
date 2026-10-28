// Hunt: a centre arc whose end is clicked (snapped) exactly onto an existing point on its circle does not share
// that point: the end is recomputed as c + (p − c)·(r/d) (centre-arc.ts centreArc) and pointAt (exact) misses it
// by a rounding, so a new point a few 1e-16 mm away is made and the outline is not closed there.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SketchXY } from "@fission/core";
import { partDocument, type DesignDocument } from "../../src/document.ts";
import { addSketch, drawLine } from "../../src/sketch.ts";
import { clickAt, startTool, type SketchTool } from "../../src/sketch-tool.ts";
import { snapPointer, snapTargets } from "../../src/snap.ts";

test("a D shape: centre arc on a line's midpoint, from one end to the other, shares both ends", () => {
  const s = addSketch(partDocument("box", 40, 30, 20));
  // A line from (0.1·3, 0.2) to (4, 3.9): what a user gets clicking on a 0.1 mm grid (0.1·3 = 0.30000000000000004).
  let doc: DesignDocument = drawLine(s.doc, s.id, [0.1 * 3, 0.2], [4, 3.9]).doc;
  let tool: SketchTool = startTool("centre", s.id);
  const sketch = () => doc.sketches.find((x) => x.id === s.id)!;
  // Each click goes through the snapper, as the workspace does: near the midpoint, then near each end.
  const snap = (raw: SketchXY) => snapPointer(raw, raw, snapTargets(sketch(), tool), 0.1).at;
  const mid = snap([2.16, 2.04]);
  assert.deepEqual(mid, [(0.1 * 3 + 4) / 2, (0.2 + 3.9) / 2]); // the midpoint target, exactly
  for (const raw of [[2.16, 2.04], [0.31, 0.21], [3.99, 3.91]] as SketchXY[]) {
    const at = snap(raw);
    const r = clickAt(doc, tool, at);
    doc = r.doc; tool = r.tool;
  }
  // The end click snapped onto (4, 3.9), the line's end, which is on the circle: |p − c| = |s − c| (c the midpoint).
  // Expected: the arc's two ends are the line's two points, so the sketch holds 3 points (2 ends + the centre).
  const sk = sketch();
  const arc = sk.curves.find((c) => c.kind === "arc");
  assert.ok(arc, "the arc was drawn");
  assert.equal(sk.points.length, 3, `points: ${JSON.stringify(sk.points)}`);
});

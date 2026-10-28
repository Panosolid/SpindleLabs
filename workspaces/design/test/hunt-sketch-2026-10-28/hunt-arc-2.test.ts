// Hunt: a centre arc whose end click lands exactly on an existing point of the sketch that lies on its circle
// (here the far end of a line from the start, through the centre: a half disc) should end ON that point, shared,
// so the outline closes. The end is recomputed as c + (p − c)·k with k = r/d = 1 and rounds off the point by
// an ulp, so pointAt misses it, a new point is made beside it, and the line and arc no longer share an end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument } from "../../src/document.ts";
import { addSketch } from "../../src/sketch.ts";
import { clickAt, startTool } from "../../src/sketch-tool.ts";

test("centre arc ending on an existing point on its circle shares that point", () => {
  const { doc, id } = addSketch(partDocument("box", 40, 30, 20));
  let d = doc;
  // Grid clicks as the 0.1 mm grid makes them.
  const s: [number, number] = [-1.9000000000000001, -0.4];
  const c: [number, number] = [-1.7000000000000002, 1.4000000000000001];
  const e: [number, number] = [-1.5, 3.2]; // c + (c − s) on the grid: (−1.5, 3.2); |e − c|² = 0.04 + 3.24 = |s − c|², on the circle
  let tool: any = startTool("line", id);
  for (const at of [s, e]) ({ doc: d, tool } = clickAt(d, tool, at));
  tool = startTool("centre", id);
  for (const at of [c, s, e]) ({ doc: d, tool } = clickAt(d, tool, at));
  const sk = d.sketches.find((x) => x.id === id)!;
  // Hand-worked: the click is on the circle (same radius), so the end is the click itself, the line's end: 3 points (s, e, c), not 4.
  assert.equal(sk.points.length, 3, `points ${JSON.stringify(sk.points)}`);
});

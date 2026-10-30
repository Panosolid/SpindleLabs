// The print preview's travel lines (print-view.ts's travelPieces): which
// nozzle moves are drawn as travel and how many the clock has passed,
// worked by hand on a short file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { playback } from "@fission/core";
import { beadGeometry, travelPieces } from "../src/print-view.ts";

const A = Math.PI * 0.875 * 0.875;
const line = 0.8 / A;
// From the origin: a lift to 0.2 (travel), a 10 mm line, a retraction (goes nowhere), a hop across to (10, 10) (travel),
// a line back to (0, 10). Pieces 0 to 4.
const FILE = ["G90", "M82", "G92 E0", "G1 Z0.2 F600", ";TYPE:Outer wall", `G1 X10 Y0 E${line} F1200`, `G1 E${line - 0.1}`, "G0 X10 Y10", `G1 X0 Y10 E${2 * line}`].join("\n");

test("hand-worked: travel pieces are the moves laying nothing that go somewhere, counted in order", () => {
  const p = playback(FILE);
  assert.equal(p.count, 5);
  assert.deepEqual([...p.plastic], [0, 1, 0, 0, 1]);
  const t = travelPieces(p);
  // The lift and the hop; the retraction stays put, so it is not a line.
  assert.equal(t.count, 2);
  assert.deepEqual([...t.positions], [0, 0, 0, 0, 0, 0.2, 10, 0, 0.2, 10, 10, 0.2].map(Math.fround));
  // Before piece 0 none; the lift (piece 0) is done before piece 1; the hop is piece 3, done before piece 4.
  assert.deepEqual([...t.before], [0, 1, 1, 1, 2, 2]);
});

test("a file with no moves has no travel", () => {
  const t = travelPieces(playback(""));
  assert.equal(t.count, 0);
  assert.deepEqual([...t.before], [0]);
});

test("hand-worked: a strand is exactly as wide and tall as its line, its top at the line's height, and closed", () => {
  // The unit strand is scaled by (length + width, width, height): so it must span x and y from −½ to ½ and z from −1
  // to 0, no less (a strand drawn 4 % thin would undo the width check of H2c2) and no more.
  for (const n of [8, 12]) {
    const g = beadGeometry(n);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    const near = (a: number, e: number) => assert.ok(Math.abs(a - e) < 1e-6, `${a} vs ${e} (n ${n})`);
    near(b.min.x, -0.5);
    near(b.max.x, 0.5);
    near(b.min.y, -0.5);
    near(b.max.y, 0.5);
    near(b.min.z, -1);
    near(b.max.z, 0);
    // The top is flat, not a point: two corners at z 0, as wide as half-way round the squircle from the side, so it lies
    // on a layer above without a gap. With 8 points, the top two sit at 67.5° and 112.5°.
    const pos = g.getAttribute("position");
    const top = new Set<string>();
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i)) < 1e-9) top.add(pos.getY(i).toFixed(6));
    assert.equal(top.size, 2);
    // Closed: every edge of every triangle is shared by exactly two triangles (welding equal positions).
    const key = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => v.toFixed(6)).join();
    const edges = new Map<string, number>();
    const idx = g.getIndex()!;
    for (let t = 0; t < idx.count; t += 3)
      for (let e = 0; e < 3; e++) {
        const [a, c] = [key(idx.getX(t + e)), key(idx.getX(t + ((e + 1) % 3)))].sort();
        edges.set(`${a}|${c}`, (edges.get(`${a}|${c}`) ?? 0) + 1);
      }
    for (const [e, k] of edges) assert.equal(k, 2, `edge ${e} used ${k} times (n ${n})`);
    // Every normal is a unit vector pointing out of the strand (away from its centre line at z −½).
    const nor = g.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      near(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i)), 1);
      assert.ok(nor.getX(i) * pos.getX(i) + nor.getY(i) * pos.getY(i) + nor.getZ(i) * (pos.getZ(i) + 0.5) > 0);
    }
  }
});

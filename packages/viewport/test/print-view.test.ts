// The print preview's travel lines (print-view.ts's travelPieces): which
// nozzle moves are drawn as travel and how many the clock has passed,
// worked by hand on a short file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { playback } from "@fission/core";
import { travelPieces } from "../src/print-view.ts";

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

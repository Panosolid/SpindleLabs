// set_part's sizes a shape ignores are optional (AI4): a left-out size keeps
// the current one when Design runs the command, and documentFor, which has
// no current part, refuses only a size the shape needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "@fission/core";
import { DESIGN_COMMANDS, documentFor, drawRefused } from "../src/index.ts";

const params = (c: unknown) => {
  const parsed = parseCommand(c, DESIGN_COMMANDS);
  assert.ok(parsed.ok, JSON.stringify(c));
  return documentFor(parsed.command).timeline.features[0].intent.parameters;
};

test("a sphere needs only its width, a cylinder its width and height", () => {
  // A sphere of width 30 is diameter 30; nothing else is read.
  assert.deepEqual(params({ op: "set_part", shape: "sphere", width: 30 }), { diameter: 30 });
  // A cylinder 25 across and 60 tall: diameter 25, height 60; no depth needed.
  assert.deepEqual(params({ op: "set_part", shape: "cylinder", width: 25, height: 60 }), { diameter: 25, height: 60 });
  // A box still takes all three.
  assert.deepEqual(params({ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }), { width: 40, depth: 30, height: 20 });
});

test("a size the shape needs, left out, is a clear error", () => {
  const doc = (c: object) => () => documentFor({ op: "set_part", ...c });
  assert.throws(doc({ shape: "cylinder", width: 25 }), /a cylinder needs its height/);
  assert.throws(doc({ shape: "box", width: 40, height: 20 }), /a box needs its depth/);
  assert.throws(doc({ shape: "star", width: 40, depth: 30 }), /a star needs its height/);
});

test("a size given as 0 is still refused, optional or not", () => {
  const parsed = parseCommand({ op: "set_part", shape: "sphere", width: 30, depth: 0 }, DESIGN_COMMANDS);
  assert.deepEqual(parsed, { ok: false, error: "set_part: depth must be a length in mm greater than 0, got 0" });
  assert.equal(parseCommand({ op: "set_part", shape: "sphere" }, DESIGN_COMMANDS).ok, false, "width is still required");
});

test("hand-worked: create_sketch (AI7a) puts an empty sketch at the marker on the plane named, and refuses anything else", () => {
  // A new project: Sketch 1 on XZ, the only item, with no points or curves.
  const fresh = documentFor({ op: "create_sketch", on: "XZ" });
  assert.deepEqual(fresh.timeline.features.map((f) => [f.id, f.intent.summary, f.provenance.self.label]), [["sketch-1", "Sketch 1 on the XZ plane", "Sketch 1"]]);
  assert.deepEqual(fresh.sketches, [{ id: "sketch-1", points: [], curves: [], constraints: [] }]);
  // After a box (feature-1): the box keeps its place and the sketch comes second.
  const after = documentFor({ op: "create_sketch", on: "YZ" }, documentFor({ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }));
  assert.deepEqual(after.timeline.features.map((f) => f.intent.summary), ["Box: 40 × 30 × 20 mm", "Sketch 1 on the YZ plane"]);
  // Every origin plane passes the command's check; a face name or a made-up plane does not, and documentFor refuses a face too (only Design's run places one).
  for (const on of ["XY", "XZ", "YZ"]) assert.ok(parseCommand({ op: "create_sketch", on }, DESIGN_COMMANDS).ok, on);
  assert.equal(parseCommand({ op: "create_sketch", on: "top" }, DESIGN_COMMANDS).ok, false);
  assert.equal(parseCommand({ op: "create_sketch" }, DESIGN_COMMANDS).ok, false);
  assert.throws(() => documentFor({ op: "create_sketch", on: "face:feature-1/end" }), /only Design can start one/);
});

test("hand-worked: the draw commands (AI7b) draw in the sketch just started, as the tools do, and refuse what they can't", () => {
  const sketched = documentFor({ op: "create_sketch", on: "XY" });
  // A circle ⌀20 round (5, -3): a centre point and a circle of radius 20 / 2 = 10.
  const circle = documentFor({ op: "draw_circle", diameter: 20, x: 5, y: -3 }, sketched).sketches[0];
  assert.deepEqual(circle.points.map((p) => [p.x, p.y]), [[5, -3]]);
  assert.deepEqual(circle.curves.map((c) => (c.kind === "circle" ? c.radius : c.kind)), [10]);
  // A 30 × 20 rectangle left at the origin: corners (−15, −10) and (15, 10), four lines, four shared points.
  const rect = documentFor({ op: "draw_rectangle", width: 30, height: 20 }, sketched).sketches[0];
  assert.deepEqual(rect.points.map((p) => [p.x, p.y]), [[-15, -10], [15, -10], [15, 10], [-15, 10]]);
  assert.equal(rect.curves.filter((c) => c.kind === "line").length, 4);
  // Two lines end to end share the point between them, as a click on it would: three points, not four.
  const one = documentFor({ op: "draw_line", x1: 0, y1: 0, x2: 10, y2: 0 }, sketched);
  const two = documentFor({ op: "draw_line", x1: 10, y1: 0, x2: 10, y2: 5 }, one).sketches[0];
  assert.deepEqual(two.points.map((p) => [p.x, p.y]), [[0, 0], [10, 0], [10, 5]]);
  // Refused: nothing to draw in, a sketch an extrude is built from, a line with no length, a size of 0.
  assert.throws(() => documentFor({ op: "draw_circle", diameter: 20 }), /no sketch to draw in/);
  assert.throws(() => documentFor({ op: "draw_circle", diameter: 20 }, documentFor({ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 })), /no sketch just started/);
  assert.throws(() => documentFor({ op: "draw_line", x1: 1, y1: 2, x2: 1, y2: 2 }, sketched), /two different ends/);
  assert.equal(parseCommand({ op: "draw_circle", diameter: 0 }, DESIGN_COMMANDS).ok, false);
  assert.equal(parseCommand({ op: "draw_rectangle", width: 10 }, DESIGN_COMMANDS).ok, false, "a rectangle needs its height");
  // The reach: 1e6 mm either way passes, past it does not.
  assert.ok(parseCommand({ op: "draw_line", x1: -1e6, y1: 0, x2: 1e6, y2: 0 }, DESIGN_COMMANDS).ok);
  assert.equal(parseCommand({ op: "draw_line", x1: -1.1e6, y1: 0, x2: 0, y2: 0 }, DESIGN_COMMANDS).ok, false);
});

test("a sketch an extrude is built from is closed to the draw commands, naming the extrude", async () => {
  const { extrudeSketch } = await import("../src/extrude.ts");
  const rect = documentFor({ op: "draw_rectangle", width: 30, height: 20 }, documentFor({ op: "create_sketch", on: "XY" }));
  const used = extrudeSketch(rect, "sketch-1", 10).doc;
  assert.equal(drawRefused(used, "sketch-1"), "Extrude 1 is built from this sketch, so the AI can't draw in it yet: draw there yourself, or start a new sketch.");
  assert.equal(drawRefused(rect, "sketch-1"), null);
  // The extrude comes after the sketch, so the sketch is no longer just before the marker: refused as nothing just started.
  assert.throws(() => documentFor({ op: "draw_circle", diameter: 5 }, used), /no sketch just started/);
});

// set_part's sizes a shape ignores are optional (AI4): a left-out size keeps
// the current one when Design runs the command, and documentFor, which has
// no current part, refuses only a size the shape needs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "@fission/core";
import { commandDistance, DESIGN_COMMANDS, documentFor, drawRefused, extrudable, EXTRUDE_OP, extrudeTarget, extrudeWords, RENAME_OP, renameTarget, renameWords, SKETCH_REACH } from "../src/index.ts";
import { addSketch } from "../src/sketch.ts";
import { moveMarker, NAME_LIMIT, suppressItem } from "../src/timeline-edits.ts";

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

test("a drawn circle's diameter and a rectangle's sides take only the sizes a typed entry takes: 0.001 mm to 1e6 mm (0.9× and 1.1× of each)", () => {
  // Sweep 2026-10-28, item 8: they were only checked to be more than 0, so 1e300 reached the view (a NaN error there) and
  // 1e-12 was drawn, sizes the circle and rectangle tools' typed boxes refuse (readLength: MIN_TYPED to MAX_TYPED).
  const sketched = documentFor({ op: "create_sketch", on: "XY" });
  const circle = (diameter: number) => () => documentFor({ op: "draw_circle", diameter }, sketched);
  const rectangle = (width: number, height: number) => () => documentFor({ op: "draw_rectangle", width, height }, sketched);
  // 0.9 × 0.001 = 0.0009 is under the smallest, 1.1 × 0.001 = 0.0011 over it; 0.9 × 1e6 = 900,000 is under the largest, 1.1 × 1e6 = 1,100,000 over it.
  const small = /at least 0\.001 mm/;
  const big = /at most 1000000 mm/;
  assert.throws(circle(0.0009), small);
  assert.throws(circle(1.1e6), big);
  assert.throws(circle(1e300), big);
  assert.throws(circle(1e-12), small);
  // A diameter of 0.0011 is a radius of 0.00055 mm: the circle is drawn with that radius.
  assert.equal(documentFor({ op: "draw_circle", diameter: 0.0011 }, sketched).sketches[0].curves[0].kind, "circle");
  assert.equal(circle(9e5)().sketches[0].curves.length, 1);
  // Each side on its own: a rectangle is 4 lines when both are in range.
  assert.throws(rectangle(0.0009, 10), small);
  assert.throws(rectangle(10, 0.0009), small);
  assert.throws(rectangle(1.1e6, 10), big);
  assert.throws(rectangle(10, 1e300), big);
  assert.equal(rectangle(0.0011, 9e5)().sketches[0].curves.length, 4);
  // The words say which size and what was asked, so the refusal is plain.
  assert.throws(circle(1e300), /^Error: A circle ⌀1e\+300 mm can't be drawn: a length can be at most 1000000 mm/);
  assert.throws(rectangle(10, 1e300), /^Error: A rectangle's height of 1e\+300 mm can't be drawn: a length can be at most 1000000 mm/);
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

const rectangleSketch = () => documentFor({ op: "draw_rectangle", width: 30, height: 20 }, documentFor({ op: "create_sketch", on: "XY" }));

test("hand-worked: extrude_sketch (AI7c) puts an extrude of the newest sketch at the marker, the other way when negative", () => {
  const doc = documentFor({ op: EXTRUDE_OP, distance: 10 }, rectangleSketch());
  // Sketch 1 is item 1 (id 1) and its 4 points and 4 lines take ids 2 to 9, so the extrude is feature-10, item 2: it depends on the sketch and names it, as the Extrude tool's OK records it.
  const [sketch, extrude] = doc.timeline.features;
  assert.deepEqual([sketch.id, extrude.id, extrude.intent.summary, extrude.provenance.self.label], ["sketch-1", "feature-10", "Extrude Sketch 1 by 10 mm", "Extrude 1"]);
  assert.deepEqual(extrude.intent.parameters, { sketch: "sketch-1", distance: 10 });
  assert.deepEqual(extrude.dependsOn, ["sketch-1"]);
  // −10 is 10 mm the other way: the distance stays positive and the extrude is flipped (Fusion's Flip).
  const back = documentFor({ op: EXTRUDE_OP, distance: -10 }, rectangleSketch()).timeline.features[1];
  assert.deepEqual([back.intent.parameters, back.intent.summary], [{ sketch: "sketch-1", distance: 10, flip: true }, "Extrude Sketch 1 by 10 mm, flipped"]);
  // The sketch itself is left as drawn: four lines.
  assert.equal(doc.sketches[0].curves.length, 4);
});

test("which sketch an extrude means: the one named, else the open one, else the newest before the marker", () => {
  // Sketch 1 (sketch-1, its rectangle taking ids 2 to 9) and Sketch 2 (sketch-10), both before the marker.
  const two = addSketch(rectangleSketch(), "XZ").doc;
  const id = (command: object, open: string | null = null) => extrudeTarget(two, { op: EXTRUDE_OP, distance: 5, ...command }, open);
  assert.equal(id({}), "sketch-10", "the newest");
  assert.equal(id({ sketch: "Sketch 1" }), "sketch-1", "named");
  assert.equal(id({}, "sketch-1"), "sketch-1", "the open one beats the newest");
  assert.equal(id({ sketch: "Sketch 2" }, "sketch-1"), "sketch-10", "a name beats the open one");
  assert.throws(() => id({ sketch: "Sketch 3" }), /no sketch "Sketch 3" before the marker/);
  // Suppressed, or after the marker: not usable. Suppressing Sketch 2 leaves Sketch 1.
  assert.deepEqual(extrudable(suppressItem(two, "sketch-10", true)).map((f) => f.id), ["sketch-1"]);
  assert.equal(extrudeTarget(suppressItem(two, "sketch-10", true), { op: EXTRUDE_OP, distance: 5 }), "sketch-1");
  // A box, then a sketch, with the marker back on the box: the sketch is after the marker, so an extrude put in there can't use it.
  const behind = moveMarker(addSketch(documentFor({ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 })).doc, "feature-1");
  assert.deepEqual(extrudable(behind), []);
  assert.throws(() => extrudeTarget(behind, { op: EXTRUDE_OP, distance: 5 }), /each comes after the rollback marker or is suppressed/);
  assert.throws(() => documentFor({ op: EXTRUDE_OP, distance: 5 }), /no sketch to extrude/);
  assert.throws(() => extrudeTarget(documentFor({ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }), { op: EXTRUDE_OP, distance: 5 }), /There is no sketch to extrude yet/);
});

test("the extrude distance: 0 and non-numbers are refused, 1e6 mm is the reach (0.9× and 1.1×)", () => {
  assert.throws(() => commandDistance({ op: EXTRUDE_OP, distance: 0 }), /Type a distance other than 0 mm/);
  assert.throws(() => documentFor({ op: EXTRUDE_OP, distance: 0 }, rectangleSketch()), /other than 0 mm/);
  assert.throws(() => commandDistance({ op: EXTRUDE_OP, distance: Number.NaN }), /needs its distance in mm/);
  assert.equal(commandDistance({ op: EXTRUDE_OP, distance: -7 }), -7);
  const ok = (distance: number) => parseCommand({ op: EXTRUDE_OP, distance }, DESIGN_COMMANDS).ok;
  assert.deepEqual([ok(0.9 * SKETCH_REACH), ok(-0.9 * SKETCH_REACH), ok(1.1 * SKETCH_REACH), ok(-1.1 * SKETCH_REACH)], [true, true, false, false]);
  assert.equal(parseCommand({ op: EXTRUDE_OP }, DESIGN_COMMANDS).ok, false, "the distance is required");
});

test("an extrude in words, for the preview and its undo step", () => {
  assert.equal(extrudeWords({ op: EXTRUDE_OP, distance: 15 }), "extrude the sketch by 15 mm");
  assert.equal(extrudeWords({ op: EXTRUDE_OP, distance: -8, sketch: "Sketch 2" }), "extrude Sketch 2 by 8 mm the other way");
});

// ---- rename_item (AI7d).

const extruded = () => documentFor({ op: EXTRUDE_OP, distance: 10 }, rectangleSketch());

test("hand-worked: rename_item changes a name and the copies of it in the items built from it, and nothing else (AI7d)", () => {
  // Sketch 1 (sketch-1) and the extrude built from it (feature-10, "Extrude 1", its `from` naming Sketch 1).
  const before = extruded();
  const after = documentFor({ op: RENAME_OP, item: "Sketch 1", name: "base" }, before);
  const [sketch, extrude] = after.timeline.features;
  assert.deepEqual([sketch.provenance.self.label, extrude.provenance.self.label, extrude.provenance.from.map((p) => p.label)], ["base", "Extrude 1", ["base"]]);
  // Nothing else moves: the same ids and order, the same drawing, the same extrude parameters and description.
  assert.deepEqual(after.timeline.features.map((f) => f.id), ["sketch-1", "feature-10"]);
  assert.deepEqual(after.sketches, before.sketches);
  assert.deepEqual([extrude.intent.parameters, extrude.intent.summary], [before.timeline.features[1].intent.parameters, before.timeline.features[1].intent.summary]);
  // Parsed first, as the assistant gets it: the same result.
  const parsed = parseCommand({ op: RENAME_OP, item: "Sketch 1", name: "base" }, DESIGN_COMMANDS);
  assert.ok(parsed.ok);
  assert.deepEqual(documentFor(parsed.command, before), after);
});

test("which item a rename means: the one named, else the one just before the marker (the one the answer just made)", () => {
  const doc = extruded();
  const target = (command: object, d = doc) => renameTarget(d, { op: RENAME_OP, name: "x", ...command });
  assert.equal(target({ item: "Sketch 1" }), "sketch-1", "named");
  assert.equal(target({}), "feature-10", "the newest item before the marker: Extrude 1");
  assert.equal(target({}, rectangleSketch()), "sketch-1", "…which is the sketch when nothing is built from it yet");
  // The marker back on the sketch: the item just before it is the sketch, though the extrude still exists after it.
  assert.equal(target({}, moveMarker(doc, "sketch-1")), "sketch-1");
  assert.throws(() => target({ item: "Sketch 2" }), /no item "Sketch 2" in the timeline/);
  assert.throws(() => target({}, { ...doc, timeline: { ...doc.timeline, features: [] } }), /timeline is empty/);
  assert.throws(() => documentFor({ op: RENAME_OP, name: "x" }), /no item to rename/);
});

test("a name is refused the way the timeline's own Rename refuses it: empty, over the limit, a control character, another item's (ignoring case)", () => {
  const doc = extruded();
  const named = (name: string) => () => documentFor({ op: RENAME_OP, item: "Sketch 1", name }, doc);
  assert.throws(named("   "), /can't be empty/);
  assert.throws(named("two\nlines"), /line break/);
  // "Extrude 1" is another item's name, in any case.
  assert.throws(named("extrude 1"), /already the name of another item/);
  // Its own name again, even in other capitals, is allowed: the same name changes nothing, "SKETCH 1" is a rename.
  assert.equal(documentFor({ op: RENAME_OP, item: "Sketch 1", name: "Sketch 1" }, doc), doc);
  assert.equal(named("SKETCH 1")().timeline.features[0].provenance.self.label, "SKETCH 1");
  // The limit is 40: 36 (0.9×) and 40 are taken, 44 (1.1×) is refused, by the schema the model's answer meets and by the rename itself.
  const ok = (n: number) => parseCommand({ op: RENAME_OP, name: "a".repeat(n) }, DESIGN_COMMANDS).ok;
  assert.equal(NAME_LIMIT, 40);
  assert.deepEqual([ok(Math.round(0.9 * NAME_LIMIT)), ok(NAME_LIMIT), ok(Math.round(1.1 * NAME_LIMIT)), ok(0)], [true, true, false, true]);
  assert.throws(named("a".repeat(44)), /at most 40 characters: this one has 44/);
  assert.equal(named("a".repeat(40))().timeline.features[0].provenance.self.label.length, 40);
  assert.equal(parseCommand({ op: RENAME_OP }, DESIGN_COMMANDS).ok, false, "the name is required");
});

test("a rename in words, for the preview and its undo step", () => {
  assert.equal(renameWords({ op: RENAME_OP, name: "base" }), "rename the newest item to base");
  assert.equal(renameWords({ op: RENAME_OP, item: "Sketch 2", name: "lid" }), "rename Sketch 2 to lid");
});

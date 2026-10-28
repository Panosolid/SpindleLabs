// Step 25c3: what the AI assistant is told about a real timeline
// (`designAIView`): the part as the set_part that makes it, each item and
// its state in build order, the marker, the sizes a set_part keeps, and
// whether Accept changes the part or adds a body (and where). The
// assistant's preview and prompt are checked in apps/fission/e2e/assistant.mjs;
// seeded timelines against withPart in packages/testing/test/ai-view.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_FACES, AI_TIMELINE_ITEMS, aiCommands, designAIView, facingWords, SKETCH_AXES, type AIFace } from "../src/ai-view.ts";
import { addSketch, drawLine, drawRectangle, planeOf } from "../src/sketch.ts";
import { inSketch } from "../src/face-edges.ts";
import { documentFor } from "../src/commands.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { moveMarker, suppressItem } from "../src/timeline-edits.ts";

/**
 * The seven-item timeline of timeline-verbs.test.ts, by Design's own edits:
 *   1 feature-1   Box 40 × 30 × 20                Body 1
 *   2 sketch-2    Sketch 1: a 40 × 30 rectangle
 *   3 feature-11  Extrude 1: Sketch 1 by 10       Body 2
 *   4 feature-12  Cylinder ⌀20 × 5, suppressed
 *   5 sketch-13   Sketch 2: one line
 *   6 feature-17  Slot 60 × 20 by 5               Body 3, the marker on it
 *   7 feature-19  Sphere ⌀10, after the marker
 */
function timeline(): DesignDocument {
  let d = partDocument("box", 40, 30, 20);
  const s1 = addSketch(d);
  d = extrudeSketch(drawRectangle(s1.doc, s1.id, [0, 0], [40, 30]).doc, s1.id, 10).doc;
  const cylinder = insertPreset(d, "cylinder", 20, 20, 5);
  d = suppressItem(cylinder.doc, cylinder.id, true);
  const s2 = addSketch(d);
  d = drawLine(s2.doc, s2.id, [0, 0], [10, 0]).doc;
  const slot = insertPreset(d, "slot", 60, 20, 5);
  const sphere = insertPreset(slot.doc, "sphere", 10, 10, 10);
  return moveMarker(sphere.doc, slot.id);
}
const doc = timeline();
const NONE: ReadonlySet<string> = new Set();
const sizes = { width: 60, depth: 20, height: 5 };
const BOX = "1. Box: 40 × 30 × 20 mm.";
const NO_OPEN = "No sketch is open: to draw, start one with create_sketch first in the same answer; the draw commands then draw in it.";
const DRAWS = ["draw_circle", "draw_rectangle", "draw_line", "extrude_sketch", "rename_item"];
// AI7c: the first of the two extrude lines, said once; the second names the sketch a bare extrude takes.
const EXTRUDE_NOTE = "extrude_sketch makes a new body at the timeline marker from a sketch that makes one closed outline, and changes nothing else; a negative distance goes the other way from the sketch's plane.";
// AI7d: the one line about renaming, last in every view.
const RENAME_NOTE = "rename_item changes only an item's name, which is how the user and the messages refer to it: at most 40 characters, on one line, and no two items share a name (capitals don't count). To name an item this answer has just made, leave `item` out; `item` names an item already in the timeline.";
const NONE_YET = "No sketch can be extruded yet, so extrude_sketch only follows a create_sketch and its drawing in the same answer.";
const SKETCH1 = "2. Sketch 1 on the XY plane.";
const EXTRUDE1 = "3. Extrude Sketch 1 by 10 mm.";
const CYLINDER = "4. Cylinder: ⌀20 × 5 mm.";
const SKETCH2 = "5. Sketch 2 on the XY plane.";
const SLOT = "6. Extrude: Slot with round ends profile 60 × 20 mm, by 5 mm.";
const SPHERE = "7. Sphere: ⌀10 mm.";

test("hand-worked: the marker on a preset, so set_part changes it in place, and every item's state", () => {
  const v = designAIView(doc, NONE, sizes);
  // The part is the last solid that builds: the slot (item 6). The sphere is after the marker, the cylinder suppressed.
  assert.deepEqual(v.setup, [{ op: "set_part", shape: "slot", width: 60, depth: 20, height: 5 }]);
  assert.equal(v.adds, null);
  assert.deepEqual(v.keeps, sizes);
  assert.deepEqual(v.notes, [
    "The design's timeline, in build order:",
    // Bodies count in build order among the solids that build: the box 1, Extrude 1 2, the slot 3.
    `${BOX} Builds Body 1.`,
    `${SKETCH1} A sketch: builds no body.`,
    `${EXTRUDE1} Builds Body 2.`,
    `${CYLINDER} Suppressed: builds nothing.`,
    `${SKETCH2} A sketch: builds no body.`,
    `${SLOT} Builds Body 3. This is the part set_part changes.`,
    `${SPHERE} After the timeline marker: not built.`,
    "The timeline marker is after item 6: items after it are not built.",
    "set_part changes the part in place, unless extrude_sketch comes before it in the same answer: the extruded body is then the part, so set_part adds a new body after it.",
    "A size set_part leaves out keeps the value it has now: width 60, depth 20, height 5.",
    // AI7a: two sketches are there, so the next is Sketch 3, put in at the marker: insertAt = 6, so item 7 after item 6.
    `create_sketch adds an empty Sketch 3 as item 7, after ${SLOT.slice(0, -1)}, and opens it; nothing already in the timeline changes.`,
    "No body is on screen, so a sketch can go only on the XY, XZ or YZ plane.",
    // AI7b: no sketch open (no `open` given), so drawing needs a sketch started first.
    NO_OPEN,
    SKETCH_AXES,
    // AI7c: Sketch 1 (item 2) and Sketch 2 (item 5) are both before the marker, so a bare extrude takes the newest, Sketch 2.
    EXTRUDE_NOTE,
    "With no sketch named, extrude_sketch takes the sketch started earlier in the answer, else the newest sketch: Sketch 2.",
    RENAME_NOTE,
  ]);
});

test("hand-worked: the marker on an extruded sketch, so set_part adds a body just after it; a failed body is said to fail", () => {
  // Marker on Extrude 1 (item 3): the part is Extrude 1, which no set_part makes. withPart puts a new preset at
  // insertAt = the marker's index + 1 = 3, so it is item 4, after item 3. The kernel failed Extrude 1 here.
  const v = designAIView(moveMarker(doc, "feature-11"), new Set(["feature-11"]), { width: 40, depth: 30, height: 10 });
  assert.deepEqual(v.setup, []);
  assert.equal(v.adds, "a new body as item 4, after 3. Extrude Sketch 1 by 10 mm");
  assert.deepEqual(v.notes.slice(1, 8), [
    `${BOX} Builds Body 1.`,
    `${SKETCH1} A sketch: builds no body.`,
    `${EXTRUDE1} Failed: builds no body.`,
    // Suppressed is said before rolled back: unsuppressing it would still leave it after the marker, but suppress is the item's own state.
    `${CYLINDER} Suppressed: builds nothing.`,
    `${SKETCH2} After the timeline marker: not built.`,
    `${SLOT} After the timeline marker: not built.`,
    `${SPHERE} After the timeline marker: not built.`,
  ]);
  assert.equal(v.notes[8], "The timeline marker is after item 3: items after it are not built.");
  assert.equal(
    v.notes[9],
    "The part (the last body) is 3. Extrude Sketch 1 by 10 mm, an extruded sketch, which no command you can use changes, so set_part adds a new body as item 4, after 3. Extrude Sketch 1 by 10 mm; nothing already in the timeline changes.",
  );
  assert.equal(v.notes[10], "A size set_part leaves out keeps the value it has now: width 40, depth 30, height 10.");
});

test("hand-worked: the marker at the start, so nothing builds and set_part adds item 1", () => {
  const v = designAIView(moveMarker(doc, "start"), NONE, sizes);
  assert.deepEqual(v.setup, []);
  // insertAt is 0 with the marker at the start: the new body is item 1, before everything.
  assert.equal(v.adds, "a new body as item 1, at the start of the timeline");
  assert.ok(v.notes.slice(1, 8).every((l, i) => l.startsWith(`${i + 1}. `)));
  assert.equal(v.notes[1], `${BOX} After the timeline marker: not built.`);
  assert.equal(v.notes[8], "The timeline marker is at the start: nothing is built.");
  assert.equal(v.notes[9], "Nothing builds a body, so set_part adds a new body as item 1, at the start of the timeline; nothing already in the timeline changes.");
});

test("hand-worked: the marker at the end with the last solid an extruded sketch adds a body as the last item", () => {
  // Box then Sketch 1 extruded: two items plus the sketch, no marker. insertAt is the length, 3, so item 4 after item 3.
  const s = addSketch(partDocument("box", 40, 30, 20));
  const d = extrudeSketch(drawRectangle(s.doc, s.id, [0, 0], [40, 30]).doc, s.id, 10).doc;
  const v = designAIView(d, NONE, sizes);
  assert.equal(v.adds, "a new body as item 4, after 3. Extrude Sketch 1 by 10 mm");
  assert.equal(v.notes.at(-10), "The timeline marker is at the end: every item is built.");
});

test("hand-worked: a suppressed sketch greys its extrude from the data (26e), and a lost sketch's extrude builds from its kept shape", () => {
  // Sketch 1 suppressed: Extrude 1 is greyed (Q3; until 26e it failed), with no kernel failure, so the note says why.
  const suppressed = designAIView(suppressItem(doc, "sketch-2", true), NONE, sizes);
  assert.equal(suppressed.notes[2], `${SKETCH1} Suppressed: builds nothing.`);
  assert.equal(suppressed.notes[3], `${EXTRUDE1} Greyed: builds nothing while Sketch 1, which it is built on, is suppressed.`);
  // Bodies keep counting only what builds: the slot is Body 2 now.
  assert.equal(suppressed.notes[6], `${SLOT} Builds Body 2. This is the part set_part changes.`);
  // Sketch 1 deleted with its shape kept (24d2): Extrude 1 still builds, from the kept shape. Items renumber.
  const sketch = doc.sketches.find((x) => x.id === "sketch-2")!;
  const lost: DesignDocument = {
    ...doc,
    sketches: doc.sketches.filter((x) => x !== sketch),
    timeline: { ...doc.timeline, features: doc.timeline.features.filter((f) => f.id !== "sketch-2") },
    kept: { "feature-11": { points: sketch.points, curves: sketch.curves } },
  };
  assert.equal(designAIView(lost, NONE, sizes).notes[2], "2. Extrude Sketch 1 by 10 mm. Builds Body 2. Its sketch is lost (deleted, or no longer a closed outline), so it builds from the shape it kept.");
});

test("a long timeline lists only its last items, and says how many were left out", () => {
  let d = partDocument("box", 40, 30, 20);
  for (let i = 0; i < AI_TIMELINE_ITEMS + 4; i++) d = insertPreset(d, "box", 10 + i, 10, 10).doc;
  // 1 + 44 = 45 items; the first 5 are left out, so the list starts at item 6.
  const notes = designAIView(d, NONE, sizes).notes;
  assert.equal(notes[1], "(5 earlier items left out)");
  assert.match(notes[2], /^6\. Box: 14 × 10 × 10 mm\. Builds Body 6\.$/);
  assert.equal(notes.length, 1 + 1 + AI_TIMELINE_ITEMS + 3 + 2 + 2 + 2 + 1);
  // The boundary: exactly AI_TIMELINE_ITEMS items is no cut; one more leaves the first out.
  let e = partDocument("box", 40, 30, 20);
  for (let i = 0; i < AI_TIMELINE_ITEMS - 1; i++) e = insertPreset(e, "box", 10, 10, 10).doc;
  assert.equal(designAIView(e, NONE, sizes).notes[1], `${BOX} Builds Body 1.`);
  const one = designAIView(insertPreset(e, "box", 10, 10, 10).doc, NONE, sizes).notes;
  assert.equal(one[1], "(1 earlier item left out)");
  assert.match(one[2], /^2\. Box: 10 × 10 × 10 mm\. Builds Body 2\.$/);
});

test("no design: no part, nothing added, and a sketch can still start on an origin plane (AI7a)", () => {
  const v = designAIView(undefined, NONE, sizes);
  assert.deepEqual({ ...v, commands: v.commands?.map((c) => c.op) }, {
    setup: [],
    keeps: sizes,
    // A new project: nothing in the timeline, so the first sketch is Sketch 1, item 1.
    notes: ["create_sketch adds an empty Sketch 1 as item 1, at the start of the timeline, and opens it; nothing already in the timeline changes.", "No body is on screen, so a sketch can go only on the XY, XZ or YZ plane.", NO_OPEN, SKETCH_AXES, EXTRUDE_NOTE, NONE_YET, RENAME_NOTE],
    adds: null,
    commands: ["set_part", "create_sketch", ...DRAWS],
    choiceWords: { XY: "the XY plane", XZ: "the XZ plane", YZ: "the YZ plane" },
  });
});

// AI7a: the faces a sketch can go on, as aiFaces gives them from the bodies on screen (checked on real bodies in
// apps/fission/e2e/assistant.mjs). A 40 × 30 × 20 box from the origin: its top's outward normal is +Z and its centre
// (20, 15, 20); its front faces −Y with centre (20, 0, 10).
// AI7b: in a sketch on the top, drawnFrame picks XY's frame lifted to z = 20 (x along X, y along Y), so the centre is
// (20, 15); on the front, XZ's frame (normal −Y, x along X, y = normal × x = +Z), so (20, 10).
const TOP: AIFace = { name: "face:feature-1/end", body: "Body 1 (Box 1)", outward: [0, 0, 1], centre: [20, 15, 20], inSketch: [20, 15] };
const FRONT: AIFace = { name: "face:feature-1/side-1", body: "Body 1 (Box 1)", outward: [0, -1, 0], centre: [20, 0, 10], inSketch: [20, 10] };

test("hand-worked: the faces on screen are offered to create_sketch by name, with the way each faces and its centre", () => {
  const v = designAIView(partDocument("box", 40, 30, 20), NONE, sizes, [TOP, FRONT]);
  const on = v.commands!.find((c) => c.op === "create_sketch")!.params.on;
  assert.ok(on.type === "choice");
  assert.deepEqual(on.values, ["XY", "XZ", "YZ", "face:feature-1/end", "face:feature-1/side-1"]);
  assert.deepEqual(v.notes.slice(-9, -5), [
    // The box is item 1 and no sketch is there yet: Sketch 1, item 2, after it.
    "create_sketch adds an empty Sketch 1 as item 2, after 1. Box: 40 × 30 × 20 mm, and opens it; nothing already in the timeline changes.",
    "The flat faces a sketch can go on, by name (create_sketch's on), with the way each faces and its centre:",
    "- face:feature-1/end: a face of Body 1 (Box 1), facing up (+Z, a top face), centre (20, 15, 20) mm, which is (20, 15) in a sketch on it.",
    "- face:feature-1/side-1: a face of Body 1 (Box 1), facing the front (−Y), centre (20, 0, 10) mm, which is (20, 10) in a sketch on it.",
  ]);
  assert.equal(v.choiceWords!["face:feature-1/end"], "a face of Body 1 (Box 1), facing up (+Z, a top face)");
  // set_part is offered as Design lists it; export_stl never (it downloads a file, so it stays the user's).
  assert.deepEqual(v.commands!.map((c) => c.op), ["set_part", "create_sketch", ...DRAWS]);
});

test("hand-worked: which way a face faces, in words for an axis and as its normal otherwise", () => {
  assert.equal(facingWords([0, 0, -1]), "down (−Z, a bottom face)");
  assert.equal(facingWords([1, 0, 0]), "right (+X)");
  assert.equal(facingWords([-1, 0, 0]), "left (−X)");
  assert.equal(facingWords([0, 1, 0]), "the back (+Y)");
  // A 45° face: 1/√2 = 0.70710678… is 0.707 to 3 decimals, and −0 is written 0.
  assert.equal(facingWords([Math.SQRT1_2, -0, Math.SQRT1_2]), "along (0.707, 0, 0.707)");
  // To 3 decimals, which is all the prompt shows: 0.9996 rounds to 1 and 0.0004 to 0, so it is "up"; 0.9994 is 0.999 and is not.
  assert.equal(facingWords([0.0004, 0, 0.9996]), "up (+Z, a top face)");
  assert.equal(facingWords([0.0346, 0, 0.9994]), "along (0.035, 0, 0.999)");
});

test("the prompt lists at most AI_FACES faces, and only those can be chosen", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i): AIFace => ({ ...TOP, name: `face:feature-1/f${i}` }));
  const at = designAIView(partDocument("box", 40, 30, 20), NONE, sizes, many(AI_FACES));
  assert.ok(!at.notes.some((l) => l.includes("left out") && l.includes("face")), "exactly AI_FACES: no cut");
  const over = designAIView(partDocument("box", 40, 30, 20), NONE, sizes, many(AI_FACES + 2));
  assert.equal(over.notes.at(-6), "(2 more faces left out)");
  const on = over.commands!.find((c) => c.op === "create_sketch")!.params.on;
  assert.ok(on.type === "choice");
  // 3 origin planes and the first 30 faces; the 31st is not a value, so the answer's check refuses it.
  assert.equal(on.values.length, 3 + AI_FACES);
  assert.ok(!on.values.includes(`face:feature-1/f${AI_FACES}`));
  assert.deepEqual(aiCommands([]).find((c) => c.op === "create_sketch")!.params.on, { type: "choice", values: ["XY", "XZ", "YZ"], description: on.description });
});

test("hand-worked: the sketch open is named for the draw commands, and one an extrude is built from is said to be closed to them (AI7b)", () => {
  // Box, then Sketch 1 on XZ (sketch-2) with nothing built from it: open, the draw commands draw in it.
  const s = addSketch(partDocument("box", 40, 30, 20), "XZ");
  const open = designAIView(s.doc, NONE, sizes, [], s.id).notes.slice(-5, -3);
  assert.deepEqual(open, ["Sketch 1 is open (Sketch 1 on the XZ plane): the draw commands draw in it, unless create_sketch starts another first.", SKETCH_AXES]);
  // A rectangle drawn and extruded 10 (Extrude 1): the sketch is closed to the AI, and the prompt says why.
  const used = extrudeSketch(drawRectangle(s.doc, s.id, [0, 0], [40, 30]).doc, s.id, 10).doc;
  assert.equal(designAIView(used, NONE, sizes, [], s.id).notes.at(-5), "Sketch 1 is open (Sketch 1 on the XZ plane), but Extrude 1 is built from it, so the draw commands can't draw in it: start a new sketch with create_sketch first.");
  // An id that names no item (a sketch open in a design since replaced) is as good as none.
  assert.equal(designAIView(s.doc, NONE, sizes, [], "sketch-99").notes.at(-5), NO_OPEN);
});

test("the sketch axes the AI is told are the ones a sketch on each origin plane really has (AI7b)", () => {
  // Hand-worked: the front plane XZ has x along X and y along Z, so the point 2 mm along X and 5 mm up, (2, 0, 5), is (2, 5) in its sketch.
  assert.deepEqual(inSketch([2, 0, 5], planeOf("XZ")), [2, 5]);
  // Each "on P, x is A and y is B" in the words: a step of 1 along A is (1, 0) in that sketch, and along B is (0, 1).
  const unit: Record<string, [number, number, number]> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
  const told = [...SKETCH_AXES.matchAll(/on (XY|XZ|YZ), x is ([XYZ]) and y is ([XYZ])/g)];
  assert.deepEqual(told.map((m) => m[1]), ["XY", "XZ", "YZ"]);
  for (const [, plane, x, y] of told) {
    assert.deepEqual(inSketch(unit[x], planeOf(plane as "XY")), [1, 0], `${plane}: x`);
    assert.deepEqual(inSketch(unit[y], planeOf(plane as "XY")), [0, 1], `${plane}: y`);
  }
});

test("hand-worked: extrude_sketch is offered, naming the sketches it can use only when there are some (AI7c)", () => {
  const ops = (cs: ReturnType<typeof aiCommands>) => cs.map((c) => c.op);
  assert.deepEqual(ops(aiCommands([])), ["set_part", "create_sketch", "draw_circle", "draw_rectangle", "draw_line", "extrude_sketch", "rename_item"]);
  // No sketch to name: no `sketch` parameter (an empty list of choices is no schema).
  assert.deepEqual(Object.keys(aiCommands([]).at(-2)!.params), ["distance"]);
  const extrude = aiCommands([], ["Sketch 1", "Sketch 2"]).at(-2)!.params;
  assert.deepEqual(Object.keys(extrude), ["distance", "sketch"]);
  assert.deepEqual((extrude.sketch as { values: string[]; optional?: boolean }).values, ["Sketch 1", "Sketch 2"]);
  assert.equal(extrude.sketch.optional, true);
  // The view: the timeline() sketches before the marker are Sketch 1 and Sketch 2 (Sketch 2 is the newest); the notes say which one a bare extrude takes.
  const view = designAIView(timeline(), new Set(), { width: 40, depth: 30, height: 20 });
  assert.deepEqual((view.commands!.at(-2)!.params.sketch as { values: string[] }).values, ["Sketch 1", "Sketch 2"]);
  assert.ok(view.notes.some((n) => /takes the sketch started earlier in the answer, else the newest sketch: Sketch 2\./.test(n)), view.notes.join("\n"));
  // With Sketch 1 open (its id is sketch-2 in this timeline), a bare extrude takes it.
  const open = designAIView(timeline(), new Set(), { width: 40, depth: 30, height: 20 }, [], "sketch-2");
  assert.ok(open.notes.some((n) => /else the open sketch: Sketch 1\./.test(n)), open.notes.join("\n"));
  // No design, or no sketch: said, so the model does not name one that is not there.
  assert.ok(designAIView(undefined, new Set(), { width: 40, depth: 30, height: 20 }).notes.some((n) => /No sketch can be extruded yet/.test(n)));
});

test("hand-worked: rename_item is offered, naming the items only when there are some, the timeline's last AI_TIMELINE_ITEMS (AI7d)", () => {
  const rename = (cs: ReturnType<typeof aiCommands>) => cs.find((c) => c.op === "rename_item")!;
  // No item to name: only `name` (an empty list of choices is no schema); the item just made is the default.
  assert.deepEqual(Object.keys(rename(aiCommands([])).params), ["name"]);
  const named = rename(aiCommands([], [], ["Sketch 1", "Box 1"])).params;
  assert.deepEqual(Object.keys(named), ["item", "name"]);
  assert.deepEqual([named.item.type, (named.item as { values: string[] }).values, named.item.optional], ["choice", ["Sketch 1", "Box 1"], true]);
  // The view lists every item's name, in order, as the timeline lines name them (the fixture's items).
  const view = designAIView(timeline(), new Set(), { width: 40, depth: 30, height: 20 });
  const items = (view.commands!.find((c) => c.op === "rename_item")!.params.item as { values: string[] }).values;
  assert.deepEqual(items, timeline().timeline.features.map((f) => f.provenance.self.label));
  // A design with more than AI_TIMELINE_ITEMS items offers the last 40, like the lines it lists.
  let big = documentFor({ op: "create_sketch", on: "XY" });
  for (let i = 1; i < AI_TIMELINE_ITEMS + 3; i++) big = addSketch(big, "XY").doc;
  const long = designAIView(big, new Set(), { width: 40, depth: 30, height: 20 }).commands!.find((c) => c.op === "rename_item")!.params.item as { values: string[] };
  assert.deepEqual([long.values.length, long.values[0], long.values.at(-1)], [AI_TIMELINE_ITEMS, "Sketch 4", `Sketch ${AI_TIMELINE_ITEMS + 3}`]);
  assert.ok(view.notes.includes(RENAME_NOTE));
  assert.ok(designAIView(undefined, new Set(), { width: 40, depth: 30, height: 20 }).notes.includes(RENAME_NOTE));
});

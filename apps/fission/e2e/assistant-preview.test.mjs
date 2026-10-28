// The AI preview (`previewOf`, src/assistant.ts) must say what Accept does
// (app sweep 2026-10-28, item 3): a set_part changes the part in place only
// while the part is a ready-made shape at that point of the answer, so an
// extrude_sketch earlier in the same answer makes it add a new body. Each
// case is worked out by hand from Design's rule (the part is the last body
// that builds; withPart changes it in place when it is a preset, else puts
// a new preset in at the marker), and then checked by doing it: Design's
// own `documentFor` run over the commands, which is what Accept does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { designAIView, documentFor, partDocument } from "@fission/design";
import { previewOf } from "../src/assistant.ts";

const sizes = { width: 40, depth: 30, height: 20 };
const box = () => partDocument("box", 40, 30, 20);
/** The timeline's items after doing `commands`, as "Box 1: box 40 30 20" for each preset (sketches and extrudes by their type). */
function accepted(doc, commands) {
  let d = doc;
  for (const c of commands) d = documentFor(c, d);
  return d.timeline.features.map((f) => {
    const p = f.intent.parameters;
    return f.intent.type === "box" ? `${f.provenance.self.label}: box ${p.width} ${p.depth} ${p.height}` : `${f.provenance.self.label}: ${f.intent.type}`;
  });
}

const EXTRUDE_THEN_SET = [
  { op: "create_sketch", on: "XY" },
  { op: "draw_circle", diameter: 10, x: 100 },
  { op: "extrude_sketch", distance: 5 },
  { op: "set_part", shape: "box", width: 50, depth: 30, height: 20 },
];

test("hand-worked: after an extrude in the same answer, set_part adds a new body, and the preview says so in command order", () => {
  const doc = box();
  const shown = previewOf(designAIView(doc, new Set(), sizes), EXTRUDE_THEN_SET);
  // The extrude puts Extrude 1 in at the end, so it is the part when set_part comes: an extruded sketch, not a preset.
  // withPart then adds Box 2 50 × 30 × 20 and leaves Box 1 at 40 × 30 × 20: every size of the box is new ("—" before).
  assert.deepEqual(shown.rows, [
    { parameter: "sketch", before: undefined, after: "new, on the XY plane" },
    { parameter: "circle", before: undefined, after: "circle ⌀10 mm at (100, 0)" },
    { parameter: "extrude", before: undefined, after: "the sketch by 5 mm" },
    { parameter: "shape", before: undefined, after: "box" },
    { parameter: "width", before: undefined, after: 50 },
    { parameter: "depth", before: undefined, after: 30 },
    { parameter: "height", before: undefined, after: 20 },
  ]);
  assert.equal(shown.label, "new sketch on the XY plane, then circle ⌀10 mm at (100, 0), then extrude the sketch by 5 mm, then new box 50 × 30 × 20 mm");
  // Items were put in before it, so the view's item number would be a guess: the marker is where it goes.
  assert.equal(shown.adds, "a new body at the timeline marker");
  // Doing it: Box 1 is untouched and Box 2 comes after the extrude.
  assert.deepEqual(accepted(doc, EXTRUDE_THEN_SET), ["Box 1: box 40 30 20", "Sketch 1: sketch", "Extrude 1: extrude", "Box 2: box 50 30 20"]);
});

test("hand-worked: a set_part before the extrude changes Box 1 in place, its label first; nothing is added by it", () => {
  const doc = box();
  const commands = [EXTRUDE_THEN_SET[3], ...EXTRUDE_THEN_SET.slice(0, 3)];
  const shown = previewOf(designAIView(doc, new Set(), sizes), commands);
  // Box 1 is the part (a preset) when set_part comes: only the width differs, 40 → 50.
  assert.deepEqual(shown.rows[0], { parameter: "width", before: 40, after: 50 });
  assert.equal(shown.rows.length, 4);
  assert.equal(shown.label, "box 50 × 30 × 20 mm, then new sketch on the XY plane, then circle ⌀10 mm at (100, 0), then extrude the sketch by 5 mm");
  assert.equal(shown.adds, null);
  assert.deepEqual(accepted(doc, commands), ["Box 1: box 50 30 20", "Sketch 1: sketch", "Extrude 1: extrude"]);
});

test("hand-worked: labels follow the command order (a rename before the set_part is named first)", () => {
  const shown = previewOf(designAIView(box(), new Set(), sizes), [
    { op: "rename_item", name: "Base" },
    { op: "set_part", shape: "box", width: 50 },
  ]);
  // The rename changes no body, so Box 1 is still the part: width 40 → 50 in place, depth and height kept (30, 20).
  assert.deepEqual(shown.rows, [
    { parameter: "rename", before: undefined, after: "Base" },
    { parameter: "width", before: 40, after: 50 },
  ]);
  assert.equal(shown.label, "rename the newest item to Base, then box 50 × 30 × 20 mm");
  assert.equal(shown.adds, null);
});

test("hand-worked: after an extrude, a second set_part changes the box the first one added, in place", () => {
  const doc = box();
  const commands = [...EXTRUDE_THEN_SET, { op: "set_part", shape: "box", width: 60, depth: 30, height: 20 }];
  const shown = previewOf(designAIView(doc, new Set(), sizes), commands);
  // The first set_part adds Box 2 50 × 30 × 20, which is then the part (a preset): the second makes it 60 wide.
  assert.deepEqual(shown.rows.at(-1), { parameter: "width", before: 50, after: 60 });
  assert.equal(shown.label.split(", then ").slice(-2).join(" | "), "new box 50 × 30 × 20 mm | box 60 × 30 × 20 mm");
  assert.deepEqual(accepted(doc, commands), ["Box 1: box 40 30 20", "Sketch 1: sketch", "Extrude 1: extrude", "Box 2: box 60 30 20"]);
});

test("hand-worked: a size an extrude's set_part leaves out keeps the panel's, which the extrude set to its distance", () => {
  // Design's aiExtrude puts the distance (5) in the height box, so a box naming only its width and depth is 5 high.
  const shown = previewOf(designAIView(box(), new Set(), sizes), [...EXTRUDE_THEN_SET.slice(0, 3), { op: "set_part", shape: "box", width: 50, depth: 30 }]);
  assert.deepEqual(shown.rows.at(-1), { parameter: "height", before: undefined, after: 5 });
});

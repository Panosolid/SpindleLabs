// U0e1: every timeline item has a short name ("Box 1", "Sketch 2",
// "Extrude 1") that no other item has, ignoring case, and an older
// project's presets, named "Feature n (type)" from the id counter, get
// theirs when it opens. The descriptions (intent summaries) stay as they
// were made: they are the browser rows' tooltips.

import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson, type Feature } from "@fission/core";
import { changePreset, freshName, insertPreset, nameKey, oldPresetName, partDocument, readDesignDocument, takenNames, withShortNames, type DesignDocument } from "../src/document.ts";
import { drawnFrame } from "../src/face-sketch.ts";
import { addFaceSketch, addSketch, drawCircle } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { deleteItem } from "../src/timeline-edits.ts";
import { designWorkspace } from "../src/workspace.ts";

const names = (doc: DesignDocument) => doc.timeline.features.map((f) => f.provenance.self.label);
const named = (doc: DesignDocument, id: string, label: string): DesignDocument => ({
  ...doc,
  timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f.id === id ? { ...f, provenance: { ...f.provenance, self: { ...f.provenance.self, label } } } : f)) },
});

test("hand-worked: presets are named for their shape, numbered among the presets of that shape", () => {
  // A new project's box is Box 1. Then, in order: a cylinder (the first, Cylinder 1), a box (one box
  // there, so 1 + 1 = Box 2), a slot (Slot 1, its profile shape's name), an L-bracket (L-bracket 1),
  // and a sphere (Sphere 1).
  let doc = partDocument("box", 40, 30, 20);
  for (const kind of ["cylinder", "box", "slot", "l-bracket", "sphere"] as const) doc = insertPreset(doc, kind, 10, 10, 10).doc;
  assert.deepEqual(names(doc), ["Box 1", "Cylinder 1", "Box 2", "Slot 1", "L-bracket 1", "Sphere 1"]);
  // Each new project's first preset is its shape's first.
  assert.deepEqual(["plate", "star", "sphere"].map((k) => names(partDocument(k as "plate", 20, 20, 5))), [["Plate 1"], ["Star 1"], ["Sphere 1"]]);
});

test("hand-worked: a number is skipped while an item has its name, ignoring case, as Sketch n and Extrude n are", () => {
  // Box 1 and Box 2, then Box 1 deleted: one box is left, so the next is 1 + 1 = 2, but Box 2 has it, so Box 3.
  let doc = insertPreset(partDocument("box", 40, 30, 20), "box", 5, 5, 5).doc;
  doc = deleteItem(doc, "feature-1");
  assert.deepEqual(names(doc), ["Box 2"]);
  doc = insertPreset(doc, "box", 5, 5, 5).doc;
  assert.deepEqual(names(doc), ["Box 2", "Box 3"]);
  // A cylinder named "box 4" (any item, any case): the next box is 2 + 1 = 3, taken, then 4, taken as "box 4", so Box 5.
  const odd = named(insertPreset(doc, "cylinder", 5, 5, 5).doc, "feature-4", "box 4");
  assert.equal(names(insertPreset(odd, "box", 5, 5, 5).doc).at(-1), "Box 5");
  // A deliberate break: with "Box 4" spelled differently ("Box  4", two spaces) nothing is taken, so Box 4.
  assert.equal(names(insertPreset(named(odd, "feature-4", "Box  4"), "box", 5, 5, 5).doc).at(-1), "Box 4");
});

test("hand-worked: a new sketch or extrude skips a name any item has, not only its own kind's", () => {
  // The box named "Sketch 1": the first sketch (no sketches yet, 0 + 1 = 1) is Sketch 2.
  const s = addSketch(named(partDocument("box", 40, 30, 20), "feature-1", "Sketch 1"));
  assert.deepEqual(names(s.doc), ["Sketch 1", "Sketch 2"]);
  // Its description is made with the same number: "Sketch 2 on the XY plane".
  assert.equal(s.doc.timeline.features[1].intent.summary, "Sketch 2 on the XY plane");
  // The box named "Extrude 1": the first extrude (0 + 1 = 1) is Extrude 2.
  const circle = drawCircle(s.doc, s.id, [0, 0], 5).doc;
  const e = extrudeSketch(named(circle, "feature-1", "extrude 1"), s.id, 10);
  assert.deepEqual(names(e.doc), ["extrude 1", "Sketch 2", "Extrude 2"]);
});

test("freshName and takenNames, by hand: the first free number from count + 1, names folded to lower case", () => {
  assert.equal(freshName("Box", 0, new Set()), "Box 1");
  assert.equal(freshName("Box", 2, new Set()), "Box 3");
  assert.equal(freshName("Box", 0, new Set(["box 1", "box 2"])), "Box 3");
  // Taken names are folded (nameKey), so an unfolded "Box 1" in the set is not seen: the set must hold nameKey's.
  assert.equal(freshName("Box", 0, new Set(["Box 1"])), "Box 1");
  assert.equal(nameKey("L-Bracket 1"), "l-bracket 1");
  const doc = insertPreset(partDocument("box", 40, 30, 20), "cylinder", 5, 5, 5).doc;
  assert.deepEqual([...takenNames(doc)], ["box 1", "cylinder 1"]);
  assert.deepEqual([...takenNames(doc, "feature-1")], ["cylinder 1"]);
});

test("hand-worked: a preset made another shape takes that shape's next name, unless the user named it", () => {
  // Box 1 and Cylinder 1; Box 1 made a cylinder: the cylinders but itself are 1, so 1 + 1 = Cylinder 2.
  const doc = insertPreset(partDocument("box", 40, 30, 20), "cylinder", 5, 5, 5).doc;
  assert.deepEqual(names(changePreset(doc, "feature-1", "cylinder", 10, 10, 10)), ["Cylinder 2", "Cylinder 1"]);
  // Made a box again (its old shape's name is gone), it is the boxes' first: Box 1.
  assert.deepEqual(names(changePreset(changePreset(doc, "feature-1", "cylinder", 10, 10, 10), "feature-1", "box", 10, 10, 10)), ["Box 1", "Cylinder 1"]);
  // New sizes, same shape: the name stays.
  assert.deepEqual(names(changePreset(doc, "feature-1", "box", 50, 30, 20)), ["Box 1", "Cylinder 1"]);
  // A name the user gave stays whatever the shape: "Base", and "Box 12a" (not a shape's name: a number must end it).
  for (const own of ["Base", "Box 12a", "Box 0", "Box 01"]) assert.deepEqual(names(changePreset(named(doc, "feature-1", own), "feature-1", "sphere", 10, 10, 10)), [own, "Cylinder 1"]);
});

test("a preset renamed by its shape change is followed by the copies of its name: a sketch on its face remembers the new one", () => {
  // A sketch on Box 1's top face keeps where it came from: { feature-1, "Box 1" }. Box 1 made a slot: Slot 1, and the copy follows.
  const top = drawnFrame([0, 0, 1], [20, 15, 20]);
  const s = addFaceSketch(partDocument("box", 40, 30, 20), { plane: "face:feature-1/top", feature: "feature-1" }, top);
  assert.deepEqual(s.doc.timeline.features[1].provenance.from, [{ workspace: "design", id: "feature-1", label: "Box 1" }]);
  const slot = changePreset(s.doc, "feature-1", "slot", 40, 30, 20);
  assert.deepEqual(names(slot), ["Slot 1", "Sketch 1"]);
  assert.deepEqual(slot.timeline.features[1].provenance.from, [{ workspace: "design", id: "feature-1", label: "Slot 1" }]);
  // Its description stays as it was made (U0e: descriptions never change with a name).
  assert.equal(slot.timeline.features[1].intent.summary, "Sketch 1 on a face of Box 1");
});

/** A version 3 document as presets were saved before U0e: "Feature n (type)" from the id counter. */
function oldDoc(): DesignDocument {
  const top = drawnFrame([0, 0, 1], [20, 15, 20]);
  let doc = partDocument("box", 40, 30, 20);
  doc = addFaceSketch(doc, { plane: "face:feature-1/top", feature: "feature-1" }, top).doc;
  for (const kind of ["cylinder", "box", "slot", "box"] as const) doc = insertPreset(doc, kind, 10, 10, 10).doc;
  // Named as the old app named them, by id and type; the sketch's copy and description too.
  const old = (f: Feature) => (f.intent.type === "sketch" ? f.provenance.self.label : oldPresetName(f));
  let back = doc;
  for (const f of doc.timeline.features) back = named(back, f.id, old(f));
  const sketch = back.timeline.features[1];
  back.timeline.features[1] = { ...sketch, intent: { ...sketch.intent, summary: "Sketch 1 on a face of Feature 1 (box)" }, provenance: { ...sketch.provenance, from: [{ workspace: "design", id: "feature-1", label: "Feature 1 (box)" }] } };
  return back;
}

test("hand-worked: an older project's presets get short names in timeline order, and every copy of the old names follows", () => {
  const doc = oldDoc();
  // Ids feature-1, sketch-2, feature-3, feature-4, feature-5 (profile-6), feature-7: worked from the counter.
  assert.deepEqual(names(doc), ["Feature 1 (box)", "Sketch 1", "Feature 3 (cylinder)", "Feature 4 (box)", "Feature 5 (extrude)", "Feature 7 (box)"]);
  const now = withShortNames(doc);
  // Boxes 1, 2, 3 in order; the cylinder and the slot their shapes' first; the sketch keeps its name.
  assert.deepEqual(names(now), ["Box 1", "Sketch 1", "Cylinder 1", "Box 2", "Slot 1", "Box 3"]);
  assert.deepEqual(now.timeline.features[1].provenance.from, [{ workspace: "design", id: "feature-1", label: "Box 1" }]);
  assert.equal(now.timeline.features[1].intent.summary, "Sketch 1 on a face of Box 1");
  // Nothing but the names and their copies changed.
  const strip = (d: DesignDocument) => JSON.stringify(d, (k, v) => (k === "label" || k === "summary" ? undefined : v));
  assert.equal(strip(now), strip(doc));
  // Opened again it is the same document (nothing left to rename), and a new design is left alone too.
  assert.equal(withShortNames(now), now);
  const fresh = partDocument("box", 40, 30, 20);
  assert.equal(withShortNames(fresh), fresh);
});

test("only a name of exactly the old form is renamed; any other stays, and its number is still counted", () => {
  // Each a deliberate break of the old form: a space after, its id's number wrong, its type wrong, a name the user could have typed.
  const doc = oldDoc();
  const kept = ["Feature 1 (box) ", "Feature 2 (box)", "Feature 1 (cylinder)", "Box 2"];
  for (const label of kept) {
    const now = withShortNames(named(doc, "feature-1", label));
    assert.equal(names(now)[0], label);
    // The first box keeps its own name but is still a box: the boxes after it are numbered 2 and 3 ("Box 2" taken by
    // the first one in the last case, so 3 and 4).
    assert.deepEqual(names(now).slice(3), label === "Box 2" ? ["Box 3", "Slot 1", "Box 4"] : ["Box 2", "Slot 1", "Box 3"]);
    // The sketch's copy of the first box's old name was "Feature 1 (box)"; with that not the box's name now, the copy stays.
    assert.equal(now.timeline.features[1].provenance.from[0].label, "Feature 1 (box)");
  }
});

test("an older project's file opens with short names, and saves and reopens byte-identical", () => {
  const text = projectToJson({ ...emptyProject("Old"), workspaces: { design: oldDoc() } });
  assert.match(text, /"Feature 4 \(box\)"/);
  const opened = projectFromJson(text, [designWorkspace]);
  const doc = opened.workspaces.design as DesignDocument;
  assert.deepEqual(names(doc), ["Box 1", "Sketch 1", "Cylinder 1", "Box 2", "Slot 1", "Box 3"]);
  const saved = projectToJson(opened);
  assert.doesNotMatch(saved, /Feature \d+ \(/);
  assert.equal(projectToJson(projectFromJson(saved, [designWorkspace])), saved);
  // readDesignDocument is where it happens, so every way in (open, paste, a command's check) gets it.
  assert.deepEqual(names(readDesignDocument(JSON.parse(JSON.stringify(oldDoc())))), names(doc));
});

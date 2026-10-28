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
  // Saved before version 4, as every file holding these names was.
  return { ...back, version: 3 } as unknown as DesignDocument;
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

// The nightly's mutation run found these left unchecked (10-26): each case below is one a project file can hold,
// since readDesignDocument hands withShortNames the file's data before anything checks provenance.

test("a sketch whose name has the old preset form keeps it: only presets are renamed", () => {
  // The sketch (sketch-2) named "Feature 2 (sketch)", exactly what oldPresetName gives it; it is no preset, so it stays,
  // and the presets are still Box 1, Cylinder 1, Box 2, Slot 1, Box 3.
  const doc = oldDoc();
  const sketch = doc.timeline.features[1];
  assert.equal(oldPresetName(sketch), "Feature 2 (sketch)");
  const now = withShortNames(named(doc, sketch.id, "Feature 2 (sketch)"));
  assert.deepEqual(names(now), ["Box 1", "Feature 2 (sketch)", "Cylinder 1", "Box 2", "Slot 1", "Box 3"]);
});

test("a preset with no provenance, or one without its own name, opens unchanged beside renamed ones", () => {
  // The cylinder (feature-3) with its provenance left out, then with only `from`: nothing to rename on it and nothing
  // of it to follow, so it comes back as the very same object, and the boxes are still renamed around it.
  const doc = oldDoc();
  const cylinder = doc.timeline.features[2];
  const { provenance: _, ...bare } = cylinder;
  for (const odd of [bare, { ...cylinder, provenance: { from: [] } }] as unknown as Feature[]) {
    const features = doc.timeline.features.map((f) => (f.id === cylinder.id ? odd : f));
    const now = withShortNames({ ...doc, timeline: { ...doc.timeline, features } });
    assert.equal(now.timeline.features[2], odd);
    assert.deepEqual(now.timeline.features.filter((f) => f !== odd).map((f) => f.provenance.self.label), ["Box 1", "Sketch 1", "Box 2", "Slot 1", "Box 3"]);
  }
});

test("only Design's copies of a renamed preset's old name follow; another workspace's entry, an empty one and a name the user gave stay", () => {
  // The sketch made from Box 1 also lists an Image entry with the same id and old label, an empty (null) entry, and
  // Design's own entry for the box under a label the user gave it ("My base"): only the first entry is Design's copy of
  // the old name, so only it becomes "Box 1".
  const doc = oldDoc();
  const sketch = doc.timeline.features[1];
  const from = [
    { workspace: "design", id: "feature-1", label: "Feature 1 (box)" },
    { workspace: "image", id: "feature-1", label: "Feature 1 (box)" },
    null,
    { workspace: "design", id: "feature-1", label: "My base" },
  ] as unknown as Feature["provenance"]["from"];
  const features = doc.timeline.features.map((f) => (f.id === sketch.id ? { ...sketch, provenance: { ...sketch.provenance, from } } : f));
  const now = withShortNames({ ...doc, timeline: { ...doc.timeline, features } });
  assert.deepEqual(now.timeline.features[1].provenance.from, [
    { workspace: "design", id: "feature-1", label: "Box 1" },
    { workspace: "image", id: "feature-1", label: "Feature 1 (box)" },
    null,
    { workspace: "design", id: "feature-1", label: "My base" },
  ]);
  assert.equal(now.timeline.features[1].intent.summary, "Sketch 1 on a face of Box 1");
});

// ---- A file's names follow the rename rules (app sweep 2026-10-28, finding 17) ----
// Before: names from a file were taken as they were, so two items could
// share one (ignoring case), and a name could be empty, 5,000 characters
// long or hold a line break, none of which Rename allows. A name that is
// not text is refused (document.test.ts); the rest are repaired as the
// file opens, the first item keeping a name two share, and every copy of a
// repaired name (another item's `from`) following it.
import { NAME_LIMIT } from "../src/timeline-edits.ts";

/** Box 1 (feature-1), Sketch 1 on its top (from Box 1), Extrude 1 of it, and Box 2 (feature-6), saved and read back with names given. */
function namedFile(labels: Record<string, unknown>): DesignDocument {
  const s = addFaceSketch(partDocument("box", 40, 30, 20), { plane: "face:feature-1/top", feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  let doc = extrudeSketch(drawCircle(s.doc, s.id, [20, 15], 5).doc, s.id, 8).doc;
  doc = insertPreset(doc, "box", 10, 10, 10).doc;
  const d = JSON.parse(JSON.stringify(doc));
  for (const f of d.timeline.features) if (Object.hasOwn(labels, f.id)) f.provenance.self.label = labels[f.id];
  for (const f of d.timeline.features) for (const o of f.provenance.from) if (Object.hasOwn(labels, o.id)) o.label = labels[o.id];
  return readDesignDocument(d);
}

test("the file the name tests change has these items and names", () => {
  const doc = namedFile({});
  assert.deepEqual(doc.timeline.features.map((f) => f.id), ["feature-1", "sketch-2", "feature-5", "feature-6"]);
  assert.deepEqual(names(doc), ["Box 1", "Sketch 1", "Extrude 1", "Box 2"]);
});

test("hand-worked: two items of one name, ignoring case, open with the second named apart: '(2)' after it", () => {
  // Box 2 saved as "box 1": nameKey("box 1") = nameKey("Box 1"), taken by the first item, which keeps it;
  // "box 1 (2)" is free, so the second item gets it.
  assert.deepEqual(names(namedFile({ "feature-6": "box 1" })), ["Box 1", "Sketch 1", "Extrude 1", "box 1 (2)"]);
  // Three items of one name: the second "(2)", the third "(3)", since "(2)" is then taken.
  assert.deepEqual(names(namedFile({ "sketch-2": "Part", "feature-5": "PART", "feature-6": "part" })), ["Box 1", "Part", "PART (2)", "part (3)"]);
  // "(2)" already some item's: the next number.
  assert.deepEqual(names(namedFile({ "feature-1": "Part", "sketch-2": "Part (2)", "feature-6": "part" })), ["Part", "Part (2)", "Extrude 1", "part (3)"]);
  // Composed and decomposed Café are one name (finding 18).
  assert.deepEqual(names(namedFile({ "feature-1": "Café", "feature-6": "Café" })), ["Café", "Sketch 1", "Extrude 1", "Café (2)"]);
});

test("hand-worked: an empty name opens as the next free name of its kind", () => {
  // Box 2 saved as "": it is the second box, so freshName gives 1 + 1 = Box 2, free.
  assert.deepEqual(names(namedFile({ "feature-6": "" })), ["Box 1", "Sketch 1", "Extrude 1", "Box 2"]);
  // Only spaces is empty too; Box 1 emptied while Box 2 keeps its name: the first box, 0 + 1 = Box 1.
  assert.deepEqual(names(namedFile({ "feature-1": "   " })), ["Box 1", "Sketch 1", "Extrude 1", "Box 2"]);
  // An empty sketch and extrude: Sketch 1 and Extrude 1 are free again once their own names are gone.
  assert.deepEqual(names(namedFile({ "sketch-2": "", "feature-5": "" })), ["Box 1", "Sketch 1", "Extrude 1", "Box 2"]);
  // Box 1 empty and Box 2 named "Box 1": Box 1 is taken, so the first box is Box 2... which is free, since Box 2 is named Box 1.
  assert.deepEqual(names(namedFile({ "feature-1": "", "feature-6": "Box 1" })), ["Box 2", "Sketch 1", "Extrude 1", "Box 1"]);
});

test("the 40-character limit on open: 0.9× and 40 kept, 41, 1.1× and 5,000 cut to 40; characters, not code units", () => {
  assert.equal(NAME_LIMIT, 40);
  const opened = (label: string) => names(namedFile({ "feature-6": label }))[3];
  // 0.9 × 40 = 36 and 40 stay as they are.
  assert.equal(opened("n".repeat(36)), "n".repeat(36));
  assert.equal(opened("n".repeat(40)), "n".repeat(40));
  // 41, 1.1 × 40 = 44 and the sweep's 5,000 are cut to their first 40.
  for (const n of [41, 44, 5000]) assert.equal(opened("n".repeat(n)), "n".repeat(40), `${n}`);
  // "🔩" is two code units but one character: 41 cut to 40 of them (80 code units), never half of one.
  assert.equal(opened("🔩".repeat(41)), "🔩".repeat(40));
  // A space where the cut falls is dropped, as Rename drops the spaces round a name: 39 n, a space, then more.
  assert.equal(opened(`${"n".repeat(39)} tail`), "n".repeat(39));
  // Cut, then two alike: the second's base is cut to 36 so " (2)" fits in 40.
  assert.deepEqual(names(namedFile({ "feature-1": "n".repeat(50), "feature-6": "N".repeat(45) })), ["n".repeat(40), "Sketch 1", "Extrude 1", `${"N".repeat(36)} (2)`]);
});

test("a line break, tab or other control character in a name opens as a space; the spaces round it go", () => {
  assert.deepEqual(names(namedFile({ "feature-6": "Top\nplate" })), ["Box 1", "Sketch 1", "Extrude 1", "Top plate"]);
  assert.deepEqual(names(namedFile({ "feature-6": "\tTop\r\n\u0007plate\n" })), ["Box 1", "Sketch 1", "Extrude 1", "Top plate"]);
  // Nothing but control characters is an empty name.
  assert.deepEqual(names(namedFile({ "feature-6": "\n\t" })), ["Box 1", "Sketch 1", "Extrude 1", "Box 2"]);
});

test("a repaired name's copies follow it: the sketch on Box 1's face names it as it opened", () => {
  const doc = namedFile({ "feature-1": " Base\n" , "feature-6": "base" });
  assert.deepEqual(names(doc), ["Base", "Sketch 1", "Extrude 1", "base (2)"]);
  assert.deepEqual(doc.timeline.features[1].provenance.from, [{ workspace: "design", id: "feature-1", label: "Base" }]);
});

test("names the rules allow open exactly as saved, and a repaired file reads back as it opened (self-consistency)", () => {
  const fine = namedFile({ "feature-1": "  ", "feature-6": "BOX 2" });
  assert.deepEqual(names(fine), ["Box 1", "Sketch 1", "Extrude 1", "BOX 2"]);
  for (const labels of [{}, { "feature-6": "box 1" }, { "feature-1": "x".repeat(5000), "feature-6": "X".repeat(5000) }, { "sketch-2": "a\nb", "feature-5": "A B" }]) {
    const once = namedFile(labels);
    assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(once))), once, JSON.stringify(labels).slice(0, 60));
    // And every name obeys Rename's rules.
    const keys = names(once).map(nameKey);
    assert.equal(new Set(keys).size, keys.length);
    for (const n of names(once)) assert.ok(n === n.trim() && n !== "" && [...n].length <= NAME_LIMIT && !/\p{Cc}/u.test(n), JSON.stringify(n));
  }
});

test("5,000 boxes of one name, or with none, open in a moment, numbered in order (audit S2's limit)", () => {
  const boxes = (label: string) => {
    const one = partDocument("box", 1, 1, 1).timeline.features[0];
    const features = Array.from({ length: 5_000 }, (_, k) => ({ ...one, id: `feature-${k + 1}`, provenance: { self: { workspace: "design", id: `feature-${k + 1}`, label }, from: [] } }));
    return { version: 3, nextId: 5_001, profiles: [], sketches: [], timeline: { features } };
  };
  for (const [label, first, last] of [["Part", "Part", "Part (5000)"], ["", "Box 1", "Box 5000"]]) {
    const start = performance.now();
    const doc = readDesignDocument(boxes(label));
    const ms = performance.now() - start;
    // All one name: the first keeps it and the k-th is "Part (k)". None: the k-th box is the k-th, so Box k.
    assert.deepEqual([names(doc)[0], names(doc)[1], names(doc)[4_999]], [first, label === "" ? "Box 2" : "Part (2)", last]);
    assert.ok(ms < 2_000, `${JSON.stringify(label)}: ${ms.toFixed(0)} ms`);
  }
});

test("a name that is not text is refused, naming its item: there is nothing to repair it from (finding 17)", () => {
  // Before: a number opened as the item's name, shown as "42", and takenNames skipped it.
  for (const [bad, said] of [[42, "42"], [null, "null"], [true, "true"], [["Box 1"], "a list"], [{}, "an object"]] as const)
    assert.throws(() => namedFile({ "feature-6": bad }), { message: `Design feature feature-6's name must be text, not ${said}` });
  // A missing name too.
  assert.throws(() => namedFile({ "feature-6": undefined }), { message: "Design feature feature-6's name must be text, not undefined" });
});

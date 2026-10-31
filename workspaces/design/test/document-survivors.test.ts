// Tests written to kill the mutants StrykerJS found surviving in reading
// Design's data on the night of 2026-10-30 (issue #220; run it again with
// packages/testing/stryker/run.sh design). Each test names the change to
// the code it catches. The mutants no caller can tell from the real code
// are explained in packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument, readDesignDocument, withRuledNames, type DesignDocument } from "../src/document.ts";
import { addSketch, projectEdges } from "../src/sketch.ts";
import { insertPreset } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
/** Read back as a file holds it. */
const reread = (doc: unknown): DesignDocument => readDesignDocument(clone(doc));
/** Refused with exactly this message (not a TypeError from reading past a missing part, nor another check's words). */
const refused = (data: unknown, message: string | RegExp) =>
  assert.throws(
    () => readDesignDocument(data),
    (e: Error) => e.constructor === Error && (typeof message === "string" ? e.message === message : message.test(e.message)),
  );
/** Three boxes, feature-1 to feature-3. */
const threeBoxes = (): DesignDocument => insertPreset(insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10).doc, "box", 5, 5, 5).doc;
const names = (doc: DesignDocument) => doc.timeline.features.map((f) => f.provenance.self.label);
/** The data with item `i`'s name set to `label`. */
const named = (doc: DesignDocument, labels: string[]): Record<string, any> => {
  const d = clone(doc) as Record<string, any>;
  labels.forEach((label, i) => (d.timeline.features[i].provenance.self.label = label));
  return d;
};

test("a provenance's from entry needs a workspace and an id; its own name needs a workspace (catches each typeof check made always true or false)", () => {
  const d = clone(partDocument("box", 40, 30, 20)) as Record<string, any>;
  const from = (entry: unknown) => {
    const x = clone(d);
    x.timeline.features[0].provenance.from = [entry];
    return x;
  };
  const listed = "Design feature feature-1's provenance lists something that is not a workspace, id and name";
  refused(from({ id: "feature-9", label: "Box" }), listed);
  refused(from({ workspace: "image", label: "Box" }), listed);
  // Both present: read (the control, so the two refusals above are the missing parts' doing).
  assert.equal(reread(from({ workspace: "image", id: "layer-2", label: "Photo" })).timeline.features[0].provenance.from.length, 1);
  const noWorkspace = clone(d);
  delete noWorkspace.timeline.features[0].provenance.self.workspace;
  refused(noWorkspace, "Design feature feature-1's provenance has no name of its own");
});

test("withRuledNames refuses an item with no name in words, never a TypeError (catches `?.self?.label` and `?.self` made plain reads)", () => {
  const box = partDocument("box", 40, 30, 20);
  const f = box.timeline.features[0];
  const noSelf = { ...box, timeline: { ...box.timeline, features: [{ ...f, provenance: { from: [] } }] } } as unknown as DesignDocument;
  const noProvenance = { ...box, timeline: { ...box.timeline, features: [{ ...f, provenance: undefined }] } } as unknown as DesignDocument;
  for (const doc of [noSelf, noProvenance])
    assert.throws(() => withRuledNames(doc), (e: Error) => e.constructor === Error && e.message === "Design feature feature-1's name must be text, not undefined");
});

test("hand-worked: a repeated name skips a number a later item's name already has (catches the filter of used names, and || made &&)", () => {
  // Names Box, Box, Box (2): the second Box repeats the first, so it gets the first free " (n)". " (2)" is the third
  // item's own name, later in the file, so the second Box becomes "Box (3)", and the third keeps "Box (2)".
  assert.deepEqual(names(reread(named(threeBoxes(), ["Box", "Box", "Box (2)"]))), ["Box", "Box (3)", "Box (2)"]);
});

test("hand-worked: a long repeated name cut for its number loses the space the cut leaves at its end (catches trimEnd made trimStart)", () => {
  // 35 a's, a space and 4 b's: 40 characters, NAME_LIMIT exactly. The repeat's suffix " (2)" is 4 characters, so the name
  // keeps its first 40 - 4 = 36: the 35 a's and the space, which goes, then " (2)": 35 a's and " (2)", 39 characters.
  const long = `${"a".repeat(35)} bbbb`;
  assert.deepEqual(names(reread(named(threeBoxes(), [long, long, "Box"]))), [long, `${"a".repeat(35)} (2)`, "Box"]);
});

test("hand-worked: a Move with an empty name gets the next Move name (catches isMoveItem made false and \"Move\" made empty)", () => {
  const moved = insertMove(partDocument("box", 40, 30, 20), ["feature-1"], { ...NO_MOVE, x: 10 }).doc;
  // The first Move in the file, no other item named "Move 1": counted from 0 before it, so "Move 1".
  assert.deepEqual(names(reread(named(moved, ["Box 1", ""]))), ["Box 1", "Move 1"]);
});

test("withRuledNames gives back the document itself when every name keeps to the rules (catches the changed checks made always true or never empty)", () => {
  const doc = threeBoxes();
  assert.equal(withRuledNames(doc), doc);
});

test("a renamed item's name is followed in from lists only where they name a Design item (catches the workspace check made always true)", () => {
  // feature-2 repeats feature-1's "Box" and becomes "Box (2)"; feature-3's from names feature-2 twice: once from Design
  // (followed), once from the Image workspace, whose feature-2 is another thing (kept as it was).
  const d = named(threeBoxes(), ["Box", "Box", "Lid"]);
  d.timeline.features[2].provenance.from = [
    { workspace: "design", id: "feature-2", label: "Box" },
    { workspace: "image", id: "feature-2", label: "Box" },
  ];
  assert.deepEqual(reread(d).timeline.features[2].provenance.from, [
    { workspace: "design", id: "feature-2", label: "Box (2)" },
    { workspace: "image", id: "feature-2", label: "Box" },
  ]);
});

test("a Move's body that is a list, not an id, is refused by the Move's own check (catches the deleted body's typeof check made always true)", () => {
  // ["feature-9"] reads as "feature-9" when turned to text, the shape of a deleted body's id; it must still be refused.
  const d = clone(insertMove(partDocument("box", 40, 30, 20), ["feature-1"], { ...NO_MOVE, x: 10 }).doc) as Record<string, any>;
  d.timeline.features[1].dependsOn = [["feature-1"]];
  refused(d, "Design move feature-2 moves a list, which is not a body made before it in the timeline");
});

test("a body's id must start with body: (catches the ^ dropped) and its number's message names a list as a list (catches the text check made always true)", () => {
  const d = clone(partDocument("box", 40, 30, 20)) as Record<string, any>;
  assert.equal(d.version, 5);
  const bodies = (b: unknown) => ({ ...clone(d), bodies: [b] });
  refused(bodies({ id: "xbody:feature-1", number: 1 }), 'Design body xbody:feature-1 is not "body:" and the id of an item that makes a body');
  refused(bodies({ id: "body:feature-1", number: [1] }), "Design body body:feature-1's number a list is not a counting number");
  refused(bodies({ id: "body:feature-1", number: "1" }), 'Design body body:feature-1\'s number "1" is not a counting number');
});

test("a version 5 file's bodies are checked, not settled: a number given twice is refused", () => {
  const d = clone(threeBoxes()) as Record<string, any>;
  d.bodies[1].number = d.bodies[0].number;
  refused(d, `Design body number ${d.bodies[0].number} is given twice`);
});

test("the eyes can't hide a Move (catches the solid-or-sketch check made always true)", () => {
  const d = clone(insertMove(partDocument("box", 40, 30, 20), ["feature-1"], { ...NO_MOVE, x: 10 }).doc) as Record<string, any>;
  d.hidden = ["feature-2"];
  refused(d, "Design data hides feature-2, which is not a solid feature or sketch in the timeline, an origin axis or a folder");
  d.hidden = ["feature-1"];
  assert.deepEqual(reread(d).hidden, ["feature-1"]);
});

test("two edges seen end on make two projected points, and the file reads (catches a point projection's curve points made non-empty)", () => {
  const made = addSketch(partDocument("box", 40, 30, 20));
  // The box's two front uprights seen from above: the points (40, 0) and (0, 0), each a projection with no curve.
  const both = projectEdges(made.doc, made.id, [
    { feature: "feature-1", edge: "front+right", shape: { kind: "point", at: [40, 0] } },
    { feature: "feature-1", edge: "front+left", shape: { kind: "point", at: [0, 0] } },
  ]);
  assert.equal(both.ids.length, 2);
  assert.equal(reread(both.doc).sketches[0].projected?.length, 2);
});

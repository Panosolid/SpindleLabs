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
  const moved = insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], { ...NO_MOVE, x: 10 }).doc;
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
  // ["body:feature-1"] reads as "body:feature-1" when turned to text, the shape of a body's id; it must still be refused.
  // (Version 6 lists a Move's bodies in its `bodies`, 35ec.)
  const d = clone(insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], { ...NO_MOVE, x: 10 }).doc) as Record<string, any>;
  d.timeline.features[1].intent.parameters.bodies = [["body:feature-1"]];
  refused(d, "Design move feature-2 moves a list, which is not a body made before it in the timeline");
});

test("a body's id must start with body: (catches the ^ dropped) and its number's message names a list as a list (catches the text check made always true)", () => {
  const d = clone(partDocument("box", 40, 30, 20)) as Record<string, any>;
  assert.equal(d.version, 6);
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
  const d = clone(insertMove(partDocument("box", 40, 30, 20), ["body:feature-1"], { ...NO_MOVE, x: 10 }).doc) as Record<string, any>;
  // Version 6 lists a body by its body id (35ec): a Move's "body" is refused either way, the box's body reads.
  d.hidden = ["body:feature-2"];
  refused(d, "Design data hides body:feature-2, which is not a body (by its body id), a sketch in the timeline, an origin axis or a folder");
  d.hidden = ["feature-2"];
  refused(d, "Design data hides feature-2, which is not a body (by its body id), a sketch in the timeline, an origin axis or a folder");
  d.hidden = ["body:feature-1"];
  assert.deepEqual(reread(d).hidden, ["body:feature-1"]);
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

// Survivors of the night of 2026-10-31 (run 41232766937, issue #220 again):
// upgrading version 5 data to version 6 and checking a Move's bodies (35ec).
/** Box 1 and Box 2, then Move 1 (feature-3) of Box 1 by 5 mm in x: what an edit writes. */
const movedBox = (): Record<string, any> => clone(insertMove(insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10).doc, ["body:feature-1"], { ...NO_MOVE, x: 5 }).doc);
/** The same as version 5 wrote it: the Move without its bodies list (dependsOn holds its items). */
const asV5 = (d: Record<string, any>) => {
  const x = clone(d);
  x.version = 5;
  for (const f of x.timeline.features) if (f.intent.type === "move") delete f.intent.parameters.bodies;
  return x;
};

test("upgrading version 5: a null item is refused by the item check, never a TypeError (catches `isRecord(f) && typeof f.id === \"string\"` made true or ||)", () => {
  const d = asV5(movedBox());
  // The control: the version 5 file reads, its Move gaining bodies ["body:feature-1"].
  assert.deepEqual(reread(d).timeline.features[2].intent.parameters.bodies, ["body:feature-1"]);
  d.timeline.features.push(null);
  // Item 4 is null: the upgrade skips it and the item check names it (a mutant reads null.id first, a TypeError).
  refused(d, "Design feature 4 has no id or intent");
});

test("upgrading version 5: a hidden Move keeps its item id, so the refusal names the Move's own id (catches `type(f) !== \"move\"` made true and \"move\" made \"\")", () => {
  const d = asV5(movedBox());
  // The control: a hidden box's item id becomes its body id (version 6).
  d.hidden = ["feature-1"];
  assert.deepEqual(reread(d).hidden, ["body:feature-1"]);
  // A Move makes no body, so "feature-3" stays as written and is refused as such; the mutants turn it into "body:feature-3".
  d.hidden = ["feature-3"];
  refused(d, "Design data hides feature-3, which is not a body (by its body id), a sketch in the timeline, an origin axis or a folder");
});

test("upgrading version 5: a hidden entry that is a list is refused as a list, not read as the text it turns into (catches `typeof id === \"string\"` made true)", () => {
  const d = asV5(movedBox());
  // String(["body:feature-1"]) is "body:feature-1", a body id, which version 5 never wrote: the mutant refuses it with that
  // message; the real check skips anything not text and the hidden check refuses it as a list.
  d.hidden = [["body:feature-1"]];
  refused(d, "Design data hides a list, which is not a body (by its body id), a sketch in the timeline, an origin axis or a folder");
  // A text body id in version 5 is refused by the upgrade (the control: the check is there and names it).
  d.hidden = ["body:feature-1"];
  refused(d, "Design data says version 5 but hides body:feature-1 by a body id, which version 6 brought");
});

test("a Move of two bodies must depend on both items in order; the refusal lists them with commas (catches some→every, its test made false or undefined, and \", \" made \"\")", () => {
  const d = movedBox();
  const move = d.timeline.features[2];
  move.intent.parameters.bodies = ["body:feature-1", "body:feature-2"];
  // The control: both items, in the bodies' order, reads.
  move.dependsOn = ["feature-1", "feature-2"];
  assert.deepEqual(reread(d).timeline.features[2].dependsOn, ["feature-1", "feature-2"]);
  // Right length, first right, second wrong: some item differs, so refused (every would need all to differ).
  const MISMATCH = "Design move feature-3 must depend on exactly the items that made the bodies it moves, in their order (feature-1, feature-2)";
  move.dependsOn = ["feature-1", "feature-1"];
  refused(d, MISMATCH);
  // Swapped: the order counts.
  move.dependsOn = ["feature-2", "feature-1"];
  refused(d, MISMATCH);
});

test("a Move of a piece the bodies list names passes the Move's check (the list is refused after, by its own check, which names the piece) (catches the piece test of isBodyOf made false, every, undefined)", () => {
  // Pieces aren't written in files yet (the bodies list holds an item's own bodies only, 35f1), but the Move's check already
  // accepts one the list names: so the refusal comes from the list's check, after the Moves'. The mutants refuse at the Move.
  const d = movedBox();
  d.timeline.features[2].intent.parameters.bodies = ["body:feature-1/piece:1"];
  d.bodies.push({ id: "body:feature-1/piece:1", number: 3 });
  d.nextBody = 4;
  refused(d, 'Design body body:feature-1/piece:1 is not "body:" and the id of an item that makes a body');
  // The control: not in the list, the Move's own check refuses it.
  d.bodies.pop();
  refused(d, "Design move feature-3 moves body:feature-1/piece:1, which is not a body made before it in the timeline");
});

test("hiding a piece of an item that isn't there is refused by the hidden check, even when the bodies list names it (catches `at !== undefined` made true)", () => {
  const d = movedBox();
  d.hidden = ["body:feature-2/piece:1"];
  d.bodies.push({ id: "body:feature-2/piece:1", number: 3 });
  d.nextBody = 4;
  // The control: feature-2 exists, so the hidden check passes and the bodies list's check refuses the piece.
  refused(d, 'Design body body:feature-2/piece:1 is not "body:" and the id of an item that makes a body');
  // feature-7 is no item: the hidden check refuses it there (the mutant lets it through to the list's check).
  d.hidden = ["body:feature-7/piece:1"];
  d.bodies[2].id = "body:feature-7/piece:1";
  refused(d, "Design data hides body:feature-7/piece:1, which is not a body (by its body id), a sketch in the timeline, an origin axis or a folder");
});

test("upgrading version 5: only solids' item ids become body ids; a hidden entry naming no item stays as written (catches the non-solid branch's [] made a list of one text)", () => {
  const d = asV5(movedBox());
  // The upgrade turns a hidden entry into a body id only when it is a solid item's id. The file holds a Move (feature-3),
  // which is not a solid, so the non-solid branch runs; a mutant puts the text "Stryker was here" into the solids for it.
  // Worked by hand: "Stryker was here" names no item, so the real upgrade keeps it as written and the hidden check
  // refuses that text; the mutant would turn it into "body:Stryker was here" and refuse that instead.
  d.hidden = ["Stryker was here"];
  refused(d, "Design data hides Stryker was here, which is not a body (by its body id), a sketch in the timeline, an origin axis or a folder");
});

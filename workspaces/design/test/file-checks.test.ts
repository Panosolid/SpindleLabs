// Regressions from the 10-28 file fuzz hunt. (1) A preset the user names
// exactly like an old automatic name ("Feature 1 (box)") kept that name only
// until the file was opened again or an undo restored it: the U0e rename of
// old names ran on every read. It now runs only on data saved before
// version 4. (2) A file whose timeline item had no dependsOn list, or
// provenance without its own name or a `from` list, opened and then crashed
// the graph sync, an edit or the browser panel; such a file is refused when
// it is opened, with a message naming the item.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ChangeNotes, DependencyGraph, emptyProject, projectFromJson, projectToJson } from "@fission/core";
import { oldPresetName, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { renameItem } from "../src/timeline-edits.ts";
import { syncGraph } from "../src/graph.ts";
import { designWorkspace } from "../src/workspace.ts";

const trip = (doc: DesignDocument): DesignDocument => projectFromJson(projectToJson({ ...emptyProject("P"), workspaces: { design: doc } }), [designWorkspace]).workspaces.design as DesignDocument;
const label = (doc: DesignDocument) => doc.timeline.features[0].provenance.self.label;

test("hand-worked: a box the user names 'Feature 1 (box)' keeps that name after save and open, and after a second round", () => {
  // partDocument's box is feature-1, so oldPresetName gives "Feature 1 (box)": exactly the form U0e renames in old files.
  const doc = partDocument("box", 40, 30, 20);
  assert.equal(oldPresetName(doc.timeline.features[0]), "Feature 1 (box)");
  const r = renameItem(doc, "feature-1", "Feature 1 (box)");
  assert.ok("doc" in r);
  const once = trip(r.doc);
  assert.equal(label(once), "Feature 1 (box)");
  assert.equal(label(trip(once)), "Feature 1 (box)");
});

test("the version tells old from new: the same data says version 3 and is renamed, says version 4 and is not", () => {
  // The break that shows the check reads the version: one word changed in an otherwise identical file.
  const doc = partDocument("box", 40, 30, 20);
  assert.equal(doc.version, 4);
  const r = renameItem(doc, "feature-1", "Feature 1 (box)");
  assert.ok("doc" in r);
  const data = JSON.parse(JSON.stringify(r.doc));
  assert.equal(label(readDesignDocument({ ...data, version: 3 })), "Box 1");
  assert.equal(readDesignDocument({ ...data, version: 3 }).version, 4);
  assert.equal(label(readDesignDocument(data)), "Feature 1 (box)");
});

test("data newer than version 4 is refused, naming the versions this SpindleLabs reads", () => {
  const data = { ...JSON.parse(JSON.stringify(partDocument("box", 40, 30, 20))), version: 5 };
  assert.throws(() => readDesignDocument(data), /Design data version 5 is not one this SpindleLabs reads \(1, 2, 3 or 4\)/);
});

/** partDocument's box as file data, broken by `mutate`. */
const broken = (mutate: (f: Record<string, any>) => void): unknown => {
  const data = JSON.parse(JSON.stringify(partDocument("box", 40, 30, 20)));
  mutate(data.timeline.features[0]);
  return data;
};

test("a timeline item with no dependsOn list, or one holding a non-id, is refused on open with a message naming it", () => {
  assert.throws(() => readDesignDocument(broken((f) => delete f.dependsOn)), /Design feature feature-1 has no dependsOn list/);
  assert.throws(() => readDesignDocument(broken((f) => (f.dependsOn = "feature-2"))), /Design feature feature-1 has no dependsOn list/);
  assert.throws(() => readDesignDocument(broken((f) => (f.dependsOn = [7]))), /Design feature feature-1 depends on 7, which is not an id/);
  // The valid file still opens and syncs into a fresh graph (what the app does on open).
  const ok = readDesignDocument(broken(() => {}));
  assert.doesNotThrow(() => syncGraph(new DependencyGraph(), ok, null, new ChangeNotes()));
});

test("a timeline item with no provenance, no name of its own, or no 'from' list is refused on open with a message naming it", () => {
  assert.throws(() => readDesignDocument(broken((f) => delete f.provenance)), /Design feature feature-1 has no provenance/);
  assert.throws(() => readDesignDocument(broken((f) => delete f.provenance.self)), /Design feature feature-1's provenance has no name of its own/);
  assert.throws(() => readDesignDocument(broken((f) => delete f.provenance.self.id)), /Design feature feature-1's provenance has no name of its own/);
  assert.throws(() => readDesignDocument(broken((f) => (f.provenance.self.label = 3))), /Design feature feature-1's name must be text, not 3/);
  assert.throws(() => readDesignDocument(broken((f) => delete f.provenance.from)), /Design feature feature-1's provenance has no 'from' list/);
  assert.throws(() => readDesignDocument(broken((f) => (f.provenance.from = [null]))), /Design feature feature-1's provenance lists something that is not a workspace, id and name/);
  assert.throws(() => readDesignDocument(broken((f) => (f.provenance.from = [{ workspace: "design", id: "profile-1" }]))), /Design feature feature-1's provenance lists something that is not a workspace, id and name/);
});

// Real-use hunt S3/S4 (2026-11-01). (3) A file whose nextId was at the top of the safe range opened, but one added
// item pushed the counter past it, and the autosaved project no longer opened. The reader now refuses a counter
// above MAX_NEXT_ID, leaving room for more ids than any design can use. (4) An item depending on itself or on a later
// item opened, the graph refused it, and the design showed nothing with no message: refused on open, naming it. (5)
// Data newer than version 4 is refused as a NewerFormatError, so the unsaved-changes journal keeps it (storage).

test("hand-worked: the counter may be 2^52 = 4,503,599,627,370,496 but not one more, and a project that opens still opens after an edit", async () => {
  const { MAX_NEXT_ID, insertPreset } = await import("../src/document.ts");
  assert.equal(MAX_NEXT_ID, 4_503_599_627_370_496); // 2^52: half the safe integers, 2^53 - 1 = 9,007,199,254,740,991
  const at = (nextId: number) => ({ ...JSON.parse(JSON.stringify(partDocument("box", 40, 30, 20))), nextId });
  assert.equal(readDesignDocument(at(MAX_NEXT_ID)).nextId, MAX_NEXT_ID);
  assert.throws(() => readDesignDocument(at(MAX_NEXT_ID + 1)), /Design data's nextId 4503599627370497 is above 4503599627370496, more ids than a design can use/);
  assert.throws(() => readDesignDocument(at(Number.MAX_SAFE_INTEGER)), /is above 4503599627370496/);
  // The hunt's case: a design that opens still opens after an edit, or the edit is refused saying why. A box takes one
  // id: at 2^52 - 1 it takes feature-4503599627370495 and the counter becomes 2^52, which opens; at 2^52 it is refused.
  const { doc } = insertPreset(readDesignDocument(at(MAX_NEXT_ID - 1)), "box", 40, 30, 20);
  assert.equal(doc.nextId, MAX_NEXT_ID);
  assert.doesNotThrow(() => trip(doc));
  assert.throws(() => insertPreset(readDesignDocument(at(MAX_NEXT_ID)), "box", 40, 30, 20), /This design has used every id it can hold/);
});

test("every edit that takes an id refuses at the top of the counter, so a saved design always opens again", async () => {
  const { MAX_NEXT_ID } = await import("../src/document.ts");
  const { extrudeSketch } = await import("../src/extrude.ts");
  const { insertMove, NO_MOVE } = await import("../src/move.ts");
  const { addSketch, drawLine } = await import("../src/sketch.ts");
  const top = (doc: ReturnType<typeof readDesignDocument>) => readDesignDocument({ ...JSON.parse(JSON.stringify(doc)), nextId: MAX_NEXT_ID });
  const box = readDesignDocument(JSON.parse(JSON.stringify(partDocument("box", 40, 30, 20))));
  assert.throws(() => insertMove(top(box), ["feature-1"], { ...NO_MOVE, x: 5 }), /every id it can hold/);
  assert.throws(() => addSketch(top(box), "XY"), /every id it can hold/);
  // A sketch with one line: drawing another, or extruding it, at the top is refused too.
  let { doc, id } = addSketch(box, "XY");
  doc = drawLine(doc, id, [0, 0], [10, 0]).doc;
  assert.throws(() => drawLine(top(doc), id, [10, 0], [10, 10]), /every id it can hold/);
  assert.throws(() => extrudeSketch(top(doc), id, 5), /every id it can hold/);
});

test("an item depending on itself, or on an item after it, is refused on open naming both", () => {
  const two = JSON.parse(JSON.stringify(partDocument("box", 40, 30, 20)));
  assert.throws(() => readDesignDocument(broken((f) => (f.dependsOn = ["feature-1"]))), /Design feature feature-1 depends on feature-1, which is not before it in the timeline/);
  const later = structuredClone(two);
  later.nextId = 3;
  later.timeline.features.push({ ...structuredClone(later.timeline.features[0]), id: "feature-2", provenance: { from: [], self: { id: "feature-2", label: "Box 2", workspace: "design" } } });
  later.timeline.features[0].dependsOn = ["feature-2"];
  assert.throws(() => readDesignDocument(later), /Design feature feature-1 depends on feature-2, which is not before it in the timeline/);
  // The same two items, depending the right way round, open.
  const right = structuredClone(later);
  right.timeline.features[0].dependsOn = [];
  right.timeline.features[1].dependsOn = ["feature-1"];
  assert.equal(readDesignDocument(right).timeline.features.length, 2);
});

test("design data newer than version 4 is refused as a NewerFormatError; text '5' or 4.5 is not newer, only wrong", async () => {
  const { NewerFormatError } = await import("@fission/core");
  const data = (version: unknown) => ({ ...JSON.parse(JSON.stringify(partDocument("box", 40, 30, 20))), version });
  assert.throws(() => readDesignDocument(data(5)), (e) => e instanceof NewerFormatError);
  assert.throws(() => projectFromJson(projectToJson({ ...emptyProject("P"), workspaces: { design: data(5) } }), [designWorkspace]), (e) => e instanceof NewerFormatError && /design workspace's data: Design data version 5/.test(e.message));
  for (const v of ["5", 4.5]) assert.throws(() => readDesignDocument(data(v)), (e) => e instanceof Error && !(e instanceof NewerFormatError));
});

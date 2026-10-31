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

test("the version tells old from new: the same data says version 3 and is renamed, says version 4 or 5 and is not", () => {
  // The break that shows the check reads the version: one word changed in an otherwise identical file.
  const doc = partDocument("box", 40, 30, 20);
  assert.equal(doc.version, 5);
  const r = renameItem(doc, "feature-1", "Feature 1 (box)");
  assert.ok("doc" in r);
  const data = JSON.parse(JSON.stringify(r.doc));
  // Older data has no bodies' numbers (version 5 brought them, 35e): the same data without them.
  const { bodies: _, nextBody: __, ...older } = data;
  assert.equal(label(readDesignDocument({ ...older, version: 3 })), "Box 1");
  assert.equal(readDesignDocument({ ...older, version: 3 }).version, 5);
  assert.equal(label(readDesignDocument({ ...older, version: 4 })), "Feature 1 (box)");
  assert.equal(label(readDesignDocument(data)), "Feature 1 (box)");
});

test("data newer than version 5 is refused, naming the versions this SpindleLabs reads", () => {
  const data = { ...JSON.parse(JSON.stringify(partDocument("box", 40, 30, 20))), version: 6 };
  assert.throws(() => readDesignDocument(data), /Design data version 6 is not one this SpindleLabs reads \(1, 2, 3, 4 or 5\)/);
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

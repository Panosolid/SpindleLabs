// Bug hunt (loader): files the project loader accepts but whose Design data
// then crashes the app's own functions. Each test: the file opens (no
// refusal), then a normal use of it throws a TypeError.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ChangeNotes, DependencyGraph, emptyProject, projectFromJson, projectToJson } from "@fission/core";
import { browserTree, changePreset, designWorkspace, partDocument, syncGraph, type DesignDocument } from "@fission/design";

const open = (mutate: (doc: Record<string, any>) => void): DesignDocument => {
  const doc = JSON.parse(JSON.stringify(partDocument("box", 40, 30, 20)));
  mutate(doc);
  const text = projectToJson({ ...emptyProject("P"), workspaces: { design: doc } });
  return projectFromJson(text, [designWorkspace]).workspaces.design as DesignDocument;
};

test("hunt: a feature with no provenance is refused on open, not accepted and then crashing the browser panel", () => {
  let doc: DesignDocument;
  try {
    doc = open((d) => delete d.timeline.features[0].provenance);
  } catch {
    return; // refused: fine
  }
  assert.doesNotThrow(() => browserTree(doc));
});

test("hunt: a preset with no dependsOn is refused on open, not accepted and then crashing an edit", () => {
  let doc: DesignDocument;
  try {
    doc = open((d) => delete d.timeline.features[0].dependsOn);
  } catch {
    return;
  }
  assert.doesNotThrow(() => changePreset(doc, doc.timeline.features[0].id, "cylinder", 10, 10, 10));
});

test("hunt: a feature whose provenance has no 'from' list is refused on open, not accepted and then crashing an edit", () => {
  let doc: DesignDocument;
  try {
    // A second box (feature-2) whose provenance has no "from" list; then box 1 is made a cylinder.
    doc = open((d) => {
      d.timeline.features.push({ ...d.timeline.features[0], id: "feature-2", provenance: { self: { workspace: "design", id: "feature-2", label: "Box 2" } } });
      d.nextId = 3;
    });
  } catch {
    return;
  }
  assert.doesNotThrow(() => changePreset(doc, doc.timeline.features[0].id, "cylinder", 10, 10, 10));
});

test("hunt: a preset with no dependsOn is refused on open, not accepted and then crashing the graph sync the app runs on open", () => {
  let doc: DesignDocument;
  try {
    doc = open((d) => delete d.timeline.features[0].dependsOn);
  } catch {
    return;
  }
  // workspace.ts: "An opened document is all new to the graph" -> syncGraph(ctx.graph, doc, null, ...).
  assert.doesNotThrow(() => syncGraph(new DependencyGraph(), doc, null, new ChangeNotes()));
});

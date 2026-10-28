// Bug hunt: every recipe survives save/load byte-identically.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson } from "@fission/core";
import { addSketch, drawArc, drawCircle, drawLine, drawRectangle, extrudeSketch, insertPreset, moveMarker, partDocument, setExtrudeDistance, setExtrudeFlip, suppressItem, type DesignDocument } from "@fission/design";
import { renameItem } from "../../../workspaces/design/src/timeline-edits.ts";
import { READERS } from "../src/project-fuzz.ts";

const trip = (doc: DesignDocument, units: "mm" | "cm" | "m" | "in" = "mm", name = "P") => {
  const a = projectToJson({ ...emptyProject(name), units: { length: units }, workspaces: { design: doc } });
  const b = projectToJson(projectFromJson(a, READERS));
  return { a, b };
};
const renamed = (doc: DesignDocument, id: string, name: string) => {
  const r = renameItem(doc, id, name);
  if (!("doc" in r)) throw new Error(r.message);
  return r.doc;
};

test("hunt: sketches, arcs, circles, extrudes, flip, suppress, marker, numbers round-trip", () => {
  let doc = partDocument("box", 40, 30, 20);
  for (const plane of ["XY", "XZ", "YZ"] as const) {
    const s = addSketch(doc, plane);
    doc = s.doc;
    doc = drawRectangle(doc, s.id, [0.1 + 0.2, -0], [1e-7, 1e21]).doc;
    doc = drawCircle(doc, s.id, [0.30000000000000004, 1 / 3], 25.4 * 1.2345678901234567).doc;
    doc = drawArc(doc, s.id, [10, 0], [-10, 0], [0, 0]).doc;
    doc = drawLine(doc, s.id, [5e-324, 2], [3, 4]).doc;
    const e = extrudeSketch(doc, s.id, 12.7, true);
    doc = e.doc;
    doc = setExtrudeDistance(doc, 0.1 + 0.7, e.id);
    doc = setExtrudeFlip(doc, false, e.id);
    doc = suppressItem(doc, e.id, true);
  }
  doc = moveMarker(doc, doc.timeline.features[2].id);
  {
  }
  const { a, b } = trip(doc, "in", "Ünïcødé 🚀 ");
  assert.equal(b, a);
});

test("hunt: a name the user typed survives save and load", () => {
  // A box's name renamed by the user to text that matches the old automatic preset name.
  let doc = partDocument("box", 40, 30, 20);
  const id = doc.timeline.features[doc.timeline.features.length - 1].id;
  const n = Number(id.split("-")[1]);
  doc = renamed(doc, id, `Feature ${n} (box)`);
  const { a, b } = trip(doc);
  assert.equal(b, a);
});

import { deleteItem as delItem, hideBody, reorderItem } from "../../../workspaces/design/src/timeline-edits.ts";

test("hunt: hidden bodies, deletes, reorders, renames with unicode round-trip", () => {
  let doc = partDocument("box", 40, 30, 20);
  doc = insertPreset(doc, "box", 10, 10, 10).doc;
  doc = insertPreset(doc, "cylinder" as never, 10, 10, 10).doc;
  const ids = doc.timeline.features.map((f) => f.id);
  const s = addSketch(doc, "XZ");
  doc = drawRectangle(s.doc, s.id, [0, 0], [5, 5]).doc;
  const e = extrudeSketch(doc, s.id, 3);
  doc = e.doc;
  doc = hideBody(doc, ids[0], true);
  doc = hideBody(doc, e.id, true);
  doc = renamed(doc, ids[1], "  Ünï 🚀 名前  ");
  doc = renamed(doc, s.id, "BOX 1x");
  const r = reorderItem(doc, ids[2], 0);
  if ("doc" in r) doc = r.doc as DesignDocument;
  doc = delItem(doc, s.id); // the extrude keeps its shape
  doc = moveMarker(doc, ids[1]);
  const { a, b } = trip(doc, "cm");
  assert.equal(b, a);
  doc = delItem(doc, ids[0]);
  const t = trip(doc, "m");
  assert.equal(t.b, t.a);
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("hunt: every old file opens, and save-open-save is stable", () => {
  const dir = join(import.meta.dirname, "../old-files");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const a = projectToJson(projectFromJson(readFileSync(join(dir, f), "utf8"), READERS));
    assert.equal(projectToJson(projectFromJson(a, READERS)), a, f);
  }
});

test("hunt: project-level fields (links, materials, other workspaces, odd numbers) round-trip", () => {
  const p = { ...emptyProject(""), units: { length: "in" as const }, materials: [{ id: "m1", name: "Steel", density: 7.85e-6 } as never], links: [{ id: "l1", kind: "live", source: { workspace: "design", id: "feature-1" }, accepts: ["solid"], x: -0 } as never], workspaces: { design: partDocument("box", 0.1 + 0.2, 1e-7, 1e21), image: { a: [1e21, 1e-7, -0, 5e-324] } } };
  const a = projectToJson(p);
  const b = projectToJson(projectFromJson(a, READERS));
  assert.equal(b, a);
});

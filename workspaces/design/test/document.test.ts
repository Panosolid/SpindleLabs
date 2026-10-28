import { test } from "node:test";
import assert from "node:assert/strict";
import { RepresentationRegistry, type BodyView, type KernelCalls, type Timeline, XY_PLANE, describeProvenance } from "@fission/core";
import { lastFeature, partDocument, specOf } from "../src/document.ts";
import { designObjects, outlineProducer, registerDesign, type OutlineSource } from "../src/representations.ts";
import { addSketch, drawLine } from "../src/sketch.ts";
import { outline } from "../src/profiles.ts";

test("a part is feature #1 of a one-step timeline, with its intent", () => {
  const doc = partDocument("box", 40, 30, 20);
  // The same Timeline type step 24 uses, not a special single-shape format.
  const timeline: Timeline = doc.timeline;
  assert.equal(timeline.features.length, 1);
  assert.deepEqual(timeline.features[0], {
    id: "feature-1",
    intent: { type: "box", parameters: { width: 40, depth: 30, height: 20 }, summary: "Box: 40 × 30 × 20 mm" },
    provenance: { self: { workspace: "design", id: "feature-1", label: "Box 1" }, from: [] },
    dependsOn: [],
    suppressed: false,
  });
});

test("intent summaries for every shape", () => {
  const summary = (...a: Parameters<typeof partDocument>) => lastFeature(partDocument(...a)).intent.summary;
  assert.equal(summary("cylinder", 40, 30, 20), "Cylinder: ⌀40 × 20 mm");
  assert.equal(summary("sphere", 40, 30, 20), "Sphere: ⌀40 mm");
  assert.equal(summary("slot", 40, 30, 20), "Extrude: Slot with round ends profile 40 × 30 mm, by 20 mm");
});

test("an extrusion depends on its profile, and says it came from it", () => {
  const doc = partDocument("l-bracket", 40, 30, 20);
  const f = lastFeature(doc);
  assert.deepEqual(f.dependsOn, ["profile-1"]);
  assert.equal(describeProvenance(f.provenance), "L-bracket 1 comes from L-bracket profile in Design.");
});

test("the body is built from the intent: changing a parameter changes the body", () => {
  const doc = partDocument("box", 40, 30, 20);
  const f = lastFeature(doc);
  f.intent.parameters.width = 55;
  assert.deepEqual(specOf(doc, f), { box: { width: 55, depth: 30, height: 20 } });
  f.intent.parameters.width = "wide";
  assert.throws(() => specOf(doc, f), /width must be a number/);
});

test("step 24 extends the list: a second feature needs no conversion of the first", () => {
  const doc = partDocument("plate", 40, 30, 20);
  const first = structuredClone(lastFeature(doc));
  doc.timeline.features.push({ ...structuredClone(first), id: "feature-2", dependsOn: ["profile-1", "feature-1"] });
  assert.deepEqual(doc.timeline.features[0], first);
  assert.deepEqual(specOf(doc, doc.timeline.features[0]), specOf(doc, doc.timeline.features[1]));
  // A saved document reads back unchanged: plain JSON, no special cases.
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), doc);
});

/** Kernel stand-in for unit tests: a one-triangle mesh for whatever is asked. */
const fakeKernel: KernelCalls = {
  call: (async () =>
    ({ mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [], indices: [0, 1, 2], triangle_faces: [0], edge_lines: [], edge_line_edges: [] } }) as unknown as BodyView) as KernelCalls["call"],
};

test("Design produces exact Solids for its features and Outlines for its profiles", async () => {
  const registry = new RepresentationRegistry();
  registerDesign(registry, fakeKernel);
  const doc = partDocument("star", 40, 30, 20);
  const [profile, feature] = designObjects(doc, fakeKernel);
  assert.deepEqual(await registry.deliver(feature, ["solid", "mesh"]), { representation: { kind: "solid", spec: specOf(doc, lastFeature(doc)) }, note: null });
  const asMesh = await registry.deliver(feature, ["mesh"]);
  assert.equal(asMesh.representation.kind, "mesh");
  assert.match(asMesh.note!, /can't take an exact solid/);
  assert.deepEqual(await registry.deliver(profile, ["outline"]), {
    representation: { kind: "outline", plane: XY_PLANE, outline: outline("star", 40, 30) },
    note: null,
  });
});

test("step 21: a sketch produces Outline through the same registry and producer, with no new path", async () => {
  // Any OutlineSource registered with the existing generic producer gives its outline.
  const stand = new RepresentationRegistry();
  stand.registerProducer("design.thing", "outline", outlineProducer);
  const triangle = { outer: { path: { corners: [0, 0, 10, 0, 0, 10], bulges: [] } }, holes: [] };
  const thing: OutlineSource = { type: "design.thing", id: "thing-1", plane: XY_PLANE, outline: () => triangle };
  assert.deepEqual(await stand.deliver(thing, ["outline", "mesh"]), { representation: { kind: "outline", plane: XY_PLANE, outline: triangle }, note: null });

  // The real sketch (21b): registered by registerDesign as design.sketch with
  // that same producer, its outline found by the kernel from the lines rebuilt
  // from point ids. A right triangle (0,0), (10,0), (0,10) drawn as a chain.
  const s = addSketch(partDocument("box", 40, 30, 20));
  let d = s.doc;
  const a = drawLine(d, s.id, [0, 0], [10, 0]);
  const b = drawLine(a.doc, s.id, a.doc.sketches[0].curves[0].end, [0, 10]);
  d = drawLine(b.doc, s.id, b.doc.sketches[0].curves[1].end, a.doc.sketches[0].curves[0].start).doc;
  const asked: unknown[] = [];
  const kernel: KernelCalls = {
    call: (async (op: string, lines: unknown, circles: unknown, arcs: unknown) => {
      asked.push([op, lines, circles, arcs]);
      return { closed: triangle };
    }) as KernelCalls["call"],
  };
  const registry = new RepresentationRegistry();
  registerDesign(registry, kernel);
  const sketch = designObjects(d, kernel).find((o) => o.type === "design.sketch")!;
  assert.equal(sketch.id, s.id);
  assert.deepEqual(await registry.deliver(sketch, ["outline", "mesh"]), { representation: { kind: "outline", plane: XY_PLANE, outline: triangle }, note: null });
  // The kernel was given the three lines in drawing order, each end at its point's place, and no circles or arcs.
  assert.deepEqual(asked, [["sketch_outline", [{ a: [0, 0], b: [10, 0] }, { a: [10, 0], b: [0, 10] }, { a: [0, 10], b: [0, 0] }], [], []]]);
  // A sketch that makes no closed outline is refused with the kernel's reason, named.
  const open: KernelCalls = { call: (async () => ({ open: "a line ends loose at (0, 10)" })) as unknown as KernelCalls["call"] };
  const r2 = new RepresentationRegistry();
  registerDesign(r2, open);
  await assert.rejects(r2.deliver(designObjects(d, open).find((o) => o.type === "design.sketch")!, ["outline"]), /Sketch 1 has no closed outline: a line ends loose at \(0, 10\)/);
});

test("Design's saved data reads back, and anything else is refused clearly", async () => {
  const { readDesignDocument } = await import("../src/document.ts");
  const doc = partDocument("slot", 40, 30, 20);
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(doc))), doc);
  assert.throws(() => readDesignDocument(null), /Design data is missing/);
  assert.throws(() => readDesignDocument({ ...doc, version: 4 }), /version 4 is not one this SpindleLabs reads \(1, 2 or 3\)/);
  // An empty timeline is a design with everything deleted (24f4): it opens, with no part; a missing one is still refused.
  const emptied = readDesignDocument({ ...doc, profiles: [], timeline: { features: [] } });
  assert.deepEqual(emptied.timeline.features, []);
  assert.equal(partOf(emptied), null);
  assert.throws(() => readDesignDocument({ ...doc, timeline: {} }), /no timeline/);
  assert.throws(() => readDesignDocument({ ...doc, timeline: { features: "none" } }), /no timeline/);
});

// ---- Opening a saved project (19a) ----
import { projectFromJson, projectToJson, emptyProject } from "@fission/core";
import { partOf, readDesignDocument, type DesignDocument } from "../src/document.ts";

const DESIGN = [{ id: "design" as const, readData: readDesignDocument }];

/** A version-2 file written by hand, as docs/project-format.md describes it: a 50 × 30 × 20 box. */
const HAND_WRITTEN = `{
  "formatVersion": 2,
  "name": "Block",
  "units": { "length": "mm" },
  "materials": [],
  "links": [],
  "workspaces": {
    "design": {
      "version": 1,
      "profiles": [],
      "timeline": { "features": [{
        "id": "feature-1",
        "intent": { "type": "box", "parameters": { "width": 50, "depth": 30, "height": 20 }, "summary": "Box: 50 × 30 × 20 mm" },
        "provenance": { "self": { "workspace": "design", "id": "feature-1", "label": "Feature 1 (box)" }, "from": [] },
        "dependsOn": [],
        "suppressed": false
      }] }
    }
  }
}`;

test("a hand-written version-2 file opens to its 50 × 30 × 20 box", () => {
  const p = projectFromJson(HAND_WRITTEN, DESIGN);
  const doc = p.workspaces.design as DesignDocument;
  assert.deepEqual(partOf(doc), { shape: "box", sizes: { width: 50, depth: 30, height: 20 } });
  const spec = specOf(doc, lastFeature(doc));
  assert.deepEqual(spec, { box: { width: 50, depth: 30, height: 20 } });
  // V = 50 · 30 · 20 = 30000 mm³ (the real kernel measures it in the open-a-file journey).
  assert.equal(spec.box!.width * spec.box!.depth * spec.box!.height, 30000);
  assert.equal(p.name, "Block");
});

test("a version-1 file with a Design part opens (outer migration, then Design's own: a counter above its ids, no sketches)", () => {
  const v1 = JSON.parse(HAND_WRITTEN);
  v1.formatVersion = 1;
  delete v1.links;
  const p = projectFromJson(JSON.stringify(v1), DESIGN);
  assert.deepEqual(p.links, []);
  // Its ids are feature-1 only, so the counter starts at 2; then version 2 to 3 changes nothing for one solid feature,
  // and its old name "Feature 1 (box)" is the short name of the first box (U0e).
  const design = JSON.parse(HAND_WRITTEN).workspaces.design;
  design.timeline.features[0].provenance.self.label = "Box 1";
  assert.deepEqual(p.workspaces.design, { ...design, version: 3, nextId: 2, sketches: [] });
});

test("partOf undoes partDocument for every shape (self-consistency)", () => {
  for (const kind of ["box", "cylinder", "sphere", "l-bracket", "plate", "slot", "star"] as const) {
    const { shape, sizes } = partOf(partDocument(kind, 41, 31, 21));
    assert.equal(shape, kind);
    const full = { width: 41, depth: kind === "cylinder" || kind === "sphere" ? undefined : 31, height: kind === "sphere" ? undefined : 21 };
    assert.deepEqual(sizes, Object.fromEntries(Object.entries(full).filter(([, v]) => v !== undefined)));
    // And the document it describes is the one it came from.
    const doc = partDocument(kind, 41, 31, 21);
    assert.deepEqual(partDocument(shape, sizes.width!, sizes.depth ?? 31, sizes.height ?? 21), doc);
  }
});

test("Design data the panel can't show is refused when the file is opened, each with its message", () => {
  const broken = (edit: (d: any) => void) => {
    const f = JSON.parse(HAND_WRITTEN);
    edit(f.workspaces.design);
    return () => projectFromJson(JSON.stringify(f), DESIGN);
  };
  assert.throws(broken((d) => (d.timeline.features[0].intent.type = "loft")), /can't open the design workspace's data: unknown feature type loft/);
  assert.throws(broken((d) => (d.timeline.features[0].intent.parameters.width = "50")), /Box: 50 × 30 × 20 mm: width must be a number/);
  assert.throws(broken((d) => delete d.timeline.features[0].intent), /Design feature 1 has no id or intent/);
  assert.throws(broken((d) => (d.timeline.features = {})), /Design data has no timeline/);
  // Everything deleted (24f4): opens as a design with no body.
  assert.equal(partOf(projectFromJson(JSON.stringify({ ...JSON.parse(HAND_WRITTEN), workspaces: { design: { ...JSON.parse(HAND_WRITTEN).workspaces.design, profiles: [], timeline: { features: [] } } } }), DESIGN).workspaces.design as DesignDocument), null);
  assert.throws(broken((d) => ((d as { version: number }).version = 4)), /Design data version 4 is not one this SpindleLabs reads \(1, 2 or 3\)/);
  const extrude = (edit: (d: DesignDocument) => void) => {
    const doc = partDocument("slot", 40, 30, 20);
    edit(doc);
    return () => projectFromJson(projectToJson({ ...emptyProject(), workspaces: { design: doc } }), DESIGN);
  };
  assert.doesNotThrow(extrude(() => {}));
  assert.throws(extrude((d) => (d.profiles = [])), /its profile profile-1 is missing/);
  assert.throws(extrude((d) => ((d.profiles[0] as { kind: string }).kind = "hexagon")), /profile profile-1 has an unknown kind hexagon/);
  assert.throws(extrude((d) => ((d.profiles[0] as { width: unknown }).width = null)), /profile profile-1: width and depth must be numbers/);
});

test("a profile that is not an object is refused with Design's own message (found by fuzzing)", () => {
  // Before: profiles [null] reached `x.id` and the file was refused with
  // "Cannot read properties of null (reading 'id')".
  const doc = partDocument("slot", 40, 30, 20) as unknown as { profiles: unknown[] };
  for (const bad of [null, 3, "profile-1", []])
    assert.throws(() => readDesignDocument({ ...doc, profiles: [bad, ...doc.profiles] }), /^Error: Design profile 1 is not an object$/);
  assert.throws(() => readDesignDocument({ ...doc, profiles: [...doc.profiles, null] }), /^Error: Design profile 2 is not an object$/);
});

// ---- A version given as text is quoted in the refusal (app sweep 2026-10-28, finding 25) ----
test("a Design version written as text is quoted, so \"3\" doesn't read as the 3 it isn't", () => {
  const doc = partDocument("box", 40, 30, 20);
  // Before: 'Design data version 3 is not one this SpindleLabs reads (1, 2 or 3)', which says 3 isn't 3.
  assert.throws(() => readDesignDocument({ ...doc, version: "3" }), { message: 'Design data version "3" is not one this SpindleLabs reads (1, 2 or 3)' });
  assert.throws(() => readDesignDocument({ ...doc, version: "" }), { message: 'Design data version "" is not one this SpindleLabs reads (1, 2 or 3)' });
  // A number, and anything that isn't text, read as they did.
  assert.throws(() => readDesignDocument({ ...doc, version: 4 }), { message: "Design data version 4 is not one this SpindleLabs reads (1, 2 or 3)" });
  assert.throws(() => readDesignDocument({ ...doc, version: null }), { message: "Design data version null is not one this SpindleLabs reads (1, 2 or 3)" });
  assert.throws(() => readDesignDocument({ ...doc, version: [3] }), { message: "Design data version a list is not one this SpindleLabs reads (1, 2 or 3)" });
});

// ---- Every part of a timeline item is checked when a file opens (app sweep 2026-10-28, finding 6) ----
// Before: a file whose item had no provenance opened; the browser panel then
// threw "Cannot read properties of undefined (reading 'self')" while naming
// it, showed nothing, and the broken design was kept in the browser, so it
// came back on every reload. Each test breaks one field of a valid file in
// exactly one way and expects that field's own refusal.
import { addFaceSketch, drawCircle } from "../src/sketch.ts";
import { drawnFrame } from "../src/face-sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";

/** Box 1 (feature-1), Sketch 1 on its top (sketch-2, from Box 1), Extrude 1 of it (from Sketch 1): every item has a provenance with a `from` and a dependsOn. */
function threeItems(): any {
  const s = addFaceSketch(partDocument("box", 40, 30, 20), { plane: "face:feature-1/top", feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  return JSON.parse(JSON.stringify(extrudeSketch(drawCircle(s.doc, s.id, [20, 15], 5).doc, s.id, 8).doc));
}
const refusedWith = (edit: (d: any) => void, message: string) => {
  const d = threeItems();
  edit(d);
  assert.throws(() => readDesignDocument(d), { message });
};

test("the three-item file the field tests break opens as it is", () => {
  const d = threeItems();
  assert.deepEqual(readDesignDocument(structuredClone(d)), d);
  // Its ids, as the refusals below name them.
  assert.deepEqual(d.timeline.features.map((f: any) => f.id), ["feature-1", "sketch-2", "feature-5"]);
});

test("an item with no provenance is refused, by name, and nothing is opened (finding 6)", () => {
  for (const bad of [undefined, null, "Box 1", 3, []])
    refusedWith((d) => (bad === undefined ? delete d.timeline.features[0].provenance : (d.timeline.features[0].provenance = bad)), "Design feature feature-1 doesn't say where it came from (its provenance)");
});

test("an item whose provenance doesn't name the item itself is refused", () => {
  for (const bad of [undefined, null, "feature-1", []])
    refusedWith((d) => (bad === undefined ? delete d.timeline.features[0].provenance.self : (d.timeline.features[0].provenance.self = bad)), "Design feature feature-1's provenance doesn't name the item itself");
  // It names itself by an id, in text.
  for (const bad of [undefined, 1, null])
    refusedWith((d) => (bad === undefined ? delete d.timeline.features[0].provenance.self.id : (d.timeline.features[0].provenance.self.id = bad)), "Design feature feature-1's provenance doesn't name the item itself");
  // A Design item is made in Design.
  for (const [bad, said] of [["render", "render"], [undefined, "undefined"], ["Design", "Design"]] as const)
    refusedWith((d) => (bad === undefined ? delete d.timeline.features[0].provenance.self.workspace : (d.timeline.features[0].provenance.self.workspace = bad)), `Design feature feature-1's provenance says it was made in ${said}, not Design`);
});

test("an item whose name is not text is refused (finding 17: numbers and the rest)", () => {
  // A number named an item in every message as "7", and the name rules (takenNames) skipped it.
  for (const [bad, said] of [[7, "7"], [null, "null"], [true, "true"], [["Box 1"], "a list"], [{}, "an object"]] as const)
    refusedWith((d) => (d.timeline.features[1].provenance.self.label = bad), `Design feature sketch-2's name must be text, not ${said}`);
  refusedWith((d) => delete d.timeline.features[1].provenance.self.label, "Design feature sketch-2's name must be text, not undefined");
});

test("an item whose provenance has no list of what it came from is refused", () => {
  for (const bad of [undefined, null, "Box 1", {}])
    refusedWith((d) => (bad === undefined ? delete d.timeline.features[1].provenance.from : (d.timeline.features[1].provenance.from = bad)), "Design feature sketch-2's provenance has no list of what it came from");
});

test("each thing an item came from needs a workspace this SpindleLabs knows, an id and a name", () => {
  const entry = "Design feature sketch-2's provenance: what it came from (entry 1) needs a workspace, an id and a name";
  refusedWith((d) => (d.timeline.features[1].provenance.from[0] = null), entry);
  refusedWith((d) => (d.timeline.features[1].provenance.from[0] = "feature-1"), entry);
  for (const field of ["workspace", "id", "label"]) refusedWith((d) => delete d.timeline.features[1].provenance.from[0][field], entry);
  refusedWith((d) => (d.timeline.features[1].provenance.from[0].workspace = "elsewhere"), entry);
  // A name every object has is not a workspace (describeProvenance looks the name up).
  refusedWith((d) => (d.timeline.features[1].provenance.from[0].workspace = "toString"), entry);
  refusedWith((d) => (d.timeline.features[1].provenance.from[0].id = 1), entry);
  refusedWith((d) => (d.timeline.features[1].provenance.from[0].label = 1), entry);
  // The second entry is counted as the second.
  refusedWith((d) => d.timeline.features[1].provenance.from.push(null), "Design feature sketch-2's provenance: what it came from (entry 2) needs a workspace, an id and a name");
});

test("an item whose dependsOn is not a list of ids is refused", () => {
  // The box (no inputs) and the extrude (one): reorder and delete read every item's dependsOn as a list.
  for (const at of [0, 2]) {
    const id = ["feature-1", "sketch-2", "feature-5"][at];
    for (const bad of [undefined, null, "sketch-2", {}, [3], [null]])
      refusedWith((d) => (bad === undefined ? delete d.timeline.features[at].dependsOn : (d.timeline.features[at].dependsOn = bad)), `Design feature ${id} must list the ids it depends on (dependsOn)`);
  }
});

test("an item's purpose, when it has one, is text", () => {
  const d = threeItems();
  d.timeline.features[0].intent.purpose = "base of the bracket";
  assert.deepEqual(readDesignDocument(structuredClone(d)), d);
  for (const [bad, said] of [[3, "3"], [null, "null"], [["a"], "a list"]] as const)
    refusedWith((d) => (d.timeline.features[0].intent.purpose = bad), `Design feature feature-1: purpose must be text or left out, not ${said}`);
});

test("a file that refuses for its provenance is refused whole by the project loader, with Design's words (finding 6)", () => {
  const d = threeItems();
  delete d.timeline.features[0].provenance;
  assert.throws(() => projectFromJson(JSON.stringify({ ...JSON.parse(projectToJson(emptyProject())), workspaces: { design: d } }), DESIGN), {
    message: "can't open the design workspace's data: Design feature feature-1 doesn't say where it came from (its provenance)",
  });
});

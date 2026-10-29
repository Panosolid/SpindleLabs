// UX1c on the real kernel: Extrude a flat face of a body, no sketch drawn
// first (Fusion's press-pull from a face; Ben, 2026-10-26). While Extrude
// is open every flat face of the bodies on screen is offered beside the
// sketches; a click on one chooses it, the extrude is previewed as OK
// would make it, and OK records the face's sketch (its edges projected,
// face-extrude.ts) and the extrude as one undo step: a new body until
// Combine (35f), which the panel says. Hand-worked volumes, bounds and
// arrows: a box's top, bottom and a side face, into the box, a plate's
// side and a cylinder's cap; a curved face and (until regions, step 48) a
// face with holes refused in words;
// a face selected first is chosen; the new body follows its face when the
// box grows; Escape leaves nothing. Run with `npm run journeys`.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView, OfferedProfile } from "@fission/core";
import { addSketch, BodyCache, changePreset, drawRectangle, FACE_WITH_HOLES, featureSpec, NO_SKETCH, partDocument, PICK_PROFILE_STATUS, rebuildTimeline, type DesignDocument } from "@fission/design";
import { app, kernel } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;

const near = (got: number, want: number, what: string, eps = 1e-9) => assert.ok(Math.abs(got - want) <= eps * Math.max(1, Math.abs(want)), `${what}: ${got}, expected ${want}`);
const nearAll = (got: readonly number[][], want: readonly number[][], what: string) => got.forEach((row, i) => row.forEach((v, j) => near(v, want[i][j], `${what} [${i}][${j}]`)));

/** The faces offered, by name, as the panel lists them for the tests. */
const offeredFaces = (a: App) => (a.$("#extrude-panel")!.dataset.faces ?? "").split(" ").filter(Boolean);
const shown = (a: App) => a.extrudeShown()!;
const previewVolume = (a: App) => Number(a.$("#extrude-panel")!.dataset.previewVolume);

/** The offered face whose plane's normal is `normal` and passes through `point` (the face's sketch frame faces out of a top face, into the body on a bottom one). */
function faceAt(a: App, normal: readonly number[], point: readonly number[]): OfferedProfile {
  const hits = shown(a).profiles.filter((p) => p.face && Math.abs(Math.abs(p.plane.normal[0] * normal[0] + p.plane.normal[1] * normal[1] + p.plane.normal[2] * normal[2]) - 1) < 1e-12 && Math.abs(p.plane.normal.reduce((s, n, i) => s + n * (point[i] - p.plane.origin[i]), 0)) < 1e-9);
  assert.equal(hits.length, 1, `one offered face through ${point} square to ${normal}: ${hits.map((h) => h.id)}`);
  return hits[0];
}

/** Every body the design builds, by feature id: its volume and bounds (built in a cache of its own, freed after). */
async function built(doc: DesignDocument): Promise<Record<string, { volume: number; bounds: number[][] }>> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const out: Record<string, { volume: number; bounds: number[][] }> = {};
    for (const [id, r] of Object.entries(build.results)) {
      assert.ok(r.status !== "failed", `${id} builds: ${JSON.stringify(r)}`);
      if (r.status === "built" && r.body !== undefined) {
        const v = (await cache.view(r.body))!;
        out[id] = { volume: v.volume, bounds: v.bounds as number[][] };
      }
    }
    return out;
  } finally {
    await cache.clear();
  }
}

/** The preset's own body (built and freed), to pin down where the hand-worked numbers start from. */
async function presetView(doc: DesignDocument): Promise<BodyView> {
  const handle = await kernel.call("body_build", await featureSpec(kernel, doc, doc.timeline.features[0]));
  try {
    return await kernel.call("body_view", handle);
  } finally {
    await kernel.call("body_free", handle);
  }
}

async function openExtrude(a: App) {
  a.$("#extrude")!.click();
  await a.settle();
}

async function type(a: App, text: string) {
  const box = a.$("#extrude-distance") as HTMLInputElement;
  box.value = text;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
}

async function ok(a: App) {
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
}

const box = () => partDocument("box", 40, 30, 20);

test("hand-worked: a box's six faces are offered; its top face, extruded 10 then dragged to 5, is a new 40 × 30 × 5 body on it, one undo step with its sketch", async () => {
  const doc = box();
  // Where the numbers start: the box fills (0, 0, 0) to (40, 30, 20).
  assert.deepEqual((await presetView(doc)).bounds, [[0, 0, 0], [40, 30, 20]]);
  const a = await app(doc);
  await openExtrude(a);
  assert.equal(offeredFaces(a).length, 6, "every face of a box is flat");
  assert.ok(shown(a).profiles.every((p) => p.face), "no sketches, so only faces");
  assert.equal(shown(a).chosen, null, "nothing chosen until a click");
  assert.equal(a.$("#extrude-status")!.textContent, PICK_PROFILE_STATUS);
  // The top face, z = 20: a 40 × 30 outline on its plane.
  const top = faceAt(a, [0, 0, 1], [0, 0, 20]);
  await a.extrudePointer({ kind: "pick", profile: top.id });
  assert.equal(shown(a).chosen, top.id);
  assert.equal(a.$("#extrude-profile")!.textContent, "Face of Box 1");
  assert.match(a.$("#extrude-status")!.textContent!, /^Face of Box 1 makes a closed outline\. Joining the new body to the one under the face comes with the Combine tool\.$/);
  // 40 · 30 · 10 = 12,000 mm³ going up from the top; the arrow from the face's centre (20, 15, 20), straight up.
  near(previewVolume(a), 12000, "the top face's preview");
  const arrow = shown(a).arrow!;
  nearAll([arrow.base, arrow.direction], [[20, 15, 20], [0, 0, 1]], "the arrow");
  assert.equal(arrow.distance, 10);
  // Dragged to 5.2 mm: 5, 1200 · 5 = 6,000 mm³.
  await a.extrudePointer({ kind: "drag", distance: 5.2, done: true });
  near(previewVolume(a), 6000, "dragged to 5");
  assert.equal(a.history.undoLabel(), null, "nothing recorded yet");
  await ok(a);
  // OK: the face's sketch and the extrude, one undo step; the box as it was, the new body z 20 to 25.
  const after = a.doc();
  assert.equal(after.timeline.features.length, 3);
  const [, sketchItem, extrude] = after.timeline.features;
  assert.equal(sketchItem.intent.type, "sketch");
  assert.equal(sketchItem.intent.parameters.plane, top.id, "the sketch is on the face itself, by its name");
  assert.equal(after.sketches.find((s) => s.id === sketchItem.id)!.projected!.length, 4, "the face's four edges projected");
  assert.equal(extrude.intent.parameters.sketch, sketchItem.id);
  assert.equal(a.history.undoLabel(), "Extrude Face of Box 1");
  const bodies = await built(after);
  near(bodies["feature-1"].volume, 24000, "the box");
  near(bodies[extrude.id].volume, 6000, "the new body");
  nearAll(bodies[extrude.id].bounds, [[0, 0, 20], [40, 30, 25]], "the new body's bounds");
  // The box grows to 25 high: the face moves up and the new body with it (its sketch follows the face, its edges theirs).
  const grown = await built(changePreset(after, "feature-1", "box", 40, 30, 25));
  nearAll(grown[extrude.id].bounds, [[0, 0, 25], [40, 30, 30]], "after the box grew");
  // And wider: 50 × 30, the face's outline follows its edges: 50 · 30 · 5 = 7,500 mm³.
  const wider = await built(changePreset(after, "feature-1", "box", 50, 30, 20));
  near(wider[extrude.id].volume, 7500, "after the box widened");
  await a.undo();
  assert.equal(a.doc().timeline.features.length, 1, "one undo takes the sketch and the extrude away");
  assert.ok(await a.close());
});

test("hand-worked: sketches come before faces; the bottom face goes down, a side face out sideways, and a negative distance into the box", async () => {
  // Sketch 1 on XY, the box's bottom outline: it and the bottom face lie on each other, and the sketch is offered first, so it wins a click on both.
  const s1 = addSketch(box());
  const a = await app(drawRectangle(s1.doc, s1.id, [0, 0], [40, 30]).doc);
  await openExtrude(a);
  assert.deepEqual(shown(a).profiles.map((p) => !!p.face), [false, true, true, true, true, true, true], "the sketch first, then the six faces");
  assert.equal(shown(a).chosen, s1.id, "the newest sketch is chosen to start, as before");
  // The bottom, z = 0: outward is down. 10 mm: z −10 to 0.
  await a.extrudePointer({ kind: "pick", profile: faceAt(a, [0, 0, 1], [0, 0, 0]).id });
  near(previewVolume(a), 12000, "the bottom's preview");
  const down = shown(a).arrow!;
  nearAll([down.base, down.direction], [[20, 15, 0], [0, 0, -1]], "the bottom's arrow points out of the box");
  // The side x = 40 (30 × 20): 7 mm out, 4,200 mm³.
  await a.extrudePointer({ kind: "pick", profile: faceAt(a, [1, 0, 0], [40, 0, 0]).id });
  await type(a, "7");
  near(previewVolume(a), 4200, "the side's preview");
  // The top, −4: into the box, z 16 to 20, 4,800 mm³ (a new body inside it, until Combine).
  await a.extrudePointer({ kind: "pick", profile: faceAt(a, [0, 0, 1], [0, 0, 20]).id });
  await type(a, "-4");
  near(previewVolume(a), 4800, "into the box");
  await ok(a);
  const extrude = a.doc().timeline.features.at(-1)!;
  nearAll((await built(a.doc()))[extrude.id].bounds, [[0, 0, 16], [40, 30, 20]], "the body inside the box");
  assert.ok(await a.close());
});

test("hand-worked: a plate's faces with holes are refused in words until regions (step 48), its sides offered; a cylinder's caps are offered, its curved side refused", async () => {
  // Plate 40 × 30 × 5 with two round holes: a sketch makes one outline until step 48, so its top and bottom aren't offered.
  const plate = partDocument("plate", 40, 30, 5);
  const pv = await presetView(plate);
  assert.deepEqual(pv.bounds, [[0, 0, 0], [40, 30, 5]]);
  const p = await app(plate);
  await openExtrude(p);
  assert.equal(offeredFaces(p).length, 4, "the four flat sides; not the top and bottom with holes, nor the holes' curved walls");
  const topIndex = pv.face_centroids.findIndex((c, i) => Math.abs(c[2] - 5) < 1e-9 && pv.face_roles[i].role !== "side");
  await p.extrudePointer({ kind: "pick", profile: null, face: topIndex });
  assert.equal(p.$("#extrude-error")!.textContent, FACE_WITH_HOLES);
  assert.equal(shown(p).chosen, null);
  // A side, 40 × 5 at y = 0, out 3 mm: 600 mm³.
  await p.extrudePointer({ kind: "pick", profile: faceAt(p, [0, 1, 0], [0, 0, 0]).id });
  await type(p, "3");
  near(previewVolume(p), 600, "a plate's side");
  assert.ok(await p.close());
  // Cylinder ⌀20 × 30: its caps are circles of radius 10, 100π mm² each; its side is curved.
  const cyl = partDocument("cylinder", 20, 20, 30);
  const cv = await presetView(cyl);
  const side = cv.face_roles.findIndex((r) => r.role === "side");
  assert.ok(side >= 0, "the cylinder has a side face");
  const c = await app(cyl);
  await openExtrude(c);
  assert.equal(offeredFaces(c).length, 2, "the two caps, not the side");
  await c.extrudePointer({ kind: "pick", profile: null, face: side });
  assert.equal(c.$("#extrude-error")!.textContent, "Only flat faces can be extruded, and this face is curved: pick a flat face or a closed sketch.");
  assert.equal(shown(c).chosen, null, "nothing chosen by the refused click");
  const cap = shown(c).profiles[0];
  await c.extrudePointer({ kind: "pick", profile: cap.id });
  near(previewVolume(c), 100 * Math.PI * 10, "a cap, 10 mm");
  assert.ok(await c.close());
});

test("a face selected before Extrude is chosen; Escape after a drag leaves nothing behind", async () => {
  const doc = box();
  const view = await presetView(doc);
  // The top face's kernel index: the face whose centroid is at z = 20.
  const topIndex = view.face_centroids.findIndex((c) => Math.abs(c[2] - 20) < 1e-9);
  const a = await app(doc);
  await a.pick({ face: topIndex });
  await openExtrude(a);
  const top = faceAt(a, [0, 0, 1], [0, 0, 20]);
  assert.equal(shown(a).chosen, top.id, "the face picked first is the one chosen");
  near(previewVolume(a), 12000, "its preview");
  await a.extrudePointer({ kind: "drag", distance: 30, done: true });
  near(previewVolume(a), 36000, "dragged to 30");
  await a.key("clear-selection");
  assert.equal(a.extrudeShown(), null, "Escape closes Extrude");
  assert.equal(a.doc().timeline.features.length, 1, "nothing recorded");
  assert.equal(a.doc().sketches.length, 0, "no face sketch left behind");
  assert.equal(a.history.undoLabel(), null);
  assert.ok(await a.close());
});

test("regression: Extrude opened before the body is drawn (a slow kernel after an Undo) offers the faces once the build lands", async () => {
  // Found by the browser check under a slow kernel (E2E_KERNEL_DELAY, seed 5): Extrude opened while the
  // design was still being built offered the sketches but no face, and never offered them after.
  const a = await app(box());
  await openExtrude(a);
  await a.extrudePointer({ kind: "pick", profile: faceAt(a, [0, 0, 1], [0, 0, 20]).id });
  await ok(a);
  assert.equal(a.history.undoLabel(), "Extrude Face of Box 1");
  // The kernel held: Undo puts the box back and Design is mounted afresh on it, with nothing drawn yet.
  a.hold();
  a.history.undo();
  a.$("#extrude")!.click();
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(offeredFaces(a), [], "nothing drawn, so no face yet");
  await a.release();
  // Built: the box's six faces, its top where the box is (z = 20, a 40 × 30 outline), none from before.
  assert.equal(offeredFaces(a).length, 6, `the box's faces offered once it is drawn: ${offeredFaces(a)}`);
  const top = faceAt(a, [0, 0, 1], [0, 0, 20]);
  await a.extrudePointer({ kind: "pick", profile: top.id });
  // 40 · 30 · 10 = 12,000 mm³ previewed.
  near(previewVolume(a), 12000, "the top face's preview");
  await a.key("clear-selection");
  assert.ok(await a.close());
});

test("with nothing to extrude the panel says so: an empty design, and a sphere alone (no flat face, no sketch)", async () => {
  const empty: DesignDocument = { version: 4, nextId: 1, profiles: [], sketches: [], timeline: { features: [] } };
  const a = await app(empty);
  await openExtrude(a);
  assert.equal(a.$("#extrude-status")!.textContent, NO_SKETCH);
  assert.deepEqual(shown(a).profiles, []);
  assert.ok(await a.close());
  const s = await app(partDocument("sphere", 20, 20, 20));
  await openExtrude(s);
  assert.deepEqual(offeredFaces(s), [], "a sphere has no flat face");
  assert.equal(s.$("#extrude-status")!.textContent, NO_SKETCH);
  assert.ok(await s.close());
});

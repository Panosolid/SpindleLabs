// Journey: Move (step 35e2) on the real WASM kernel. A Move is a timeline
// item: from its place on, each body it moves is where it put it, and
// everything after it (a sketch on the moved body's face, the view, the
// STL) finds it there. Hand-worked moves and turns of a 40 × 30 × 20 box,
// moves chained, two bodies moved at once, suppress, the marker, a deleted
// body, a refusal leaving everything where it was, names kept; then seeded
// random moves of random boxes against a plain model (the box's eight
// corners turned and shifted in plain arithmetic). Run with
// `npm run journeys` after the app build.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import {
  builtBody,
  addFaceSketch,
  bodyIdOf,
  BodyCache,
  deleteItem,
  drawRectangle,
  extrudeSketch,
  featureNames,
  insertMove,
  insertPreset,
  joinBodies,
  movedPoint,
  moveMarker,
  NO_MOVE,
  partDocument,
  rebuildTimeline,
  shownBodies,
  sketchSpot,
  suppressItem,
  unmovedPoint,
  changedMove,
  type DesignDocument,
  type FeatureResult,
  type MoveValues,
} from "@fission/design";
import { nodeKernel } from "../src/node-kernel.ts";
import { seeded } from "../src/index.ts";

const LINEAR = 1e-5;
const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });
type Box3 = [[number, number, number], [number, number, number]];
const near = (got: Box3, want: Box3, what: string) =>
  got.flat().forEach((x, i) => assert.ok(Math.abs(x - want.flat()[i]) <= LINEAR, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

/** The design rebuilt as the app rebuilds it: each item's result and each built body's view. */
async function built(doc: DesignDocument): Promise<{ results: Record<string, FeatureResult>; views: Map<string, BodyView> }> {
  const kernel = nodeKernel();
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const views = new Map<string, BodyView>();
    for (const id of build.order) { const b = builtBody(build, id); if (b !== undefined) views.set(id, (await cache.view(b.handle))!); }
    return { results: build.results, bodies: build.bodies, views };
  } finally {
    await cache.close();
  }
}
const boundsOf = async (doc: DesignDocument, id: string): Promise<Box3> => (await built(doc)).views.get(id)!.bounds;

const BOX = () => partDocument("box", 40, 30, 20);

test("a box moved 10 mm, turned 90°, and both, by hand", async () => {
  // Moved (10, 0, 0): x 10..50, the rest as built.
  near(await boundsOf(insertMove(BOX(), ["body:feature-1"], v({ x: 10 })).doc, "feature-1"), [[10, 0, 0], [50, 30, 20]], "moved 10 in x");
  // Turned 90° about Z through the origin, (x, y) → (−y, x): x −30..0, y 0..40.
  near(await boundsOf(insertMove(BOX(), ["body:feature-1"], v({ turnZ: 90 })).doc, "feature-1"), [[-30, 0, 0], [0, 40, 20]], "turned 90° about Z");
  // Turned 90° about X through the box's middle (20, 15, 10), (y, z) → (−(z − 10), y − 15) about it:
  // y 15 − 10..15 + 10 = 5..25, z 10 − 15..10 + 15 = −5..25.
  near(await boundsOf(insertMove(BOX(), ["body:feature-1"], v({ turnX: 90, pivotX: 20, pivotY: 15, pivotZ: 10 })).doc, "feature-1"), [[0, 5, -5], [40, 25, 25]], "turned about X through its middle");
  // One Move, turned then shifted: turned 90° about Z (x −30..0, y 0..40), then (100, 0, 5): x 70..100, z 5..25.
  near(await boundsOf(insertMove(BOX(), ["body:feature-1"], v({ turnZ: 90, x: 100, z: 5 })).doc, "feature-1"), [[70, 0, 5], [100, 40, 25]], "turned then shifted");
  // Two Moves one after the other: (10, 0, 0) gives x 10..50, then 90° about Z: (x, y) → (−y, x), x −30..0, y 10..50.
  const two = insertMove(insertMove(BOX(), ["body:feature-1"], v({ x: 10 })).doc, ["body:feature-1"], v({ turnZ: 90 })).doc;
  near(await boundsOf(two, "feature-1"), [[-30, 10, 0], [0, 50, 20]], "two moves");
});

test("a moved body keeps its volume, area and every face's name", async () => {
  const still = (await built(BOX())).views.get("feature-1")!;
  const doc = insertMove(BOX(), ["body:feature-1"], v({ turnX: 33, turnY: -71, turnZ: 12, x: -500, y: 3, z: 77 })).doc;
  const { results, bodies, views } = await built(doc);
  const moved = views.get("feature-1")!;
  // 40 · 30 · 20 = 24,000 mm³ and 2(1200 + 800 + 600) = 5,200 mm², wherever it is.
  assert.ok(Math.abs(moved.volume - 24000) <= 1e-9 * 24000 && Math.abs(moved.area - 5200) <= 1e-9 * 5200, `${moved.volume} ${moved.area}`);
  const r = builtBody({ results, bodies }, "feature-1");
  assert.ok(r !== undefined && r.spec !== undefined);
  const names = (view: BodyView, spec = { box: { width: 40, depth: 30, height: 20 } } as never) => featureNames("feature-1", { spec }, view).faces;
  assert.deepEqual(featureNames("feature-1", { spec: r.spec }, moved).faces, names(still), "the same names, face by face");
});

test("two bodies moved at once, the one not picked left alone", async () => {
  const d = insertPreset(insertPreset(BOX(), "cylinder", 10, 10, 5).doc, "box", 1, 1, 1).doc;
  const { views } = await built(insertMove(d, ["body:feature-1", "body:feature-2"], v({ y: -7 })).doc);
  near(views.get("feature-1")!.bounds, [[0, -7, 0], [40, 23, 20]], "the box");
  // The cylinder ⌀10 stands on the origin: x, y −5..5, so y −12..−2.
  near(views.get("feature-2")!.bounds, [[-5, -12, 0], [5, -2, 5]], "the cylinder");
  near(views.get("feature-3")!.bounds, [[0, 0, 0], [1, 1, 1]], "the small box, not picked");
});

test("a Move suppressed, behind the marker, greyed, or moving a deleted body leaves bodies where they were built", async () => {
  const { doc, id } = insertMove(BOX(), ["body:feature-1"], v({ x: 10 }));
  near(await boundsOf(suppressItem(doc, id, true), "feature-1"), [[0, 0, 0], [40, 30, 20]], "the Move suppressed");
  near(await boundsOf(moveMarker(doc, "feature-1"), "feature-1"), [[0, 0, 0], [40, 30, 20]], "the marker before the Move");
  const greyed = (await built(suppressItem(doc, "feature-1", true))).results[id];
  assert.deepEqual(greyed, { status: "greyed", by: "feature-1" });
  // The box deleted (one more body so the design isn't empty): the Move fails naming it.
  const gone = deleteItem(insertPreset(doc, "sphere", 10, 10, 10).doc, "feature-1");
  assert.deepEqual((await built(gone)).results[id], { status: "failed", cause: "deleted-input", input: "feature-1", message: "Box 1 was deleted, so Move 1 has nothing to move" });
});

test("a move past the edge of model space fails with the kernel's words and moves nothing", async () => {
  // Two bodies: the box would end 200 km out (the kernel's model space reaches 100 km, 1e8 mm), so neither moves.
  const d = insertPreset(BOX(), "box", 1, 1, 1).doc;
  const { results, views } = await built(insertMove(d, ["body:feature-2", "body:feature-1"], v({ x: 2e8 })).doc);
  const r = results["feature-3"];
  assert.ok(r.status === "failed" && r.cause === "error" && /limit is 1e8 mm/.test(r.message), JSON.stringify(r));
  near(views.get("feature-1")!.bounds, [[0, 0, 0], [40, 30, 20]], "the box");
  near(views.get("feature-2")!.bounds, [[0, 0, 0], [1, 1, 1]], "the small box");
});

test("a sketch on the moved box's top lies on the top where the Move put it", async () => {
  // Box moved up 5: its top at z = 25. A 10 × 10 square drawn on the top and extruded 10 spans z 25..35.
  const moved = insertMove(BOX(), ["body:feature-1"], v({ z: 5 })).doc;
  const s = addFaceSketch(moved, { plane: "face:feature-1/top", feature: "feature-1" }, { plane: { origin: [0, 0, 25], xAxis: [1, 0, 0], normal: [0, 0, 1] }, side: 1, body: { origin: [0, 0, 5], xAxis: [1, 0, 0], normal: [0, 0, 1] } });
  const drawn = drawRectangle(s.doc, s.id, [5, 5], [15, 15]).doc;
  const e = extrudeSketch(drawn, s.id, 10);
  near((await built(e.doc)).views.get(e.id)!.bounds, [[5, 5, 25], [15, 15, 35]], "the extrude on the moved top");
  // The Move edited to 15 up: the top at 35, and the sketch follows it up, so the extrude spans 35..45.
  near((await built(changedMove(e.doc, "feature-2", v({ z: 15 })))).views.get(e.id)!.bounds, [[5, 5, 35], [15, 15, 45]], "followed the top up");
});

/** `doc` with a sketch on the top of `feature` picked as the app picks it (the bodies on screen after a rebuild, `sketchSpot`), a square from `a` to `c` on it, extruded `h`. */
async function squareOnTop(doc: DesignDocument, feature: string, a: [number, number], c: [number, number], h: number): Promise<{ doc: DesignDocument; extrude: string }> {
  const kernel = nodeKernel();
  const cache = new BodyCache(kernel);
  try {
    const scene = joinBodies(await shownBodies(doc, await rebuildTimeline(doc, cache, kernel), cache));
    const b = scene.bodies.findIndex((x) => x.feature === feature);
    const face = scene.bodies[b].names.faces.findIndex((n) => n === "top");
    const spot = sketchSpot({ face: scene.faceStart[b] + face, shift: false }, scene);
    assert.ok(spot?.kind === "face", JSON.stringify(spot));
    const s = addFaceSketch(doc, spot.face, spot.drawn);
    const e = extrudeSketch(drawRectangle(s.doc, s.id, a, c).doc, s.id, h);
    return { doc: e.doc, extrude: e.id };
  } finally {
    await cache.close();
  }
}

test("35e2h: a sketch on a moved face slides and turns with it when the Move is edited (picked as the app picks it)", async () => {
  // Drawn on the top after a Move of 5 up: the square spans x, y 5..15 (rule 8: the top's coordinates are the world's).
  const { doc, extrude } = await squareOnTop(insertMove(BOX(), ["body:feature-1"], v({ z: 5 })).doc, "feature-1", [5, 5], [15, 15], 10);
  near((await built(doc)).views.get(extrude)!.bounds, [[5, 5, 25], [15, 15, 35]], "as drawn");
  // The Move edited to slide 20 along x too: the face slides 20, and the square with it, x 25..35 (before 35e2h it stayed at 5..15).
  near((await built(changedMove(doc, "feature-2", v({ x: 20, z: 5 })))).views.get(extrude)!.bounds, [[25, 5, 25], [35, 15, 35]], "slid with its face");
  // Edited to a quarter turn about Z through the origin, (x, y) → (−y, x): the square's x 5..15, y 5..15 go to x −15..−5, y 5..15.
  near((await built(changedMove(doc, "feature-2", v({ turnZ: 90, z: 5 })))).views.get(extrude)!.bounds, [[-15, 5, 25], [-5, 15, 35]], "turned with its face");
  // Edited to half a turn about X through the box's middle line (y 15, z 10), then up 5 (turns come first): (y, z) → (30 − y, 20 − z),
  // so the top (z 20) turns over to look down at z 0, then rises to 5; the square's y 5..15 goes to 15..25; the extrude, out of the
  // face, built at z 20..30 on the unmoved box, goes to 0..−10, then −5..5.
  near((await built(changedMove(doc, "feature-2", v({ turnX: 180, pivotY: 15, pivotZ: 10, z: 5 })))).views.get(extrude)!.bounds, [[5, 15, -5], [15, 25, 5]], "turned over with its face");

  // A sketch from a file made before 35e2h keeps no body frame: where its body was when drawn isn't known, so it isn't
  // carried (a guess would move it on opening), and slides as it always did: not at all, x 5..15.
  const old = addFaceSketch(insertMove(BOX(), ["body:feature-1"], v({ z: 5 })).doc, { plane: "face:feature-1/top", feature: "feature-1" }, { plane: { origin: [0, 0, 25], xAxis: [1, 0, 0], normal: [0, 0, 1] }, side: 1 });
  const oldExtrude = extrudeSketch(drawRectangle(old.doc, old.id, [5, 5], [15, 15]).doc, old.id, 10);
  near((await built(changedMove(oldExtrude.doc, "feature-2", v({ x: 20, z: 5 })))).views.get(oldExtrude.id)!.bounds, [[5, 5, 25], [15, 15, 35]], "an old file's sketch stays");
});

test("35e2h seeded: sketches drawn on a box's top after a random slide and turn about Z land where a random edit of that Move takes the face (FISSION_SEED)", async () => {
  const seed = BigInt(process.env.FISSION_SEED ?? "35");
  const r = seeded(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r.next();
  const anyMove = (): MoveValues => v({ x: between(-80, 80), y: between(-80, 80), z: between(-80, 80), turnX: between(-180, 180), turnY: between(-180, 180), turnZ: between(-180, 180), pivotX: between(-50, 50), pivotY: between(-50, 50), pivotZ: between(-50, 50) });
  for (let i = 0; i < 12; i++) {
    // Drawn after a Move that keeps the top looking up (a slide and a turn about Z), so its coordinates are the world's x and y.
    const first = v({ x: between(-80, 80), y: between(-80, 80), z: between(-80, 80), turnZ: between(-180, 180), pivotX: between(-50, 50), pivotY: between(-50, 50) });
    const w = 40 + Math.floor(r.next() * 40);
    const d = 30 + Math.floor(r.next() * 30);
    const box = partDocument("box", w, d, 20);
    const at = (p: readonly number[]) => movedPoint(p, first);
    // A square well inside the top as moved: round the top's middle, 6 mm across.
    const mid = at([w / 2, d / 2, 20]);
    const a: [number, number] = [mid[0] - 3, mid[1] - 3];
    const h = between(1, 10);
    const { doc, extrude } = await squareOnTop(insertMove(box, ["body:feature-1"], first).doc, "feature-1", a, [a[0] + 6, a[1] + 6], h);
    // The model: the prism's corners back on the unmoved box (the first Move undone), then through the edited Move.
    const edit = anyMove();
    const corners = [0, 1].flatMap((dx) => [0, 1].flatMap((dy) => [0, 1].map((dz) => unmovedPoint([a[0] + 6 * dx, a[1] + 6 * dy, mid[2] + h * dz], first)))).map((p) => movedPoint(p, edit));
    const want: Box3 = [[0, 1, 2].map((k) => Math.min(...corners.map((p) => p[k]))) as [number, number, number], [0, 1, 2].map((k) => Math.max(...corners.map((p) => p[k]))) as [number, number, number]];
    const got = (await built(changedMove(doc, "feature-2", edit))).views.get(extrude)!.bounds;
    // Scaled for points up to ~300 mm out (the kernel's LINEAR is for a part's own size).
    got.flat().forEach((x, k) => assert.ok(Math.abs(x - want.flat()[k]) <= 1e-4, `seed ${seed} case ${i}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
  }
});

test("seeded: random moves of random boxes put every corner where plain arithmetic does (FISSION_SEED)", async () => {
  const seed = BigInt(process.env.FISSION_SEED ?? "35");
  const r = seeded(seed);
  const pick = (n: number) => Math.floor(r.next() * n);
  // A turn of a degrees about axis k through p, then the next; the model turns corners with cos and sin by hand.
  const turn = (q: number[], k: number, deg: number, p: number[]): number[] => {
    const [i, j] = k === 0 ? [1, 2] : k === 1 ? [2, 0] : [0, 1];
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    const out = [...q];
    out[i] = p[i] + c * (q[i] - p[i]) - s * (q[j] - p[j]);
    out[j] = p[j] + s * (q[i] - p[i]) + c * (q[j] - p[j]);
    return out;
  };
  let doc = partDocument("box", 1, 1, 1);
  const kinds = { turned: 0, shifted: 0, chained: 0 };
  for (let n = 0; n < 60; n++) {
    const [w, d, h] = [1 + pick(80), 1 + pick(80), 1 + pick(80)];
    doc = insertPreset({ version: 3, nextId: 1, profiles: [], sketches: [], timeline: { features: [] } }, "box", w, d, h).doc;
    let corners = [0, 1, 2, 3, 4, 5, 6, 7].map((b) => [b & 1 ? w : 0, b & 2 ? d : 0, b & 4 ? h : 0]);
    const moves = 1 + pick(3);
    if (moves > 1) kinds.chained++;
    for (let m = 0; m < moves; m++) {
      // Turns of whole quarter turns half the time (the common case), any angle else; shifts up to ±500 mm.
      const angle = () => (pick(2) === 0 ? 90 * (pick(7) - 3) : Math.round((r.next() * 720 - 360) * 100) / 100);
      const values = v({
        turnX: pick(3) === 0 ? angle() : 0,
        turnY: pick(3) === 0 ? angle() : 0,
        turnZ: pick(2) === 0 ? angle() : 0,
        pivotX: pick(100) - 50,
        pivotY: pick(100) - 50,
        pivotZ: pick(100) - 50,
        x: pick(2) === 0 ? pick(1001) - 500 : 0,
        y: pick(2) === 0 ? pick(1001) - 500 : 0,
        z: pick(2) === 0 ? pick(1001) - 500 : 0,
      });
      if (values.turnX || values.turnY || values.turnZ) kinds.turned++;
      if (values.x || values.y || values.z) kinds.shifted++;
      doc = insertMove(doc, ["body:feature-1"], values).doc;
      const p = [values.pivotX, values.pivotY, values.pivotZ];
      corners = corners.map((q) => turn(turn(turn(q, 0, values.turnX, p), 1, values.turnY, p), 2, values.turnZ, p).map((x, k) => x + [values.x, values.y, values.z][k]));
    }
    const view = (await built(doc)).views.get("feature-1")!;
    const what = `seed ${seed} box ${n} (${w} × ${d} × ${h}, FISSION_SEED=${seed} to replay)`;
    // Every corner the model has is a corner the kernel has, within LINEAR (the model's own rounding is far smaller).
    for (const q of corners) assert.ok(view.vertex_points.some((x) => Math.hypot(x[0] - q[0], x[1] - q[1], x[2] - q[2]) <= LINEAR), `${what}: no corner at ${q}`);
    assert.ok(Math.abs(view.volume - w * d * h) <= 1e-9 * w * d * h, `${what}: volume ${view.volume}`);
  }
  // Every kind of case was reached.
  assert.ok(kinds.turned > 20 && kinds.shifted > 20 && kinds.chained > 10, JSON.stringify(kinds));
});

/** The scene the app draws for `doc` (rebuilt and joined as workspace.ts does it). */
async function sceneOf(doc: DesignDocument) {
  const { joinBodies, shownBodies } = await import("@fission/design");
  const kernel = nodeKernel();
  const cache = new BodyCache(kernel);
  try {
    return joinBodies(await shownBodies(doc, await rebuildTimeline(doc, cache, kernel), cache));
  } finally {
    await cache.close();
  }
}

test("the Move panel's preview (35e2b) draws the picked bodies where the kernel puts them, seeded (FISSION_SEED)", async () => {
  const { movedMesh } = await import("@fission/design");
  const seed = BigInt(process.env.FISSION_SEED ?? "35");
  const r = seeded(seed);
  const pick = (n: number) => Math.floor(r.next() * n);
  for (let n = 0; n < 20; n++) {
    // A box and a cylinder; one, the other or both picked.
    const d = insertPreset(partDocument("box", 1 + pick(60), 1 + pick(60), 1 + pick(60)), "cylinder", 2 + pick(40), 2 + pick(40), 1 + pick(40)).doc;
    const picked = [["feature-1"], ["feature-2"], ["feature-1", "feature-2"]][pick(3)];
    const angle = () => (pick(3) === 0 ? 0 : pick(2) === 0 ? 90 * (pick(7) - 3) : Math.round((r.next() * 720 - 360) * 10) / 10);
    const values = v({ x: pick(401) - 200, y: pick(401) - 200, z: pick(401) - 200, turnX: angle(), turnY: angle(), turnZ: angle(), pivotX: pick(100) - 50, pivotY: pick(100) - 50, pivotZ: pick(100) - 50 });
    const what = `seed ${seed} case ${n} (${picked.join(" and ")}, ${JSON.stringify(values)}; FISSION_SEED=${seed} to replay)`;
    const preview = movedMesh(await sceneOf(d), picked, values);
    const kernel = (await sceneOf(insertMove(d, picked.map(bodyIdOf), values).doc)).mesh;
    // The same triangles in the same order: every point within LINEAR of the kernel's, every normal within 1e-6 of it.
    assert.equal(preview.positions.length, kernel.positions.length, what);
    assert.deepEqual(preview.indices, kernel.indices, what);
    preview.positions.forEach((x, i) => assert.ok(Math.abs(x - kernel.positions[i]) <= LINEAR, `${what}: point number ${i} ${x}, the kernel's ${kernel.positions[i]}`));
    preview.edge_lines.forEach((x, i) => assert.ok(Math.abs(x - kernel.edge_lines[i]) <= LINEAR, `${what}: line number ${i}`));
    // The kernel sends normals as 32-bit floats, good to about 6e-8 on a unit vector: 1e-6 still catches any wrong turn.
    preview.normals.forEach((x, i) => assert.ok(Math.abs(x - kernel.normals[i]) <= 1e-6, `${what}: normal number ${i} ${x}, the kernel's ${kernel.normals[i]}`));
  }
});

test("the Move panel's OK asks the kernel first (35e2b): a move out past model space is refused with its words; one inside is not", async () => {
  const { refusedMove } = await import("@fission/design");
  const far = insertMove(BOX(), ["body:feature-1"], v({ x: 2e8 }));
  assert.match((await refusedMove(nodeKernel(), far.doc, far.id)) ?? "", /limit is 1e8 mm/);
  const near10 = insertMove(BOX(), ["body:feature-1"], v({ x: 10, turnZ: 45 }));
  assert.equal(await refusedMove(nodeKernel(), near10.doc, near10.id), null);
  // Behind the marker it builds nothing, so it is not refused (it waits there, as any item does).
  const behind = moveMarker(far.doc, "feature-1");
  assert.equal(await refusedMove(nodeKernel(), behind, far.id), null);
});

test("regression (35e2b's browser check): a moved body downloads as STL, and is handed to other workspaces, where the Move put it", async () => {
  const { ActionRegistry, emptyProject, RepresentationRegistry } = await import("@fission/core");
  const { designWorkspace, DOWNLOAD_STL, registerDesignActions, shownBodyRefs } = await import("@fission/design");
  const kernel = nodeKernel();
  const saved: Uint8Array[] = [];
  const actions = new ActionRegistry();
  registerDesignActions(actions, (bytes) => void saved.push(bytes), async () => {});
  const representations = new RepresentationRegistry();
  designWorkspace.registerRepresentations!(representations, kernel);
  // The box moved up 5 and along X 10, then a second Move turning it 90° about Z through the origin:
  // up 5 gives z 5..25, x 10..50; turned, (x, y) → (−y, x): x −30..0, y 10..50.
  const doc = insertMove(insertMove(BOX(), ["body:feature-1"], v({ x: 10, z: 5 })).doc, ["body:feature-1"], v({ turnZ: 90 })).doc;
  const want: Box3 = [[-30, 10, 5], [0, 50, 25]];
  const project = emptyProject("Moved");
  project.workspaces.design = doc;
  const ctx = { project, kernel, representations, viewport: { setOverlay() {}, clearOverlay() {} } } as never;
  assert.deepEqual(await actions.get(DOWNLOAD_STL)!.run(shownBodyRefs(doc), ctx), { message: "Exported spindlelabs-box.stl.", bad: false });
  const bytes = saved[0];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pts: number[][] = [];
  for (let t = 0; t < view.getUint32(80, true); t++) for (let k = 0; k < 3; k++) pts.push([0, 1, 2].map((i) => view.getFloat32(84 + 50 * t + 12 + 12 * k + 4 * i, true)));
  const stl: Box3 = [[0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))) as Box3[0], [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))) as Box3[1]];
  near(stl, want, "the STL");
  // Slice and the other workspaces take the body as a mesh: there too.
  const { representation } = await representations.deliver({ type: "design.feature", id: "feature-1", document: doc } as never, ["mesh"]);
  const p = (representation as { positions: number[] }).positions;
  const corners = (k: number, f: (...x: number[]) => number) => f(...p.filter((_, i) => i % 3 === k));
  near([[0, 1, 2].map((k) => corners(k, Math.min)), [0, 1, 2].map((k) => corners(k, Math.max))] as Box3, want, "the mesh other workspaces are handed");
});

/** The box round a mesh's points. */
const meshBox = (positions: readonly number[]): Box3 => [
  [0, 1, 2].map((k) => Math.min(...positions.filter((_, i) => i % 3 === k))) as Box3[0],
  [0, 1, 2].map((k) => Math.max(...positions.filter((_, i) => i % 3 === k))) as Box3[1],
];

test("an edited Move's preview (35e2c) draws the bodies where the kernel puts them after OK, a later Move among them, seeded (FISSION_SEED)", async () => {
  const { changedMove, editedMoveMesh } = await import("@fission/design");
  const seed = BigInt(process.env.FISSION_SEED ?? "35");
  const r = seeded(seed);
  const pick = (n: number) => Math.floor(r.next() * n);
  const angle = () => (pick(3) === 0 ? 0 : 15 * (pick(25) - 12));
  const values = () => v({ x: pick(201) - 100, y: pick(201) - 100, z: pick(201) - 100, turnX: angle(), turnY: angle(), turnZ: angle(), pivotX: pick(100) - 50, pivotY: pick(100) - 50, pivotZ: pick(100) - 50 });
  const bodies = () => [["feature-1"], ["feature-2"], ["feature-1", "feature-2"]][pick(3)];
  for (let n = 0; n < 20; n++) {
    // A box and a cylinder, Move 1 of some, and half the time Move 2 of some after it; Move 1 edited.
    let d = insertPreset(partDocument("box", 1 + pick(60), 1 + pick(60), 1 + pick(60)), "cylinder", 2 + pick(40), 2 + pick(40), 1 + pick(40)).doc;
    const first = insertMove(d, bodies().map(bodyIdOf), values());
    d = first.doc;
    if (pick(2) === 0) d = insertMove(d, bodies().map(bodyIdOf), values()).doc;
    const to = values();
    const what = `seed ${seed} case ${n} (Move 1 to ${JSON.stringify(to)}; FISSION_SEED=${seed} to replay)`;
    const preview = editedMoveMesh(await sceneOf(d), d, (await built(d)).results, first.id, to);
    const kernel = (await sceneOf(changedMove(d, first.id, to))).mesh;
    // Unlike a new Move's preview (from the body's points as made, small whole numbers here), this one starts from the
    // points as built and moved, which the kernel sends as 32-bit floats. A point at distance R from the origin has each
    // part rounded by at most R·2^-24, so it is off by at most √3·R·2^-24; the Move's turns and shifts keep that length;
    // the kernel's own mesh to compare with is rounded once more, R·2^-24 a part. So LINEAR plus (√3 + 1)·R·2^-24,
    // R the farthest point from the origin in either mesh (a turn can bring a far point near the origin).
    const reach = (m: readonly number[]) => Math.max(...m.map((_, i) => (i % 3 === 0 ? Math.hypot(m[i], m[i + 1], m[i + 2]) : 0)));
    const bound = LINEAR + (Math.sqrt(3) + 1) * Math.max(reach(kernel.positions), reach((await sceneOf(d)).mesh.positions)) * 2 ** -24;
    assert.equal(preview.positions.length, kernel.positions.length, what);
    preview.positions.forEach((x, i) => assert.ok(Math.abs(x - kernel.positions[i]) <= bound, `${what}: point number ${i} ${x}, the kernel's ${kernel.positions[i]}`));
    preview.edge_lines.forEach((x, i) => assert.ok(Math.abs(x - kernel.edge_lines[i]) <= bound, `${what}: line number ${i}`));
    preview.normals.forEach((x, i) => assert.ok(Math.abs(x - kernel.normals[i]) <= 1e-6, `${what}: normal number ${i}`));
  }
});

test("Move's handles in the app (35e2c): a drag fills the boxes in whole mm and 15° steps, the preview and handles follow, OK builds what was shown", async () => {
  const { app } = await import("./design-app.ts");
  const { bodyReference } = await import("@fission/design");
  const a = await app(BOX());
  const before = meshBox(a.mesh()!.positions);
  const box = (k: string) => (a.$(`#move-${k}`) as HTMLInputElement).value;
  // No handles until a body is picked.
  await a.key("move-tool");
  assert.equal(a.moveHandlesShown(), null, "nothing picked: no handles");
  a.selection.set([bodyReference("body:feature-1")]);
  await a.settle();
  // The box 40 × 30 × 20 from `before`: the handles at its middle.
  const middle = [0, 1, 2].map((k) => (before[0][k] + before[1][k]) / 2);
  assert.deepEqual(a.moveHandlesShown()?.centre, middle);
  // 12.4 mm along X while held: 12 in the box, the box drawn 12 mm on, the handles with it.
  await a.movePointer({ handle: "x", amount: 12.4, done: false });
  assert.equal(box("x"), "12");
  near(meshBox(a.mesh()!.positions), [[before[0][0] + 12, before[0][1], before[0][2]], [before[1][0] + 12, before[1][1], before[1][2]]], "held at 12 mm");
  assert.deepEqual(a.moveHandlesShown()?.centre, [middle[0] + 12, middle[1], middle[2]]);
  // Let go at 12.6 mm: 13.
  await a.movePointer({ handle: "x", amount: 12.6, done: true });
  assert.equal(box("x"), "13");
  // Round Z: 50° snaps to 45; then a second drag of 140° (135 more) to 180; a third of 20° (15 more) to 195°, shown as −165.
  for (const [amount, want] of [[50, "45"], [140, "180"], [20, "-165"]] as const) {
    await a.movePointer({ handle: "turnZ", amount, done: true });
    assert.equal(box("turnZ"), want, `after ${amount}°`);
  }
  // A typed box is the user's: the next drag starts from it.
  const y = a.$("#move-y") as HTMLInputElement;
  y.value = "2.5";
  y.dispatchEvent(new a.window.Event("input") as unknown as Event);
  await a.movePointer({ handle: "y", amount: -3.2, done: true });
  assert.equal(box("y"), "-0.5");
  const shown = a.mesh()!.positions.slice();
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  const move = a.doc().timeline.features.at(-1)!;
  assert.deepEqual([move.intent.parameters.x, move.intent.parameters.y, move.intent.parameters.turnZ], [13, -0.5, -165]);
  assert.equal(a.moveHandlesShown(), null, "OK takes the handles away");
  // The kernel's body is where the preview drew it.
  const kernel = a.mesh()!.positions;
  assert.equal(kernel.length, shown.length);
  kernel.forEach((x, i) => assert.ok(Math.abs(x - shown[i]) <= LINEAR, `point number ${i}: ${x}, the preview's ${shown[i]}`));
});

test("an edited Move previews in the app (35e2c): its handles at its pivot moved, a drag moves the body before OK, Cancel puts it back", async () => {
  const { app } = await import("./design-app.ts");
  const moved = insertMove(BOX(), ["body:feature-1"], v({ x: 10 }));
  const a = await app(moved.doc);
  const built = meshBox(a.mesh()!.positions);
  await a.doubleClick(moved.id);
  assert.equal((a.$("#move-x") as HTMLInputElement).value, "10", "the edit opened on Move 1");
  const pivot = moved.doc.timeline.features.at(-1)!.intent.parameters;
  assert.deepEqual(a.moveHandlesShown()?.centre, [(pivot.pivotX as number) + 10, pivot.pivotY, pivot.pivotZ]);
  // 5 mm up Z: the box drawn 5 mm up before OK (35e2b drew it as built until OK).
  await a.movePointer({ handle: "z", amount: 5, done: true });
  near(meshBox(a.mesh()!.positions), [[built[0][0], built[0][1], built[0][2] + 5], [built[1][0], built[1][1], built[1][2] + 5]], "edited, up 5");
  // Typed back to no shift along X: the box drawn 10 mm back.
  const x = a.$("#move-x") as HTMLInputElement;
  x.value = "0";
  x.dispatchEvent(new a.window.Event("input") as unknown as Event);
  near(meshBox(a.mesh()!.positions), [[built[0][0] - 10, built[0][1], built[0][2] + 5], [built[1][0] - 10, built[1][1], built[1][2] + 5]], "edited, back along X");
  (a.$("#move-cancel") as HTMLButtonElement).click();
  await a.settle();
  near(meshBox(a.mesh()!.positions), built, "Cancel: as built");
  assert.equal(a.moveHandlesShown(), null);
});

test("35e2i: an edited Move's bodies changed on the real kernel, by hand: Cylinder 1 put in, Box 1 taken out, a later Move still applied", async () => {
  const { changedMove } = await import("@fission/design");
  // Box 1 40 × 30 × 20 at the origin, Cylinder 1 ⌀10 × 5 standing on it; Move 1 shifts Box 1 10 mm along X, Move 2 lifts Cylinder 1 3 mm.
  const d = insertPreset(BOX(), "cylinder", 10, 10, 5).doc;
  const first = insertMove(d, ["body:feature-1"], v({ x: 10 }));
  const doc = insertMove(first.doc, ["body:feature-2"], v({ z: 3 })).doc;
  // Move 1 moving both: the box x 10..50; the cylinder x −5..5 → 5..15, then up 3: z 3..8.
  const both = (await built(changedMove(doc, first.id, v({ x: 10 }), ["body:feature-1", "body:feature-2"]))).views;
  near(both.get("feature-1")!.bounds, [[10, 0, 0], [50, 30, 20]], "Box 1 still moved");
  near(both.get("feature-2")!.bounds, [[5, -5, 3], [15, 5, 8]], "Cylinder 1 moved by Move 1, then Move 2");
  // Move 1 moving the cylinder alone: the box back where it was made.
  const swapped = (await built(changedMove(doc, first.id, v({ x: 10 }), ["body:feature-2"]))).views;
  near(swapped.get("feature-1")!.bounds, [[0, 0, 0], [40, 30, 20]], "Box 1 taken out: as made");
  near(swapped.get("feature-2")!.bounds, [[5, -5, 3], [15, 5, 8]], "Cylinder 1 put in");
});

test("35e2i: an edited Move's bodies changed in the app: a pick puts one in, another takes one out, a body made later is refused in words, the preview is what OK builds", async () => {
  const { app } = await import("./design-app.ts");
  const { bodyReference, madeAfter } = await import("@fission/design");
  // Box 1 40 × 30 × 20, Cylinder 1 ⌀10 × 5, Move 1 (Box 1, 10 mm along X), then Box 2 1 × 1 × 1 made after it.
  const first = insertMove(insertPreset(BOX(), "cylinder", 10, 10, 5).doc, ["body:feature-1"], v({ x: 10 }));
  const a = await app(insertPreset(first.doc, "box", 1, 1, 1).doc);
  const bodiesLine = () => a.$("#move-bodies")!.textContent;
  await a.doubleClick(first.id);
  assert.equal(bodiesLine(), "Body: Box 1", "the edit opens on Move 1's own body");
  assert.deepEqual(a.selection.items.map((r) => r.id), [bodyReference("body:feature-1").id], "its body picked, lit as a new Move's are");
  // Cylinder 1's row clicked in the browser: put in, drawn 10 mm along X before OK.
  a.selection.toggle(bodyReference("body:feature-2"));
  await a.settle();
  assert.equal(bodiesLine(), "Bodies: Box 1, Cylinder 1");
  // Box 1 clicked in the view (its first face, joined face 0): taken out, drawn where it was made.
  await a.pick({ face: 0 });
  assert.equal(bodiesLine(), "Body: Cylinder 1");
  // Box 2 clicked in the view (after Box 1's 6 faces and Cylinder 1's 3: joined face 9): refused, nothing changes.
  await a.pick({ face: 9 });
  assert.equal(a.$("#move-error")!.textContent, madeAfter("Box 2", "Move 1"));
  assert.equal(bodiesLine(), "Body: Cylinder 1", "Box 2 let go");
  assert.deepEqual(a.selection.items.map((r) => r.id), [bodyReference("body:feature-2").id]);
  const preview = a.mesh()!.positions.slice();
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  const move = a.doc().timeline.features.find((f) => f.id === first.id)!;
  assert.deepEqual(move.dependsOn, ["feature-2"]);
  assert.equal(move.intent.summary, "Move Cylinder 1 by (10, 0, 0) mm");
  assert.equal(a.history.undoLabel(), "Edit Move 1", "one undo step");
  assert.deepEqual(a.selection.items, [], "the edited Move's picks let go");
  // What OK built is what the preview drew; by hand the box is as made and the cylinder x 5..15.
  const kernel = a.mesh()!.positions;
  assert.equal(kernel.length, preview.length);
  kernel.forEach((x, i) => assert.ok(Math.abs(x - preview[i]) <= LINEAR, `point number ${i}: ${x}, the preview's ${preview[i]}`));
  const views = (await built(a.doc())).views;
  near(views.get("feature-1")!.bounds, [[0, 0, 0], [40, 30, 20]], "Box 1");
  near(views.get("feature-2")!.bounds, [[5, -5, 0], [15, 5, 5]], "Cylinder 1");
  // Undo puts Box 1 back in Move 1.
  await a.undo();
  assert.deepEqual(a.doc().timeline.features.find((f) => f.id === first.id)!.dependsOn, ["feature-1"]);
});

test("35e2i: every body taken out of an edited Move asks for one again, and OK says to pick one; Cancel keeps the Move as it was", async () => {
  const { app } = await import("./design-app.ts");
  const moved = insertMove(BOX(), ["body:feature-1"], v({ x: 10 }));
  const a = await app(moved.doc);
  await a.doubleClick(moved.id);
  await a.pick({ face: 0 });
  assert.equal(a.$("#move-bodies")!.hidden, true);
  assert.equal(a.$("#move-pick")!.hidden, false, "how to pick shown again");
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(a.$("#move-error")!.textContent, "pick at least one body for Move 1 to move");
  (a.$("#move-cancel") as HTMLButtonElement).click();
  await a.settle();
  assert.deepEqual(a.doc().timeline.features.at(-1)!.dependsOn, ["feature-1"]);
  near(meshBox(a.mesh()!.positions), [[10, 0, 0], [50, 30, 20]], "as built");
});

test("an empty Move box (Ben, 2026-10-28) counts as 0 while empty, keeps the preview and handles up, and shows 0 once left", async () => {
  const { app } = await import("./design-app.ts");
  const { bodyReference } = await import("@fission/design");
  const a = await app(BOX());
  a.selection.set([bodyReference("body:feature-1")]);
  await a.key("move-tool");
  const x = a.$("#move-x") as HTMLInputElement;
  const typeIn = (value: string) => {
    x.value = value;
    x.dispatchEvent(new a.window.Event("input") as unknown as Event);
  };
  typeIn("10");
  await a.settle();
  const centre = a.moveHandlesShown()!.centre;
  // Cleared to type a new number: counted as 0, so the handles go back 10 mm and stay up; the box stays empty while it has the focus.
  typeIn("");
  await a.settle();
  assert.deepEqual(a.moveHandlesShown()?.centre, [centre[0] - 10, centre[1], centre[2]]);
  assert.equal(x.value, "");
  assert.equal(a.$("#move-error")!.hidden, true, "no error for an empty box");
  // Left: it shows 0. A box with a number keeps it when left.
  x.dispatchEvent(new a.window.Event("blur") as unknown as Event);
  assert.equal(x.value, "0");
  typeIn("4.5");
  x.dispatchEvent(new a.window.Event("blur") as unknown as Event);
  assert.equal(x.value, "4.5");
});

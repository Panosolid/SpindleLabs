// Journey: Move's snap (step 35e2d) on the real WASM kernel. In the app: a
// 10 mm cube's bottom snapped onto a 40 × 30 × 20 box's top lands centred
// on it (worked by hand), top onto top turns it over, Escape stops only
// the snap, the wrong body says why; an edited Move snapped through a later
// Move of the same body. Then seeded: random boxes and cylinders, random
// turns already in the boxes, random faces and edges snapped, each Move
// built by the kernel and the snapped face or edge found where it landed
// (FISSION_SEED to replay). Run with `npm run journeys` after the app build.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import {
  BodyCache,
  bodyReference,
  insertMove,
  insertPreset,
  joinBodies,
  NO_MOVE,
  partDocument,
  rebuildTimeline,
  shownBodies,
  snappedValues,
  snapPart,
  type DesignDocument,
  type MoveValues,
  type SnapPart,
} from "@fission/design";
import { nodeKernel } from "../src/node-kernel.ts";
import { seeded } from "../src/index.ts";

const LINEAR = 1e-5;
const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });
const near = (got: readonly number[], want: readonly number[], what: string, eps = LINEAR) =>
  got.forEach((x, i) => assert.ok(Math.abs(x - want[i]) <= eps, `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

/** The design built by the kernel: each built body's view, by feature id. */
async function views(doc: DesignDocument): Promise<Map<string, BodyView>> {
  const kernel = nodeKernel();
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const out = new Map<string, BodyView>();
    for (const [id, r] of Object.entries(build.results)) if (r.status === "built" && r.body !== undefined) out.set(id, (await cache.view(r.body))!);
    return out;
  } finally {
    await cache.close();
  }
}
/** The scene the app draws for `doc`: where each body's faces start in the joined numbering. */
async function sceneOf(doc: DesignDocument) {
  const kernel = nodeKernel();
  const cache = new BodyCache(kernel);
  try {
    return joinBodies(await shownBodies(doc, await rebuildTimeline(doc, cache, kernel), cache));
  } finally {
    await cache.close();
  }
}
/** The kernel index of the face of `view` with role `role` ("top", "bottom"…). */
const faceWith = (view: BodyView, role: string) => view.face_roles.findIndex((r) => r?.role === role);

/** A 40 × 30 × 20 box (feature-1) with a 10 mm cube inserted after it. */
function twoBoxes() {
  const { doc, id } = insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10);
  return { doc, cube: id };
}

test("by hand in the app: Snap lays the cube's bottom on the box's top, centred; OK builds it there", async () => {
  const { app } = await import("./design-app.ts");
  const { doc, cube } = twoBoxes();
  const scene = await sceneOf(doc);
  const [big, small] = [0, 1].map((b) => scene.bodies.findIndex((s) => s.feature === (b === 0 ? "feature-1" : cube)));
  const a = await app(doc);
  a.selection.set([bodyReference(cube)]);
  await a.key("move-tool");
  const snap = a.$("#move-snap") as HTMLButtonElement;
  assert.equal(snap.disabled, false);
  snap.click();
  await a.settle();
  assert.equal(snap.getAttribute("aria-pressed"), "true");
  assert.match(a.$("#move-hint")!.textContent!, /face or edge to move/);
  assert.equal(a.$("#move-hint")!.hidden, false);
  // In the panel too, in place of the bodies' names (a phone's sheet goes away while the view is tapped).
  assert.equal(a.$("#move-snap-note")!.textContent, a.$("#move-hint")!.textContent);
  assert.equal(a.$("#move-bodies")!.hidden, true);
  // The box first: not a moving body, so it says so and waits.
  await a.pick({ face: scene.faceStart[big] + faceWith(scene.bodies[big].view, "top") });
  assert.equal(a.$("#move-error")!.textContent, "Pick a face or edge of the bodies being moved first.");
  // The cube's bottom, then the cube again: where it lands must be another body.
  await a.pick({ face: scene.faceStart[small] + faceWith(scene.bodies[small].view, "bottom") });
  assert.match(a.$("#move-hint")!.textContent!, /where it lands/);
  await a.pick({ face: scene.faceStart[small] + faceWith(scene.bodies[small].view, "top") });
  assert.equal(a.$("#move-error")!.textContent, "That body is being moved: pick where it lands on another body.");
  // Empty space does nothing; then the box's top.
  await a.pick({});
  assert.match(a.$("#move-hint")!.textContent!, /where it lands/);
  await a.pick({ face: scene.faceStart[big] + faceWith(scene.bodies[big].view, "top") });
  assert.equal(snap.getAttribute("aria-pressed"), "false", "the snap is done");
  assert.equal(a.$("#move-hint")!.hidden, true);
  assert.equal(a.$("#move-snap-note")!.hidden, true);
  assert.equal(a.$("#move-bodies")!.textContent, "Body: Box 2", "the names back");
  assert.equal(a.$("#move-error")!.hidden, true);
  // The box's top is centred (20, 15, 20): the cube, 10 mm wide, sits from (15, 10, 20) to (25, 20, 30).
  const before = scene.bodies[small].view.bounds;
  const box = (k: string) => Number((a.$(`#move-${k}`) as HTMLInputElement).value);
  near([box("x"), box("y"), box("z")], [15 - before[0][0], 10 - before[0][1], 20 - before[0][2]], "the distance boxes", 0);
  near([box("turnX"), box("turnY"), box("turnZ")], [0, 0, 0], "no turn", 0);
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  const built = (await views(a.doc())).get(cube)!;
  near(built.bounds.flat(), [15, 10, 20, 25, 20, 30], "the cube as the kernel built it");
});

test("by hand in the app: top onto top turns the cube over (180° about X); Escape stops only the snap", async () => {
  const { app } = await import("./design-app.ts");
  const { doc, cube } = twoBoxes();
  const scene = await sceneOf(doc);
  const big = scene.bodies.findIndex((s) => s.feature === "feature-1");
  const small = scene.bodies.findIndex((s) => s.feature === cube);
  const a = await app(doc);
  a.selection.set([bodyReference(cube)]);
  await a.key("move-tool");
  (a.$("#move-snap") as HTMLButtonElement).click();
  await a.pick({ face: scene.faceStart[small] + faceWith(scene.bodies[small].view, "top") });
  await a.key("clear-selection");
  assert.equal(a.$("#move-panel")!.hidden, false, "Escape kept the Move open");
  assert.equal(a.$("#move-snap")!.getAttribute("aria-pressed"), "false");
  // A click now picks bodies again, as before Snap: the box is added.
  (a.$("#move-snap") as HTMLButtonElement).click();
  await a.pick({ face: scene.faceStart[small] + faceWith(scene.bodies[small].view, "top") });
  await a.pick({ face: scene.faceStart[big] + faceWith(scene.bodies[big].view, "top") });
  assert.equal((a.$("#move-turnX") as HTMLInputElement).value, "180");
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  const built = (await views(a.doc())).get(cube)!;
  near(built.bounds.flat(), [15, 10, 20, 25, 20, 30], "the cube turned over onto the top");
  // The face that was the cube's top now faces down, onto the box.
  near(built.face_normals[faceWith(built, "top")]!, [0, 0, -1], "its top faces −Z", 1e-12);
  near(built.face_centroids[faceWith(built, "top")], [20, 15, 20], "its top on the box's top");
});

test("an edited Move snapped through a later Move: the cube ends where the box's top is seen", async () => {
  const { app } = await import("./design-app.ts");
  let { doc, cube } = twoBoxes();
  const first = insertMove(doc, [cube], v({ x: 100 }));
  doc = insertMove(first.doc, [cube], v({ y: 50 })).doc;
  // The box moved too, by a third Move, so its top is seen at (20, 15 + 7, 20 + 3).
  doc = insertMove(doc, ["feature-1"], v({ y: 7, z: 3 })).doc;
  const scene = await sceneOf(doc);
  const big = scene.bodies.findIndex((s) => s.feature === "feature-1");
  const small = scene.bodies.findIndex((s) => s.feature === cube);
  const a = await app(doc);
  await a.doubleClick(first.id);
  (a.$("#move-snap") as HTMLButtonElement).click();
  await a.pick({ face: scene.faceStart[small] + faceWith(scene.bodies[small].view, "bottom") });
  await a.pick({ face: scene.faceStart[big] + faceWith(scene.bodies[big].view, "top") });
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  const built = (await views(a.doc())).get(cube)!;
  near(built.face_centroids[faceWith(built, "bottom")], [20, 22, 23], "the cube's bottom on the box's top as seen, after Move 2");
});

test("a snap onto a tilted face keeps its angles' every digit: the faces lie flat on each other, not 1e-6° apart as typed numbers would", async () => {
  const { app } = await import("./design-app.ts");
  // The box tilted 33.3° about X and 17.7° about Z: the angles that lay the cube on its top are not round numbers.
  let { doc, cube } = twoBoxes();
  doc = insertMove(doc, ["feature-1"], v({ turnX: 33.3, turnZ: 17.7 })).doc;
  const scene = await sceneOf(doc);
  const big = scene.bodies.findIndex((s) => s.feature === "feature-1");
  const small = scene.bodies.findIndex((s) => s.feature === cube);
  const a = await app(doc);
  a.selection.set([bodyReference(cube)]);
  await a.key("move-tool");
  (a.$("#move-snap") as HTMLButtonElement).click();
  await a.pick({ face: scene.faceStart[small] + faceWith(scene.bodies[small].view, "bottom") });
  await a.pick({ face: scene.faceStart[big] + faceWith(scene.bodies[big].view, "top") });
  (a.$("#move-ok") as HTMLButtonElement).click();
  await a.settle();
  const built = (await views(a.doc())).get(cube)!;
  const target = scene.bodies[big].view;
  const [n, t] = [built.face_normals[faceWith(built, "bottom")]!, target.face_normals[faceWith(target, "top")]!];
  // Rounded to 1e-6° as a typed box is, the faces would be up to 1.7e-8 rad apart: a 1 m face's far side 1.7e-5 mm
  // off the other's plane, past LINEAR, so Combine would not see them as one plane. Kept whole, they agree to rounding.
  const apart = Math.hypot(n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]);
  assert.ok(apart < 1e-12 && n[0] * t[0] + n[1] * t[1] + n[2] * t[2] < 0, `normals ${JSON.stringify(n)} and ${JSON.stringify(t)}: sine ${apart}`);
  near(built.face_centroids[faceWith(built, "bottom")], target.face_centroids[faceWith(target, "top")], "centre on centre");
});

test("seeded: random faces and edges of random bodies snapped, the Move built by the kernel, land where the target is (FISSION_SEED)", async () => {
  const seed = BigInt(process.env.FISSION_SEED ?? "352");
  const r = seeded(seed);
  const pick = (n: number) => Math.floor(r.next() * n);
  const reached = { face: 0, line: 0, circle: 0, turned: 0 };
  for (let n = 0; n < 60; n++) {
    // The target, then the body moved, each a box or cylinder of random size; the moved one already turned at random.
    // Straight edges are on boxes only and round edges on cylinders only, so the kind of part is chosen first.
    const kind = (["face", "line", "circle"] as const)[n % 3];
    const shape = () => (kind === "line" ? "box" : kind === "circle" ? "cylinder" : pick(2) === 0 ? "box" : "cylinder");
    const kinds = [shape(), shape()] as const;
    const size = () => [1 + pick(60), 1 + pick(60), 1 + pick(60)] as const;
    let doc = partDocument(kinds[0], ...size());
    const placed = insertPreset(doc, kinds[1], ...size());
    doc = insertMove(placed.doc, ["feature-1"], v({ turnX: 15 * (pick(25) - 12), turnZ: 15 * (pick(25) - 12), x: pick(200) - 100, pivotZ: pick(50) })).doc;
    const moved = placed.id;
    const seen = await views(doc);
    const [target, body] = [seen.get("feature-1")!, seen.get(moved)!];
    // A part of each that snaps, of one kind: a flat face, a straight edge or a round edge.
    const parts = (view: BodyView, kind: "face" | "edge") =>
      Array.from({ length: kind === "face" ? view.faces : view.edges }, (_, i) => snapPart(view, kind, i))
        .map((p, index) => ({ p, index }))
        .filter((x): x is { p: { part: SnapPart }; index: number } => "part" in x.p);
    const of = (view: BodyView) => parts(view, kind === "face" ? "face" : "edge").filter((x) => x.p.part.kind === kind);
    const [froms, tos] = [of(body), of(target)];
    if (froms.length === 0 || tos.length === 0) continue;
    const from = froms[pick(froms.length)];
    const to = tos[pick(tos.length)];
    const start = v({ turnX: pick(2) ? 0 : pick(360) - 180, turnY: pick(2) ? 0 : 90 * (pick(4) - 2), turnZ: pick(360) - 180, pivotX: pick(40), pivotY: pick(40), pivotZ: pick(40), y: pick(40) });
    if (start.turnX || start.turnY || start.turnZ) reached.turned++;
    const got = snappedValues(start, from.p.part, to.p.part);
    assert.ok("values" in got, JSON.stringify(got));
    const after = (await views(insertMove(doc, [moved], got.values).doc)).get(moved)!;
    const landed = snapPart(after, kind === "face" ? "face" : "edge", from.index);
    assert.ok("part" in landed);
    const what = `seed ${seed} case ${n} (${kinds.join(" under ")}, ${kind} ${from.index} on ${to.index}; FISSION_SEED=${seed} to replay)`;
    near(landed.part.point, to.p.part.point, `${what}: point`);
    const dir = (p: SnapPart) => (p.kind === "line" ? p.direction : p.normal);
    const [d, t] = [dir(landed.part), dir(to.p.part)];
    const along = d[0] * t[0] + d[1] * t[1] + d[2] * t[2];
    // Faces and round edges face each other; straight edges lie along one line, either way.
    assert.ok(kind === "line" ? Math.abs(Math.abs(along) - 1) < 1e-9 : Math.abs(along + 1) < 1e-9, `${what}: directions ${JSON.stringify(d)} and ${JSON.stringify(t)}`);
    reached[kind]++;
  }
  assert.ok(reached.face === 20 && reached.line === 20 && reached.circle === 20 && reached.turned >= 30, JSON.stringify(reached));
});

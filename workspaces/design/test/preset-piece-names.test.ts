// Face hunt 11-01, bug 1: a ready-made profile's sides were named by piece
// number alone ("side:piece-2"), the same names for every profile shape, so
// a preset's Shape changed from L-bracket to Star moved a sketch on piece 2
// (and pins and projected edges on it) onto the star's piece 2, a slanted
// side, with no warning. From Design data version 7 the name says the shape
// ("side:l-bracket-piece-2"): another shape is another face, held with the
// plane-lost words (the naming model's rules 1 and 6). Version 6 and older
// files are read into the new names by the preset's shape in the file, so
// they open exactly as before. On the real kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson, type BodyView, type Outline } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { changePreset, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { addFaceSketch, drawCircle, pinNewPoints, projectEdges } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { drawnFrame, facePlane } from "../src/face-sketch.ts";
import { faceEdgeTargets } from "../src/face-edges.ts";
import { projectPick } from "../src/projection.ts";
import { outlineCurves } from "../src/naming.ts";
import { outline } from "../src/profiles.ts";
import { BodyCache, builtBody, rebuildTimeline, settleKept } from "../src/rebuild.ts";
import { joinBodies, shownBodies } from "../src/scene.ts";

const kernel = nodeKernel();
const DESIGN = [{ id: "design" as const, readData: readDesignDocument }];

/** Every item's result, every body's view by item id, and the scene, from one rebuild on a cache of its own. */
async function build(doc: DesignDocument) {
  const cache = new BodyCache(kernel);
  try {
    const b = await rebuildTimeline(doc, cache, kernel);
    const views: Record<string, BodyView> = {};
    for (const id of Object.keys(b.results)) {
      const body = builtBody(b, id);
      if (body) views[id] = (await cache.view(body.handle))!;
    }
    return { results: b.results as Record<string, Record<string, unknown>>, views, scene: joinBodies(await shownBodies(doc, b, cache)) };
  } finally {
    await cache.clear();
  }
}

// The L-bracket 40 × 30 × 20: outline (0, 0) (40, 0) (40, 9) (12, 9) (12, 30) (0, 30), arms 0.3 of the width and depth
// thick (profiles.ts), piece k from corner k to corner k + 1. Piece 2 runs (40, 9) → (12, 9): the inner side of the long
// arm, the plane y = 9, the solid below it (y < 9), so it looks along +y. Rule 8 frames it with XZ (normal −Y, the plane
// most nearly parallel), on the side opposite its outward normal: frame normal (0, −1, 0), origin where the world's origin
// meets y = 9, (0, 9, 0); sketch (x, y) is world (x, 9, y).
const SIDE = facePlane("feature-1", "side:l-bracket-piece-2");
const OLD_SIDE = facePlane("feature-1", "side:piece-2");
const onSide = (doc: DesignDocument, plane = SIDE) => addFaceSketch(doc, { plane, feature: "feature-1" }, drawnFrame([0, 1, 0], [26, 9, 10]));
/** A circle of radius 2 round sketch (26, 10), world (26, 9, 10), extruded 5 out of the face: x 24 to 28, y 9 to 14, z 8 to 12. */
const CYLINDER = [[24, 9, 8], [28, 14, 12]];
const near = (got: number[][], want: number[][], what: string) => got.forEach((row, i) => row.forEach((x, j) => assert.ok(Math.abs(x - want[i][j]) <= 1e-9, `${what}: ${JSON.stringify(got)} want ${JSON.stringify(want)}`)));

test("hand-worked: a ready-made profile's sides and holes are named with its shape; an outline no preset makes, not at all", () => {
  // Pieces numbered as the profile gives them, a hole's with its loop (1 for the first hole), the shape before the number.
  assert.deepEqual([0, 2, 5].map((k) => outlineCurves(outline("l-bracket", 40, 30))(0, k)), ["l-bracket-piece-0", "l-bracket-piece-2", "l-bracket-piece-5"]);
  assert.deepEqual([outlineCurves(outline("plate", 40, 30))(0, 3), outlineCurves(outline("plate", 40, 30))(2, 0)], ["plate-piece-3", "plate-hole-2-piece-0"]);
  assert.equal(outlineCurves(outline("slot", 40, 30))(0, 1), "slot-piece-1");
  assert.equal(outlineCurves(outline("star", 40, 30))(0, 9), "star-piece-9");
  // The same shapes at other sizes are the same shapes.
  assert.equal(outlineCurves(outline("star", 7, 300))(0, 4), "star-piece-4");
  assert.equal(outlineCurves(outline("plate", 300, 7))(1, 0), "plate-hole-1-piece-0");
  // A loop of three corners, or a square with one hole: no preset's, so nothing to name it by (never a guess).
  const triangle: Outline = { outer: { path: { corners: [0, 0, 1, 0, 0, 1], bulges: [] } }, holes: [] };
  assert.equal(outlineCurves(triangle)(0, 0), null);
  const oneHole: Outline = { ...outline("plate", 40, 30), holes: outline("plate", 40, 30).holes.slice(0, 1) };
  assert.equal(outlineCurves(oneHole)(0, 0), null);
  // A slot's arcs turning the other way, or a six-corner loop with an arc: not the slot's or the L-bracket's.
  const slotBack: Outline = { outer: { path: { corners: [15, 0, 25, 0, 25, 30, 15, 30], bulges: [0, -1, 0, -1] } }, holes: [] };
  assert.equal(outlineCurves(slotBack)(0, 0), null);
  const bent: Outline = { outer: { path: { corners: [0, 0, 40, 0, 40, 9, 12, 9, 12, 30, 0, 30], bulges: [0, 0.5, 0, 0, 0, 0] } }, holes: [] };
  assert.equal(outlineCurves(bent)(0, 0), null);
});

test("regression (face hunt 11-01): an L-bracket made a Star holds a sketch on its inner side with the plane-lost words, never moving it onto the star's slanted side; made an L-bracket again, it is found", async () => {
  const base = partDocument("l-bracket", 40, 30, 20);
  const made = onSide(base);
  const e = extrudeSketch(drawCircle(made.doc, made.id, [26, 10], 2).doc, made.id, 5);
  let doc = await settleKept(kernel, base, e.doc);
  const first = await build(doc);
  assert.equal(first.results[made.id].plane, undefined);
  near(first.views[e.id].bounds, CYLINDER, "on the L-bracket");
  // A Star: no "l-bracket" side, so the sketch's face is gone. It stays where it was, frame and all, and says so; its
  // extrude is built there with "source lost".
  doc = await settleKept(kernel, doc, changePreset(doc, "feature-1", "star", 40, 30, 20));
  const star = await build(doc);
  const s = star.results[made.id] as { plane?: unknown; placement: { plane: { origin: number[]; normal: number[] } } };
  assert.deepEqual(s.plane, { cause: "plane-lost", face: SIDE, message: "Sketch 1's face is gone, so its plane is lost: it stays where it was" });
  assert.deepEqual([s.placement.plane.origin, s.placement.plane.normal], [[0, 9, 0], [0, -1, 0]]);
  assert.equal((star.results[e.id].source as { cause: string }).cause, "plane-lost");
  near(star.views[e.id].bounds, CYLINDER, "held on a star");
  // Back to an L-bracket: the name finds its side again, so the sketch follows it (no warning) where it was.
  doc = await settleKept(kernel, doc, changePreset(doc, "feature-1", "l-bracket", 40, 30, 20));
  const back = await build(doc);
  assert.equal(back.results[made.id].plane, undefined);
  assert.equal(back.results[e.id].source, undefined);
  near(back.views[e.id].bounds, CYLINDER, "back on the L-bracket");
});

/**
 * The design of the old-file test as today's app makes it: a sketch on piece 2 with a circle round the corner (12, 20)
 * pinned there (sketch (12, 20) is world (12, 9, 20): where pieces 2 and 3 meet the top), the top edge of the side
 * projected (world (40, 9, 20) to (12, 9, 20), sketch (40, 20) and (12, 20)), extruded 5.
 */
async function pinnedAndProjected() {
  const base = partDocument("l-bracket", 40, 30, 20);
  const made = onSide(base);
  const one = await build(made.doc);
  const view = one.views["feature-1"];
  const f = one.scene.bodies[0].names.faces.indexOf("side:l-bracket-piece-2");
  const plane = drawnFrame([0, 1, 0], [26, 9, 10]).plane;
  const corner = faceEdgeTargets(view, one.scene.bodies[0].names, f, plane).filter((t) => t.kind === "endpoint" && t.at[0] === 12 && t.at[1] === 20);
  assert.equal(corner.length, 1, "one corner at sketch (12, 20)");
  const circled = pinNewPoints(made.doc, drawCircle(made.doc, made.id, [12, 20], 2).doc, made.id, corner);
  const top = projectPick(circled, made.id, one.scene, plane, { face: one.scene.faceStart[0] + f }).edges.filter((x) => x.shape.kind === "line" && x.edge.includes("end"));
  assert.equal(top.length, 1, "the side's top edge");
  const e = extrudeSketch(projectEdges(circled, made.id, top).doc, made.id, 5);
  return { doc: await settleKept(kernel, base, e.doc), sketch: made.id, extrude: e.id };
}

test("an old file (version 6) naming the L-bracket's side, a pin and a projected edge by piece number alone opens on the same face, pin and edge", async () => {
  const today = await pinnedAndProjected();
  const sketch = today.doc.sketches.find((s) => s.id === today.sketch)!;
  const [pin, projected] = [sketch.pins![0], sketch.projected![0]];
  // Today's names say the shape; the same file as version 6 wrote it says the piece alone.
  assert.ok(pin.name.includes("side:l-bracket-piece-2") && pin.name.includes("side:l-bracket-piece-3"), pin.name);
  assert.ok(projected.edge.includes("side:l-bracket-piece-2"), projected.edge);
  const json = projectToJson({ ...emptyProject(), workspaces: { design: today.doc } });
  assert.ok(json.includes('"version": 7') || json.includes('"version":7'), "saved as version 7");
  const old = json.replaceAll("l-bracket-piece-", "piece-").replace(/"version": ?7/, '"version": 6');
  assert.ok(old.includes(JSON.stringify(OLD_SIDE)) && !old.includes("l-bracket-piece"), "every name as version 6 wrote it");
  // Opened: version 7, every name as today writes it, so it is the design saved, exactly.
  const opened = projectFromJson(old, DESIGN).workspaces.design as DesignDocument;
  assert.equal(opened.version, 7);
  assert.deepEqual(opened, readDesignDocument(today.doc));
  // And it builds as before: the sketch on the side, its pin and projection found, the extrude where it was.
  const a = await build(today.doc);
  const b = await build(opened);
  for (const key of ["plane", "points", "projections"]) assert.equal(b.results[today.sketch][key], undefined, key);
  assert.deepEqual(b.views[today.extrude].bounds, a.views[today.extrude].bounds);
});

test("an old file's plate hole names are read with their own shapes; sketch extrudes, boxes and version 7 names are left as they are", () => {
  const plate = partDocument("plate", 40, 30, 20);
  const onPlate = addFaceSketch(plate, { plane: facePlane("feature-1", "end"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  // A hand-made version 6 file: a projection of the plate's first hole's top edge (centre (10, 15), radius 0.15 × 30 = 4.5).
  const file = (version: number, edge: string) => ({
    ...onPlate.doc,
    version,
    nextId: 10,
    sketches: onPlate.doc.sketches.map((s) => ({ ...s, points: [{ id: "point-5", x: 10, y: 15 }], curves: [{ id: "circle-6", kind: "circle", centre: "point-5", radius: 4.5 }], projected: [{ id: "projection-4", feature: "feature-1", edge, made: "circle-6" }] })),
  });
  const v6 = readDesignDocument(file(6, "end+side:hole-1-piece-0"));
  assert.equal(v6.sketches[0].projected![0].edge, "end+side:plate-hole-1-piece-0");
  // Version 7 data is today's: a name in it is read as it is, even one of the old form (it finds nothing: plane-lost words).
  assert.equal(readDesignDocument(file(7, "end+side:hole-1-piece-0")).sketches[0].projected![0].edge, "end+side:hole-1-piece-0");
  // Version 8 is newer than this SpindleLabs.
  assert.throws(() => readDesignDocument(file(8, "end+side:hole-1-piece-0")), { message: "Design data version 8 is not one this SpindleLabs reads (1, 2, 3, 4, 5, 6 or 7)" });
  // A box's names have no pieces; a sketch's extrude's are its curve ids, which never say "piece": both kept.
  const box = addFaceSketch(partDocument("box", 40, 30, 20), { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  assert.deepEqual(readDesignDocument({ ...box.doc, version: 6 }), box.doc);
});

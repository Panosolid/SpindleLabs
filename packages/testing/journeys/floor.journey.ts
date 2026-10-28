// Journey: inserted shapes rest on the XY floor (Ben, 2026-10-28), on the
// real WASM kernel. Every preset, inserted at the panel's 40 × 30 × 20,
// starts with its lowest point at z = 0. A sphere, which the kernel builds
// round the origin, is lifted by its radius and keeps that centre: a later
// size change grows it about its centre, below the floor if it is bigger,
// and nothing snaps it back. A sphere saved before keeps its place. Run
// with `npm run journeys` after the app build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BodyCache, buildSpec, changePreset, insertPreset, partDocument, readDesignDocument, rebuildTimeline, SHAPES, specOf, type DesignDocument } from "@fission/design";
import { nodeKernel } from "../src/node-kernel.ts";

const LINEAR = 1e-5;
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= LINEAR, `${what}: ${a}, expected ${b}`);

/** Each solid feature's body bounds, built the way the app builds the timeline. */
async function bounds(doc: DesignDocument): Promise<Map<string, [number[], number[]]>> {
  const kernel = nodeKernel();
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const out = new Map<string, [number[], number[]]>();
    for (const [id, r] of Object.entries(build.results)) {
      if (r.status !== "built" || r.body === undefined) continue;
      const v = await cache.view(r.body);
      assert.ok(v, `${id} has a view`);
      out.set(id, [v.bounds[0], v.bounds[1]]);
    }
    return out;
  } finally {
    await cache.close();
  }
}

test("every preset inserted rests on the floor", async () => {
  let doc: DesignDocument = { version: 3, nextId: 1, profiles: [], sketches: [], timeline: { features: [] } };
  const ids: string[] = [];
  for (const kind of SHAPES) {
    const made = insertPreset(doc, kind, 40, 30, 20);
    doc = made.doc;
    ids.push(made.id);
  }
  const b = await bounds(doc);
  for (const [i, kind] of SHAPES.entries()) {
    const [lo, hi] = b.get(ids[i])!;
    near(lo[2], 0, `${kind}'s lowest point`);
    assert.ok(hi[2] > 0, `${kind} stands up from the floor`);
  }
  // The sphere by hand: ⌀40, so radius 20, lifted 20: z 0..40, and still
  // centred over the origin, x and y −20..20.
  const [lo, hi] = b.get(ids[SHAPES.indexOf("sphere")])!;
  near(hi[2], 40, "sphere's top");
  near(lo[0], -20, "sphere's left");
  near(hi[1], 20, "sphere's back");
});

test("a sphere made bigger grows about its centre, below the floor, and is never snapped back", async () => {
  const doc = partDocument("sphere", 40, 30, 20);
  // ⌀40 → ⌀60: the centre stays 20 up, the radius is 30, so z 20 − 30 = −10 to 20 + 30 = 50.
  const bigger = changePreset(doc, "feature-1", "sphere", 60, 30, 20);
  const [lo, hi] = (await bounds(bigger)).get("feature-1")!;
  near(lo[2], -10, "bigger sphere's bottom, 10 below the floor");
  near(hi[2], 50, "bigger sphere's top");
  // ⌀40 → ⌀10: radius 5 about 20 up, z 15..25, floating.
  const [lo2, hi2] = (await bounds(changePreset(doc, "feature-1", "sphere", 10, 30, 20))).get("feature-1")!;
  near(lo2[2], 15, "smaller sphere's bottom");
  near(hi2[2], 25, "smaller sphere's top");
});

test("a box made a sphere rests on the floor as a new sphere would", async () => {
  // A 40 × 30 × 20 box changed to a sphere ⌀50: lifted by its radius 25, z 0..50.
  const doc = changePreset(partDocument("box", 40, 30, 20), "feature-1", "sphere", 50, 30, 20);
  const [lo, hi] = (await bounds(doc)).get("feature-1")!;
  near(lo[2], 0, "bottom");
  near(hi[2], 50, "top");
});

test("a sphere saved before floors existed stays round the origin, and keeps doing so when resized", async () => {
  const old = readDesignDocument({
    version: 3,
    nextId: 2,
    profiles: [],
    sketches: [],
    timeline: { features: [{ id: "feature-1", intent: { type: "sphere", parameters: { diameter: 40 }, summary: "Sphere: ⌀40 mm" }, provenance: { self: { workspace: "design", id: "feature-1", label: "Sphere 1" }, from: [] }, dependsOn: [], suppressed: false }] },
  });
  // Unchanged: radius 20 round the origin, z −20..20, the spec it always had.
  assert.deepEqual(specOf(old, old.timeline.features[0]), { sphere: { radius: 20 } });
  const [lo, hi] = (await bounds(old)).get("feature-1")!;
  near(lo[2], -20, "old sphere's bottom");
  near(hi[2], 20, "old sphere's top");
  // Resized, it still has no centre: ⌀30 round the origin.
  assert.deepEqual(changePreset(old, "feature-1", "sphere", 30, 30, 20).timeline.features[0].intent.parameters, { diameter: 30 });
});

test("a moved body's one-shot view (buildSpec) is the stored one, and frees what it built", async () => {
  const kernel = nodeKernel();
  const spec = specOf(partDocument("sphere", 40, 30, 20), partDocument("sphere", 40, 30, 20).timeline.features[0]);
  const before = (await kernel.call("body_count")) as number;
  const v = await buildSpec(kernel, spec);
  near(v.bounds[0][2], 0, "bottom");
  near(v.bounds[1][2], 40, "top");
  // 4/3 · π · 20³ = 32000π/3, wherever it is.
  assert.ok(Math.abs(v.volume - (32000 * Math.PI) / 3) <= 1e-9 * v.volume, `${v.volume}`);
  assert.equal(await kernel.call("body_count"), before, "nothing left held");
});

test("a sphere's centre that isn't a number is refused by name when the file is read", () => {
  const file = (centreZ: unknown) => ({
    version: 3,
    nextId: 2,
    profiles: [],
    sketches: [],
    timeline: { features: [{ id: "feature-1", intent: { type: "sphere", parameters: { diameter: 40, centreZ }, summary: "Sphere: ⌀40 mm" }, provenance: { self: { workspace: "design", id: "feature-1", label: "Sphere 1" }, from: [] }, dependsOn: [], suppressed: false }] },
  });
  assert.throws(() => readDesignDocument(file("20")), { message: "Sphere: ⌀40 mm: centreZ 20 is not a number of mm" });
  assert.throws(() => readDesignDocument(file(null)), { message: "Sphere: ⌀40 mm: centreZ null is not a number of mm" });
  assert.throws(() => readDesignDocument(file(Infinity)), { message: "Sphere: ⌀40 mm: centreZ Infinity is not a number of mm" });
  assert.equal(readDesignDocument(file(-3)).timeline.features[0].intent.parameters.centreZ, -3);
});

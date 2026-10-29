// The soak test's model of the design (soak.mjs): what each cycle built,
// worked out by hand from the sizes the seed chose, and the facts read back
// from the app to compare with it. Every body the soak makes is a box (an
// extruded rectangle, or the Box preset with its width typed), so its
// volume is width × depth × height, its mesh 12 triangles (6 faces, 2 each),
// and since every body starts on the ground, its bottom is at the height
// the Move lifted it to and its top that plus its height. The app's facts
// come from its exported STL (triangles, volume, bounds), its timeline and
// the Browser's bodies; `sameState` compares two readings of the app
// (the long-running page and a fresh page that opened its file), and
// `matchesModel` compares one with the model.

/**
 * Volume compared to this fraction of the expected one. The STL stores
 * float32 corners (24-bit mantissa, a relative error of 6e-8 each); the
 * volume is a sum over triangles of corner · (corner × corner) / 6, terms as
 * big as |corner| × a face's area, and the soak's bodies sit within about
 * 200 mm of the origin while 10 mm across at least, so the error stays
 * below about 20 × 3 × 6e-8 ≈ 4e-6 of the volume. 1e-5 leaves room for that;
 * a body 1 mm short in a 40 mm side is 2.5e-2 off.
 */
export const VOLUME_TOL = 1e-5;
/** Bounds compared to this, in mm (the move test's tolerance, e2e/move.mjs). */
export const BOUNDS_TOL = 1e-3;

/** Triangles, volume (divergence theorem) and bounds [[minX, maxX], [minY, maxY], [minZ, maxZ]] of a binary STL in `bytes` (a Buffer). */
export function stlFacts(bytes) {
  const triangles = bytes.readUInt32LE(80);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let six = 0;
  for (let t = 0; t < triangles; t++) {
    const v = [0, 1, 2].map((k) => [0, 1, 2].map((i) => bytes.readFloatLE(84 + 50 * t + 12 + 12 * k + 4 * i)));
    for (const p of v) for (let i = 0; i < 3; i++) [lo[i], hi[i]] = [Math.min(lo[i], p[i]), Math.max(hi[i], p[i])];
    const [a, b, c] = v;
    six += a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return { triangles, volume: six / 6, bounds: [0, 1, 2].map((i) => [lo[i], hi[i]]) };
}

/** What the model says the design is: bodies, triangles, volume and the height range, from `bodies` ({ w, d, h, z }: sizes in mm, z its bottom). */
export function expected(bodies) {
  return {
    bodies: bodies.length,
    triangles: 12 * bodies.length,
    volume: bodies.reduce((s, b) => s + b.w * b.d * b.h, 0),
    z: [Math.min(...bodies.map((b) => b.z)), Math.max(...bodies.map((b) => b.z + b.h))],
  };
}

const volumeOff = (got, want) => Math.abs(got - want) > VOLUME_TOL * Math.abs(want);
const fmt = (x) => Number(x.toFixed(6)).toLocaleString("en");

/** Problems, in words, where `state` ({ stl: stlFacts, items: [timeline titles], bodies: the Browser's, kernel: the kernel's shapes }) differs from the model `want` (expected) with `items` timeline items. */
export function matchesModel(state, want, items) {
  const problems = [];
  if (state.stl.triangles !== want.triangles) problems.push(`the STL has ${state.stl.triangles} triangles, the model ${want.triangles}`);
  if (volumeOff(state.stl.volume, want.volume)) problems.push(`the STL's volume is ${fmt(state.stl.volume)} mm³, the model's ${fmt(want.volume)} mm³`);
  const z = state.stl.bounds[2];
  if (Math.abs(z[0] - want.z[0]) > BOUNDS_TOL || Math.abs(z[1] - want.z[1]) > BOUNDS_TOL) problems.push(`the STL spans z ${fmt(z[0])}..${fmt(z[1])}, the model ${fmt(want.z[0])}..${fmt(want.z[1])}`);
  if (state.bodies !== want.bodies) problems.push(`the Browser lists ${state.bodies} bodies, the model ${want.bodies}`);
  if (state.items.length !== items) problems.push(`the timeline has ${state.items.length} items, the model ${items}`);
  return problems;
}

/** Problems, in words, where state `b` (named `what`) differs from state `a`: the timeline exactly, the Browser's bodies, the kernel's shapes, the STL's triangles, volume and bounds. */
export function sameState(a, b, what) {
  const problems = [];
  if (JSON.stringify(a.items) !== JSON.stringify(b.items)) problems.push(`${what}: the timeline is ${JSON.stringify(b.items)}, was ${JSON.stringify(a.items)}`);
  if (a.bodies !== b.bodies) problems.push(`${what}: the Browser lists ${b.bodies} bodies, was ${a.bodies}`);
  if (a.kernel !== b.kernel) problems.push(`${what}: the kernel holds ${b.kernel} shapes, was ${a.kernel}`);
  if (a.stl.triangles !== b.stl.triangles) problems.push(`${what}: the STL has ${b.stl.triangles} triangles, was ${a.stl.triangles}`);
  if (volumeOff(b.stl.volume, a.stl.volume)) problems.push(`${what}: the STL's volume is ${fmt(b.stl.volume)} mm³, was ${fmt(a.stl.volume)} mm³`);
  const off = a.stl.bounds.flat().findIndex((x, i) => Math.abs(x - b.stl.bounds.flat()[i]) > BOUNDS_TOL);
  if (off >= 0) problems.push(`${what}: the STL's bounds are ${JSON.stringify(b.stl.bounds.map((r) => r.map(fmt)))}, were ${JSON.stringify(a.stl.bounds.map((r) => r.map(fmt)))}`);
  return problems;
}

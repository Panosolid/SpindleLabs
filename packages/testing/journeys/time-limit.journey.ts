// The kernel calls' time limits on the real WASM kernel (step 35d3): the
// calibration boolean timed as the worker times it, then legal calls of
// every kind that has a size, each taking less than its units times the
// calibration with no headroom at all (the limit gives four times that), so
// no legal call is failed by its limit on a device whose calibration runs
// as fast as its other calls. And the store calls the limits read, on the
// real kernel: body_boolean of the calibration cubes by hand, body_hide.
// Run with `npm run journeys`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KernelError, type BodySpec, type Outline } from "@fission/core";
import { calibrate, CALIBRATION_TARGET, CALIBRATION_TOOL, callUnits, facesSize, builtSize, HEADROOM, type BodySize } from "../../core/src/kernel/time-limit.ts";
import { entry } from "../../core/src/kernel/entry-points.ts";
import { loadKernel, nodeKernel } from "../src/node-kernel.ts";

loadKernel();
const calls = { build: (spec: BodySpec) => entry.body_build(spec), boolean: entry.body_boolean, free: entry.body_free, now: () => performance.now() };

const rect = (x0: number, y0: number, x1: number, y1: number) => ({ path: { corners: [x0, y0, x1, y0, x1, y1, x0, y1], bulges: [] } });

/** A 100 mm square plate 2 mm thick with `n` slots along x (the kernel's costliest legal boolean is two of these crossed, at 111 slots): 6 + 4n faces. */
function grating(n: number): BodySpec {
  const pitch = 98 / n;
  const holes = Array.from({ length: n }, (_, k) => rect(1, 1 + k * pitch, 99, 1 + k * pitch + pitch / 2));
  return { extrude: { profile: { outer: rect(0, 0, 100, 100), holes }, distance: 2 } };
}

/** How long `f` takes, in ms. */
function timed<T>(f: () => T): [number, T] {
  const start = performance.now();
  const out = f();
  return [performance.now() - start, out];
}

test("the calibration times the cubes' boolean on this machine and keeps nothing", () => {
  const before = entry.body_count();
  const unitMs = calibrate(calls);
  assert.ok(unitMs > 0 && Number.isFinite(unitMs), `${unitMs}`);
  assert.equal(entry.body_count(), before);
});

test("legal calls of each size take less than their units × the calibration, with no headroom", () => {
  // The calibration taken twice, the faster kept: what a device that isn't busy measures.
  const unitMs = Math.min(calibrate(calls), calibrate(calls));
  const check = (what: string, units: number, ms: number) => {
    assert.ok(ms < units * unitMs, `${what}: ${ms.toFixed(0)} ms, ${units.toFixed(0)} units × ${unitMs.toFixed(3)} ms = ${(units * unitMs).toFixed(0)} ms`);
    console.log(`${what}: ${ms.toFixed(0)} ms of ${(units * unitMs).toFixed(0)} (limit ${(units * unitMs * HEADROOM).toFixed(0)})`);
  };
  // A boolean: 40-slot gratings crossed (166 faces each, 27,556 pairs).
  const plate = grating(40);
  const crossed: BodySpec = { moved: { body: plate, moves: [{ turn: { pivot: [0, 0, 0], axis: [0, 0, 1], angle: Math.PI / 2 } }, { move: [100.05, 0.05, 1] }] } };
  const sizes = new Map<number, BodySize>();
  const [buildMs, a] = timed(() => entry.body_build(plate));
  check("a 162-corner plate built", callUnits("body_build", [plate], () => undefined), buildMs);
  const b = entry.body_build(crossed);
  sizes.set(a, builtSize(plate));
  sizes.set(b, builtSize(crossed));
  for (const op of ["union", "subtract", "intersect"] as const) {
    const [ms, out] = timed(() => entry.body_boolean(a, [b], op));
    check(`gratings ${op}`, callUnits("body_boolean", [a, [b], op], (h) => sizes.get(h)), ms);
    // Each result shown again after hiding: its mesh made anew, timed by its faces.
    const piece = out.bodies[0];
    entry.body_hide(piece);
    const [viewMs] = timed(() => entry.body_view(piece));
    check(`gratings ${op}, its first piece shown again`, facesSize(out.history[0].faces.length).mesh, viewMs);
    out.bodies.forEach((p) => entry.body_free(p));
  }
  // The STL of the plate, sliced at 0.2 mm (10 layers).
  const stl = entry.body_stl(a, "plate").bytes;
  const [sliceMs] = timed(() => entry.slice_stl(stl, 0.2, 3, 15, "off"));
  check("the plate sliced", callUnits("slice_stl", [stl, 0.2, 3, 15, "off"], () => undefined), sliceMs);
  entry.body_free(a);
  entry.body_free(b);
  // A 300-hole plate (304 corners), built with its view: make_extrude.
  const side = 18;
  const holes = Array.from({ length: 300 }, (_, k) => ({ circle: { center: [((k % side) + 0.5) * 5000, (Math.floor(k / side) + 0.5) * 5000] as [number, number], radius: 1500 } }));
  const profile: Outline = { outer: rect(0, 0, 90_000, 90_000), holes };
  const [extrudeMs] = timed(() => entry.make_extrude(profile, 1000));
  check("a 300-hole plate extruded", callUnits("make_extrude", [profile, 1000], () => undefined), extrudeMs);
  // A 500 mm sphere hidden, then shown: its mesh at the most chords.
  const sphere: BodySpec = { sphere: { radius: 500 } };
  const ball = entry.body_build(sphere);
  entry.body_hide(ball);
  const [ballMs] = timed(() => entry.body_view(ball));
  check("a 500 mm sphere shown again", builtSize(sphere).mesh, ballMs);
  entry.body_free(ball);
  // A sketch of 1,000 lines round a circle.
  const lines = Array.from({ length: 1000 }, (_, k) => {
    const at = (j: number): [number, number] => [100 * Math.cos((2 * Math.PI * j) / 1000), 100 * Math.sin((2 * Math.PI * j) / 1000)];
    return { a: at(k), b: at(k + 1) };
  });
  const [sketchMs] = timed(() => entry.sketch_outline(lines, [], []));
  check("a 1,000-line sketch", callUnits("sketch_outline", [lines, [], []], () => undefined), sketchMs);
});

test("the calibration cubes joined by hand, through the app's handles; hidden bodies shown again the same", async () => {
  const kernel = nodeKernel();
  const before = await kernel.call("body_count");
  const target = await kernel.call("body_build", CALIBRATION_TARGET);
  const tool = await kernel.call("body_build", CALIBRATION_TOOL);
  const shown = await kernel.call("body_view", target);
  // Two 10 mm cubes overlapping in a 5 mm cube: 1,000 + 1,000 − 125 = 1,875 mm³; each keeps 3 faces whole and
  // 3 cut down to L shapes, so the union has 6 + 6 = 12 faces.
  const joined = await kernel.call("body_boolean", target, [tool], "union");
  assert.equal(joined.bodies.length, 1);
  const view = await kernel.call("body_view", joined.bodies[0]);
  assert.ok(Math.abs(view.volume - 1875) < 1e-9 * 1875, `${view.volume}`);
  assert.equal(view.faces, 12);
  assert.equal(joined.history[0].faces.length, 12);
  assert.deepEqual(new Set(joined.history[0].faces.map((f) => f.body)), new Set([target, tool]));
  assert.equal(joined.history[0].faces.filter((f) => f.whole).length, 6, "3 whole faces from each cube");
  // Hidden, the target is shown again bit for bit; hiding twice is fine.
  await kernel.call("body_hide", target);
  await kernel.call("body_hide", target);
  assert.deepEqual(await kernel.call("body_view", target), shown);
  // The cubes are left as they were: the subtract by hand, 1,000 − 125 = 875 mm³.
  const cut = await kernel.call("body_boolean", target, [tool], "subtract");
  assert.ok(Math.abs((await kernel.call("body_view", cut.bodies[0])).volume - 875) < 1e-9 * 875);
  // A body can't be its own tool; an unknown handle is refused by kind.
  await assert.rejects(kernel.call("body_boolean", target, [target], "union"), (e: KernelError) => e.kind === "invalid-input");
  await assert.rejects(kernel.call("body_hide", 999_999), (e: KernelError) => e.kind === "unknown-body");
  for (const body of [target, tool, ...joined.bodies, ...cut.bodies]) await kernel.call("body_free", body);
  assert.equal(await kernel.call("body_count"), before);
});

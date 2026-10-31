// Step 35ec2/35ec3 test helpers: a test-only Combine on the real kernel
// (no button until 35f), blocks built as Design builds them, and seeded
// sessions of blocks and Combines the naming model can answer.

import assert from "node:assert/strict";
import { KernelError, type BodyView, type BooleanOp, type BooleanResult, type KernelCalls } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { seeded } from "../../../packages/testing/src/index.ts";
import { rebuildBooleans, type BlockFeature, type BooleanFeature } from "../../../packages/testing/src/boolean-naming-model.ts";
import { featureNames, type BodyNames } from "../src/naming.ts";
import { plainOutline } from "../src/sketch.ts";
import { combineNames, featureBody, type NamedBody } from "../src/boolean-names.ts";

export const kernel: KernelCalls = nodeKernel();
export const OPS: Record<"join" | "cut" | "intersect", BooleanOp> = { join: "union", cut: "subtract", intersect: "intersect" };

/** A block as Design builds it: a rectangle of four lines (line-1 along −y, then round counter-clockwise) extruded on XY from z0. */
export async function buildBlock(f: BlockFeature, place: number): Promise<NamedBody & { names: BodyNames }> {
  const [x0, y0, x1, y1] = f.rect;
  const c: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const lines = c.map((a, i) => ({ a, b: c[(i + 1) % 4] }));
  const out = plainOutline(await kernel.call("sketch_outline", lines, [], []));
  assert.ok("closed" in out, "a block's rectangle closes");
  const profile = out.closed;
  const spec = { extrude: { profile, distance: f.z[1] - f.z[0], frame: { origin: [0, 0, f.z[0]] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] } } };
  const handle = await kernel.call("body_build", spec);
  const view = await kernel.call("body_view", handle);
  const ids = f.lines ?? ["line-1", "line-2", "line-3", "line-4"];
  const names = featureNames(f.id, { spec, curves: { line: [...ids], arc: [], circle: [] } }, view);
  return { ...featureBody(`body:${f.id}`, handle, view, names, place), names };
}

/** What `Combine` runs in combineNames: the kernel's boolean and each result body's view. */
export type Run = (target: NamedBody, tools: readonly NamedBody[], op: BooleanOp) => Promise<{ result: BooleanResult; views: BodyView[] }>;
export const onKernel: Run = async (target, tools, op) => {
  const result = await kernel.call("body_boolean", target.handle, tools.map((t) => t.handle), op);
  return { result, views: await Promise.all(result.bodies.map((h) => kernel.call("body_view", h))) };
};

/** The test-only Combine: every feature in order on the real kernel, named by boolean-names.ts; a refusal fails the feature and keeps its bodies. */
export async function designRebuild(features: readonly BooleanFeature[], run: Run = onKernel): Promise<{ bodies: NamedBody[]; failed: Set<string>; blocks: Map<string, BodyNames> }> {
  let bodies: NamedBody[] = [];
  const blocks = new Map<string, BodyNames>();
  const failed = new Set<string>();
  for (const [place, f] of features.entries()) {
    if (f.kind === "block") {
      assert.equal(f.operation, "new", "the test-only Combine builds new blocks only (Extrude join and cut are step 39)");
      const built = await buildBlock(f, place);
      blocks.set(f.id, built.names);
      bodies.push(built);
      continue;
    }
    const target = bodies.find((b) => b.id === f.target)!;
    const tools = f.tools.map((id) => bodies.find((b) => b.id === id)!);
    try {
      const { result, views } = await run(target, tools, OPS[f.operation]);
      const named = combineNames(f.id, OPS[f.operation], target, tools, result, views);
      if ("failed" in named) throw new Error(named.failed);
      bodies = bodies.flatMap((b) => (b === target ? named.bodies : !f.keepTools && tools.includes(b) ? [] : [b]));
    } catch (e) {
      if (!(e instanceof KernelError) || e.kind !== "invalid-input") throw e;
      failed.add(f.id);
    }
  }
  return { bodies, failed, blocks };
}

export const block = (id: string, rect: BlockFeature["rect"], z: BlockFeature["z"]): BlockFeature => ({ kind: "block", id, rect, z, operation: "new" });

/**
 * A seeded session: two to four blocks with every x, y and z plane apart
 * (the kernel refuses faces lying on each other until 36a, and apart
 * planes can't touch along an edge), then one or two Combines picking
 * live bodies by the model's ids, any operation, the last sometimes
 * keeping its tools (an earlier one would leave a body and its copy, whose
 * faces lie on each other, for the next).
 */
export function randomSession(seed: bigint): BooleanFeature[] {
  const r = seeded(seed);
  const int = (n: number) => Math.floor(r.next() * n);
  const pool = () => {
    const values = [...Array(40).keys()].map((v) => v * 1.5);
    for (let i = values.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  };
  const [xs, ys, zs] = [pool(), pool(), pool()];
  const pair = (p: number[]) => {
    const a = p.pop()!;
    const b = p.pop()!;
    return [Math.min(a, b), Math.max(a, b)];
  };
  const features: BooleanFeature[] = [];
  const blocks = 2 + int(3);
  for (let i = 0; i < blocks; i++) {
    const [x0, x1] = pair(xs);
    const [y0, y1] = pair(ys);
    features.push(block(`feature-${features.length + 1}`, [x0, y0, x1, y1], pair(zs) as [number, number]));
  }
  const combines = 1 + int(2);
  for (let i = 0; i < combines; i++) {
    const live = rebuildBooleans(features).bodies.map((b) => b.id);
    if (live.length < 2) break;
    const target = live.splice(int(live.length), 1)[0];
    const tools = [live.splice(int(live.length), 1)[0]];
    if (live.length > 0 && r.next() < 0.3) tools.push(live.splice(int(live.length), 1)[0]);
    const operation = (["join", "cut", "intersect"] as const)[int(3)];
    features.push({ kind: "combine", id: `feature-${features.length + 1}`, target, tools, operation, ...(r.next() < 0.2 && i === combines - 1 ? { keepTools: true } : {}) });
  }
  return features;
}

export const SEEDS = process.env.FISSION_SEED !== undefined ? [BigInt(process.env.FISSION_SEED)] : [...Array(Number(process.env.BOOLEAN_NAMES_SEEDS ?? 20)).keys()].map((i) => 35_200n + BigInt(i));


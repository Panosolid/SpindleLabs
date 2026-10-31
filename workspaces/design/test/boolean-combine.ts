// Step 35ec2/35ec3 test helpers: a test-only Combine on the real kernel
// (no button until 35f), blocks built as Design builds them, and seeded
// sessions of blocks and Combines the naming model can answer.

import assert from "node:assert/strict";
import { KernelError, type BodyView, type BooleanOp, type BooleanResult, type KernelCalls } from "@fission/core";
import { nodeKernel } from "../../../packages/testing/src/node-kernel.ts";
import { seeded } from "../../../packages/testing/src/index.ts";
import { rebuildBooleans, type BlockFeature, type BooleanFeature, type BooleanRebuild } from "../../../packages/testing/src/boolean-naming-model.ts";
import { featureNames, type BodyNames } from "../src/naming.ts";
import { plainOutline } from "../src/sketch.ts";
import { combineNames, featureBody, fullNames, type DesignNames, type NamedBody, type NameFound } from "../src/boolean-names.ts";

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

/** What the test-only Combine has built so far. */
export interface Built {
  bodies: NamedBody[];
  failed: Set<string>;
  /** Each block's names as Extrude made them, by feature id. */
  blocks: Map<string, BodyNames>;
  /** Why each failed feature failed: the kernel's words, or the Combine's own check. */
  why: Map<string, string>;
}

/**
 * The test-only Combine: every feature in order on the real kernel, named
 * by boolean-names.ts; a refusal fails the feature and keeps its bodies, as
 * do a target or tool that is not there, the target among the tools, a tool
 * picked twice, and a result with nothing left (the checks 35f's Combine
 * makes before and after the kernel; the model fails the same). `step`, if
 * given, sees what is built after each feature.
 */
export async function designRebuild(features: readonly BooleanFeature[], run: Run = onKernel, step?: (done: number, built: Built) => void): Promise<Built> {
  let bodies: NamedBody[] = [];
  const blocks = new Map<string, BodyNames>();
  const failed = new Set<string>();
  const why = new Map<string, string>();
  for (const [place, f] of features.entries()) {
    if (f.kind === "block") {
      assert.equal(f.operation, "new", "the test-only Combine builds new blocks only (Extrude join and cut are step 39)");
      const built = await buildBlock(f, place);
      blocks.set(f.id, built.names);
      bodies.push(built);
    } else {
      const target = bodies.find((b) => b.id === f.target);
      const tools = f.tools.map((id) => bodies.find((b) => b.id === id));
      const own =
        target === undefined || tools.some((t) => t === undefined)
          ? "a body is not there"
          : tools.length === 0
            ? "no tool bodies"
            : tools.includes(target)
              ? "the target is also a tool"
              : new Set(tools).size !== tools.length
                ? "a tool is picked twice"
                : null;
      if (own !== null) {
        failed.add(f.id);
        why.set(f.id, own);
      } else {
        const ts = tools as NamedBody[];
        try {
          const { result, views } = await run(target!, ts, OPS[f.operation]);
          const named = combineNames(f.id, OPS[f.operation], target!, ts, result, views);
          if ("failed" in named) {
            failed.add(f.id);
            why.set(f.id, named.failed);
          } else bodies = bodies.flatMap((b) => (b === target ? named.bodies : !f.keepTools && ts.includes(b) ? [] : [b]));
        } catch (e) {
          if (!(e instanceof KernelError) || e.kind !== "invalid-input") throw e;
          failed.add(f.id);
          why.set(f.id, e.message);
        }
      }
    }
    step?.(place + 1, { bodies, failed, blocks, why });
  }
  return { bodies, failed, blocks, why };
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


// What both sides say, and where they part --------------------------------------

/** Each body as both sides can say it: its id, volume, and its faces' names (shown first) with the full name. */
export interface Said {
  id: string;
  volume: number;
  faces: string[];
}

/** What Design built, as both sides can say it. */
export function designSaid(bodies: readonly NamedBody[], failed: ReadonlySet<string>): { bodies: Said[]; failed: string[] } {
  const full = fullNames(bodies);
  const said = bodies.map((b, bi) => ({ id: b.id, volume: b.view.volume, faces: b.faces.map((f, fi) => `${full[bi][fi]} = ${f.names.join(" | ")}`).sort() }));
  return { bodies: said.sort((a, b) => (a.id < b.id ? -1 : 1)), failed: [...failed].sort() };
}

export function modelSays(features: readonly BooleanFeature[] | BooleanRebuild): { bodies: Said[]; failed: string[] } {
  const r = Array.isArray(features) ? rebuildBooleans(features) : (features as BooleanRebuild);
  const said = r.bodies.map((b) => ({ id: b.id, volume: b.volume, faces: b.faces.map((f) => `${f.full} = ${f.names.join(" | ")}`).sort() }));
  return { bodies: said.sort((a, b) => (a.id < b.id ? -1 : 1)), failed: [...r.failed.keys()].sort() };
}

/** Where Design and the model part, in words; null when they agree (volumes within a billionth). */
export function difference(d: { bodies: Said[]; failed: string[] }, m: { bodies: Said[]; failed: string[] }): string | null {
  if (d.failed.join() !== m.failed.join()) return `failed: Design ${d.failed.join() || "none"}, model ${m.failed.join() || "none"}`;
  if (d.bodies.map((b) => b.id).join() !== m.bodies.map((b) => b.id).join()) return `bodies: Design ${d.bodies.map((b) => b.id).join()}, model ${m.bodies.map((b) => b.id).join()}`;
  for (const [i, b] of d.bodies.entries()) {
    const n = m.bodies[i];
    if (Math.abs(b.volume - n.volume) > 1e-9 * Math.max(b.volume, n.volume)) return `${b.id} volume: Design ${b.volume}, model ${n.volume}`;
    const extra = b.faces.filter((f) => !n.faces.includes(f));
    const missing = n.faces.filter((f) => !b.faces.includes(f));
    if (extra.length + missing.length > 0) return `${b.id} faces: only Design ${extra.join("; ") || "none"}; only model ${missing.join("; ") || "none"}`;
  }
  return null;
}

/** Each body's edge names, sorted (a shared edge as "shared" and its faces and ends), by body id. */
export function designEdges(bodies: readonly NamedBody[], names: DesignNames): Map<string, string[]> {
  return new Map(bodies.map((b, bi) => [b.id, names.edges[bi].map((e) => (e === null ? "unnamed" : (e.name ?? `shared ${e.faces.join("+")};${e.ends.join(",")}`))).sort()]));
}
export function modelEdges(r: BooleanRebuild): Map<string, string[]> {
  return new Map(r.bodies.map((b) => [b.id, b.edges.map((e) => e.name ?? `shared ${e.faces.join("+")};${e.ends.join(",")}`).sort()]));
}

/** Where the two sides' edge names part, in words; null when they agree. */
export function edgeDifference(d: Map<string, string[]>, m: Map<string, string[]>): string | null {
  if ([...d.keys()].sort().join() !== [...m.keys()].sort().join()) return `bodies: Design ${[...d.keys()]}, model ${[...m.keys()]}`;
  for (const [id, names] of d) {
    const other = m.get(id)!;
    const extra = names.filter((n) => !other.includes(n));
    const missing = other.filter((n) => !names.includes(n));
    if (extra.length + missing.length > 0 || names.length !== other.length) return `${id} edges: only Design ${extra.join("; ") || "none"}; only model ${missing.join("; ") || "none"} (${names.length} against ${other.length})`;
  }
  return null;
}

/** A found face or edge as both sides can say it: its body id and full name (an edge: faces and ends), with the warning. */
export const saidFace = (bodies: readonly NamedBody[], names: DesignNames, f: NameFound): string =>
  "lost" in f ? "lost" : "ambiguous" in f ? `ambiguous ${f.ambiguous}` : `${bodies[f.body].id} ${names.full[f.body][f.index]} ${f.warning ?? ""}`;
export const saidEdge = (bodies: readonly NamedBody[], names: DesignNames, f: NameFound): string => {
  if ("lost" in f || "ambiguous" in f) return saidFace(bodies, names, f);
  const e = names.edges[f.body][f.index]!;
  return `${bodies[f.body].id} ${e.faces.join("+")};${e.ends.join(",")}`;
};


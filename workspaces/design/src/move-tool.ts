// The Move tool (step 35e2b): what the Move panel (move-panel.ts) needs
// worked out, as pure functions workspace.ts drives. Which bodies a
// selection picks (a face or an edge picks its body, as Fusion's Move picks
// bodies), the pivot it starts at (the centre of the box round the picked
// bodies, Fusion's default), the boxes read as numbers, the preview (the
// shown mesh with the picked bodies turned and shifted as the Move will do
// it, so typing moves them at once with no kernel call), and the kernel's
// refusal before OK records anything. A Move's own document changes are
// move.ts.

import type { BodySpec, DisplayMesh, Feature, GeometryReference, KernelCalls } from "@fission/core";
import { isMoveItem, MOVE_PARAMS, type DesignDocument, type MoveParam } from "./document.ts";
import { featureSpec } from "./extrude.ts";
import type { MoveValues } from "./move.ts";
import { BodyCache, rebuildTimeline } from "./rebuild.ts";
import { bodyOf, type Scene } from "./scene.ts";
import { itemName } from "./timeline-edits.ts";

type Point = [number, number, number];
type Box3 = readonly [readonly [number, number, number], readonly [number, number, number]];

/** The feature ids of the bodies `items` pick on `scene`, in the scene's order, each once: a body, or the body a face or edge is on. */
export function pickedBodies(items: readonly GeometryReference[], scene: Scene | null): string[] {
  if (scene === null) return [];
  const picked = new Set<number>();
  for (const item of items) {
    const b = bodyOf(scene, item);
    if (b >= 0) picked.add(b);
  }
  return [...picked].sort((a, b) => a - b).map((b) => scene.bodies[b].feature);
}

/** The centre of the smallest box round every one of `boxes` (mm): where a new Move turns about. The origin when there are none. */
export function boxCentre(boxes: readonly Box3[]): Point {
  if (boxes.length === 0) return [0, 0, 0];
  const low = [0, 1, 2].map((k) => Math.min(...boxes.map((b) => b[0][k])));
  const high = [0, 1, 2].map((k) => Math.max(...boxes.map((b) => b[1][k])));
  return [0, 1, 2].map((k) => (low[k] + high[k]) / 2) as Point;
}

/** The pivot a Move of `bodies` starts at on `scene`: the centre of the box round them (each body's exact bounds, BodyView). */
export function startPivot(bodies: readonly string[], scene: Scene | null): Point {
  const boxes = (scene?.bodies ?? []).filter((b) => bodies.includes(b.feature)).map((b) => b.view.bounds);
  return boxCentre(boxes);
}

const DEGREES = Math.PI / 180;

/**
 * `p` turned and shifted as a Move of `v` turns and shifts a body
 * (moveMotions, rebuild.ts): about the line through the pivot along X, then
 * Y, then Z, each counter-clockwise looking down its axis, then shifted.
 * With `vector` a direction (a normal) is only turned.
 */
export function movedPoint(p: readonly number[], v: MoveValues, vector = false): Point {
  const pivot = vector ? [0, 0, 0] : [v.pivotX, v.pivotY, v.pivotZ];
  const q = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
  // About X the turn takes y towards z, about Y z towards x, about Z x towards y.
  for (const [k, deg] of [[0, v.turnX], [1, v.turnY], [2, v.turnZ]] as const) {
    if (deg === 0) continue;
    const [i, j] = k === 0 ? [1, 2] : k === 1 ? [2, 0] : [0, 1];
    const c = Math.cos(deg * DEGREES);
    const s = Math.sin(deg * DEGREES);
    const [a, b] = [q[i], q[j]];
    q[i] = c * a - s * b;
    q[j] = s * a + c * b;
  }
  if (vector) return q as Point;
  return [q[0] + pivot[0] + v.x, q[1] + pivot[1] + v.y, q[2] + pivot[2] + v.z];
}

/**
 * The preview: `scene`'s joined mesh with the bodies `moving` (feature ids)
 * turned and shifted by `v` (their points and edge lines moved, their
 * normals turned) and every other body as it is. The lists keep their
 * lengths and numbering, so the selection's highlight still lands on the
 * same faces. A Move that neither shifts nor turns gives the mesh itself.
 */
export function movedMesh(scene: Scene, moving: readonly string[], v: MoveValues): DisplayMesh {
  if (MOVE_PARAMS.every((k) => k.startsWith("pivot") || v[k] === 0)) return scene.mesh;
  const positions = [...scene.mesh.positions];
  const normals = [...scene.mesh.normals];
  const lines = [...scene.mesh.edge_lines];
  /** The points from `from` to `to` (numbers, three to a point) in `list` moved; directions only turned. */
  const move = (list: number[], from: number, to: number, vector = false) => {
    for (let n = from; n < to; n += 3) {
      const p = movedPoint(list.slice(n, n + 3), v, vector);
      for (let k = 0; k < 3; k++) list[n + k] = p[k];
    }
  };
  let point = 0;
  let line = 0;
  for (const b of scene.bodies) {
    const points = b.view.mesh.positions.length;
    const ends = b.view.mesh.edge_lines.length;
    if (moving.includes(b.feature)) {
      move(positions, point, point + points);
      move(normals, point, point + points, true);
      move(lines, line, line + ends);
    }
    point += points;
    line += ends;
  }
  return { ...scene.mesh, positions, normals, edge_lines: lines };
}

/** What each box is called when it isn't a number: "Type the X distance in mm." */
export const MOVE_BOX_WORDS: Record<MoveParam, string> = {
  x: "X distance in mm",
  y: "Y distance in mm",
  z: "Z distance in mm",
  turnX: "angle about X in degrees",
  turnY: "angle about Y in degrees",
  turnZ: "angle about Z in degrees",
  pivotX: "pivot's X in mm",
  pivotY: "pivot's Y in mm",
  pivotZ: "pivot's Z in mm",
};

/** The panel's boxes read as a Move's numbers, or the first box that isn't a number (an empty box among them). */
export function readMoveBoxes(typed: Partial<Record<MoveParam, string>>): { values: MoveValues } | { bad: MoveParam } {
  const values = {} as MoveValues;
  for (const k of MOVE_PARAMS) {
    const text = typed[k] ?? "";
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return { bad: k };
    values[k] = n;
  }
  return { values };
}

/** A number as a box shows it: rounded to a nanometre (the kernel's 10 nm tolerance is far coarser), with no "-0". */
export const boxText = (n: number): string => String(Math.round(n * 1e6) / 1e6 + 0);

/**
 * Why the kernel refuses Move `id` in `next` (the design OK would record),
 * or null when it builds: the design is built on a body store of its own
 * (so nothing the view holds is touched) and the Move's failure, if any,
 * is given in the rebuild's own words ("... limit is 1e8 mm"). A Move that
 * is greyed or after the marker builds nothing and is not refused.
 */
export async function refusedMove(kernel: KernelCalls, next: DesignDocument, id: string): Promise<string | null> {
  const cache = new BodyCache(kernel);
  try {
    const r = (await rebuildTimeline(next, cache, kernel)).results[id];
    return r?.status === "failed" ? r.message : null;
  } finally {
    await cache.close();
  }
}

/**
 * The body solid feature `f` ends as in `doc`: what the STL download and
 * other workspaces are handed. A body no Move moves is its feature's own
 * (`featureSpec`); one a Move moves is the rebuild's (on a body store of
 * its own), so it is where the timeline put it, or refused with the
 * rebuild's words when it is not built (35e2b's browser check: the STL of a
 * moved box came out where the box was made).
 */
export async function endSpec(kernel: KernelCalls, doc: DesignDocument, f: Feature): Promise<BodySpec> {
  if (!doc.timeline.features.some((m) => isMoveItem(m) && m.dependsOn.includes(f.id))) return featureSpec(kernel, doc, f);
  const cache = new BodyCache(kernel);
  try {
    const r = (await rebuildTimeline(doc, cache, kernel)).results[f.id];
    if (r?.status === "built" && r.spec !== undefined) return r.spec;
    throw new Error(r?.status === "failed" ? r.message : `${itemName(f)} is not built`);
  } finally {
    await cache.close();
  }
}


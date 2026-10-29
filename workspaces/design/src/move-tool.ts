// The Move tool (step 35e2b): what the Move panel (move-panel.ts) needs
// worked out, as pure functions workspace.ts drives. Which bodies a
// selection picks (a face or an edge picks its body, as Fusion's Move picks
// bodies), the pivot it starts at (the centre of the box round the picked
// bodies, Fusion's default), the boxes read as numbers, the preview (the
// shown mesh with the picked bodies turned and shifted as the Move will do
// it, so typing moves them at once with no kernel call), and the kernel's
// refusal before OK records anything. A Move's own document changes are
// move.ts.

import type { BodySpec, DisplayMesh, Feature, GeometryReference, KernelCalls, MoveHandle } from "@fission/core";
import { isMoveItem, MOVE_PARAMS, type DesignDocument, type MoveParam } from "./document.ts";
import { featureSpec } from "./extrude.ts";
import { madeAfter, moveValues, type MoveValues } from "./move.ts";
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

/** `q` (relative to the pivot) turned `deg` degrees about axis `k`, counter-clockwise looking down it: about X y goes towards z, about Y z towards x, about Z x towards y. */
function turned(q: number[], k: 0 | 1 | 2, deg: number) {
  if (deg === 0) return;
  const [i, j] = k === 0 ? [1, 2] : k === 1 ? [2, 0] : [0, 1];
  const c = Math.cos(deg * DEGREES);
  const s = Math.sin(deg * DEGREES);
  const [a, b] = [q[i], q[j]];
  q[i] = c * a - s * b;
  q[j] = s * a + c * b;
}

/**
 * `p` turned and shifted as a Move of `v` turns and shifts a body
 * (moveMotions, rebuild.ts): about the line through the pivot along X, then
 * Y, then Z, each counter-clockwise looking down its axis, then shifted.
 * With `vector` a direction (a normal) is only turned.
 */
export function movedPoint(p: readonly number[], v: MoveValues, vector = false): Point {
  const pivot = vector ? [0, 0, 0] : [v.pivotX, v.pivotY, v.pivotZ];
  const q = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
  turned(q, 0, v.turnX);
  turned(q, 1, v.turnY);
  turned(q, 2, v.turnZ);
  if (vector) return q as Point;
  return [q[0] + pivot[0] + v.x, q[1] + pivot[1] + v.y, q[2] + pivot[2] + v.z];
}

/** `p` put back where it was before a Move of `v` (movedPoint undone): shifted back, then turned back about Z, Y, then X. */
export function unmovedPoint(p: readonly number[], v: MoveValues, vector = false): Point {
  const pivot = vector ? [0, 0, 0] : [v.pivotX, v.pivotY, v.pivotZ];
  const shift = vector ? [0, 0, 0] : [v.x, v.y, v.z];
  const q = [0, 1, 2].map((k) => p[k] - shift[k] - pivot[k]);
  turned(q, 2, -v.turnZ);
  turned(q, 1, -v.turnY);
  turned(q, 0, -v.turnX);
  return [q[0] + pivot[0], q[1] + pivot[1], q[2] + pivot[2]];
}

/** What a body's points go through on the way to the preview: point or direction in, moved point or turned direction out. */
export type PointMap = (p: readonly number[], vector: boolean) => Point;

/**
 * `scene`'s joined mesh with each body `map` gives a PointMap for (by
 * feature id) moved by it (its points and edge lines moved, its normals
 * turned) and every other body as it is. The lists keep their lengths and
 * numbering, so the selection's highlight still lands on the same faces.
 */
export function mappedMesh(scene: Scene, map: (feature: string) => PointMap | null): DisplayMesh {
  const positions = [...scene.mesh.positions];
  const normals = [...scene.mesh.normals];
  const lines = [...scene.mesh.edge_lines];
  /** The points from `from` to `to` (numbers, three to a point) in `list` moved by `f`; directions only turned. */
  const move = (f: PointMap, list: number[], from: number, to: number, vector = false) => {
    for (let n = from; n < to; n += 3) {
      const p = f(list.slice(n, n + 3), vector);
      for (let k = 0; k < 3; k++) list[n + k] = p[k];
    }
  };
  let point = 0;
  let line = 0;
  for (const b of scene.bodies) {
    const points = b.view.mesh.positions.length;
    const ends = b.view.mesh.edge_lines.length;
    const f = map(b.feature);
    if (f) {
      move(f, positions, point, point + points);
      move(f, normals, point, point + points, true);
      move(f, lines, line, line + ends);
    }
    point += points;
    line += ends;
  }
  return { ...scene.mesh, positions, normals, edge_lines: lines };
}

/** Whether a Move of `v` neither shifts nor turns. */
const still = (v: MoveValues) => MOVE_PARAMS.every((k) => k.startsWith("pivot") || v[k] === 0);

/**
 * The preview: `scene`'s joined mesh with the bodies `moving` (feature ids)
 * turned and shifted by `v` and every other body as it is. A Move that
 * neither shifts nor turns gives the mesh itself.
 */
export function movedMesh(scene: Scene, moving: readonly string[], v: MoveValues): DisplayMesh {
  if (still(v)) return scene.mesh;
  return mappedMesh(scene, (feature) => (moving.includes(feature) ? (p, vector) => movedPoint(p, v, vector) : null));
}

/**
 * The preview of Move `id` edited to `v` (35e2c), on `scene` as `doc`
 * built it (`results`): each body it moves taken back through the built
 * Moves after it that move it too (last first), then out of where Move
 * `id` put it, then moved by `v`, then through those later Moves again; so
 * the body shows where OK will put it, whatever comes after. A Move that
 * did not build (suppressed, greyed, past the marker) builds nothing
 * either way and is drawn as it is; one that failed moved nothing, so
 * there is nothing to take back. Since 35e2i the Move may move `bodies`
 * instead of its own: a body taken out is only taken back out of where the
 * Move put it, one put in only moved by `v`. Numbers and bodies as built
 * give the mesh itself.
 */
export function editedMoveMesh(scene: Scene, doc: DesignDocument, results: Readonly<Record<string, { status: string }>>, id: string, v: MoveValues, bodies?: readonly string[]): DisplayMesh {
  const at = doc.timeline.features.findIndex((f) => f.id === id);
  const edited = doc.timeline.features[at];
  const status = results[id]?.status;
  if (edited === undefined || !isMoveItem(edited) || (status !== "built" && status !== "failed")) return scene.mesh;
  const before = moveValues(edited);
  const now = bodies ?? edited.dependsOn;
  const sameBodies = now.length === edited.dependsOn.length && now.every((b) => edited.dependsOn.includes(b));
  if (status === "built" && sameBodies && MOVE_PARAMS.every((k) => before[k] === v[k])) return scene.mesh;
  if (status === "failed" && still(v)) return scene.mesh;
  const later = doc.timeline.features.slice(at + 1).filter((f) => isMoveItem(f) && results[f.id]?.status === "built");
  return mappedMesh(scene, (feature) => {
    const was = edited.dependsOn.includes(feature);
    const is = now.includes(feature);
    if (!was && !is) return null;
    const after = later.filter((f) => f.dependsOn.includes(feature)).map(moveValues);
    return (p, vector) => {
      let q: readonly number[] = p;
      for (const m of [...after].reverse()) q = unmovedPoint(q, m, vector);
      if (status === "built" && was) q = unmovedPoint(q, before, vector);
      if (is) q = movedPoint(q, v, vector);
      for (const m of after) q = movedPoint(q, m, vector);
      return q as Point;
    };
  });
}

/**
 * An edited Move's bodies as the picks change (35e2i): the bodies it holds
 * that `scene` doesn't show stay (a hidden, failed or deleted body can't be
 * clicked off), the shown ones are those `picked`, in timeline order. A
 * pick made after the Move can't be moved by it: it is left out and
 * `refused` says so (the first such pick), so the caller can let it go.
 */
export function editedBodies(doc: DesignDocument, id: string, held: readonly string[], picked: readonly string[], scene: Scene | null): { bodies: string[]; refused: string | null } {
  const features = doc.timeline.features;
  const at = features.findIndex((f) => f.id === id);
  const move = features[at];
  if (move === undefined || !isMoveItem(move)) return { bodies: [...held], refused: null };
  const shownNow = new Set((scene?.bodies ?? []).map((b) => b.feature));
  const place = (b: string) => features.findIndex((f) => f.id === b);
  const later = picked.filter((b) => place(b) > at);
  const bodies = [...new Set([...held.filter((b) => !shownNow.has(b)), ...picked.filter((b) => !later.includes(b))])];
  bodies.sort((a, b) => place(a) - place(b));
  return { bodies, refused: later.length === 0 ? null : madeAfter(itemName(features[place(later[0])]), itemName(move)) };
}

/** Where a Move of `v` puts its pivot: where the arrows and rings are drawn. */
export const handlesCentre = (v: MoveValues): Point => [v.pivotX + v.x, v.pivotY + v.y, v.pivotZ + v.z];

/** A dragged distance (mm) snapped to whole millimetres, halves away from 0 (Math.round alone takes −0.5 to 0), with no "−0". */
export const snapMm = (d: number): number => Math.sign(d) * Math.round(Math.abs(d)) + 0;

/** A dragged angle (degrees) snapped to whole 15° steps, halves away from 0, with no "−0". */
export const snapDegrees = (a: number): number => 15 * Math.sign(a) * Math.round(Math.abs(a) / 15) + 0;

/** An angle (degrees) as a box shows it after a drag: the same turn in (−180°, 180°], so dragging round and round never runs up 720°. */
export function wrapDegrees(a: number): number {
  const w = a - 360 * Math.floor((a + 180) / 360); // in [−180, 180)
  return (w === -180 ? 180 : w) + 0;
}

/**
 * The Move's numbers while a handle is dragged (35e2c): `start` (as at the
 * press) with the handle's own number moved by the drag snapped, an arrow
 * whole millimetres, a ring 15° steps (an angle then wrapped into
 * (−180°, 180°]). Only the step is snapped, so a number typed in between
 * (2.5 mm) keeps its part and a press that doesn't move changes nothing.
 */
export function draggedValues(start: MoveValues, handle: MoveHandle, amount: number): MoveValues {
  if (handle.startsWith("turn")) {
    const step = snapDegrees(amount);
    return step === 0 ? start : { ...start, [handle]: wrapDegrees(start[handle] + step) };
  }
  const step = snapMm(amount);
  return step === 0 ? start : { ...start, [handle]: start[handle] + step };
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

/**
 * The panel's boxes read as a Move's numbers, or the first box that isn't a
 * number. An empty box counts as 0 (Ben, 2026-10-28: as Extrude does, so the
 * preview and the handles stay up while a box is cleared to type in it).
 */
export function readMoveBoxes(typed: Partial<Record<MoveParam, string>>): { values: MoveValues } | { bad: MoveParam } {
  const values = {} as MoveValues;
  for (const k of MOVE_PARAMS) {
    const text = (typed[k] ?? "").trim();
    const n = text === "" ? 0 : Number(text);
    if (!Number.isFinite(n)) return { bad: k };
    values[k] = n;
  }
  return { values };
}

/**
 * Whether the preview can draw `v`: every distance and pivot within 1e9 mm,
 * ten times the kernel's model space (1e8 mm, which OK checks). Past that
 * the moved points overflow what the view can draw (a 1e308 mm Move gave
 * the view NaN sizes and the body vanished, weak-spot hunt 10-29), so the
 * body is drawn unmoved, as for a box half typed.
 */
export const MOVE_PREVIEW_LIMIT = 1e9;
export const previewable = (v: MoveValues): boolean =>
  (["x", "y", "z", "pivotX", "pivotY", "pivotZ"] as const).every((k) => Math.abs(v[k]) <= MOVE_PREVIEW_LIMIT);

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


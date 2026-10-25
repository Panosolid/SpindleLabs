// Design building a stacked chain (stack-model.ts) on the real kernel, the
// way the app does: each prism's sketch made with addSketch (the first, on
// XY) or addFaceSketch on the face found in the shown bodies by its name
// with the frame drawnOnFace gives (as a pick lands), its shape drawn with
// drawLine as a chain or drawCircle, extruded with extrudeSketch (and Flip);
// then the chain's edits, setExtrudeDistance, setExtrudeFlip and movePoint.
// Every edit is settled with settleKept and recorded on core's undo history
// (createHistory, whole project snapshots, as the shell's is). After every
// one the whole design is checked (`checkStack`):
// - every item built, with no warning, and settling it again changes nothing;
// - the bodies are the model's, one per prism: volume and surface area to
//   1e-9 relative; every face where the model has it, by its name (start,
//   end, side:<line>), its outward normal to 1e-9, its middle and area; every
//   corner a corner of the kernel's body; the topology closed (every edge
//   between two faces, V − E + F = 2 for a polygon prism, faces' areas
//   adding up to the body's);
// - every face sketch's placement is the model's (origin, x axis, normal, side);
// - a rebuild from nothing (a fresh cache) is the same, number for number;
// - saving and opening gives the same design, the same text saved again, and
//   the same bodies number for number;
// - undo then redo gives back the state before, then this one, number for
//   number, on the same cache the app keeps;
// and once the chain is done, undoing every step back to the empty design
// and redoing every one gives each state again, and clearing the cache frees
// every body (the kernel's body_count back where it started).

import { createHistory, emptyProject, projectFromJson, projectToJson, type BodyView, type KernelCalls } from "@fission/core";
import { addFaceSketch, addSketch, BodyCache, drawCircle, drawLine, drawnOnFace, extrudeSketch, facePlane, movePoint, readDesignDocument, rebuildTimeline, setExtrudeDistance, setExtrudeFlip, settleKept, shownBodies, type DesignDocument, type ShownBody, type TimelineBuild } from "@fission/design";
import { seeded } from "./index.ts";
import { buildStack, dot, edited, faceName, norm, randomChain, sub, type FaceKey, type ModelBody, type StackChain, type StackPrism } from "./stack-model.ts";
import type { Vec3 } from "./naming-model.ts";

/** Bugs planted in the harness's side, each proving a check bites (journeys/face-stack.journey.ts). Bugs in Design's own code are planted by planted/run.ts (`STACK_PLANTS`). */
export type StackFault =
  /** The file forgets every extrude's Flip. */
  | "save-drops-flip"
  /** Undo puts back the state two steps back. */
  | "undo-skips"
  /** The model's prisms a tenth of a nanometre (1e-7 mm) longer than asked. */
  | "model-long"
  /** The model's face sketches drawn on the start cap whenever the end cap was picked. */
  | "model-wrong-cap";

export const STACK_FAULTS: readonly StackFault[] = ["save-drops-flip", "undo-skips", "model-long", "model-wrong-cap"];

export class StackFailure extends Error {
  readonly check: string;
  readonly at: string;
  constructor(check: string, at: string, message: string) {
    super(`${check} after ${at}: ${message}`);
    this.check = check;
    this.at = at;
  }
}

const DESIGN = [{ id: "design" as const, readData: readDesignDocument }];
const save = (doc: DesignDocument) => projectToJson({ ...emptyProject("Stack"), workspaces: { design: doc } });
const open = (text: string) => projectFromJson(text, DESIGN).workspaces.design as DesignDocument;

/** The chain for a seed, as the journey and the nightly draw it: 5 to 8 prisms, then 6 edits. */
export function chainOf(seed: bigint): StackChain {
  const r = seeded(seed);
  return randomChain(seed, r, 5 + Math.floor(r.next() * 4), 6);
}

/** Everything a rebuild gives that the checks compare number for number: each result's status and placement, each body's view but its mesh (its size and a sum of it instead). */
export function fingerprint(build: TimelineBuild, bodies: readonly ShownBody[]): string {
  const results = build.order.map((id) => {
    const r = build.results[id];
    return r.status === "built" ? { id, placement: r.placement, warn: [r.warning, r.plane, r.source, r.points].filter(Boolean) } : { id, status: r.status };
  });
  const views = bodies.map((b) => {
    const { mesh, ...rest } = b.view;
    let sum = 0;
    for (let k = 0; k < mesh.positions.length; k++) sum += mesh.positions[k] * ((k % 7) + 1);
    return { feature: b.feature, names: b.names.faces, ...rest, mesh: [mesh.positions.length, mesh.indices.length, sum] };
  });
  return JSON.stringify({ results, views });
}

/** What the harness drew for each prism: its sketch and extrude ids, and its outline's line and point ids in corner order. */
interface Drawn {
  sketch: string;
  extrude: string;
  lines: string[];
  points: string[];
}

const close = (got: number, want: number, rel = 1e-9) => Math.abs(got - want) <= rel * Math.max(1, Math.abs(want));
const near = (a: readonly number[], b: readonly number[], tol: number) => norm(sub(a as Vec3, b as Vec3)) <= tol;
const fmt = (v: readonly number[]) => `[${v.map((x) => x.toPrecision(12)).join(", ")}]`;

/** The name Design gives prism `p`'s face `k`: its cap's role, or "side:<the line it was swept from>". */
const designName = (k: FaceKey, d: Drawn) => (k.role === "side" ? `side:${encodeURIComponent(d.lines[k.edge])}` : k.role);

/** Checks every shown body and face sketch placement against the model; throws a StackFailure naming the first difference. */
export function checkStack(at: string, model: readonly ModelBody[], drawn: readonly Drawn[], build: TimelineBuild, bodies: readonly ShownBody[]) {
  const fail = (check: string, msg: string) => {
    throw new StackFailure(check, at, msg);
  };
  for (const id of build.order) {
    const r = build.results[id];
    if (r.status !== "built") fail("built", `${id} is ${r.status}${"message" in r ? `: ${(r as { message: string }).message}` : ""}`);
    else if (r.warning || r.plane || r.source || r.points) fail("built", `${id} has a warning: ${JSON.stringify(r.warning ?? r.plane ?? r.source ?? r.points)}`);
  }
  if (bodies.length !== model.length) fail("bodies", `${bodies.length} bodies shown, the model has ${model.length}`);
  // Lengths are compared to a billionth of the chain's size (every chain's numbers pass through up to a dozen turned frames).
  const size = Math.max(1, ...model.flatMap((m) => m.faces.flatMap((f) => (f.corners ?? []).flatMap((c) => c.map(Math.abs)))), ...model.map((m) => norm(m.centroid)));
  const tol = 1e-9 * size;
  model.forEach((m, i) => {
    const d = drawn[i];
    const b = bodies.find((x) => x.feature === d.extrude);
    if (!b) return fail("bodies", `no body for ${d.extrude}`);
    const v: BodyView = b.view;
    // Placement: the sketch's frame (a face sketch's; the first is on XY).
    const res = build.results[d.sketch];
    if (i > 0) {
      const pl = res.status === "built" ? res.placement : undefined;
      if (!pl) return fail("placement", `${d.sketch} has no placement`);
      if (!near(pl.plane.origin, m.placement.origin, tol) || !near(pl.plane.xAxis, m.placement.x, 1e-9) || !near(pl.plane.normal, m.placement.normal, 1e-9) || pl.side !== m.placement.side)
        fail("placement", `${d.sketch} lies at ${fmt(pl.plane.origin)} x ${fmt(pl.plane.xAxis)} n ${fmt(pl.plane.normal)} side ${pl.side}, the model's ${fmt(m.placement.origin)} x ${fmt(m.placement.x)} n ${fmt(m.placement.normal)} side ${m.placement.side}`);
    }
    // Validated: the kernel checks a body before it shows it, and lists what failed.
    if (v.errors.length > 0) fail("valid", `${d.extrude} fails validation: ${v.errors.join("; ")}`);
    if (v.tolerance !== 1e-5) fail("valid", `${d.extrude} carries a tolerance of ${v.tolerance} mm, not the kernel's 1e-5 (nothing here intersects)`);
    if (!close(v.volume, m.volume)) fail("volume", `${d.extrude}: ${v.volume}, the model's ${m.volume}`);
    if (!close(v.area, m.area)) fail("area", `${d.extrude}: ${v.area}, the model's ${m.area}`);
    if (v.faces !== m.faces.length) fail("faces", `${d.extrude} has ${v.faces} faces, the model ${m.faces.length}`);
    // Closed: every edge between exactly two faces, the faces' areas the body's, and for a polygon prism Euler's V − E + F = 2.
    if (v.edge_faces.some((x) => x === null)) fail("closed", `${d.extrude} has an edge not used once each way`);
    if (!close(v.face_areas.reduce((s, x) => s + x, 0), v.area)) fail("closed", `${d.extrude}'s faces add up to ${v.face_areas.reduce((s, x) => s + x, 0)}, its area is ${v.area}`);
    if (m.vertices.length > 0 && v.vertices - v.edges + v.faces !== 2) fail("closed", `${d.extrude}: V − E + F = ${v.vertices - v.edges + v.faces}`);
    for (const f of m.faces) {
      const name = designName(f.key, d);
      const k = b.names.faces.indexOf(name);
      if (f.outward === null) {
        // A circle's round side has no name of its own to sketch on; it is the one curved face.
        const round = v.face_normals.findIndex((x) => x == null);
        if (round < 0 || !close(v.face_areas[round], f.area) || !near(v.face_centroids[round], f.centroid, tol)) fail("face", `${d.extrude}'s round side (area ${v.face_areas[round]}, middle ${round < 0 ? "none" : fmt(v.face_centroids[round])}) is not the model's (area ${f.area}, middle ${fmt(f.centroid)})`);
        continue;
      }
      if (k < 0) return fail("face", `${d.extrude} has no face named ${name} (it has ${b.names.faces.join(", ")})`);
      const n = v.face_normals[k];
      if (!n || !near(n, f.outward, 1e-9)) fail("face", `${d.extrude}/${name} faces ${n ? fmt(n) : "round"}, the model's ${fmt(f.outward)}`);
      if (!near(v.face_centroids[k], f.centroid, tol)) fail("face", `${d.extrude}/${name}'s middle is ${fmt(v.face_centroids[k])}, the model's ${fmt(f.centroid)}`);
      if (!close(v.face_areas[k], f.area)) fail("face", `${d.extrude}/${name}'s area is ${v.face_areas[k]}, the model's ${f.area}`);
      // The plane, apart from the middle: the model's corners (or disc centre) lie on the kernel's plane.
      for (const c of f.corners ?? [f.disc!.centre]) if (Math.abs(dot(sub(c, v.face_centroids[k]), n!)) > tol) fail("face", `${d.extrude}/${name}: the model's corner ${fmt(c)} is ${dot(sub(c, v.face_centroids[k]), n!)} off the kernel's plane`);
    }
    if (m.vertices.length > 0) {
      if (v.vertex_points.length !== m.vertices.length) fail("corners", `${d.extrude} has ${v.vertex_points.length} corners, the model ${m.vertices.length}`);
      for (const c of m.vertices) if (!v.vertex_points.some((p) => near(p, c, tol))) fail("corners", `${d.extrude} has no corner at the model's ${fmt(c)}`);
    }
  });
}

/** A failure, or null, and what the chain reached. */
export interface StackRun {
  failure: StackFailure | null;
  /** Edits skipped because they would spoil the first outline. */
  skipped: number;
  steps: number;
}

/** The model's prisms with a fault planted in them (`model-long`, `model-wrong-cap`). */
function faulted(prisms: readonly StackPrism[], faults: ReadonlySet<StackFault>): StackPrism[] {
  return prisms.map((p) => ({
    ...p,
    distance: faults.has("model-long") ? p.distance + 1e-7 : p.distance,
    on: p.on && faults.has("model-wrong-cap") && p.on.face.role === "end" ? { ...p.on, face: { role: "start" } } : p.on,
  }));
}

/**
 * Builds `chain` in Design on `kernel`, first `length` prisms and `edits`
 * edits (all of them when left out, fewer when shrinking), checking after
 * every step. Never throws for a check: a failed one is `failure`.
 */
export async function runStack(kernel: KernelCalls, chain: StackChain, opts: { length?: number; edits?: number; faults?: Iterable<StackFault> } = {}): Promise<StackRun> {
  const faults = new Set(opts.faults ?? []);
  const length = opts.length ?? chain.prisms.length;
  const editCount = opts.edits ?? chain.edits.length;
  const startCount = await kernel.call("body_count");
  const cache = new BodyCache(kernel);
  let doc: DesignDocument = readDesignDocument({ version: 3, nextId: 1, profiles: [], sketches: [], timeline: { features: [] } });
  const saveF = (d: DesignDocument) => (faults.has("save-drops-flip") ? save({ ...d, timeline: { ...d.timeline, features: d.timeline.features.map((f) => (f.intent.type === "extrude" ? { ...f, intent: { ...f.intent, parameters: Object.fromEntries(Object.entries(f.intent.parameters).filter(([k]) => k !== "flip")) } } : f)) } }) : save(d));
  const history = createHistory({ capture: () => saveF(doc), restore: (s) => void (doc = open(s)), mergeMs: 0 });
  /** Each history entry's fingerprint, by entry. */
  const states: string[] = [];
  const drawn: Drawn[] = [];
  let prisms: StackPrism[] = [];
  let steps = 0;
  let skipped = 0;
  let at = "start";

  const read = async (d: DesignDocument, c: BodyCache) => {
    const build = await rebuildTimeline(d, c, kernel);
    return { build, bodies: await shownBodies(d, build, c) };
  };
  /** Settles the edit, records it, checks everything. */
  const step = async (label: string, before: DesignDocument, after: DesignDocument) => {
    at = label;
    steps++;
    doc = await settleKept(kernel, before, after, cache);
    if ((await settleKept(kernel, doc, doc, cache)) !== doc) throw new StackFailure("settled", at, "settling a settled design changed it");
    history.record(label);
    const now = await read(doc, cache);
    // Only a whole chain step is checked against the model: a sketch alone has no body yet.
    if (drawn.length === prisms.length) checkStack(at, buildStack(faulted(prisms, faults)), drawn, now.build, now.bodies);
    const print = fingerprint(now.build, now.bodies);
    // A rebuild from nothing gives the same numbers.
    const fresh = new BodyCache(kernel);
    try {
      const again = await read(doc, fresh);
      if (fingerprint(again.build, again.bodies) !== print) throw new StackFailure("fresh rebuild", at, "a rebuild on a fresh cache differs from the app's cached one");
      // Saved and opened: the same design, saved to the same text, built to the same numbers.
      const text = saveF(doc);
      const reopened = open(text);
      if (save(reopened) !== save(doc)) throw new StackFailure("save and open", at, "the opened design differs from the one saved");
      if (saveF(reopened) !== text) throw new StackFailure("save and open", at, "saving the opened design gives other text");
      await fresh.clear();
      const opened = await read(reopened, fresh);
      if (fingerprint(opened.build, opened.bodies) !== print) throw new StackFailure("save and open", at, "the opened design builds other bodies");
    } finally {
      await fresh.clear();
    }
    // Undo gives the state before, redo this one, on the app's cache.
    if (states.length > 0) {
      history.undo();
      if (faults.has("undo-skips") && history.canUndo()) history.undo();
      const back = await read(doc, cache);
      if (fingerprint(back.build, back.bodies) !== states.at(-1)) throw new StackFailure("undo and redo", at, "undo did not give back the state before");
      history.redo();
      if (faults.has("undo-skips") && history.canRedo()) history.redo();
      const fwd = await read(doc, cache);
      if (fingerprint(fwd.build, fwd.bodies) !== print) throw new StackFailure("undo and redo", at, "redo did not give back this state");
    }
    states.push(print);
  };

  try {
    states.push(fingerprint(...(Object.values(await read(doc, cache)) as [TimelineBuild, ShownBody[]])));
    for (let i = 0; i < length; i++) {
      const p = chain.prisms[i];
      let made: { doc: DesignDocument; id: string };
      if (p.on === null) made = addSketch(doc);
      else {
        // The face as a pick lands on it: found among the shown bodies by its Design name, framed by drawnOnFace on the kernel's numbers.
        const parent = drawn[p.on.prism];
        const { bodies } = await read(doc, cache);
        const b = bodies.find((x) => x.feature === parent.extrude);
        const name = designName(p.on.face, parent);
        const f = b ? b.names.faces.indexOf(name) : -1;
        if (!b || f < 0) throw new StackFailure("face", `prism ${i}`, `${parent.extrude} has no face ${name} to draw on`);
        const placed = drawnOnFace(b.view, f);
        if (!placed) throw new StackFailure("face", `prism ${i}`, `${parent.extrude}/${name} is not flat`);
        made = addFaceSketch(doc, { plane: facePlane(b.names.feature, name), feature: parent.extrude }, placed);
      }
      let d = made.doc;
      const lines: string[] = [];
      const points: string[] = [];
      if (p.shape.kind === "circle") d = drawCircle(d, made.id, p.shape.centre, p.shape.radius).doc;
      else {
        const c = p.shape.corners;
        for (let k = 0; k < c.length; k++) {
          const line = drawLine(d, made.id, points[k] ?? c[k], k + 1 === c.length ? points[0] : c[k + 1]);
          d = line.doc;
          const curve = d.sketches.find((s) => s.id === made.id)!.curves.find((x) => x.id === line.id) as { start: string; end: string };
          lines.push(line.id);
          points[k] = curve.start;
          if (k + 1 < c.length) points[k + 1] = curve.end;
        }
      }
      const before = doc;
      await step(`prism ${i}'s sketch`, before, d);
      const ex = extrudeSketch(doc, made.id, p.distance, p.flip);
      drawn.push({ sketch: made.id, extrude: ex.id, lines, points });
      prisms = chain.prisms.slice(0, i + 1);
      await step(`prism ${i} (${p.on ? `on prism ${p.on.prism}'s ${faceName(p.on.face)}` : "on XY"}, ${p.shape.kind}, ${p.distance.toPrecision(4)} mm${p.flip ? ", flipped" : ""})`, doc, ex.doc);
    }
    for (let e = 0; e < editCount; e++) {
      const edit = chain.edits[e];
      if (edit.kind !== "corner" && edit.prism >= length) continue;
      const next = edited(prisms, edit);
      if (next === null) {
        skipped++;
        continue;
      }
      prisms = next;
      let d: DesignDocument;
      if (edit.kind === "distance") d = setExtrudeDistance(doc, edit.distance, drawn[edit.prism].extrude);
      else if (edit.kind === "flip") d = setExtrudeFlip(doc, prisms[edit.prism].flip, drawn[edit.prism].extrude);
      else d = movePoint(doc, drawn[0].sketch, drawn[0].points[edit.corner], edit.to[0], edit.to[1]);
      await step(`edit ${e} (${edit.kind}${edit.kind === "corner" ? ` ${edit.corner}` : ` of prism ${edit.prism}`})`, doc, d);
    }
    // Every step undone back to the empty design, each state as it was; then every one redone.
    at = "undoing everything";
    for (let k = states.length - 2; k >= 0; k--) {
      history.undo();
      const back = await read(doc, cache);
      if (fingerprint(back.build, back.bodies) !== states[k]) throw new StackFailure("undo and redo", at, `undoing back to state ${k} of ${states.length - 1} did not give it back`);
    }
    at = "redoing everything";
    for (let k = 1; k < states.length; k++) {
      history.redo();
      const fwd = await read(doc, cache);
      if (fingerprint(fwd.build, fwd.bodies) !== states[k]) throw new StackFailure("undo and redo", at, `redoing to state ${k} of ${states.length - 1} did not give it back`);
    }
    await cache.clear();
    const left = (await kernel.call("body_count")) - startCount;
    if (left !== 0) throw new StackFailure("bodies freed", "the end", `${left} bodies left in the kernel after clearing the cache`);
    return { failure: null, skipped, steps };
  } catch (e) {
    if (e instanceof StackFailure) return { failure: e, skipped, steps };
    return { failure: new StackFailure("threw", at, e instanceof Error ? (e.stack ?? e.message) : String(e)), skipped, steps };
  } finally {
    await cache.clear().catch(() => undefined);
  }
}

/**
 * The shortest start of `chain` that still fails the same check: first the
 * fewest edits (with every prism), then the fewest prisms (with no edits,
 * if it still fails without them).
 */
export async function shrinkStack(kernel: KernelCalls, chain: StackChain, check: string, faults: Iterable<StackFault> = []): Promise<{ length: number; edits: number }> {
  const fails = async (length: number, edits: number) => (await runStack(kernel, chain, { length, edits, faults })).failure?.check === check;
  let edits = 0;
  while (edits < chain.edits.length && !(await fails(chain.prisms.length, edits))) edits++;
  let length = 1;
  if (edits === 0) while (length < chain.prisms.length && !(await fails(length, 0))) length++;
  else length = chain.prisms.length;
  return { length, edits };
}

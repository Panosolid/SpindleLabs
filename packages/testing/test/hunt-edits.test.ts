// Bug hunt: seeded random edit chains on Design's timeline with undo/redo,
// checking save/load round trips, unique ids and names, and undo exactness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory, emptyProject, projectFromJson, projectToJson, type Project } from "@fission/core";
import {
  addSketch, deleteItem, designWorkspace, drawCircle, drawLine, editFeature, extrudeSketch, isSketchItem, itemName,
  moveMarker, partDocument, reorderItem, suppressItem, withPart, type DesignDocument,
} from "@fission/design";
import { seeded } from "../src/index.ts";
import { nodeKernel } from "../src/node-kernel.ts";
import { BodyCache, rebuildTimeline, settleKept } from "@fission/design";
const kernel = nodeKernel();
import { hideBody, renameItem } from "../../../workspaces/design/src/timeline-edits.ts";
import { addFaceSketch, facePlane, SHAPES } from "@fission/design";
export const stats = { kept: 0, hidden: 0, face: 0 };

const designOf = (p: Project) => p.workspaces.design as DesignDocument;
const NAMES = ["  Body  ", "É", "e\u0301", "ﬁ", ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((k) => [`Sketch ${k}`, `extrude ${k}`, `Box ${k}`, `Cylinder ${k}`, `Star ${k}`, `Body ${k}`])];

async function run(seed: bigint, steps: number, log: string[], withKernel = false) {
  const r = seeded(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r.next() * xs.length)];
  let project: Project = { ...emptyProject(), workspaces: { design: partDocument("box", 40, 30, 20) } };
  const start = projectToJson(project);
  let t = 0;
  const h = createHistory({ capture: () => projectToJson(project), restore: (s) => { project = projectFromJson(s, [designWorkspace]); }, limit: 1000, mergeMs: 0, now: () => (t += 5000) });
  let recorded = 0;
  const pending: [DesignDocument, string][] = [];
  const set = (doc: DesignDocument, label: string) => { pending.push([doc, label]); };
  const commit = async (doc: DesignDocument, label: string) => {
    if (withKernel) doc = await settleKept(kernel, designOf(project), doc);
    const before = projectToJson(project);
    project = { ...project, workspaces: { design: doc } };
    if (projectToJson(project) === before) return;
    assert.equal(h.record(label), true, label);
    recorded++;
  };
  for (let i = 0; i < steps; i++) {
    const doc = designOf(project);
    const fs = doc.timeline.features;
    const at = `seed ${seed} step ${i}`;
    const n = r.next();
    let op = "";
    try {
      if (n < 0.1) { op = "addSketch"; const m = addSketch(doc); const s = drawCircle(m.doc, m.id, [0, 0], 5); set(s.doc, op); }
      else if (n < 0.2) { const sk = fs.filter(isSketchItem); if (sk.length) { const id = pick(sk).id; op = `extrude ${id}`; set(extrudeSketch(doc, id, 1 + Math.floor(r.next() * 9)).doc, op); } }
      else if (n < 0.24) { op = "withPart"; set(withPart(doc, pick(SHAPES), 1 + Math.floor(r.next() * 50), 30, 20), op); }
      else if (n < 0.27 && fs.length) { if (r.next() < 0.5) { const f = pick(fs.filter((x) => !isSketchItem(x))); if (f) { op = `hide ${f.id}`; set(hideBody(doc, f.id, !(doc.hidden ?? []).includes(f.id)), op); } } else { const f = pick(fs.filter((x) => !isSketchItem(x))); if (f) { op = `faceSketch ${f.id}`; const m = addFaceSketch(doc, { plane: facePlane(f.id, "top"), feature: f.id }, { plane: { origin: [0, 0, 20], xAxis: [1, 0, 0], normal: [0, 0, 1] }, side: 1 }); set(drawCircle(m.doc, m.id, [0, 0], 3).doc, op); } } }
      else if (n < 0.35 && fs.length) { const f = pick(fs); op = `delete ${f.id}`; set(deleteItem(doc, f.id), op); }
      else if (n < 0.45 && fs.length) { const f = pick(fs); const to = Math.floor(r.next() * fs.length); op = `reorder ${f.id} ${to}`; const x = reorderItem(doc, f.id, to); if ("doc" in x) set(x.doc, op); }
      else if (n < 0.52 && fs.length) { const f = pick(fs); const name = pick(NAMES); op = `rename ${f.id} ${JSON.stringify(name)}`; const x = renameItem(doc, f.id, name); if ("doc" in x) set(x.doc, op); }
      else if (n < 0.6 && fs.length) { const f = pick(fs); op = `suppress ${f.id}`; set(suppressItem(doc, f.id, !f.suppressed), op); }
      else if (n < 0.67) { const m = pick([null, "start", ...fs.map((f) => f.id)]); op = `marker ${m}`; set(moveMarker(doc, m), op); }
      else if (n < 0.74 && fs.length) { const f = pick(fs.filter((x) => !isSketchItem(x)).concat([])); if (f) { op = `edit ${f.id}`; set(editFeature(doc, f.id, { width: 1 + Math.floor(r.next() * 30), height: 1 + Math.floor(r.next() * 30) }), op); } }
      else if (n < 0.78) { const sk = doc.sketches; if (sk.length) { const s = pick(sk); op = `line ${s.id}`; set(drawLine(doc, s.id, [r.next() * 10, r.next() * 10], [20 + r.next(), 20]).doc, op); } }
      else if (n < 0.9) { const k = 1 + Math.floor(r.next() * 4); op = `undo ${k}`; for (let j = 0; j < k; j++) h.undo(); }
      else { const k = 1 + Math.floor(r.next() * 4); op = `redo ${k}`; for (let j = 0; j < k; j++) h.redo(); }
    } catch (e) {
      const msg = (e as Error).message;
      if (e instanceof TypeError || e instanceof RangeError) throw new Error(`${at} ${op}: ${e.constructor.name} ${msg}`);
      log.push(`${at} ${op} refused: ${msg}`);
      continue;
    }
    for (const [d0, l] of pending.splice(0)) {
      try { await commit(d0, l); } catch (e) { if (e instanceof TypeError || e instanceof RangeError) throw new Error(`${at} ${op}: settle ${e.constructor.name} ${(e as Error).message}`); log.push(`${at} ${op} settle refused: ${(e as Error).message}`); }
    }
    if (op) log.push(`${at} ${op}`);
    if (withKernel) {
      const summary = async (d: DesignDocument) => { const b = await rebuildTimeline(d, new BodyCache(kernel), kernel); return JSON.stringify({ order: b.order, results: Object.fromEntries(Object.entries(b.results).map(([k, v]) => { const { body: _, ...rest } = v as { body?: unknown }; return [k, rest]; })) }); };
      let a: string;
      try { a = await summary(designOf(project)); }
      catch (e) { throw new Error(`${at} ${op}: rebuild threw ${(e as Error).constructor.name} ${(e as Error).message}`); }
      const loaded = designOf(projectFromJson(projectToJson(project), [designWorkspace]));
      assert.equal(await summary(loaded), a, `${at} ${op}: the reloaded project rebuilds differently`);
    }
    const json = projectToJson(project);
    // save/load round trip
    assert.equal(projectToJson(projectFromJson(json, [designWorkspace])), json, `${at} ${op}: save/load changed the project`);
    const d = designOf(project);
    if (d.kept) stats.kept++; if (d.hidden) stats.hidden++; if (d.timeline.features.some((f) => String(f.intent.parameters.plane ?? "").includes(":"))) stats.face++;
    const ids = d.timeline.features.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, `${at} ${op}: duplicate ids ${ids}`);
    const names = d.timeline.features.map((f) => itemName(f).toLowerCase());
    assert.equal(new Set(names).size, names.length, `${at} ${op}: duplicate names ${names}`);
    const m = d.timeline.marker;
    if (m !== undefined && m !== "start") assert.ok(ids.includes(m), `${at} ${op}: marker on missing ${m}`);
    for (const s of d.sketches) assert.ok(ids.includes(s.id), `${at} ${op}: orphan sketch ${s.id}`);
    for (const hId of d.hidden ?? []) assert.ok(ids.includes(hId), `${at} ${op}: hidden missing ${hId}`);
    // undo then redo is exact
    if (h.canUndo()) {
      h.undo();
      h.redo();
      assert.equal(projectToJson(project), json, `${at} ${op}: undo+redo changed the project`);
    }
  }
  while (h.canUndo()) h.undo();
  assert.equal(projectToJson(project), start, `seed ${seed}: undo all did not return to start`);
  return recorded;
}

for (const seed of [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 0x5eedn, 0xbeefn]) {
  test(`hunt-edits: random edit chain seed ${seed}`, async () => {
    const log: string[] = [];
    try { await run(seed, 300, log); } catch (e) { console.log(log.slice(-12).join("\n")); throw e; }
  });
}

for (const seed of [11n, 12n, 13n, 14n]) {
  test(`hunt-edits: random edit chain on the kernel seed ${seed}`, async () => {
    const log: string[] = [];
    try { await run(seed, 150, log, true); } catch (e) { console.log(log.slice(-12).join("\n")); throw e; }
  });
}

test("stats", () => console.log(JSON.stringify(stats)));

// Step 34a4: old names still find what they found (rule 6 of
// docs/document-model.md, section 8), on the real kernel. Every saved file
// the repo holds (the golden models, the old-file corpus, the regression
// projects that open) and a few made here (half discs either way round, a
// triangle) is built, and on every body every name Design gives or could
// have written (each face's, each edge's as a reference, as a projection
// and as a pin's middle or centre, each vertex's as a pin, the names shared
// by two, the 0.26 forms, the forms an outline turned over writes, a
// vertex's name with one of its edges left out, and one made-up name of
// each kind) is found twice: by Design's old string (references.ts
// `resolveReference`, projection.ts `edgeNamed`, face-edges.ts `pinNow`)
// and through src/old-names.ts, which reads the name into its faces' full
// names and finds the edge by rule 5 from the kernel's view alone. Both
// must give the same face, edge or point, or both say lost, or both
// ambiguous. The names the files themselves hold (sketch planes, pins,
// projections, any face or edge id anywhere in them) are each checked on
// their own body. Then each planted misreading must make some name
// disagree. Run with `npm run journeys` after the app build.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { projectFromJson, type Plane, type StableId } from "@fission/core";
import {
  addSketch,
  BodyCache,
  designWorkspace,
  drawArc,
  drawLine,
  edgeNamed,
  edgeName,
  extrudeSketch,
  inSketch,
  partDocument,
  pinNow,
  readDesignDocument,
  rebuildTimeline,
  resolveReference,
  sharedBy,
  shownBodies,
  vertexNames,
  type DesignDocument,
  type EdgeKind,
  type ShownBody,
  type SketchPin,
} from "@fission/design";
import { kernel } from "./design-app.ts";
import { findEdge, findFace, findVertex, newNames, OLD_NAME_FAULTS, readOldEdge, readOldReference, readOldVertex, type Found, type NewBody, type OldNameFault } from "../src/old-names.ts";

const ROOT = new URL("../../../", import.meta.url);
/** Where saved projects are kept: every file in these that opens as a project with Design in it is checked. */
const SAVED = ["tests/golden/", "packages/testing/old-files/", "packages/testing/test/regressions/"];
const PLANE: Plane = { origin: [0, 0, 0], xAxis: [1, 0, 0], normal: [0, 0, 1] };

function* walk(dir: URL): Generator<URL> {
  for (const name of readdirSync(dir).sort()) {
    const u = new URL(name, dir);
    if (statSync(u).isDirectory()) yield* walk(new URL(`${name}/`, dir));
    else if (name.endsWith(".json")) yield u;
  }
}

/** Every saved project that opens with Design data, by its path. */
function savedDocuments(): { label: string; doc: DesignDocument; json: unknown }[] {
  const out: { label: string; doc: DesignDocument; json: unknown }[] = [];
  for (const dir of SAVED)
    for (const u of walk(new URL(dir, ROOT))) {
      const label = u.pathname.slice(ROOT.pathname.length);
      try {
        const project = projectFromJson(readFileSync(u, "utf8"), [designWorkspace]);
        const data = project.workspaces.design;
        if (data === undefined) continue;
        out.push({ label, doc: readDesignDocument(data), json: data });
      } catch {
        // Not a project (a session, an expectation) or one refused on purpose (the fuzz regressions): nothing to name.
      }
    }
  return out;
}

/** Made here: a half disc (two sides that meet twice), flipped and not, and a triangle drawn clockwise. */
function madeDocuments(): { label: string; doc: DesignDocument; json: unknown }[] {
  const halfDisc = (flip: boolean) => {
    const made = addSketch(partDocument("box", 40, 30, 20));
    let doc = drawLine(made.doc, made.id, [-5, 0], [5, 0]).doc;
    const [p, q] = doc.sketches.at(-1)!.points;
    doc = drawArc(doc, made.id, q.id, p.id, [0, 0]).doc;
    return extrudeSketch(doc, made.id, 10, flip).doc;
  };
  const triangle = () => {
    const made = addSketch(partDocument("cylinder", 10, 10, 20));
    let doc = drawLine(made.doc, made.id, [0, 0], [0, 8]).doc;
    const [a, b] = doc.sketches.at(-1)!.points;
    doc = drawLine(doc, made.id, b.id, [6, 0]).doc;
    const c = doc.sketches.at(-1)!.points.at(-1)!;
    doc = drawLine(doc, made.id, c.id, a.id).doc;
    return extrudeSketch(doc, made.id, -4, false).doc;
  };
  return [
    { label: "half disc", doc: halfDisc(false), json: null },
    { label: "half disc flipped", doc: halfDisc(true), json: null },
    { label: "triangle", doc: triangle(), json: null },
  ];
}

/** What a find gave, in one form for both ways: a kernel index or a point, or "lost", or "ambiguous". */
const shownFound = (f: Found) => (typeof f === "string" ? f : `#${f.index}`);
const shownAt = (at: readonly number[]) => `(${at.join(", ")})`;

const unordered = (part: string) => (part.includes(">") ? part.split(">").sort().join("+") : part);
const reversed = (part: string) => (part.includes(">") ? part.split(">").reverse().join(">") : part.includes("@") ? part.split("+").reverse().map((x, k, all) => `${x.slice(0, x.indexOf("@"))}@${all[1 - k].slice(all[1 - k].indexOf("@") + 1)}`).sort().join("+") : part);
/** A 27b corner name as 0.26 wrote it: each "A@x+B@y" as "A+B". */
const old26 = (name: string) => name.split("&").map((p) => (p.includes("@") ? p.split("+").map((x) => x.slice(0, x.indexOf("@"))).sort().join("+") : p)).sort().join("&");

interface Tally {
  names: number;
  /** The names a file holds that were checked on their body, as "<feature> <kind> <name>". */
  saved: Set<string>;
  byKind: Record<string, number>;
  disagree: string[];
}

/** One body's checks: every name of each kind found both ways. */
function checkBody(body: ShownBody, tally: Tally, savedNames: { kind: "face" | "edge" | "part" | EdgeKind; name: string }[], faults: OldNameFault[]): void {
  const { view, names } = body;
  const feature = names.feature;
  const nb: NewBody = newNames(feature, names, view);
  const record = (kind: string, name: string, old: string, now: string, saved: boolean) => {
    tally.names++;
    if (saved) tally.saved.add(`${body.feature} ${kind.replace("pin ", "").replace("projection", "part")} ${name}`);
    tally.byKind[kind] = (tally.byKind[kind] ?? 0) + 1;
    if (old !== now) tally.disagree.push(`${kind} ${feature}/${name}: Design ${old}, read ${now}`);
  };
  const savedSet = new Set(savedNames.map((s) => `${s.kind} ${s.name}`));
  const isSaved = (kind: string, name: string) => savedSet.has(`${kind} ${name}`);
  const present = <T,>(xs: readonly (T | null | undefined)[]) => xs.filter((x): x is T => x !== null && x !== undefined);

  // Faces: as references (and sketch planes).
  const faces = new Set([...present(names.faces), ...names.shared.faces.keys(), "side:line-999", ...savedNames.filter((s) => s.kind === "face").map((s) => s.name)]);
  for (const part of faces) {
    const id = `face:${feature}/${part}`;
    const ref = { kind: "face" as const, id: id as StableId };
    const i = resolveReference(ref, names);
    const old = i !== null ? `#${i}` : sharedBy(ref, names) > 1 ? "ambiguous" : "lost";
    const read = readOldReference(id, faults);
    record("face", part, old, read === null || !("face" in read) ? "unread" : shownFound(findFace(nb, read.face)), isSaved("face", part));
  }

  // Edges as references (naming.ts's names, a selection or a link): set and ordered, and turned round.
  const refs = new Set([...present(names.edges), ...names.shared.edges.keys(), "end+side:line-999", ...savedNames.filter((s) => s.kind === "edge").map((s) => s.name)]);
  for (const p of [...refs]) refs.add(reversed(p)).add(unordered(p));
  for (const part of refs) {
    const ref = { kind: "edge" as const, id: `edge:${feature}/${part}` as StableId };
    const i = resolveReference(ref, names);
    const old = i !== null ? `#${i}` : sharedBy(ref, names) > 1 ? "ambiguous" : "lost";
    const read = readOldReference(ref.id, faults);
    record("edge", part, old, read === null || !("edge" in read) ? "unread" : shownFound(findEdge(nb, read.edge, faults)), isSaved("edge", part));
  }

  // Edges as a projection names them (partName): corners, and sets where none is known; turned round, and 0.26's sets.
  const parts = new Set<string>(["end+side:line-999", ...savedNames.filter((s) => s.kind === "part").map((s) => s.name)]);
  for (let e = 0; e < view.edge_faces.length; e++) {
    const n = edgeName(names, e);
    if (n !== null) parts.add(n).add(reversed(n)).add(old26(n));
  }
  for (const k of names.shared.edges.keys()) parts.add(unordered(k));
  for (const part of parts) {
    const got = edgeNamed(names, view.edge_faces.length, part);
    const old = "edge" in got ? `#${got.edge}` : got.cause === "projection-ambiguous" ? "ambiguous" : "lost";
    const read = readOldEdge(feature, part, "part", faults);
    record("projection", part, old, read === null ? "unread" : shownFound(findEdge(nb, read, faults)), isSaved("part", part));
  }

  // Pins: a vertex's name on an end; an edge's (naming.ts's, or its 27b corner) on a middle or a centre.
  const { vertices, shared } = vertexNames(view, names);
  const ends = new Set([...present(vertices), ...shared.keys(), "end+side:line-999", ...savedNames.filter((s) => s.kind === "endpoint").map((s) => s.name)]);
  // Each also as 0.26 wrote it, and with one edge left out: a corner named when it had three edges, which has four now.
  for (const v of [...ends]) {
    ends.add(old26(v));
    const parts = v.split("&");
    if (parts.length > 1) parts.forEach((_, k) => ends.add(parts.filter((_, j) => j !== k).join("&")));
  }
  const middles = new Set(["end+side:line-999", ...savedNames.filter((s) => s.kind !== "endpoint" && s.kind !== "face" && s.kind !== "edge" && s.kind !== "part").map((s) => s.name)]);
  names.edges.forEach((n, e) => {
    if (n === null) return;
    const m = names.ends?.[e] ?? n;
    middles.add(m).add(reversed(m)).add(n);
  });
  const pins: SketchPin[] = [
    ...[...ends].map((name) => ({ point: "p", kind: "endpoint" as const, name })),
    ...[...middles].flatMap((name) => (["midpoint", "centre"] as const).map((kind) => ({ point: "p", kind, name }))),
  ];
  for (const pin of pins) {
    const got = pinNow(pin, view, names, PLANE);
    const old = "at" in got ? shownAt(got.at) : got.cause === "point-ambiguous" ? "ambiguous" : "lost";
    record(`pin ${pin.kind}`, pin.name, old, newPin(nb, view, pin, feature, faults), isSaved(pin.kind, pin.name));
  }
}

/** Where a pin is now through the reader: its vertex or edge found by its faces, and the point Design takes from it. */
function newPin(nb: NewBody, view: ShownBody["view"], pin: SketchPin, feature: string, faults: OldNameFault[]): string {
  const closed = (e: number) => view.edge_vertices[e][0] === view.edge_vertices[e][1];
  if (pin.kind === "endpoint") {
    const q = readOldVertex(feature, pin.name, faults);
    if (q === null) return "unread";
    const f = findVertex(nb, q, faults);
    return typeof f === "string" ? f : shownAt(inSketch(view.vertex_points[f.index], PLANE));
  }
  const read = (name: string) => {
    if (name.includes("@")) return readOldEdge(feature, name, "part", faults);
    const r = readOldReference(`edge:${feature}/${name}`, faults);
    return r !== null && "edge" in r ? r.edge : null;
  };
  const q = read(pin.name);
  if (q === null) return "unread";
  let f = findEdge(nb, q, faults);
  // A middle's ordered name finds the edge named the other way round once the outline turned over (hunt 26h), as Design does.
  if (f === "lost" && pin.kind === "midpoint" && pin.name.includes(">")) {
    const back = read(reversed(pin.name));
    if (back !== null) f = findEdge(nb, back, faults);
  }
  if (typeof f === "string") return f;
  if (pin.kind === "midpoint") return closed(f.index) ? "lost" : shownAt(inSketch(view.edge_middles[f.index], PLANE));
  const centre = view.edge_centres[f.index];
  return centre ? shownAt(inSketch(centre, PLANE)) : "lost";
}

/** The names a document's own file holds, by the feature whose body they are on. */
function savedNamesOf(doc: DesignDocument, json: unknown): Map<string, { kind: "face" | "edge" | "part" | EdgeKind; name: string }[]> {
  const out = new Map<string, { kind: "face" | "edge" | "part" | EdgeKind; name: string }[]>();
  const add = (feature: string, kind: "face" | "edge" | "part" | EdgeKind, name: string) => out.set(feature, [...(out.get(feature) ?? []), { kind, name }]);
  // Any face or edge id anywhere in the file: a sketch's plane, a link.
  const scan = (x: unknown): void => {
    if (typeof x === "string") {
      const m = /^(face|edge):([^:/]+)\/(.+)$/.exec(x);
      if (m) add(decodeURIComponent(m[2]), m[1] as "face" | "edge", m[3]);
    } else if (Array.isArray(x)) x.forEach(scan);
    else if (x !== null && typeof x === "object") Object.values(x).forEach(scan);
  };
  scan(json);
  for (const s of doc.sketches) {
    const item = doc.timeline.features.find((f) => f.id === s.id);
    const plane = item?.intent.parameters.plane;
    const onFace = typeof plane === "string" ? /^face:([^:/]+)\//.exec(plane)?.[1] : undefined;
    for (const pin of s.pins ?? []) add(pin.feature ?? decodeURIComponent(onFace ?? ""), pin.kind, pin.name);
    for (const p of s.projected ?? []) add(p.feature, "part", p.edge);
  }
  return out;
}

/** Every document built and every body checked, with `faults` planted in the reader. */
async function sweep(faults: OldNameFault[] = []): Promise<Tally & { bodies: number; documents: number; unchecked: string[]; held: number }> {
  const tally: Tally = { names: 0, saved: new Set(), byKind: {}, disagree: [] };
  let bodies = 0;
  let held = 0;
  const unchecked: string[] = [];
  const docs = [...savedDocuments(), ...madeDocuments()];
  for (const { label, doc, json } of docs) {
    const cache = new BodyCache(kernel);
    try {
      const build = await rebuildTimeline(doc, cache, kernel);
      const saved = savedNamesOf(doc, json);
      tally.saved = new Set();
      for (const body of await shownBodies(doc, build, cache)) {
        bodies++;
        const before = tally.disagree.length;
        checkBody(body, tally, saved.get(body.feature) ?? [], faults);
        for (let k = before; k < tally.disagree.length; k++) tally.disagree[k] = `${label}: ${tally.disagree[k]}`;
      }
      // Every name the file holds, once each: checked on its body, or listed.
      const all = new Set([...saved].flatMap(([feature, list]) => list.map((s) => `${feature} ${s.kind} ${s.name}`)));
      held += all.size;
      for (const n of all) if (!tally.saved.has(n)) unchecked.push(`${label}: ${n}`);
    } finally {
      await cache.clear();
    }
  }
  return { ...tally, bodies, documents: docs.length, unchecked, held };
}

test("34a4: every old name on every saved file's bodies finds by its faces what Design finds by its string", async () => {
  const t = await sweep();
  console.log(`${t.documents} documents, ${t.bodies} bodies, ${t.names} names (${Object.entries(t.byKind).map(([k, n]) => `${k} ${n}`).join(", ")}); the files hold ${t.held} different names, ${t.held - t.unchecked.length} checked on their body`);
  assert.deepEqual(t.disagree, []);
  // The corpus is what it says: the six golden files, the seventeen old ones, and the names they hold.
  assert.ok(t.documents >= 6 + 17 + 3, `documents: ${t.documents}`);
  // Every name a file holds is checked on its body but one: v3-pin-lost's pin, whose body was deleted on purpose.
  assert.deepEqual(t.unchecked, ["packages/testing/old-files/v3-pin-lost.panosolid.json: feature-1 endpoint back+bottom&back+right&bottom+right"]);
});

test("34a4: each planted misreading makes some old name find something else", async () => {
  for (const fault of OLD_NAME_FAULTS) {
    const t = await sweep([fault]);
    assert.ok(t.disagree.length > 0, `planted ${fault}: every name still agreed`);
    console.log(`planted ${fault}: ${t.disagree.length} names disagree, e.g. ${t.disagree[0]}`);
  }
});

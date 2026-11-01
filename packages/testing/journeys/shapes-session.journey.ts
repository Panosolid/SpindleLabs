// Shapes and selection bug hunt (2026-11-01): seeded random sessions of inserts, selections, deletes,
// suppress, typed sizes, undo and redo against a model written apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "./design-app.ts";
import { empty, insert, type, row, panel } from "./selection-hunt-helpers.ts";
import { seeded } from "../src/index.ts";

type Kind = "box" | "cylinder" | "sphere";
interface F { id: string; kind: Kind; w: number; d: number; h: number; suppressed: boolean; body: number }
interface M { features: F[]; nextId: number; nextBody: number }
const vol = (f: F) => (f.kind === "box" ? f.w * f.d * f.h : f.kind === "cylinder" ? Math.PI * (f.w / 2) ** 2 * f.h : (Math.PI * f.w ** 3) / 6);
const clone = (m: M): M => ({ ...m, features: m.features.map((f) => ({ ...f })) });

async function session(seed: bigint, steps: number, checkGhost: boolean) {
  const r = seeded(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r.next() * xs.length)];
  const a = await app(empty());
  let m: M = { features: [], nextId: 1, nextBody: 1 };
  const undo: { before: M; key?: string }[] = [];
  let redo: M[] = [];
  let sel: string | null = null; // the feature id the user selected
  const log: string[] = [];
  const record = (before: M, key?: string) => {
    const top = undo[undo.length - 1];
    if (key !== undefined && top?.key === key && lastWasType === key) { /* merged */ } else undo.push({ before, key });
    redo = [];
  };
  let lastWasType: string | undefined;
  for (let s = 0; s < steps; s++) {
    const live = m.features.filter((f) => !f.suppressed);
    const part = live[live.length - 1];
    const op = pick(["insert", "insert", "select", "select", "delete", "suppress", "type", "type", "undo", "undo", "redo"] as const);
    let typed: string | undefined;
    if (op === "insert") {
      const k = pick(["box", "cylinder", "sphere"] as const);
      const before = clone(m);
      m.features.push({ id: `feature-${m.nextId++}`, kind: k, w: 40, d: 30, h: 20, suppressed: false, body: m.nextBody++ });
      record(before);
      sel = null;
      log.push(`insert ${k}`);
      await insert(a, k);
    } else if (op === "select" && m.features.length) {
      const f = pick(m.features.filter((x) => !x.suppressed));
      if (!f) continue;
      log.push(`select Body ${f.body}`);
      await row(a, `body-${f.body}`);
      sel = f.id;
    } else if (op === "delete" && m.features.length) {
      const f = pick(m.features);
      const before = clone(m);
      m.features = m.features.filter((x) => x !== f);
      record(before);
      log.push(`delete ${f.id}`);
      assert.equal(await a.menu(f.id, "delete"), null);
    } else if (op === "suppress" && m.features.length) {
      const f = pick(m.features);
      const before = clone(m);
      f.suppressed = !f.suppressed;
      record(before);
      log.push(`${f.suppressed ? "" : "un"}suppress ${f.id}`);
      assert.equal(await a.menu(f.id, f.suppressed ? "suppress" : "unsuppress"), null);
    } else if (op === "type" && part) {
      const keys = part.kind === "box" ? ["width", "depth", "height"] : part.kind === "cylinder" ? ["width", "height"] : ["width"];
      const key = pick(keys);
      const v = pick([10, 25, 50, 60, 75]);
      const before = clone(m);
      const p = m.features.find((x) => x.id === part.id)!;
      if ((p as any)[key[0]] === v) continue;
      (p as any)[key[0]] = v;
      record(before, key);
      typed = key;
      log.push(`type ${key} ${v} (part ${part.id})`);
      await type(a, key, String(v));
    } else if (op === "undo" && undo.length) {
      const u = undo.pop()!;
      redo.push(clone(m));
      m = u.before;
      log.push("undo");
      await a.undo();
    } else if (op === "redo" && redo.length) {
      undo.push({ before: clone(m) });
      m = redo.pop()!;
      log.push("redo");
      await a.redo();
    } else continue;
    lastWasType = typed;
    const where = `seed ${seed} after ${log.join("; ")}`;
    // The design's features are the model's.
    const doc = a.doc();
    assert.deepEqual(doc.timeline.features.map((f) => `${f.id}${f.suppressed ? "(s)" : ""}`), m.features.map((f) => `${f.id}${f.suppressed ? "(s)" : ""}`), `features, ${where}`);
    // Names unique.
    const labels = doc.timeline.features.map((f) => f.provenance.self.label);
    assert.equal(new Set(labels).size, labels.length, `unique names ${labels}, ${where}`);
    // The panel: the selected body if it still exists and builds, else the part.
    const selected = a.selection.items.map((i) => i.id);
    if (checkGhost) for (const id of selected) assert.ok(m.features.some((f) => `body:${f.id}` === id), `selection ${id} is a body that exists, ${where}`);
    const focusF = m.features.find((f) => selected.includes(`body:${f.id}`));
    const lv = m.features.filter((f) => !f.suppressed);
    const shown = focusF ?? lv[lv.length - 1];
    const p = panel(a);
    if (shown && !shown.suppressed) {
      assert.equal(p.heading, `Body ${shown.body}`, `heading, ${where}`);
      const want = vol(shown);
      assert.ok(Math.abs(p.volume - want) <= 1e-4 * want, `volume ${p.volume}, expected ${want} for ${shown.id}, ${where}`);
    }
    // The size boxes show the part's sizes.
    const pt = lv[lv.length - 1];
    if (pt) assert.equal((a.$("#width") as HTMLInputElement).value, String(pt.w), `width box shows the part's width, ${where}`);
  }
  assert.ok(await a.close());
}

// FISSION_SESSIONS seeds (default 20) of 60 steps, each checking no gone body stays selected (fixed 2026-11-01).
const SESSIONS = Number(process.env.FISSION_SESSIONS ?? 20);
for (const seed of Array.from({ length: SESSIONS }, (_, i) => BigInt(i + 1))) {
  test(`seeded session ${seed}, with the ghost-selection check`, async () => session(seed, 60, true));
}

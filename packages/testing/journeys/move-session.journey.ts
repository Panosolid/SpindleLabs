// Move, timeline and undo bug hunt (2026-11-01): seeded Move/Rotate sessions in the app against a plain affine model.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import { bodyReference, builtBody, BodyCache, insertPreset, partDocument, rebuildTimeline, type DesignDocument, type MoveValues } from "@fission/design";
import { app, kernel } from "./design-app.ts";
import { seeded } from "../src/index.ts";

type P = [number, number, number];
type Box3 = [P, P];
interface MMove { id: string; bodies: string[]; v: MoveValues; suppressed: boolean }
interface Model { bodies: { id: string; size: P }[]; moves: MMove[] }
const KEYS = ["x", "y", "z", "turnX", "turnY", "turnZ", "pivotX", "pivotY", "pivotZ"] as const;

/** My own turn: R = Rz·Ry·Rx about the pivot, then the shift. */
function moved(p: P, v: MoveValues): P {
  const d = Math.PI / 180;
  let q: P = [p[0] - v.pivotX, p[1] - v.pivotY, p[2] - v.pivotZ];
  const rot = (q: P, ax: number, deg: number): P => {
    const c = Math.cos(deg * d), s = Math.sin(deg * d);
    if (ax === 0) return [q[0], c * q[1] - s * q[2], s * q[1] + c * q[2]];
    if (ax === 1) return [c * q[0] + s * q[2], q[1], -s * q[0] + c * q[2]];
    return [c * q[0] - s * q[1], s * q[0] + c * q[1], q[2]];
  };
  q = rot(rot(rot(q, 0, v.turnX), 1, v.turnY), 2, v.turnZ);
  return [q[0] + v.pivotX + v.x, q[1] + v.pivotY + v.y, q[2] + v.pivotZ + v.z];
}
function corners(m: Model, body: string): P[] {
  const b = m.bodies.find((x) => x.id === body)!;
  let pts: P[] = [];
  for (let i = 0; i < 8; i++) pts.push([i & 1 ? b.size[0] : 0, i & 2 ? b.size[1] : 0, i & 4 ? b.size[2] : 0]);
  for (const mv of m.moves) if (!mv.suppressed && mv.bodies.includes(body)) pts = pts.map((p) => moved(p, mv.v));
  return pts;
}
const boundsOf = (pts: P[]): Box3 => [[0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k]))) as P, [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k]))) as P];

async function kernelBounds(doc: DesignDocument): Promise<Map<string, Box3>> {
  const cache = new BodyCache(kernel);
  try {
    const build = await rebuildTimeline(doc, cache, kernel);
    const out = new Map<string, Box3>();
    for (const id of build.order) { const b = builtBody(build, id); if (b !== undefined) out.set(id, ((await cache.view(b.handle)) as BodyView).bounds as Box3); }
    return out;
  } finally {
    await cache.close();
  }
}
const near = (got: Box3, want: Box3, what: string, tol = 1e-4) =>
  got.flat().forEach((x, i) => assert.ok(Math.abs(x - want.flat()[i]) <= tol * Math.max(1, Math.abs(want.flat()[i])), `${what}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));

const SEEDS = Number(process.env.HUNT_SEEDS ?? 8);
const STEPS = Number(process.env.HUNT_STEPS ?? 40);

for (let seed = 1; seed <= SEEDS; seed++) {
  test(`seeded Move session ${seed}`, async () => {
    const sr = seeded(BigInt(seed)); const rnd = () => sr.next();
    const int = (n: number) => Math.floor(rnd() * n);
    const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)];
    let doc = partDocument("box", 40, 30, 20);
    doc = insertPreset(doc, "box", 10, 20, 5).doc;
    doc = insertPreset(doc, "box", 7, 7, 7).doc;
    const a = await app(doc);
    let model: Model = { bodies: [{ id: "feature-1", size: [40, 30, 20] }, { id: "feature-2", size: [10, 20, 5] }, { id: "feature-3", size: [7, 7, 7] }], moves: [] };
    const undo: Model[] = [];
    let redo: Model[] = [];
    const log: string[] = [];
    const type = (k: string, value: string) => {
      const x = a.$(`#move-${k}`) as HTMLInputElement;
      x.value = value;
      x.dispatchEvent(new a.window.Event("input") as unknown as Event);
    };
    const value = (k: string) => {
      if (k.startsWith("turn")) return pick([0, 0, 90, -90, 45, 180, 360, 720, -270, 30, 15]);
      return pick([0, 0, 5, -12, 2.5, 100, -0.25, 33]);
    };
    const check = async (what: string) => {
      const ctx = `seed ${seed}, ${what}; log: ${log.join(" | ")}`;
      const got = await kernelBounds(a.doc());
      for (const b of model.bodies) near(got.get(b.id)!, boundsOf(corners(model, b.id)), `${ctx}: ${b.id}`);
      const moves = a.doc().timeline.features.filter((f) => f.intent.type === "move");
      assert.equal(moves.length, model.moves.length, `${ctx}: number of moves`);
      // The view: the union of every body.
      const all = boundsOf(model.bodies.flatMap((b) => corners(model, b.id)));
      const pos = a.mesh()!.positions;
      const mesh: Box3 = [[0, 1, 2].map((k) => Math.min(...pos.filter((_, i) => i % 3 === k))) as P, [0, 1, 2].map((k) => Math.max(...pos.filter((_, i) => i % 3 === k))) as P];
      near(mesh, all, `${ctx}: the view`, 1e-3);
      assert.equal(a.moveHandlesShown(), null, `${ctx}: no handles left`);
      assert.equal(a.$("#move-panel")!.hidden, true, `${ctx}: panel closed`);
    };
    const record = (next: Model) => { undo.push(model); redo = []; model = next; };
    for (let step = 0; step < STEPS; step++) {
      const r = rnd();
      if (r < 0.35) {
        // A new Move of 1 or 2 bodies, typed.
        const bodies = model.bodies.map((b) => b.id).filter(() => rnd() < 0.5);
        if (bodies.length === 0) bodies.push(pick(model.bodies).id);
        a.selection.set(bodies.map((b) => bodyReference(`body:${b}`)));
        await a.settle();
        const kind = rnd() < 0.3 ? "rotate-tool" : "move-tool";
        await a.key(kind);
        const v = { x: 0, y: 0, z: 0, turnX: 0, turnY: 0, turnZ: 0, pivotX: 0, pivotY: 0, pivotZ: 0 } as MoveValues;
        const centre = boundsOf(bodies.flatMap((b) => corners(model, b)));
        [v.pivotX, v.pivotY, v.pivotZ] = [0, 1, 2].map((k) => (centre[0][k] + centre[1][k]) / 2);
        for (const k of KEYS) {
          if (rnd() < 0.5) continue;
          const n = k.startsWith("pivot") ? pick([0, 10, -7.5]) : value(k);
          type(k, String(n));
          v[k] = n;
        }
        const ordered = model.bodies.map((b) => b.id).filter((b) => bodies.includes(b));
        log.push(`new ${kind} ${ordered.join(",")} ${JSON.stringify(v)}`);
        const cancel = rnd() < 0.15;
        if (cancel) { (a.$(rnd() < 0.5 ? "#move-cancel" : "#move-cancel") as HTMLButtonElement).click(); await a.settle(); log.push("cancel"); }
        else {
          (a.$("#move-ok") as HTMLButtonElement).click();
          await a.settle();
          const err = a.$("#move-error")!;
          assert.ok(err.hidden, `seed ${seed}: an error ${err.textContent}; ${log.join(" | ")}`);
          const still = ["x", "y", "z", "turnX", "turnY", "turnZ"].every((k) => v[k as keyof MoveValues] === 0);
          if (!still) {
            const id = a.doc().timeline.features.at(-1)!.id;
            record({ ...model, moves: [...model.moves, { id, bodies: ordered, v: { ...v }, suppressed: false }] });
          }
        }
        a.selection.clear();
        await a.settle();
      } else if (r < 0.55 && model.moves.length > 0) {
        // Edit a Move: a few boxes typed again.
        const m = pick(model.moves);
        if (m.suppressed) continue;
        await a.doubleClick(m.id);
        assert.equal(a.$("#move-panel")!.hidden, false, `seed ${seed}: edit opened`);
        for (const k of KEYS) assert.ok(Math.abs(Number((a.$(`#move-${k}`) as HTMLInputElement).value) - m.v[k]) < 1e-6, `seed ${seed}: edit shows ${k} ${(a.$(`#move-${k}`) as HTMLInputElement).value} want ${m.v[k]}; ${log.join(" | ")}`);
        const v = { ...m.v };
        for (const k of KEYS) {
          if (rnd() < 0.7) continue;
          const n = k.startsWith("pivot") ? pick([0, 10, -7.5]) : value(k);
          type(k, String(n));
          v[k] = n;
        }
        log.push(`edit ${m.id} ${JSON.stringify(v)}`);
        if (rnd() < 0.2) { await a.key("clear-selection"); log.push("escape"); }
        else {
          (a.$("#move-ok") as HTMLButtonElement).click();
          await a.settle();
          const err = a.$("#move-error")!;
          if (!err.hidden && err.textContent) assert.fail(`seed ${seed}: edit error ${err.textContent}; ${log.join(" | ")}`);
          const changed = KEYS.some((k) => v[k] !== m.v[k]);
          if (changed) record({ ...model, moves: model.moves.map((x) => (x.id === m.id ? { ...x, v } : x)) });
        }
      } else if (r < 0.65 && model.moves.length > 0) {
        const m = pick(model.moves);
        assert.equal(await a.menu(m.id, m.suppressed ? "unsuppress" : "suppress"), null);
        log.push(`${m.suppressed ? "unsuppress" : "suppress"} ${m.id}`);
        record({ ...model, moves: model.moves.map((x) => (x.id === m.id ? { ...x, suppressed: !x.suppressed } : x)) });
      } else if (r < 0.72 && model.moves.length > 0) {
        const m = pick(model.moves);
        assert.equal(await a.menu(m.id, "delete"), null);
        log.push(`delete ${m.id}`);
        record({ ...model, moves: model.moves.filter((x) => x.id !== m.id) });
      } else if (r < 0.88) {
        if (undo.length === 0) continue;
        await a.undo();
        log.push("undo");
        redo.push(model);
        model = undo.pop()!;
      } else {
        if (redo.length === 0) continue;
        await a.redo();
        log.push("redo");
        undo.push(model);
        model = redo.pop()!;
      }
      await check(`step ${step}`);
    }
    await a.close();
  });
}

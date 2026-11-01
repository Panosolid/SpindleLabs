// Move, timeline and undo bug hunt (2026-11-01): seeded sessions in the real app (menus, the Move tool,
// undo/redo) on three boxes, against a plain model of boxes and shifts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyReference, insertPreset, partDocument } from "@fission/design";
import { app } from "./design-app.ts";
import { seeded } from "../src/index.ts";

type Item = { id: string; kind: "box"; size: [number, number, number]; suppressed: boolean } | { id: string; kind: "move"; bodies: string[]; shift: [number, number, number]; suppressed: boolean };
type M = { items: Item[]; marker: string | undefined };
type App = Awaited<ReturnType<typeof app>>;

function expect(m: M) {
  const status: Record<string, string> = {};
  const at: Record<string, [number, number, number]> = {};
  let rolled = m.marker === "start";
  for (const it of m.items) {
    if (rolled) { status[it.id] = "rolled"; continue; }
    if (it.suppressed) status[it.id] = "suppressed";
    else if (it.kind === "box") { status[it.id] = "built"; at[it.id] = [0, 0, 0]; }
    else {
      let s = "built";
      for (const b of it.bodies) {
        const st = status[b];
        if (st === "suppressed" || st === "greyed") { s = "greyed"; break; }
      }
      if (s === "built") for (const b of it.bodies) { if (status[b] === undefined) { s = "failed"; break; } if (status[b] !== "built") { s = "failed"; break; } }
      status[it.id] = s;
      if (s === "built") for (const b of it.bodies) at[b] = at[b].map((x, i) => x + it.shift[i]) as [number, number, number];
    }
    if (m.marker === it.id) rolled = true;
  }
  let vol = 0;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const it of m.items) if (it.kind === "box" && status[it.id] === "built") {
    vol += it.size[0] * it.size[1] * it.size[2];
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], at[it.id][k]); hi[k] = Math.max(hi[k], at[it.id][k] + it.size[k]); }
  }
  return { status, vol, bounds: vol === 0 ? null : [lo, hi] };
}

const barState = (a: App) => Object.fromEntries([...a.window.document.querySelectorAll(".timeline-bar-item")].map((e: any) => [e.dataset.item, e.dataset.rolledBack ? "rolled" : e.dataset.failed ? "failed" : e.dataset.greyed ? "greyed" : e.dataset.suppressed ? "suppressed" : "built"]));
const meshBounds = (a: App) => { const mesh = a.mesh(); if (!mesh || mesh.positions.length === 0) return null; const p = [...mesh.positions]; const ax = (k: number) => p.filter((_, i) => i % 3 === k); return [[0, 1, 2].map((k) => Math.min(...ax(k))), [0, 1, 2].map((k) => Math.max(...ax(k)))]; };

const SEEDS = Number(process.env.HUNT_SEEDS ?? 15);
for (let seed = 1; seed <= SEEDS; seed++) {
  test(`hunt session seed ${seed}`, async () => {
    const r = seeded(BigInt(seed));
    const rint = (a: number, b: number) => a + Math.floor(r.next() * (b - a + 1));
    let doc = partDocument("box", 10, 20, 30);
    doc = insertPreset(doc, "box", 7, 5, 3).doc;
    doc = insertPreset(doc, "box", 2, 9, 4).doc;
    let model: M = { items: doc.timeline.features.map((f) => ({ id: f.id, kind: "box", size: [f.intent.parameters.width, f.intent.parameters.depth, f.intent.parameters.height] as [number, number, number], suppressed: false })), marker: undefined };
    const undo: M[] = [], redo: M[] = [];
    const record = (next: M) => { undo.push(model); redo.length = 0; model = next; };
    const copy = (): M => JSON.parse(JSON.stringify(model));
    const a = await app(doc);
    const log: string[] = [];
    for (let step = 0; step < 25; step++) {
      const e = expect(model);
      const n = r.next();
      const items = model.items;
      if (n < 0.25) {
        const shown = items.filter((i) => i.kind === "box" && e.status[i.id] === "built").map((i) => i.id);
        if (shown.length === 0) continue;
        const picked = shown.filter(() => r.next() < 0.5);
        if (picked.length === 0) picked.push(shown[0]);
        const shift: [number, number, number] = [rint(-20, 20), rint(-20, 20), rint(0, 10)];
        if (shift.every((x) => x === 0)) shift[0] = 1;
        log.push(`move ${picked} by ${shift}`);
        a.selection.set(picked.map((p) => bodyReference(`body:${p}`)));
        await a.settle();
        await a.key("move-tool");
        for (const [k, x] of [["x", shift[0]], ["y", shift[1]], ["z", shift[2]]] as const) {
          const box = a.$(`#move-${k}`) as HTMLInputElement;
          box.value = String(x);
          box.dispatchEvent(new a.window.Event("input") as unknown as Event);
        }
        (a.$("#move-ok") as HTMLButtonElement).click();
        await a.settle();
        const made = a.doc().timeline.features.find((f) => !model.items.some((i) => i.id === f.id));
        assert.ok(made, `a Move was made (${log.join("; ")}) err ${a.$("#move-error")?.textContent}`);
        const next = copy();
        const place = next.marker === undefined ? next.items.length : next.marker === "start" ? 0 : next.items.findIndex((i) => i.id === next.marker) + 1;
        next.items.splice(place, 0, { id: made.id, kind: "move", bodies: picked, shift, suppressed: false });
        if (next.marker !== undefined) next.marker = made.id;
        record(next);
      } else if (n < 0.35) {
        const moves = items.filter((i) => i.kind === "move");
        if (moves.length === 0) continue;
        const it = moves[rint(0, moves.length - 1)] as Extract<Item, { kind: "move" }>;
        const shift: [number, number, number] = [rint(-20, 20), rint(-20, 20), rint(0, 10)];
        if (shift.every((x) => x === 0)) shift[1] = 2;
        log.push(`edit ${it.id} to ${shift}`);
        await a.doubleClick(it.id);
        for (const [k, x] of [["x", shift[0]], ["y", shift[1]], ["z", shift[2]]] as const) {
          const box = a.$(`#move-${k}`) as HTMLInputElement;
          box.value = String(x);
          box.dispatchEvent(new a.window.Event("input") as unknown as Event);
        }
        (a.$("#move-ok") as HTMLButtonElement).click();
        await a.settle();
        const panelOpen = a.$("#move-panel") !== null && a.$("#move-panel")!.closest("[hidden]") === null;
        if (panelOpen && it.bodies.some((b) => !model.items.some((i) => i.id === b))) { (a.$("#move-cancel") as HTMLButtonElement).click(); await a.settle(); log.push("(refused, failed Move)"); continue; }
        assert.ok(!panelOpen, `the panel closed after OK (${log.join("; ")}): ${a.$("#move-error")?.textContent}`);
        const next = copy();
        const same = it.shift.every((x, i) => x === shift[i]);
        const nm = next.items.find((i) => i.id === it.id) as Extract<Item, { kind: "move" }>;
        nm.shift = shift;
        // (the working tree's uncommitted move-tool.ts patch, another helper's: an edit drops a deleted body)
        const kept = nm.bodies.filter((b) => model.items.some((i) => i.id === b));
        const dropped = kept.length !== nm.bodies.length;
        nm.bodies = kept;
        if (!same || dropped) record(next);
      } else if (n < 0.45) {
        if (items.length === 0) continue;
        const it = items[rint(0, items.length - 1)];
        log.push(`${it.suppressed ? "unsuppress" : "suppress"} ${it.id}`);
        await a.menu(it.id, it.suppressed ? "unsuppress" : "suppress");
        const next = copy();
        next.items.find((i) => i.id === it.id)!.suppressed = !it.suppressed;
        record(next);
      } else if (n < 0.6) {
        if (items.length === 0) continue;
        const k = rint(0, items.length - 1);
        const it = items[k];
        log.push(`delete ${it.id}`);
        await a.menu(it.id, "delete");
        const box = a.$("#delete-ask") as HTMLDialogElement | null;
        if (box?.open) { (a.$("#delete-ask-confirm") as HTMLButtonElement).click(); await a.settle(); }
        const next = copy();
        next.items.splice(k, 1);
        if (next.marker === it.id) next.marker = k === 0 ? "start" : items[k - 1].id;
        record(next);
      } else if (n < 0.72) {
        if (items.length === 0) continue;
        const k = rint(0, items.length - 1);
        const at = items[k].id;
        const place = model.marker === undefined ? items.length : model.marker === "start" ? 0 : items.findIndex((i) => i.id === model.marker) + 1;
        if (place === k + 1) continue;
        log.push(`marker ${at}`);
        await a.menu(at, "marker");
        const next = copy();
        next.marker = k === items.length - 1 ? undefined : at;
        record(next);
      } else if (n < 0.86) {
        if (undo.length === 0) continue;
        log.push("undo");
        await a.undo();
        redo.push(model);
        model = undo.pop()!;
      } else {
        if (redo.length === 0) continue;
        log.push("redo");
        await a.redo();
        undo.push(model);
        model = redo.pop()!;
      }
      const want = expect(model);
      const what = `seed ${seed} after ${log.join("; ")}`;
      assert.deepEqual(a.doc().timeline.features.map((f) => f.id), model.items.map((i) => i.id), `items, ${what}`);
      assert.equal(a.doc().timeline.marker, model.marker, `marker, ${what}`);
      assert.deepEqual(barState(a), want.status, `bar, ${what}`);
      assert.ok(Math.abs(a.volume() - want.vol) < 1e-6 * Math.max(1, want.vol), `volume ${a.volume()} want ${want.vol}, ${what}`);
      const got = meshBounds(a);
      assert.deepEqual(got && got.map((p) => p.map((x) => Math.round(x * 1e6) / 1e6)), want.bounds, `bounds, ${what}`);
    }
    assert.ok(await a.close(), "freed");
  });
}

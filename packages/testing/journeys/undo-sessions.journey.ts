// Undo bug hunt (2026-11-01): seeded sessions of edits, Undo and Redo (some while the
// kernel is slow) in the real Design on the real kernel. A mirror of the undo
// steps, kept from what was recorded when each was made (a fake clock, so the
// merging is known): every state Undo or Redo reaches must be the one
// recorded, and the view's volume the one first drawn for that state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { designWorkspace, partDocument } from "@fission/design";
import { app, chooseShape } from "./design-app.ts";

const SEEDS = Number(process.env.HUNT_SESSIONS ?? 6);
const STEPS = Number(process.env.HUNT_STEPS ?? 60);
const FIRST = Number(process.env.HUNT_FIRST ?? 1);
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => (p < q ? -1 : 1))) : x));

let clock = 1_000_000;
const realNow = Date.now;

async function session(seed: number) {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  Date.now = () => clock;
  const a = await app(partDocument("box", 40, 30, 20), designWorkspace);
  const h = a.history;
  // The mirror.
  type E = { state: string; label: string; key?: string; at: number };
  let es: E[] = [{ state: canon(a.doc()), label: "", at: clock }];
  let ix = 0;
  let lastRec = false;
  let restoredThenAmended: string[] = [];
  let sinceRestore = false;
  const record = h.record.bind(h), amend = h.amend.bind(h), undo = h.undo.bind(h), redo = h.redo.bind(h);
  h.record = (label, key) => {
    const ok = record(label, key);
    if (!ok) return ok;
    sinceRestore = false;
    const s = canon(a.doc());
    es.length = ix + 1;
    const top = es[ix];
    if (lastRec && ix > 0 && key !== undefined && top.key === key && clock - top.at < 1000) {
      if (s === es[ix - 1].state) (es.pop(), ix--, (lastRec = false));
      else es[ix] = { state: s, label, key, at: clock };
    } else {
      es.push({ state: s, label, key, at: clock });
      ix++;
      lastRec = true;
    }
    assert.equal(h.canRedo(), false, "nothing to redo after a new step");
    return ok;
  };
  h.amend = (keep) => {
    const ok = amend(keep);
    if (!ok) return ok;
    const s = canon(a.doc());
    if (sinceRestore) restoredThenAmended.push(es[ix].label);
    es[ix] = { ...es[ix], state: s };
    if (ix > 0 && s === es[ix - 1].state) (es.splice(ix, 1), ix--, (lastRec = false));
    else if (!keep) lastRec = false;
    return ok;
  };
  h.undo = () => {
    const l = undo();
    if (l !== null) (ix--, (lastRec = false), (sinceRestore = true));
    return l;
  };
  h.redo = () => {
    const l = redo();
    if (l !== null) (ix++, (lastRec = false), (sinceRestore = true));
    return l;
  };
  const volumeOf = new Map<string, number>();
  const done: string[] = [];
  let held = false;
  const check = (what: string) => {
    const now = canon(a.doc());
    assert.equal(h.undoLabel(), ix > 0 ? es[ix].label : null, `undo label after ${what}`);
    assert.equal(h.canRedo(), ix < es.length - 1, `redo after ${what}`);
    assert.equal(now, es[ix].state, `the state is the mirror's after ${what}`);
    if (held || a.$("[data-rebuilding]")?.dataset.rebuilding === "true") return;
    if (a.error()) return;
    const v = a.volume();
    const seen = volumeOf.get(now);
    if (seen === undefined) volumeOf.set(now, v);
    else assert.ok(Math.abs(seen - v) <= 1e-6 * Math.max(1, Math.abs(v)), `the view after ${what} shows ${v} mm³, ${seen} when this state was first drawn`);
  };
  try {
    for (let step = 0; step < STEPS; step++) {
      clock += r() < 0.5 ? Math.floor(r() * 900) : 1000 + Math.floor(r() * 5000);
      const roll = r();
      let what = "";
      if (roll < 0.25) {
        const key = pick(["width", "depth", "height"]);
        const box = a.$(`#${key}`) as HTMLInputElement;
        box.value = String(5 + Math.floor(r() * 55));
        box.dispatchEvent(new a.window.Event("input") as unknown as Event);
        what = `type ${key} ${box.value}`;
      } else if (roll < 0.33) {
        const shape = pick(["Box", "Cylinder", "Sphere"]);
        try { chooseShape(a, shape); what = `shape ${shape}`; } catch { what = `no shape ${shape}`; }
      } else if (roll < 0.5) {
        const l = h.undo();
        what = `undo (${l})`;
      } else if (roll < 0.62) {
        const l = h.redo();
        what = `redo (${l})`;
      } else if (roll < 0.7) {
        if (held) {
          await a.release();
          held = false;
          what = "release";
        } else {
          a.hold();
          held = true;
          what = "hold";
        }
      } else if (roll < 0.8 && !held) {
        const fs = a.doc().timeline.features;
        if (fs.length > 0) {
          const f = pick(fs);
          const entry = pick([f.suppressed ? "unsuppress" : "suppress", "marker"]);
          const off = await a.menu(f.id, entry);
          what = `${entry} ${f.id}${off !== null ? " off" : ""}`;
        }
      } else if (roll < 0.9 && !held) {
        const fs = a.doc().timeline.features.filter((f) => f.intent.type !== "sketch");
        if (fs.length > 0) {
          const f = pick(fs);
          const off = await a.menu(f.id, "edit");
          if (off === null) {
            for (const key of ["width", "depth", "height"]) {
              const b = a.$(`#edit-${key}`) as HTMLInputElement | null;
              if (b && !b.closest("[hidden]") && r() < 0.7) b.value = String(5 + Math.floor(r() * 55));
            }
            // Sometimes Undo with the Edit feature panel still open.
            if (r() < 0.3) {
              h.undo();
              what = `edit ${f.id}, undo with the panel open`;
            } else {
              a.$("#feature-edit-ok")!.click();
              what = `edit ${f.id} ok`;
            }
            await a.settle();
            if (a.$("#feature-edit") && !a.$("#feature-edit")!.hidden) a.$("#feature-edit-cancel")!.click();
          } else what = `edit ${f.id} off`;
        }
      } else if (!held) {
        const kind = pick(["box", "cylinder", "sphere"]);
        a.$("#insert")?.click();
        const items = a.window.document.querySelectorAll(`#insert-${kind}`);
        // Insert a box from the toolbar's Insert menu, when there is one.
        const button = [...items][0] as HTMLElement | undefined;
        if (button) {
          button.click();
          what = `insert ${kind}`;
        } else what = "no insert";
      }
      if (held) for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
      else await a.settle();
      done.push(what);
      check(what);
    }
    if (held) await a.release();
    await a.settle();
    check("the end");
    if (seed === FIRST) console.log(done.join(" | "), "depth", ix, es.length);
    return restoredThenAmended;
  } catch (e) {
    throw new Error(`seed ${seed}, after: ${done.slice(-12).join(" | ")}\n${(e as Error).message}`);
  } finally {
    Date.now = realNow;
    await a.close();
  }
}

test("seeded undo sessions: Undo and Redo reach the states recorded, drawn as first drawn", async () => {
  const amended: string[] = [];
  for (let s = FIRST; s < FIRST + SEEDS; s++) amended.push(...(await session(s)).map((l) => `seed ${s}: ${l}`));
  if (amended.length) console.log("steps rewritten by an amend after Undo/Redo:", amended);
});

// Reviewer repros (sweep-storage review): a clock stepped back after a save, and an entry recovery could not store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, type Project } from "@fission/core";
import { memoryKeyValue, projectStore, recoverUnsaved, startAutosave, type JournalStorage, type ProjectStore } from "../src/index.ts";

const part = (w: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width: w } } });
const settle = () => new Promise<void>((r) => setImmediate(r));
function storage(): JournalStorage {
  const m = new Map<string, string>();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

test("single tab: clock steps back (NTP) between a save and closing -> last edit lost on next visit", async () => {
  // Stored 40 at t = 1,000,000; the clock is set back a minute and 45 is journalled as the page goes. The entry's
  // time must not be before this tab's own save (1,000,000), or the next visit skips it as older and 45 is lost.
  let t = 1_000_000;
  const now = () => new Date(t);
  const real = projectStore(memoryKeyValue(), [], now);
  let dead = false; // page closing: saves never finish
  const store: ProjectStore = { ...real, save: (...a) => (dead ? new Promise<void>(() => {}) : real.save(...a)) };
  const journal = storage();
  let project = part(40);
  const timers = { setTimeout: (fn: () => void) => (queueMicrotask(fn), 1), clearTimeout: () => {} };
  const a = startAutosave(store, "p", () => project, () => {}, { journal, now, timers, quietMs: 0 });
  a.changed(); await settle(); await settle(); // stored width 40 at t=1_000_000
  assert.equal(((await real.open("p")).workspaces.design as any).width, 40);
  t -= 60_000; // the system clock is corrected back a minute
  project = part(45);
  a.changed();
  dead = true;
  assert.equal(a.leaving(), true); // journals 45: the page is told the change is kept
  // next visit
  await recoverUnsaved(real, journal, []);
  assert.equal(((await real.open("p")).workspaces.design as any).width, 45, "the journalled edit was thrown away");
});

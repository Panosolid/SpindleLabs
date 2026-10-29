// Reviewer repros (sweep-storage review): a clock stepped back after a save, and an entry recovery could not store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type Project } from "@fission/core";
import { journalEntry, memoryKeyValue, projectStore, recoverUnsaved, startAutosave, unsavedKey, type JournalStorage, type ProjectStore } from "../src/index.ts";

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

test("single tab: an entry recovery couldn't store ('kept for the next visit') is deleted by the first autosave", async () => {
  // Stored 40 (save time 500); the journal holds 45 written at 900. Recovery's save is refused (quota) and says the
  // changes are kept. The reopened tab (showing 40) is renamed: its save must not go over them, nor remove them, so
  // the next visit, with storage working, puts 45 back.
  let t = 1000; const now = () => new Date(t);
  const real = projectStore(memoryKeyValue(), [], now);
  await real.save("p", part(40), new Date(500));
  const journal = storage();
  journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(45)), new Date(900)));
  let full = true; // a transient quota error on the recovery save
  const store: ProjectStore = { ...real, save: (...a) => (full ? Promise.reject(new Error("quota")) : real.save(...a)) };
  const msgs = await recoverUnsaved(store, journal, []);
  assert.equal(msgs.length, 1); // "they are shown, and kept in this browser until it has room"
  full = false;
  const top = (await real.list())[0];
  const timers = { setTimeout: (fn: () => void) => (queueMicrotask(fn), 1), clearTimeout: () => {} };
  let project = await real.open("p");
  const a = startAutosave(store, "p", () => project, () => {}, { journal, now, timers, quietMs: 0, stored: true, storedAt: top.modified });
  project = { ...project, name: "Renamed" }; a.changed(); await settle(); await settle();
  assert.notEqual(journal.getItem(unsavedKey("p")), null, "the kept unsaved changes were deleted");
  assert.equal(((await real.open("p")).workspaces.design as any).width, 40, "nothing saved over them");
  assert.equal(a.leaving(), false, "the page asks before going");
  assert.deepEqual(await recoverUnsaved(real, journal, []), []);
  assert.equal(((await real.open("p")).workspaces.design as any).width, 45, "the next visit puts them back");
});

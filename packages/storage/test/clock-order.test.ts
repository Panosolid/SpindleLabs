// Real-use hunt B5: a device clock that ran ahead and was then put right. The
// list's order comes from a count of saves, not the clock (store.ts), and an
// autosave never stamps a save older than the state it replaces (autosave.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, type Project } from "@fission/core";
import { memoryKeyValue, projectStore, recoverUnsaved, startAutosave, unsavedKey, type JournalStorage } from "../src/index.ts";

const part = (name: string, width: number): Project => ({ ...emptyProject(name), workspaces: { design: { version: 1, width } } });
const widthOf = (p: Project) => (p.workspaces.design as { width: number }).width;
const settle = () => new Promise<void>((r) => setImmediate(r));
const DAY = 86_400_000;
function fakeStorage() {
  const items = new Map<string, string>();
  const s: JournalStorage & { items: Map<string, string> } = {
    items,
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
  return s;
}

test("the saves are counted 1, 2, 3 across projects, worked by hand", async () => {
  // Three saves into an empty store: a, b, then a again. The count starts at 0 and each save adds one, so a's first
  // save is 1, b's is 2 and a's second is 3; the list is by count, highest first: a (3), b (2).
  const kv = memoryKeyValue();
  const store = projectStore(kv, [], () => new Date(0));
  await store.save("a", part("A", 1));
  await store.save("b", part("B", 1));
  await store.save("a", part("A", 2));
  assert.equal(kv.entries.get("order"), "3");
  assert.deepEqual((await store.list()).map((s) => [s.id, s.order]), [["a", 3], ["b", 2]]);
});

test("a count that can't be read starts again from 1, and a summary's odd order counts as none", async () => {
  // The check fails for a test that trusted whatever was stored: "x" or -4 as the count would give NaN or -3.
  for (const bad of ["x", "-4", "1.5", ""]) {
    const kv = memoryKeyValue();
    await kv.set("order", bad);
    const store = projectStore(kv, []);
    await store.save("a", part("A", 1));
    assert.equal(kv.entries.get("order"), "1", JSON.stringify(bad));
  }
  const kv = memoryKeyValue();
  await kv.set("summary/odd", JSON.stringify({ name: "Odd", modified: "2026-01-01T00:00:00.000Z", order: "7" }));
  assert.equal((await projectStore(kv, []).list())[0].order, 0);
});

test("B5a: a project stored while the clock ran a day ahead no longer stays first once the clock is put right", async () => {
  // main.ts start() opens list()[0]. "Old" is saved with the clock a day ahead; the clock is put right and "New" is
  // worked on for 5 hours. By time, Old (a day) would stay first; by count, New (saves 2 to 6) is after Old (1).
  let t = DAY;
  const store = projectStore(memoryKeyValue(), [], () => new Date(t));
  await store.save("old", part("Old", 10));
  t = 1000; // clock put right
  for (let h = 1; h <= 5; h++) {
    t += 3_600_000;
    await store.save("new", part("New", 10 + h));
  }
  assert.equal((await store.list())[0].name, "New", "the reload opens the project worked on last");
});

test("B5b: with the clock set back, a closed tab's stale journal entry is not put back over newer work", async () => {
  // Stored at 5000 while the clock ran ahead. Tab A changes it to 45 and closes before its save lands: its entry is
  // stamped max(now, base) = 5000. The clock is put right (100). Tab B, opened from the store (base 5000), stores 70
  // at 1200 by the clock; its save is stamped 5001 instead, just after the state it replaces. Next visit: A's entry
  // (5000) is older than the store's 5001, so B's 70 stays.
  let t = 5000;
  const now = () => new Date(t);
  const store = projectStore(memoryKeyValue(), [], now);
  const journal = fakeStorage();
  await store.save("p", part("P", 40));
  const storedAt = (await store.list())[0].modified;
  const never: typeof store = { ...store, save: () => new Promise<void>(() => {}) };
  let a = part("P", 40);
  const timers = { setTimeout: () => 1, clearTimeout: () => {} };
  const tabA = startAutosave(never, "p", () => a, () => {}, { timers, journal, stored: true, storedAt, now });
  a = part("P", 45);
  tabA.changed();
  let b = part("P", 40);
  let fire = () => {};
  const tabB = startAutosave(store, "p", () => b, () => {}, { timers: { setTimeout: (fn) => ((fire = fn), 2), clearTimeout: () => {} }, journal, stored: true, storedAt, now });
  t = 100; // the clock is set back
  tabA.leaving();
  assert.match(journal.items.get(unsavedKey("p"))!, /^@5000~5000#[\w-]+\n/, "A's entry stamped 5000, made from the state saved at 5000, then A's writer id");
  b = part("P", 70);
  tabB.changed();
  t = 1200;
  fire();
  await settle();
  assert.equal(widthOf(await store.open("p")), 70, "B stored 70");
  assert.equal((await store.list())[0].modified.getTime(), 5001, "B's save stamped just after the state it replaced");
  await recoverUnsaved(store, journal, [], () => "copy");
  assert.equal(widthOf(await store.open("p")), 70, "the next visit keeps B's newer 70");
  assert.equal(widthOf(await store.open("copy")), 45, "and A's change, made from the state B replaced, as a separate project (real-use hunt S1)");
});

test("an autosave with the clock running forward stamps its saves by the clock, as before", async () => {
  // The B5 rule only acts when the clock is behind the stored state: at 2000 over a state stored at 1000, the save
  // is stamped 2000, not 1001.
  let t = 1000;
  const now = () => new Date(t);
  const store = projectStore(memoryKeyValue(), [], now);
  await store.save("p", part("P", 1));
  let p = part("P", 1);
  let fire = () => {};
  const tab = startAutosave(store, "p", () => p, () => {}, { timers: { setTimeout: (fn) => ((fire = fn), 1), clearTimeout: () => {} }, stored: true, storedAt: new Date(1000), now });
  p = part("P", 2);
  tab.changed();
  t = 2000;
  fire();
  await settle();
  assert.equal((await store.list())[0].modified.getTime(), 2000);
});

// Two tabs on one project (app sweep 2026-10-28, finding 1): tab A closes
// with a change not stored yet, so `leaving()` journals it; tab B carries on
// and stores newer work. A's journal entry was put back blindly on the next
// visit, over B's newer work. Each journal entry now says when it was
// written, and the store's save time says when the state it holds was read,
// so the next visit skips (and removes) an entry older than what the store
// holds, and a tab's save removes such an entry at once. One store and one
// localStorage are shared by both tabs, as in a browser, on one fake clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type Project } from "@fission/core";
import {
  memoryKeyValue,
  projectStore,
  recoverUnsaved,
  startAutosave,
  unsavedKey,
  type JournalStorage,
  type ProjectStore,
  type Timers,
} from "../src/index.ts";

const part = (width: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width } } });
const widthOf = (p: Project) => (p.workspaces.design as { width: number }).width;
const settle = () => new Promise<void>((r) => setImmediate(r));

/** One clock for both tabs and the store: timers run, and `now()` moves, only when the test moves time on. */
function fakeClock() {
  let t = 0;
  let next = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout: (fn, ms) => (pending.set(++next, { at: t + ms, fn }), next),
    clearTimeout: (h) => void pending.delete(h as number),
  };
  async function advance(ms: number) {
    const end = t + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      t = due[1].at;
      due[1].fn();
      await settle();
    }
    t = end;
    await settle();
  }
  return { timers, advance, now: () => new Date(t) };
}

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

/** A tab that closes: its store's saves never finish (the page has gone before they could). */
const closing = (store: ProjectStore): ProjectStore => ({ ...store, save: () => new Promise<void>(() => {}) });

test("a tab closed mid-save doesn't put its older change back over another tab's newer stored work (worked by hand)", async () => {
  // Stored at width 40 at t = 0. Both tabs open it. A changes it to 45 at
  // t = 0 and is closed at t = 100: leaving() journals 45 written at 100,
  // and A's save never finishes. B changes it to 70 at t = 200; its save
  // reads the project at t = 1200 (the quiet second later) and stores 70,
  // save time 1200. The entry (100) is older than the store's state (1200),
  // so B's save removes it, and a next visit that still found it would skip
  // it: the store reads 70, the newer work, not 45.
  const clock = fakeClock();
  const kv = memoryKeyValue();
  const store = projectStore(kv, [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40));
  let a = part(40);
  let b = part(40);
  const tabA = startAutosave(closing(store), "p", () => a, () => {}, { timers: clock.timers, journal, stored: true, now: clock.now });
  const tabB = startAutosave(store, "p", () => b, () => {}, { timers: clock.timers, journal, stored: true, now: clock.now });
  a = part(45);
  tabA.changed();
  await clock.advance(100);
  assert.equal(tabA.leaving(), true);
  const entry = journal.items.get(unsavedKey("p"))!;
  assert.ok(entry.endsWith(projectToJson(part(45))), "A's change journalled");
  await clock.advance(100);
  b = part(70);
  tabB.changed();
  await clock.advance(1000);
  assert.equal(widthOf(await store.open("p")), 70, "B stored 70");
  assert.equal(journal.items.has(unsavedKey("p")), false, "B's save removed the older entry");

  // The entry still there on the next visit (B's save couldn't remove it): skipped and removed.
  journal.setItem(unsavedKey("p"), entry);
  const problems = await recoverUnsaved(store, journal, []);
  assert.deepEqual(problems, []);
  assert.equal(widthOf(await store.open("p")), 70, "the newer stored work is kept");
  assert.equal(journal.items.has(unsavedKey("p")), false, "the older entry is removed");
});

test("an entry newer than the store, or written the same millisecond, is still put back", async () => {
  // Stored 40 at t = 500. An entry written at 501 (newer) is put back; so is
  // one written at 500 exactly, as no one can tell which came first and
  // keeping a change beats losing one. An entry from before entries had times
  // (the file text alone) is put back too, as it always was.
  for (const [entry, want] of [
    [`@501\n${projectToJson(part(45))}`, 45],
    [`@500\n${projectToJson(part(46))}`, 46],
    [projectToJson(part(47)), 47],
    [`@499\n${projectToJson(part(48))}`, 40],
  ] as const) {
    let t = 0;
    const store = projectStore(memoryKeyValue(), [], () => new Date(t));
    t = 500;
    await store.save("p", part(40));
    const journal = fakeStorage();
    journal.setItem(unsavedKey("p"), entry);
    assert.deepEqual(await recoverUnsaved(store, journal, []), []);
    assert.equal(widthOf(await store.open("p")), want, entry.slice(0, 5));
    assert.equal(journal.items.size, 0);
  }
});

test("a save's time is when its state was read, so a slow save of an older state doesn't hide a newer entry", async () => {
  // Stored 10. A change to 20; its save reads the project at t = 1000 and
  // takes until t = 3000. A change to 30 at t = 1500, and the page goes at
  // t = 2000: 30 journalled at 2000. The store's state is as of 1000 (when
  // 20 was read), older than the entry, so the next visit puts 30 back. Had
  // the save time been when the save finished (3000), 30 would be skipped.
  const clock = fakeClock();
  const kv = memoryKeyValue();
  let slow = false;
  let release = () => {};
  // IndexedDB's writes take time: while `slow`, each write waits for `release()`.
  const slowKv = { ...kv, set: (k: string, v: string) => (slow ? new Promise<void>((r) => (release = () => void kv.set(k, v).then(r))) : kv.set(k, v)) };
  const inner = projectStore(slowKv, [], clock.now);
  await inner.save("p", part(10));
  slow = true;
  const journal = fakeStorage();
  let project = part(10);
  const tab = startAutosave(inner, "p", () => project, () => {}, { timers: clock.timers, journal, stored: true, now: clock.now });
  project = part(20);
  tab.changed();
  await clock.advance(1500);
  project = part(30);
  tab.changed();
  await clock.advance(500);
  tab.leaving();
  await clock.advance(1000);
  release(); // the project's text written at t = 3000
  await settle();
  release(); // and its summary
  await settle();
  slow = false;
  assert.deepEqual(await recoverUnsaved(inner, journal, []), []);
  assert.equal(widthOf(await inner.open("p")), 30);
});

test("a save time that isn't a time is refused before anything is written", async () => {
  // The save time is what journal entries are compared with: an invalid one
  // would compare false both ways, so it is refused, and the store keeps 40.
  const store = projectStore(memoryKeyValue(), []);
  await store.save("p", part(40));
  await assert.rejects(store.save("p", part(41), new Date(NaN)), /a stored project needs a valid save time/);
  assert.equal(widthOf(await store.open("p")), 40);
});

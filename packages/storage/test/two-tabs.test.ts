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
  journalEntry,
  memoryKeyValue,
  readJournalEntry,
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

// Finding 2: two tabs both open on one project. Each tab knows the save
// time of the stored project it last read or wrote; a save is refused when
// the store's has changed since (another tab saved), so a stale tab never
// silently overwrites another tab's saved edit, and it says so.

test("a stale tab's save is refused, and says so, instead of overwriting another tab's saved edit (worked by hand)", async () => {
  // Stored 40 at t = 0; both tabs open it, knowing save time 0. A changes it
  // to 45 at t = 0; its save at t = 1000 finds save time 0 as expected and
  // stores 45 (save time 1000). B, still showing 40, changes it to 25 at
  // t = 1100; its save at t = 2100 expects save time 0 but finds 1000, so
  // it is refused: the store keeps 45 and B says another tab changed it.
  // A's next change still saves (it expects 1000, finds 1000). B leaving
  // keeps nothing in the journal (a next visit would put 25 back over A's
  // work) and asks before going instead.
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40));
  let a = part(40);
  let b = part(40);
  const bSaid: string[] = [];
  const opts = { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now };
  const tabA = startAutosave(store, "p", () => a, () => {}, opts);
  const tabB = startAutosave(store, "p", () => b, (s) => bSaid.push(s.state === "error" ? s.message : s.state), opts);
  a = part(45);
  tabA.changed();
  await clock.advance(1100);
  assert.equal(widthOf(await store.open("p")), 45);
  b = part(25);
  tabB.changed();
  await clock.advance(1000);
  assert.equal(widthOf(await store.open("p")), 45, "B didn't overwrite A's saved edit");
  assert.equal(bSaid.at(-1), "This project was changed in another tab. Reload to see the newer version.");
  b = part(26);
  tabB.changed();
  await clock.advance(1000);
  assert.equal(widthOf(await store.open("p")), 45, "nor with its next change");
  assert.equal(tabB.leaving(), false, "B asks before going");
  assert.equal(journal.items.size, 0, "B's stale change isn't journalled to be put back over A's");
  a = part(50);
  tabA.changed();
  await clock.advance(1000);
  assert.equal(widthOf(await store.open("p")), 50, "A carries on saving");
});

test("a save expecting a save time is refused when the store's differs by a millisecond either way", async () => {
  // Stored 40 at t = 1000. Expecting 999 or 1001 is refused and the store keeps 40; expecting 1000 stores 41.
  let t = 1000;
  const store = projectStore(memoryKeyValue(), [], () => new Date(t));
  await store.save("p", part(40));
  t = 2000;
  for (const expect of [999, 1001]) {
    await assert.rejects(store.save("p", part(41), undefined, new Date(expect)), /changed in another tab/);
    assert.equal(widthOf(await store.open("p")), 40);
  }
  await store.save("p", part(41), undefined, new Date(1000));
  assert.equal(widthOf(await store.open("p")), 41);
});

test("a stale tab finishing (another project opened) stores nothing and leaves nothing to be put back", async () => {
  // Stored 40 at t = 0, both tabs knowing save time 0. A stores 45 at t = 1000. B changes to 25 at t = 1100 and opens
  // another project at once (finish): 25 is journalled, then its save after the flight expects 0, finds 1000 and is
  // refused, so the entry goes too: a next visit reads 45, A's work.
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40));
  let a = part(40);
  let b = part(40);
  const opts = { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now };
  const tabA = startAutosave(store, "p", () => a, () => {}, opts);
  const tabB = startAutosave(store, "p", () => b, () => {}, opts);
  a = part(45);
  tabA.changed();
  await clock.advance(1100);
  b = part(25);
  tabB.changed();
  tabB.finish();
  await settle();
  await settle();
  assert.equal(journal.items.size, 0);
  assert.deepEqual(await recoverUnsaved(store, journal, []), []);
  assert.equal(widthOf(await store.open("p")), 45);
});

// Real-use hunt S1 / B1b (2026-11-01): tab B, stale, journals its change when its page is hidden, before its save
// finds that tab A stored newer work. The entry was newer than the store's state, so the next visit put B's stale
// state back over A's saved edit. Each entry now also names the stored state it was made from (the save time the
// tab expected); recovery puts it back only over that state, and otherwise keeps it as a separate project.

test("a stale tab hidden before its save is refused: the next visit keeps A's work and B's as a separate project (worked by hand)", async () => {
  // Stored 40 at t = 0, both tabs expecting save time 0. A changes to 45; its save at t = 1000 stores 45 (save time
  // 1000). B, still on 40, changes to 25 at t = 1100 and is hidden at t = 1300: leaving() journals 25, written at
  // 1300 (newer than 1000) but made from the state saved at 0. Its save expects 0, finds 1000 and is refused. Next
  // visit: the store's 1000 is not the entry's 0, so 25 must not go over 45: "p" keeps 45, and 25 is kept as a new
  // project "Box (from another tab)", with a message naming it, and the entry goes.
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40));
  let a = part(40);
  let b = part(40);
  const opts = { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now };
  const tabA = startAutosave(store, "p", () => a, () => {}, opts);
  const tabB = startAutosave(store, "p", () => b, () => {}, opts);
  a = part(45);
  tabA.changed();
  await clock.advance(1100);
  b = part(25);
  tabB.changed();
  await clock.advance(200);
  assert.equal(tabB.leaving(), true, "B didn't know yet, so it journalled its change");
  await settle();
  await settle();
  assert.equal(widthOf(await store.open("p")), 45, "B's save was refused");
  const problems = await recoverUnsaved(store, journal, [], () => "copy-1");
  assert.equal(widthOf(await store.open("p")), 45, "A's saved edit is not overwritten");
  assert.equal(widthOf(await store.open("copy-1")), 25, "B's change is kept as a separate project");
  assert.equal((await store.open("copy-1")).name, "Box (from another tab)");
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /"Box \(from another tab\)"/);
  assert.equal(journal.items.size, 0, "the entry goes once its copy is stored");
  // The project the user last saw stored opens next, not the copy: the copy is listed behind every other project.
  assert.deepEqual((await store.list()).map((x) => x.id), ["p", "copy-1"]);
  await store.save("q", part(1));
  assert.deepEqual((await store.list()).map((x) => x.id), ["q", "p", "copy-1"], "and stays behind later saves");
});

test("A saving again later doesn't silently remove the stale tab's entry: it still becomes a separate project", async () => {
  // As above, then A changes to 50 at t = 1400 and stores it at t = 2400. B's entry (written 1300) is older than that,
  // which used to let A's save remove it; but it was made from save time 0, not the 1000 A's save replaced, so it is
  // a change A never saw, and it is left for the next visit, which keeps it as a copy.
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40));
  let a = part(40);
  let b = part(40);
  const opts = { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now };
  const tabA = startAutosave(store, "p", () => a, () => {}, opts);
  const tabB = startAutosave(store, "p", () => b, () => {}, opts);
  a = part(45);
  tabA.changed();
  await clock.advance(1100);
  b = part(25);
  tabB.changed();
  await clock.advance(200);
  tabB.leaving();
  await clock.advance(100);
  a = part(50);
  tabA.changed();
  await clock.advance(1000);
  assert.equal(widthOf(await store.open("p")), 50);
  assert.equal(journal.items.size, 1, "B's entry is still here");
  await recoverUnsaved(store, journal, [], () => "copy-1");
  assert.equal(widthOf(await store.open("p")), 50);
  assert.equal(widthOf(await store.open("copy-1")), 25);
});

test("a tab's entry written while its own save was in flight is still put back over that save, not copied", async () => {
  // One tab. Stored 40 at t = 0 (expected 0). It changes to 45; its save starts at t = 1000 and lands only later. At
  // t = 1100 it changes to 46 and is hidden: 46 is journalled, made from save time 0 as the tab knew it then. The
  // save of 45 lands (save time 1000) and the page dies before 46 is stored. The store's 1000 is this tab's own
  // save, so the entry's base moved with it: the next visit puts 46 back over 45, with no copy.
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40));
  let land: () => void = () => {};
  let calls = 0;
  const slow: ProjectStore = {
    ...store,
    save: (...args) => {
      calls++;
      if (calls > 1) return new Promise<void>(() => {}); // the page has gone
      return new Promise<void>((done) => (land = () => void store.save(...args).then(done)));
    },
  };
  let p = part(40);
  const tab = startAutosave(slow, "p", () => p, () => {}, { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now });
  p = part(45);
  tab.changed();
  await clock.advance(1100);
  p = part(46);
  tab.changed();
  assert.equal(tab.leaving(), true);
  land();
  await settle();
  await settle();
  await settle();
  assert.equal(widthOf(await store.open("p")), 45, "the first save landed");
  assert.deepEqual(await recoverUnsaved(store, journal, [], () => "copy-1"), []);
  assert.equal(widthOf(await store.open("p")), 46, "put back over its own save");
  assert.equal((await store.list()).length, 1, "no copy");
});

test("an entry names the save time it was made from after its own time; one that can't be written is left out (worked by hand)", () => {
  // Written at 1300 from the state saved at 0: "@1300~0", then the text. Kept and made from 5000: "@7!~5000". A base
  // before 1970 (-1 ms) or past 15 digits can't be read back, so it is left out rather than spoil the entry.
  assert.equal(journalEntry("X", new Date(1300), false, new Date(0)), "@1300~0\nX");
  assert.equal(journalEntry("X", new Date(7), true, new Date(5000)), "@7!~5000\nX");
  assert.equal(journalEntry("X", new Date(7), false, new Date(-1)), "@7\nX");
  assert.equal(journalEntry("X", new Date(7), false, new Date(1e15)), "@7\nX");
  assert.equal(journalEntry("X", new Date(7), false, new Date(1e15 - 1)), "@7~999999999999999\nX");
  assert.deepEqual(readJournalEntry("@1300~0\nX"), { text: "X", written: new Date(1300), kept: false, base: new Date(0) });
  assert.equal(readJournalEntry("@7!~5000\nX").base?.getTime(), 5000);
  assert.equal(readJournalEntry("@7~\nX").written, null, "a ~ with no time is not a head");
});

test("a stale entry whose copy can't be stored stays in the journal, and the project keeps the newer work", async () => {
  // Stored 45 at t = 1000; the entry (25, made from save time 0) can't go over it, and the store refuses the copy
  // too (full): the entry stays for the next visit, "p" keeps 45, and the message says so.
  let t = 1000;
  const store = projectStore(memoryKeyValue(), [], () => new Date(t));
  await store.save("p", part(45));
  const journal = fakeStorage();
  journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(25)), new Date(1300), false, new Date(0)));
  const full: ProjectStore = { ...store, save: (id, ...rest) => (id === "p" ? store.save(id, ...rest) : Promise.reject(new Error("storage is full"))) };
  t = 2000;
  const problems = await recoverUnsaved(full, journal, [], () => "copy-1");
  assert.equal(widthOf(await store.open("p")), 45);
  assert.equal(journal.items.size, 1, "kept for the next visit");
  assert.match(problems[0]!, /couldn't be kept as a separate project \(storage is full\)/);
  assert.equal((await store.list()).length, 1);
});

test("an entry made from the state the store still holds is put back over it, with no copy", async () => {
  // Stored 40 at t = 500. The entry (46, written 900, made from 500) goes over it; one made from 499 or 501 would not.
  for (const [base, want, copies] of [[500, 46, 0], [499, 40, 1], [501, 40, 1]] as const) {
    let t = 500;
    const store = projectStore(memoryKeyValue(), [], () => new Date(t));
    await store.save("p", part(40));
    t = 1000;
    const journal = fakeStorage();
    journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(46)), new Date(900), false, new Date(base)));
    await recoverUnsaved(store, journal, [], () => "copy-1");
    assert.equal(widthOf(await store.open("p")), want, `made from ${base}`);
    assert.equal((await store.list()).length, 1 + copies, `made from ${base}`);
    assert.equal(journal.items.size, 0);
  }
});

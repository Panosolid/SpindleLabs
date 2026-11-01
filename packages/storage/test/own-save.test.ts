// A tab's own save landing after its page has gone (merge-queue CI, leave-save.mjs, 2026-11-01): a width typed and
// the page reloaded at once, while "Saving…". leaving() journalled the change, naming the stored state it was made
// from (the save time before that save), and started the save; IndexedDB finished the save after the page had gone,
// so the tab never heard and never moved its entry's base on. The next visit found the store at a save time other
// than the entry's base and took the tab's own save for another tab's work: a false "from another tab" copy. Each
// autosave now stamps its saves and its entries with its own writer id, so recovery knows a store whose last save is
// the entry's own tab's has no other tab's work in it; and an entry holding exactly what the store holds just goes.
//
// One store and one localStorage, as in a browser, on one fake clock. The page's store is a fake whose saves the test
// lands one by one, in order (IndexedDB's readwrite transactions on one store run in order); once the page is dead, a
// save that lands is written to the store but the page is never told.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type Project } from "@fission/core";
import { journalEntry, memoryKeyValue, projectStore, readJournalEntry, recoverUnsaved, startAutosave, unsavedKey, type JournalStorage, type ProjectStore, type Timers } from "../src/index.ts";

const part = (width: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width } } });
const widthOf = (p: Project) => (p.workspaces.design as { width: number }).width;
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
};

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

/** A page's view of `store`: each save waits until `land()`; once `dead`, a landed save is stored but never answered. */
function page(store: ProjectStore, forgetWriter = false) {
  const waiting: { args: Parameters<ProjectStore["save"]>; done: () => void; failed: (e: unknown) => void }[] = [];
  const p = {
    dead: false,
    waiting,
    store: { ...store, save: (...args) => new Promise<void>((done, failed) => waiting.push({ args, done, failed })) } as ProjectStore,
    async land() {
      const w = waiting.shift();
      if (!w) return;
      try {
        const [id, project, read, since, behind] = w.args;
        await (forgetWriter ? store.save(id, project, read, since, behind) : store.save(...w.args));
        if (!p.dead) w.done();
      } catch (e) {
        if (!p.dead) w.failed(e);
      }
      await settle();
    },
  };
  return p;
}

test("a width typed and the page reloaded at once: its own save landing after the page has gone is not another tab's (worked by hand)", async () => {
  // Stored 40 at t = 0; the tab opens it, expecting save time 0. It changes to 45 at t = 0 and is reloaded at
  // t = 100, still "Saving…": leaving() journals 45 (written at 100, made from save time 0) and starts the save,
  // which reads the project at t = 100. The page dies; IndexedDB still finishes that save, so the store holds 45,
  // save time 100, and the page never hears. Next visit: the store's 100 is not the entry's 0, but the save there is
  // this tab's own and holds exactly the entry's 45, so the entry just goes: "p" reads 45, one project, no message.
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40));
  const pg = page(store);
  let p = part(40);
  const tab = startAutosave(pg.store, "p", () => p, () => {}, { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now });
  p = part(45);
  tab.changed();
  await clock.advance(100);
  assert.equal(tab.leaving(), true);
  assert.equal(readJournalEntry(journal.items.get(unsavedKey("p"))!).base?.getTime(), 0, "made from save time 0");
  pg.dead = true;
  await pg.land();
  assert.equal(widthOf(await store.open("p")), 45, "the save landed after the page had gone");
  assert.equal(journal.items.size, 1, "and the page never heard, so its entry is still here");
  assert.deepEqual(await recoverUnsaved(store, journal, [], () => "copy-1"), [], "no message: nothing came from another tab");
  assert.equal(widthOf(await store.open("p")), 45);
  assert.deepEqual((await store.list()).map((s) => s.id), ["p"], "no copy");
  assert.equal(journal.items.size, 0);
});

test("an older save of its own landing after the page has gone: the newer entry goes back over it, with no copy (worked by hand)", async () => {
  // Stored 40 at t = 0 (expected 0). It changes to 45; its save reads it at t = 1000 and waits. At t = 1100 it
  // changes to 46 and is reloaded: 46 is journalled at 1100, made from save time 0. The page dies; the save of 45
  // lands (save time 1000) unheard, and nothing stores 46. Next visit: the store's last save is this tab's own, so
  // the entry, newer (1100 > 1000), goes back over it: "p" reads 46, one project, no message.
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  await store.save("p", part(40));
  const pg = page(store);
  let p = part(40);
  const tab = startAutosave(pg.store, "p", () => p, () => {}, { timers: clock.timers, journal, stored: true, storedAt: new Date(0), now: clock.now });
  p = part(45);
  tab.changed();
  await clock.advance(1100);
  p = part(46);
  tab.changed();
  assert.equal(tab.leaving(), true);
  pg.dead = true;
  await pg.land();
  assert.equal(widthOf(await store.open("p")), 45);
  assert.deepEqual(await recoverUnsaved(store, journal, [], () => "copy-1"), []);
  assert.equal(widthOf(await store.open("p")), 46, "put back over its own save");
  assert.deepEqual((await store.list()).map((s) => s.id), ["p"], "no copy");
});

test("a stale tab's entry over another tab's save is still kept as a copy, though the store's text is checked too", async () => {
  // Stored 45 at t = 1000 by tab A (writer "a"). B's entry, 25, made from save time 0 by writer "b": another tab's save
  // is there, holding other text, so 25 is kept as "Box (from another tab)" and 45 stays. The same entry holding 45,
  // exactly what the store holds, just goes, with no copy: there is nothing to keep apart.
  for (const [width, copies] of [[25, 1], [45, 0]] as const) {
    let t = 1000;
    const store = projectStore(memoryKeyValue(), [], () => new Date(t));
    await store.save("p", part(45), undefined, undefined, false, "a");
    t = 2000;
    const journal = fakeStorage();
    journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(width)), new Date(1300), false, new Date(0), "b"));
    const problems = await recoverUnsaved(store, journal, [], () => "copy-1");
    assert.equal(widthOf(await store.open("p")), 45, `entry ${width}`);
    assert.equal((await store.list()).length, 1 + copies, `entry ${width}`);
    assert.equal(problems.length, copies, `entry ${width}`);
    assert.equal(journal.items.size, 0);
  }
});

test("an entry's writer only counts when the store's last save is that same writer's", async () => {
  // Stored 45 at t = 1000. The entry (46, written 1300, made from 0, writer "b") goes back over it only when the
  // store's save is writer "b"'s; one by "a", or by no writer named (an older build, recovery's own), is another
  // tab's as far as anyone can tell, so 46 is kept as a copy.
  for (const [stored, want, copies] of [["b", 46, 0], ["a", 45, 1], [undefined, 45, 1]] as const) {
    let t = 1000;
    const store = projectStore(memoryKeyValue(), [], () => new Date(t));
    await store.save("p", part(45), undefined, undefined, false, stored);
    t = 2000;
    const journal = fakeStorage();
    journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(46)), new Date(1300), false, new Date(0), "b"));
    await recoverUnsaved(store, journal, [], () => "copy-1");
    assert.equal(widthOf(await store.open("p")), want, `stored by ${stored}`);
    assert.equal((await store.list()).length, 1 + copies, `stored by ${stored}`);
  }
});

test("its own save newer than its entry (a phone killed the page with no leaving) keeps the newer save", async () => {
  // Stored 45 by writer "b" at save time 2000; b's entry (44, written 1300, made from 0) is older than that save of its
  // own, which read the project later and so holds every change the entry does: the entry just goes, and "p" keeps 45.
  let t = 2000;
  const store = projectStore(memoryKeyValue(), [], () => new Date(t));
  await store.save("p", part(45), undefined, undefined, false, "b");
  const journal = fakeStorage();
  journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(44)), new Date(1300), false, new Date(0), "b"));
  assert.deepEqual(await recoverUnsaved(store, journal, [], () => "copy-1"), []);
  assert.equal(widthOf(await store.open("p")), 45);
  assert.equal((await store.list()).length, 1);
  assert.equal(journal.items.size, 0);
});

test("an entry's head carries its writer after the base, and one that can't be written is left out (worked by hand)", () => {
  // Written at 1300 from save time 0 by writer "tab-1": "@1300~0#tab-1", then the text. A writer with a space or
  // a newline would spoil the head, so it is left out; so is one of 65 characters (64 is the most).
  assert.equal(journalEntry("X", new Date(1300), false, new Date(0), "tab-1"), "@1300~0#tab-1\nX");
  assert.equal(journalEntry("X", new Date(7), false, null, "w"), "@7#w\nX");
  assert.equal(journalEntry("X", new Date(7), false, new Date(0), "a b"), "@7~0\nX");
  assert.equal(journalEntry("X", new Date(7), false, new Date(0), "a\nb"), "@7~0\nX");
  assert.equal(journalEntry("X", new Date(7), false, new Date(0), "w".repeat(65)), "@7~0\nX");
  assert.equal(journalEntry("X", new Date(7), false, new Date(0), "w".repeat(64)), `@7~0#${"w".repeat(64)}\nX`);
  assert.equal(readJournalEntry("@1300~0#tab-1\nX").writer, "tab-1");
  assert.equal(readJournalEntry("@1300~0\nX").writer, undefined);
  assert.equal(readJournalEntry("@7#\nX").written, null, "a # with no writer is not a head");
});

// Seeded page lives against a model: one tab at a time (so no other tab's work ever exists), random edits, quiet
// moments, saves landing, hidden-and-back, and a reload (leaving, then the page dies) or a kill (dies with no
// leaving); as it dies, any of its waiting saves may still land, unheard. Every next visit must find exactly one
// project, no message, and: after a reload, the last change; after a kill, nothing older than the newest save the
// page heard land, nor newer than its last change. A copy "from another tab" would be a false conflict.

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function lives(seed: number, visits: number, forgetWriter = false) {
  const r = rng(seed);
  const pick = (n: number) => Math.floor(r() * n);
  const clock = fakeClock();
  const store = projectStore(memoryKeyValue(), [], clock.now);
  const journal = fakeStorage();
  let width = 1;
  await store.save("p", part(width));
  let landedUnheard = 0;
  for (let v = 0; v < visits; v++) {
    const where = `seed ${seed}, visit ${v}`;
    const [summary] = await store.list();
    const pg = page(store, forgetWriter);
    let w = width;
    const tab = startAutosave(pg.store, "p", () => part(w), () => {}, { timers: clock.timers, journal, stored: true, storedAt: summary!.modified, now: clock.now });
    let heard = width;
    const land = async () => {
      const before = pg.waiting[0];
      await pg.land();
      if (before && !pg.dead) heard = Math.max(heard, widthOf(before.args[1]));
    };
    for (let steps = pick(14); steps > 0; steps--) {
      const k = pick(5);
      if (k <= 1) {
        w = ++width;
        tab.changed();
      } else if (k === 2) await clock.advance(pick(1500));
      else if (k === 3) await land();
      else tab.leaving();
    }
    const reload = r() < 0.7;
    if (reload) assert.equal(tab.leaving(), true, `${where}: leaving() kept everything`);
    pg.dead = true;
    for (let n = pick(pg.waiting.length + 1); n > 0; n--, landedUnheard++) await pg.land();
    await clock.advance(1 + pick(50));
    const problems = await recoverUnsaved(store, journal, [], () => `copy-${v}`);
    assert.deepEqual(problems, [], `${where}: one tab only, so nothing came from another tab`);
    assert.deepEqual((await store.list()).map((s) => s.id), ["p"], `${where}: no copy`);
    const after = widthOf(await store.open("p"));
    if (reload) assert.equal(after, width, `${where}: a reload keeps the last change`);
    else assert.ok(after >= heard && after <= width, `${where}: killed, read ${after}, heard ${heard}, last ${width}`);
    width = after;
    tab.stop();
  }
  return landedUnheard;
}

test("seeded: 300 runs × 6 visits of one tab never make a copy from its own saves, and keep what each page left with", async () => {
  const base = Number(process.env.FISSION_SEED ?? 2611);
  let unheard = 0;
  for (let seed = base; seed < base + 300; seed++) unheard += await lives(seed, 6);
  if (process.env.FISSION_SEED === undefined) assert.ok(unheard >= 100, `saves landed unheard ${unheard} times`);
});

test("the seeded runs catch a store that forgets who saved", async () => {
  // Saves stored without their writer (as if the store dropped it): some page's own save landing unheard, of an older
  // state than its entry, must then be taken for another tab's and copied.
  let caught = false;
  for (let seed = 2611; seed < 2611 + 300 && !caught; seed++)
    try {
      await lives(seed, 6, true);
    } catch (e) {
      caught = /nothing came from another tab|no copy/.test((e as Error).message);
    }
  assert.ok(caught);
});

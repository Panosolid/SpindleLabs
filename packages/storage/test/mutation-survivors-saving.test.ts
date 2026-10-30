// More tests written to kill the mutants StrykerJS found surviving in saving
// (2026-10-30; run packages/testing/stryker/run.sh storage). Each test names the change to the code it catches.
// Mutants that no caller can tell apart from the code are listed, with the reason, in
// packages/testing/stryker/explained.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type Project } from "@fission/core";
import {
  journalEntry,
  keptEntry,
  memoryKeyValue,
  OPENING_KEY,
  projectStore,
  ProjectChangedError,
  readJournalEntry,
  recoverUnsaved,
  reopenGuard,
  startAutosave,
  storedCopy,
  STORAGE_NOT_ANSWERING,
  unsavedKey,
  type AutosaveStatus,
  type JournalStorage,
  type OpeningChannel,
  type ProjectStore,
  type Timers,
} from "../src/index.ts";

const settle = () => new Promise<void>((r) => setImmediate(r));

/** A fake clock: timers run only when the test moves time on; `clears` lists every handle passed to clearTimeout. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const waiting = new Map<number, { at: number; fn: () => void }>();
  const clears: unknown[] = [];
  const timers: Timers = {
    setTimeout(fn, ms) {
      waiting.set(next, { at: now + ms, fn });
      return next++;
    },
    clearTimeout(h) {
      clears.push(h);
      waiting.delete(h as number);
    },
  };
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const due = [...waiting.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      waiting.delete(due[0]);
      now = due[1].at;
      due[1].fn();
      await settle();
    }
    now = end;
    await settle();
  }
  return { timers, advance, clears, pending: () => waiting.size };
}

/** localStorage as a Map, with key(i) and length; `calls` counts each method used. */
function fakeStorage(items = new Map<string, string>()) {
  const calls = { getItem: 0, setItem: 0, removeItem: 0 };
  return {
    items,
    calls,
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (k: string) => (calls.getItem++, items.get(k) ?? null),
    setItem: (k: string, v: string) => (calls.setItem++, void items.set(k, v)),
    removeItem: (k: string) => (calls.removeItem++, void items.delete(k)),
  };
}

const part = (width: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width } } });
const widthOf = (p: Project) => (p.workspaces.design as { width: number }).width;

/** A store whose saves wait until the test finishes them, counting each save asked for. */
function heldStore(kv = memoryKeyValue()) {
  const inner = projectStore(kv, []);
  const waiting: (() => Promise<void>)[] = [];
  let asked = 0;
  const store: ProjectStore = {
    ...inner,
    save: (id, p, read) => {
      asked++;
      return new Promise<void>((resolve) => waiting.push(() => inner.save(id, p, read).then(resolve)));
    },
  };
  return { kv, store, asked: () => asked, finishOne: async () => (await waiting.shift()!(), settle()) };
}

const T = (ms: number) => new Date(ms);

// ---------- autosave.ts ----------

test("a save storage never answers says exactly why, in the words the status line shows", async () => {
  // Kills STORAGE_NOT_ANSWERING => "": the constant and the status carry the full sentence.
  const clock = fakeTimers();
  const { store } = heldStore();
  const seen: AutosaveStatus[] = [];
  const auto = startAutosave(store, "p", () => part(1), (s) => seen.push(s), { timers: clock.timers });
  auto.changed();
  await clock.advance(1000); // the quiet moment: the save starts and is never answered
  await clock.advance(15_000);
  const expected = "browser storage isn't answering, so your latest changes aren't stored yet (use Save to keep your work as a file)";
  assert.equal(STORAGE_NOT_ANSWERING, expected);
  assert.deepEqual(seen.at(-1), { state: "error", message: expected });
});

test("an entry that can't be read at start-up is still compared when the store takes a save: a newer entry from another tab stays", async () => {
  // Kills the start-up read's `catch { return null; }` => `{}`: an undefined journalVersion would take the
  // 'this page's own entry' branch and remove the entry without comparing times.
  const journal = fakeStorage();
  const key = unsavedKey("p");
  let first = true;
  const flaky: JournalStorage = {
    ...journal,
    getItem: (k) => {
      if (first) {
        first = false;
        throw new Error("storage off");
      }
      return journal.getItem(k);
    },
  };
  journal.items.set(key, journalEntry(projectToJson(part(9)), T(5000))); // written after this save's time (1000)
  const clock = fakeTimers();
  const auto = startAutosave(projectStore(memoryKeyValue(), []), "p", () => part(1), () => {}, { timers: clock.timers, journal: flaky, now: () => T(1000) });
  auto.changed();
  await clock.advance(1000);
  assert.ok(journal.items.has(key), "the newer entry is kept");
});

test("a save removes another tab's journal entry only when it is older than the save: 999 goes, 1000 and 1001 and one with no time stay", async () => {
  // Hand-worked: the save reads the project at 1000 ms (the clock handed in, nothing stored before). An entry written
  // at 999 holds an older state than the one stored, so it goes; written at 1000 (the same millisecond: can't be told
  // apart, kept) or 1001 (newer) it stays, and so does one from before entries had a time (no age to compare).
  // Kills `journalVersion !== null` => true, the whole `else` block => {}, `written.getTime() >= at.getTime()`
  // => false / `>`, `written === null || …` => `&&`, and the whole condition => false.
  const cases: [string, string, boolean][] = [
    ["written 999", journalEntry(projectToJson(part(9)), T(999)), false],
    ["written 1000", journalEntry(projectToJson(part(9)), T(1000)), true],
    ["written 1001", journalEntry(projectToJson(part(9)), T(1001)), true],
    ["no time", projectToJson(part(9)), true],
  ];
  for (const [name, entry, kept] of cases) {
    const journal = fakeStorage();
    const clock = fakeTimers();
    const auto = startAutosave(projectStore(memoryKeyValue(), []), "p", () => part(1), () => {}, { timers: clock.timers, journal, now: () => T(1000) });
    journal.items.set(unsavedKey("p"), entry); // another tab wrote it after this one started
    auto.changed();
    await clock.advance(1000);
    assert.equal(journal.items.has(unsavedKey("p")), kept, name);
  }
});

test("after one save of a project opened from its kept entry, the entry it journals next is no longer marked kept", async () => {
  // Kills `owner = false` => true after a save: the store holds this tab's state, so the entry is an ordinary one.
  const journal = fakeStorage();
  journal.items.set(unsavedKey("p"), journalEntry(projectToJson(part(2)), T(10), true));
  const clock = fakeTimers();
  let w = 2;
  const auto = startAutosave(projectStore(memoryKeyValue(), []), "p", () => part(w), () => {}, { timers: clock.timers, journal, fromKept: true, now: () => T(1000) });
  auto.changed();
  await clock.advance(1000); // stored; the kept entry goes
  assert.equal(journal.items.has(unsavedKey("p")), false);
  w = 3;
  auto.changed();
  assert.equal(auto.leaving(), true);
  const entry = journal.items.get(unsavedKey("p"))!;
  assert.match(entry, /^@\d+\n/, "no ! after the time");
  assert.equal(readJournalEntry(entry).kept, false);
  await settle();
});

test("a save asked for during another is not repeated once the one after it has finished", async () => {
  // Kills `again = false` => true before the follow-up save: the flag would stay set, and the save after that
  // would run straight away, ahead of the quiet moment.
  const clock = fakeTimers();
  const held = heldStore();
  let w = 1;
  const auto = startAutosave(held.store, "p", () => part(w), () => {}, { timers: clock.timers });
  auto.changed();
  await clock.advance(1000); // save 1 starts
  w = 2;
  auto.changed();
  await clock.advance(1000); // the timer fires during save 1: one more is asked for
  await held.finishOne(); // save 1 done; the follow-up (save 2) starts, of w = 2
  assert.equal(held.asked(), 2);
  w = 3;
  auto.changed(); // a change during save 2: it waits for its quiet moment
  await held.finishOne(); // save 2 done
  assert.equal(held.asked(), 2, "nothing more is stored before the quiet moment");
  await clock.advance(1000);
  assert.equal(held.asked(), 3);
});

test("stopping a quiet autosave, and leaving with a save running, never clear a timer that isn't there", async () => {
  // Kills `timer !== null` => true in stop() and in leaving(): clearTimeout would be handed null.
  const quiet = fakeTimers();
  startAutosave(projectStore(memoryKeyValue(), []), "p", () => part(1), () => {}, { timers: quiet.timers }).stop();
  assert.deepEqual(quiet.clears, []);

  const clock = fakeTimers();
  const held = heldStore();
  const auto = startAutosave(held.store, "p", () => part(1), () => {}, { timers: clock.timers, journal: fakeStorage() });
  auto.changed();
  await clock.advance(1000); // the save is running, no timer waits
  clock.clears.length = 0;
  assert.equal(auto.leaving(), true);
  assert.deepEqual(clock.clears, []);
  assert.equal(held.asked(), 1, "and the running save is not asked for again");
});

test("finishing with the journal full keeps an older entry when another tab saved: it is only removed when it is this state's", async () => {
  // Kills `journalVersion === v` => true in finish's refusal handler: an entry from an earlier visit (version 0),
  // which this state could not replace (storage full), would be removed along with the refused save.
  const journal = fakeStorage();
  const key = unsavedKey("p");
  journal.items.set(key, journalEntry(projectToJson(part(7)), T(5)));
  const full: JournalStorage = {
    ...journal,
    setItem: () => {
      throw new Error("full");
    },
  };
  const store = projectStore(memoryKeyValue(), []);
  await store.save("p", part(1), T(200)); // another tab's save
  const clock = fakeTimers();
  const auto = startAutosave(store, "p", () => part(2), () => {}, { timers: clock.timers, journal: full, storedAt: T(100), now: () => T(1000) });
  auto.changed();
  auto.finish();
  await settle();
  assert.ok(journal.items.has(key), "the older entry stays");
  assert.equal(widthOf(await store.open("p")), 1, "and the other tab's work is not overwritten");
});

// ---------- reopen.ts ----------

function fakeChannel() {
  const posted: unknown[] = [];
  const channel: OpeningChannel = { postMessage: (d) => void posted.push(d), onmessage: null };
  const deliver = (data: unknown) => channel.onmessage!({ data });
  return { channel, posted, deliver };
}

test("the tab answers a question only for the project it is opening, and ignores messages that aren't questions", () => {
  // Kills `typeof message?.asking === "string" && message.asking === mine` => `||` / true on either half, and
  // `message?.asking` => `message.asking`: a null message, or a question of null while no project is opening
  // (null === null), must not be answered or throw.
  const { channel, posted, deliver } = fakeChannel();
  const guard = reopenGuard(fakeStorage(), { channel });
  deliver(null);
  deliver({ asking: null });
  deliver({ asking: "a" });
  assert.deepEqual(posted, [], "nothing is opening yet");
  guard.opening("a");
  deliver({ asking: "b" });
  deliver({ asking: null });
  assert.deepEqual(posted, [], "another project's question is not answered");
  deliver({ asking: "a" });
  assert.deepEqual(posted, [{ opening: "a" }]);
});

test("an answer for another project, or one that comes when nothing was asked, does not settle the question", async () => {
  // Kills `message.opening === waiting?.id` => true, `message?.opening` / `waiting?.id` => without the `?`.
  const clock = fakeTimers();
  const { channel, deliver } = fakeChannel();
  const storage = fakeStorage(new Map([[OPENING_KEY, "a"]]));
  const guard = reopenGuard(storage, { channel, timers: clock.timers });
  deliver(null);
  deliver({ opening: "a" }); // nobody is waiting
  const stuck = guard.check("a");
  deliver({ opening: "b" }); // an answer for another project
  await clock.advance(1000);
  assert.equal(await stuck, true, "no tab answered for a: it counts as stuck");
});

test("a mark taken down by putAway comes back once with back(), never when nothing took it down", () => {
  // Kills `away = false` => true in opening() (back() would write a mark that was never taken down) and in back()
  // (a second back() would write it again), and `mine !== null && away` => `||`.
  const storage = fakeStorage();
  const guard = reopenGuard(storage);
  guard.opening("a");
  storage.items.delete(OPENING_KEY); // another tab cleared it
  guard.back();
  assert.equal(storage.items.has(OPENING_KEY), false, "back() without putAway writes nothing");
  guard.putAway();
  guard.opening("b"); // a second opening: the earlier putAway no longer counts
  storage.items.delete(OPENING_KEY);
  guard.back();
  assert.equal(storage.items.has(OPENING_KEY), false);
  guard.putAway();
  guard.back();
  assert.equal(storage.items.get(OPENING_KEY), "b", "put away and back: the mark returns");
  storage.items.delete(OPENING_KEY);
  guard.back();
  assert.equal(storage.items.has(OPENING_KEY), false, "back() again does nothing");
});

test("back() writes nothing after the opening ended, and never takes another tab's mark", () => {
  // Kills `mine !== null && away` => `mine !== null` / `true && away`.
  const storage = fakeStorage();
  const guard = reopenGuard(storage);
  guard.opening("a");
  guard.putAway(); // mark down, away
  guard.finished(); // opening ended with a message: nothing of ours
  storage.items.set(OPENING_KEY, "b"); // another tab's
  guard.back();
  assert.equal(storage.items.get(OPENING_KEY), "b");
});

test("a mark another tab put over ours is left alone by finished() and putAway()", () => {
  // Kills `read() === mine` => true in both, and `mine !== null && read() === mine` => `||`.
  const storage = fakeStorage();
  const guard = reopenGuard(storage);
  guard.opening("a");
  storage.items.set(OPENING_KEY, "b");
  guard.putAway();
  assert.equal(storage.items.get(OPENING_KEY), "b");
  guard.back();
  storage.items.set(OPENING_KEY, "b");
  guard.finished();
  assert.equal(storage.items.get(OPENING_KEY), "b");
});

test("with nothing opening, finished(), putAway() and shown() touch neither the mark nor the clock", () => {
  // Kills `mine !== null` => true in finished(), `mine === null` => false in putAway(), `pending !== null` => true
  // in shown() and finished(): each would remove a mark that isn't there or clear a timer that isn't.
  const storage = fakeStorage();
  const clock = fakeTimers();
  const guard = reopenGuard(storage, { timers: clock.timers });
  guard.finished();
  guard.putAway();
  assert.equal(storage.calls.setItem, 0);
  assert.equal(storage.calls.removeItem, 0);
  assert.deepEqual(clock.clears, []);
  guard.shown("a"); // no timer waiting before it
  assert.deepEqual(clock.clears, []);
});

test("shown() for another project than the one opening leaves this tab's opening alone", async () => {
  // Kills `mine === id` => true in the settle timer: it would forget the project this tab is opening.
  const clock = fakeTimers();
  const storage = fakeStorage();
  const guard = reopenGuard(storage, { timers: clock.timers });
  guard.opening("a");
  guard.shown("b");
  await clock.advance(3000);
  guard.finished();
  assert.equal(storage.items.has(OPENING_KEY), false, "finished() still clears a's mark");
});

test("putAway after the project is shown counts it as opened: its settle timer is dropped and back() writes nothing", () => {
  // Kills `pending !== null` => false and the block => {} in putAway().
  const clock = fakeTimers();
  const storage = fakeStorage();
  const guard = reopenGuard(storage, { timers: clock.timers });
  guard.opening("a");
  guard.shown("a");
  assert.equal(clock.pending(), 1);
  guard.putAway();
  assert.equal(clock.pending(), 0);
  guard.back();
  assert.equal(storage.items.has(OPENING_KEY), false);
});

// ---------- store.ts ----------

test("a refused save is a ProjectChangedError by name", async () => {
  // Kills `this.name = "ProjectChangedError"` => "".
  const store = projectStore(memoryKeyValue(), []);
  await store.save("p", part(1), T(200));
  await assert.rejects(store.save("p", part(2), T(300), T(100)), (e: Error) => e instanceof ProjectChangedError && e.name === "ProjectChangedError");
});

test("a stored summary that can't be read refuses a save that expects any time, even the start of 1970", async () => {
  // Kills `holds.problem !== undefined` => false: an unreadable summary reads as time 0, which an expected time of 0 would match.
  const kv = memoryKeyValue();
  const store = projectStore(kv, []);
  await store.save("p", part(1), T(200));
  await kv.set("summary/p", "not json");
  await assert.rejects(store.save("p", part(2), T(300), T(0)), ProjectChangedError);
  assert.equal(await kv.get("summary/p"), "not json", "nothing was written");
});

test("storedCopy passes over an entry whose summary can't be read, and one whose summary names another project", async () => {
  // Kills `summary.problem !== undefined` => false, `summary.name !== project.name` => false, and `||` => `&&`.
  // A broken summary lists under its id, so the project is named like its id here.
  const kv = memoryKeyValue();
  const store = projectStore(kv, []);
  const box = part(1); // named "Box"
  await store.save("Box", box, T(100));
  await store.save("other", box, T(200));
  assert.equal((await storedCopy(store, box))?.id, "other", "the newer of two copies");
  await kv.set("summary/Box", "junk"); // problem: skipped though the project there is the same
  await kv.set("summary/other", JSON.stringify({ name: "Renamed", modified: T(200).toISOString(), order: 2 })); // names another project
  assert.equal(await storedCopy(store, box), undefined);
});

// ---------- unsaved.ts ----------

test("an entry's time must start the entry: '@12' later in the text is not a time", () => {
  // Hand-worked: "@86400000\n" is 86,400,000 ms = 24 h * 3600 s * 1000 ms after 1970-01-01, so 1970-01-02T00:00:00Z.
  // Kills the regex losing its `^`: text that happens to hold "@12\n" further in would be cut in two.
  const dated = readJournalEntry("@86400000\nX");
  assert.equal(dated.written?.toISOString(), "1970-01-02T00:00:00.000Z");
  assert.equal(dated.text, "X");
  assert.equal(dated.kept, false);
  assert.deepEqual(readJournalEntry("abc@12\nrest"), { text: "abc@12\nrest", written: null, kept: false });
  assert.equal(readJournalEntry("@12!\nrest").kept, true);
});

test("a journal with no entries of ours never asks the store for its list", async () => {
  // Kills `keys.length === 0` => false.
  const journal = fakeStorage(
    new Map([
      ["something/else", "x"],
      ["panoshape.unsaved/", "no id"],
    ]),
  );
  const calls: number[] = [];
  const counting: ProjectStore = { ...projectStore(memoryKeyValue(), []), list: async () => (calls.push(1), []) };
  assert.deepEqual(await recoverUnsaved(counting, journal, []), []);
  assert.deepEqual(calls, []);
});

test("a recovered entry is stored with the time it was written, not the time of recovery", async () => {
  // Kills `entry.written ?? undefined` => `entry.written && undefined`: the store would stamp its own clock (5000).
  const kv = memoryKeyValue();
  const store = projectStore(kv, [], () => T(5000));
  const journal = fakeStorage(new Map([[unsavedKey("p"), journalEntry(projectToJson(part(7)), T(1000))]]));
  assert.deepEqual(await recoverUnsaved(store, journal, []), []);
  const [summary] = await store.list();
  assert.equal(summary.modified.getTime(), 1000);
});

test("an entry the store refuses is kept marked, with the time it had (or the start of 1970 when it had none)", async () => {
  // Kills `entry.written ?? new Date(0)` => `entry.written && new Date(0)`: a timed entry would be re-marked with
  // time 0, a timeless one could not be marked at all.
  const refusing: ProjectStore = {
    ...projectStore(memoryKeyValue(), []),
    save: async () => {
      throw new Error("full");
    },
  };
  const text = projectToJson(part(3));
  const journal = fakeStorage(
    new Map([
      [unsavedKey("timed"), journalEntry(text, T(1000))],
      [unsavedKey("old"), text],
    ]),
  );
  const problems = await recoverUnsaved(refusing, journal, []);
  assert.equal(problems.length, 2);
  assert.equal(journal.items.get(unsavedKey("timed")), `@1000!\n${text}`);
  assert.equal(journal.items.get(unsavedKey("old")), `@0!\n${text}`);
});

test("keptEntry gives null, not undefined, when the journal can't be read", () => {
  // Kills the catch block of keptEntry => {}.
  const broken: JournalStorage = {
    ...fakeStorage(),
    getItem: () => {
      throw new Error("off");
    },
  };
  assert.equal(keptEntry(broken, "p"), null);
  assert.equal(keptEntry(fakeStorage(), "p"), null);
  assert.equal(keptEntry(fakeStorage(new Map([[unsavedKey("p"), journalEntry("T", T(1), true)]])), "p"), "T");
});

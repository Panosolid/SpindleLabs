// Storage full over a reload (real-use hunt B1): a change the store refused
// (quota) was journalled as the page went; the next visit's recovery couldn't
// store it either, so it was marked kept, and the app opened the older
// stored state. The screen jumped back, and Save to file wrote that older
// state. Now the app opens the kept entry's state (`keptEntry`) and its
// autosave owns the entry (`fromKept`): it stores over the older state once
// the store has room, and until then keeps each newer state in the journal,
// still marked kept, so no other tab saves over it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectToJson, type Project } from "@fission/core";
import { journalEntry, keptEntry, memoryKeyValue, projectStore, readJournalEntry, recoverUnsaved, startAutosave, unsavedKey, type JournalStorage, type ProjectStore } from "../src/index.ts";

const part = (w: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width: w } } });
const widthOf = (p: Project) => (p.workspaces.design as { width: number }).width;
const settle = async () => {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r));
};
function storage(): JournalStorage & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
const timers = { setTimeout: (fn: () => void) => (queueMicrotask(fn), 1), clearTimeout: () => {} };

/** The story up to the reload: 40 stored at 500, 50 journalled at 900, and recovery refused (storage full). */
async function fullAfterReload() {
  let t = 1000;
  const now = () => new Date(t);
  const real = projectStore(memoryKeyValue(), [], now);
  await real.save("p", part(40), new Date(500));
  const journal = storage();
  journal.setItem(unsavedKey("p"), journalEntry(projectToJson(part(50)), new Date(900)));
  let full = true;
  const store: ProjectStore = { ...real, save: (...a) => (full ? Promise.reject(new Error("browser storage is full")) : real.save(...a)) };
  const problems = await recoverUnsaved(store, journal, []);
  return { real, store, journal, problems, room: () => void (full = false), tick: (ms: number) => void (t += ms), now };
}

test("keptEntry: the state recovery couldn't store, and nothing for an entry it can still put back (worked by hand)", async () => {
  const { journal, problems } = await fullAfterReload();
  assert.deepEqual(problems, ["unsaved changes from your last visit couldn't be stored (browser storage is full); they are shown, and kept in this browser until it has room: Save keeps them as a file"]);
  const kept = keptEntry(journal, "p");
  assert.equal(kept === null ? null : widthOf(JSON.parse(kept)), 50, "the newest state: width 50, not the stored 40");
  assert.equal(keptEntry(journal, "q"), null, "no entry");
  journal.setItem(unsavedKey("q"), journalEntry(projectToJson(part(7)), new Date(900))); // an entry not marked kept
  assert.equal(keptEntry(journal, "q"), null);
  assert.equal(keptEntry(null, "p"), null, "no localStorage");
});

test("opened from the kept entry, the first edit is stored over the older state once there is room, and the entry goes", async () => {
  const { real, store, journal, room } = await fullAfterReload();
  let project = JSON.parse(keptEntry(journal, "p")!) as Project;
  const statuses: string[] = [];
  const top = (await real.list())[0];
  const a = startAutosave(store, "p", () => project, (s) => statuses.push(s.state === "error" ? s.message : s.state), { journal, timers, quietMs: 0, storedAt: top.modified, fromKept: true });
  room();
  project = part(55);
  a.changed();
  await settle();
  assert.equal(widthOf(await real.open("p")), 55);
  assert.equal(journal.getItem(unsavedKey("p")), null, "stored, so the entry is not needed");
  assert.deepEqual(statuses, ["saving", "saved"]);
});

test("still full: each newer state stays in the journal, still kept, and the next visit shows it", async () => {
  const { real, store, journal } = await fullAfterReload();
  let project = JSON.parse(keptEntry(journal, "p")!) as Project;
  const statuses: string[] = [];
  const top = (await real.list())[0];
  const a = startAutosave(store, "p", () => project, (s) => statuses.push(s.state === "error" ? s.message : s.state), { journal, timers, quietMs: 0, storedAt: top.modified, fromKept: true });
  project = part(60);
  a.changed();
  await settle();
  assert.deepEqual(statuses, ["saving", "browser storage is full"], "the store's own reason, not a refusal to save");
  assert.equal(a.leaving(), true, "kept: the page needn't ask");
  const entry = readJournalEntry(journal.getItem(unsavedKey("p"))!);
  assert.equal(entry.kept, true, "still marked kept, so no other tab saves over it");
  assert.equal(widthOf(JSON.parse(entry.text)), 60);
  // The next visit, still full: recovery keeps it, and keptEntry gives 60.
  await recoverUnsaved(store, journal, []);
  assert.equal(widthOf(JSON.parse(keptEntry(journal, "p")!)), 60);
  assert.equal(widthOf(await real.open("p")), 40, "the store still holds the older state");
});

test("finish (a new project or a file opened) keeps the owner's newest state too", async () => {
  const { real, store, journal } = await fullAfterReload();
  let project = JSON.parse(keptEntry(journal, "p")!) as Project;
  const top = (await real.list())[0];
  const a = startAutosave(store, "p", () => project, () => {}, { journal, timers, quietMs: 60_000, storedAt: top.modified, fromKept: true });
  project = part(65);
  a.changed();
  a.finish();
  await settle();
  const entry = readJournalEntry(journal.getItem(unsavedKey("p"))!);
  assert.deepEqual([entry.kept, widthOf(JSON.parse(entry.text))], [true, 65]);
});

test("a tab that didn't open the kept entry still won't save over it, and says a reload shows it", async () => {
  const { real, store, journal, room } = await fullAfterReload();
  room();
  let project = await real.open("p"); // 40: a tab started before, or one that opened the store's state
  const statuses: string[] = [];
  const top = (await real.list())[0];
  const a = startAutosave(store, "p", () => project, (s) => statuses.push(s.state === "error" ? s.message : s.state), { journal, timers, quietMs: 0, stored: true, storedAt: top.modified });
  project = { ...project, name: "Renamed" };
  a.changed();
  await settle();
  assert.equal(widthOf(await real.open("p")), 40, "nothing saved over the kept 50");
  assert.equal(statuses.at(-1), "unsaved changes from your last visit couldn't be stored yet, so this tab won't save over them. Reload the page to see them.");
  assert.equal(a.leaving(), false);
});

// A save's conflict check and its writes are one step (real-use hunt B6, B7):
// they were three, so a tab paused between its check and its write stored
// over another tab's newer save with no message in either, and a tab killed
// between the project write and the summary write left a project stored but
// never listed. The store now saves through KeyValue.update, which reads and
// writes in one go (one readwrite IndexedDB transaction in the browser:
// e2e/storage.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, type Project } from "@fission/core";
import { memoryKeyValue, ProjectChangedError, projectStore, type KeyValue } from "../src/index.ts";

const part = (w: number): Project => ({ ...emptyProject("Box"), workspaces: { design: { version: 1, width: w } } });
const widthOf = (p: Project) => (p.workspaces.design as { width: number }).width;

test("two tabs saving from the same stored state at once: one is stored, the other refused (worked by hand)", async () => {
  // Stored 40 at 1000. Tab A saves 45 and tab B 70, both expecting the store to hold the state of 1000: whichever
  // goes first changes the save time, so the other's check must fail; neither may land silently over the other.
  const kv = memoryKeyValue();
  const store = projectStore(kv, []);
  await store.save("p", part(40), new Date(1000));
  const base = new Date(1000);
  const outcomes = await Promise.all([
    store.save("p", part(45), new Date(2000), base).then(() => "stored", (e) => (e instanceof ProjectChangedError ? "refused" : String(e))),
    store.save("p", part(70), new Date(3000), base).then(() => "stored", (e) => (e instanceof ProjectChangedError ? "refused" : String(e))),
  ]);
  assert.deepEqual(outcomes, ["stored", "refused"]);
  assert.equal(widthOf(await store.open("p")), 45);
  assert.equal((await store.list())[0].modified.getTime(), 2000, "the summary is A's");
});

test("a save that can't finish writes nothing: never a project without its summary", async () => {
  // As a tab killed mid-save, or a full disk: the KeyValue's separate writes fail after the first (the old path).
  const kv = memoryKeyValue();
  const dying: KeyValue = {
    ...kv,
    set: async (k, v) => {
      if (k.startsWith("summary/")) throw new Error("tab killed");
      return kv.set(k, v);
    },
  };
  await projectStore(dying, []).save("n", part(10)).catch(() => {});
  const stored = [...kv.entries.keys()].filter((k) => k.startsWith("project/")).map((k) => k.slice("project/".length));
  const listed = (await projectStore(kv, []).list()).map((s) => s.id);
  assert.deepEqual(stored, listed, "every stored project is listed");
});

test("memoryKeyValue.update: reads the keys, writes what change returns, and writes nothing when it throws", async () => {
  const kv = memoryKeyValue();
  await kv.set("a", "1");
  await kv.update(["a", "b"], ([a, b]) => {
    assert.deepEqual([a, b], ["1", undefined]);
    return { a: "2", c: "3" };
  });
  assert.deepEqual([...kv.entries].sort(), [["a", "2"], ["c", "3"]]);
  await assert.rejects(
    kv.update(["a"], () => {
      throw new ProjectChangedError();
    }),
    ProjectChangedError,
  );
  assert.deepEqual([...kv.entries].sort(), [["a", "2"], ["c", "3"]]);
});

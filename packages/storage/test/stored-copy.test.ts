// Real-use hunt B3: every Open stored a new copy of the file, so opening the same file again piled up copies no one
// could reach. storedCopy finds the stored project that already holds exactly the opened one (store.ts), and
// keepStorage asks the browser once, after the first save, not to clear the store under storage pressure (persist.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson, type DataReader, type Project } from "@fission/core";
import { keepStorage, memoryKeyValue, projectStore, storedCopy } from "../src/index.ts";

const part = (name: string, width: number): Project => ({ ...emptyProject(name), workspaces: { design: { version: 1, width } } });
const settle = () => new Promise<void>((r) => setImmediate(r));

test("the stored copy of an opened project, worked by hand", async () => {
  // Stored: a = "A" width 1, b = "A" width 2, c = "C" width 1. Opening "A" width 2 is b's text exactly, so b; "A"
  // width 3 is no one's; "C" width 1 differs from a only by its name, so c, not a; "B" width 1 is no one's (no "B").
  const store = projectStore(memoryKeyValue(), []);
  await store.save("a", part("A", 1));
  await store.save("b", part("A", 2));
  await store.save("c", part("C", 1));
  assert.equal((await storedCopy(store, part("A", 2)))?.id, "b");
  assert.equal(await storedCopy(store, part("A", 3)), undefined);
  assert.equal((await storedCopy(store, part("C", 1)))?.id, "c");
  assert.equal(await storedCopy(store, part("B", 1)), undefined);
});

test("the copy found carries its save time, so the first save over it checks no other tab changed it since", async () => {
  const store = projectStore(memoryKeyValue(), [], () => new Date(5000));
  await store.save("p", part("P", 1));
  const found = await storedCopy(store, part("P", 1));
  assert.equal(found?.modified.getTime(), 5000);
});

test("two stored copies of the same text: the one saved last is reused", async () => {
  // Copies left by the app before this fix: x saved first (order 1), y next (order 2); the list puts y first.
  const store = projectStore(memoryKeyValue(), []);
  await store.save("x", part("P", 1));
  await store.save("y", part("P", 1));
  assert.equal((await storedCopy(store, part("P", 1)))?.id, "y");
});

test("a project read through the workspaces' readers matches the stored copy it was saved as", async () => {
  // The app compares projects as read (projectFromJson upgrades each workspace's part), not the file's own bytes: a
  // file saved with other spacing, or by an older version, still finds the copy stored after it was opened.
  const design: DataReader = { id: "design", readData: (d) => ({ ...(d as object), read: true }) };
  const store = projectStore(memoryKeyValue(), [design]);
  const file = JSON.stringify(JSON.parse(projectToJson(part("P", 4))), null, 2); // spaced out, not yet read
  const opened = projectFromJson(file, [design]);
  await store.save("p", opened); // what openProject's first autosave stores
  assert.equal((await storedCopy(store, projectFromJson(file, [design])))?.id, "p");
});

test("a stored project that can't be read, or whose summary can't, is passed over, not an error", async () => {
  // The check fails for a storedCopy that let open's refusal through: Open would then refuse a good file.
  const kv = memoryKeyValue();
  const store = projectStore(kv, []);
  await kv.set("project/bad", "{ not json");
  await kv.set("summary/bad", JSON.stringify({ name: "P", modified: "2026-01-01T00:00:00.000Z", order: 9 }));
  await kv.set("project/odd", projectToJson(part("P", 1)));
  await kv.set("summary/odd", "{ not json");
  assert.equal(await storedCopy(store, part("P", 1)), undefined);
  await store.save("good", part("P", 1));
  assert.equal((await storedCopy(store, part("P", 1)))?.id, "good");
});

test("keepStorage asks the browser once, however many saves follow", async () => {
  let asked = 0;
  const ask = keepStorage({ persist: async () => (asked++, true) });
  assert.equal(asked, 0, "nothing asked before the first save");
  ask();
  ask();
  ask();
  await settle();
  assert.equal(asked, 1);
});

test("keepStorage with no storage manager, no persist, or a persist that throws or refuses does nothing visible", async () => {
  keepStorage(undefined)();
  keepStorage({})();
  let unhandled = 0;
  const count = () => void unhandled++;
  process.on("unhandledRejection", count);
  keepStorage({ persist: () => Promise.reject(new Error("denied")) })();
  keepStorage({
    persist: () => {
      throw new Error("not allowed here");
    },
  })();
  keepStorage({ persist: async () => false })();
  await settle();
  await settle();
  process.off("unhandledRejection", count);
  assert.equal(unhandled, 0);
});

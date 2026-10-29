import { test } from "node:test";
import assert from "node:assert/strict";
import { SETTINGS_KEY, SETTINGS_SECTIONS, SettingsStore, type SettingsStorage } from "../src/settings.ts";

const memory = (initial?: string): SettingsStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>(initial === undefined ? [] : [[SETTINGS_KEY, initial]]);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

test("hand-worked: a value set is read back, and a new store over the same storage sees it", () => {
  const storage = memory();
  const a = new SettingsStore(storage);
  assert.equal(a.get("snap", false), false); // nothing set: the fallback
  a.set("snap", true);
  a.set("units", "mm");
  assert.equal(storage.data.get(SETTINGS_KEY), '{"snap":true,"units":"mm"}'); // two keys, in the order set
  const b = new SettingsStore(storage);
  assert.equal(b.get("snap", false), true);
  assert.equal(b.get("units", "in"), "mm");
});

test("a value of the wrong kind falls back instead of being trusted", () => {
  const s = new SettingsStore(memory('{"snap":"yes","n":3}'));
  assert.equal(s.get("snap", false), false);
  assert.equal(s.get("n", 0), 3);
  assert.equal(s.get("n", "x"), "x");
});

test("damaged, non-object or array storage starts empty; nested values are dropped", () => {
  for (const raw of ["{not json", "42", "[1,2]", "null", ""]) assert.equal(new SettingsStore(memory(raw)).get("a", 7), 7, raw);
  assert.equal(new SettingsStore(memory('{"a":{"b":1}}')).get("a", 7), 7);
});

test("storage that is off or throws never throws; the choice holds for this page", () => {
  assert.equal(new SettingsStore(null).get("a", 1), 1);
  const off = new SettingsStore(null);
  off.set("a", 5);
  assert.equal(off.get("a", 1), 5);
  const throwing: SettingsStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  const s = new SettingsStore(throwing);
  s.set("a", 2);
  assert.equal(s.get("a", 1), 2);
});

test("a test can fail: a stored value is not what a fallback of another kind returns", () => {
  const storage = memory();
  new SettingsStore(storage).set("a", true);
  assert.notEqual(new SettingsStore(storage).get("a", 0), true);
});

test("the sections are the planned six with unique ids, and every empty one says what will live there", () => {
  assert.deepEqual(SETTINGS_SECTIONS.map((s) => s.id), ["general", "design", "phone", "printing", "privacy", "about"]);
  assert.equal(new Set(SETTINGS_SECTIONS.map((s) => s.id)).size, 6);
  for (const s of SETTINGS_SECTIONS) if (!["privacy", "about"].includes(s.id)) assert.match(s.coming, /will be set here\.$/);
});

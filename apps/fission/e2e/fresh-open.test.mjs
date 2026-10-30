// The rules for opening the new build by itself (src/fresh-open.ts; Ben's
// phone, 2026-10-30: the saved body red at open until a reload). Each case
// is worked out from the rule: reload only when the site serves another
// build, the user hasn't touched the page, and this tab hasn't already
// reloaded for that same build (else a browser that keeps handing over the
// old page would reload for ever). The browser check is e2e/app-updated.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RELOADED_TO, reloadFor, STARTED_BY, watchStarted } from "../src/fresh-open.ts";

const store = (initial = {}) => {
  const items = { ...initial };
  return { items, getItem: (k) => items[k] ?? null, setItem: (k, v) => void (items[k] = String(v)) };
};
const NEW = "/assets/index-new.js";

test("a newer build at open, untouched, first time: reload, and remember the build", () => {
  const s = store();
  assert.equal(reloadFor(NEW, false, s), true);
  assert.equal(s.items[RELOADED_TO], NEW);
});

test("the same build again after that reload (the browser still gave the old page): no second reload", () => {
  // The first call remembers NEW; the page that comes back is still old and finds NEW again.
  const s = store();
  assert.equal(reloadFor(NEW, false, s), true);
  assert.equal(reloadFor(NEW, false, s), false);
});

test("a later deploy (another build) in the same tab may reload once more", () => {
  const s = store({ [RELOADED_TO]: NEW });
  assert.equal(reloadFor("/assets/index-newer.js", false, s), true);
  assert.equal(s.items[RELOADED_TO], "/assets/index-newer.js");
});

test("no newer build (null): never reload, nothing written", () => {
  const s = store();
  assert.equal(reloadFor(null, false, s), false);
  assert.deepEqual(s.items, {});
});

test("the user has started: never reload (the notice asks instead), nothing written", () => {
  const s = store();
  assert.equal(reloadFor(NEW, true, s), false);
  assert.deepEqual(s.items, {});
});

test("no storage, or storage that throws: never reload (no way to stop a loop)", () => {
  assert.equal(reloadFor(NEW, false, null), false);
  const throwing = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.equal(reloadFor(NEW, false, throwing), false);
  const unreadable = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => {} };
  assert.equal(reloadFor(NEW, false, unreadable), false);
});

test("watchStarted: false until any of the starting events, then true for good", () => {
  for (const type of STARTED_BY) {
    const target = new EventTarget();
    const started = watchStarted(target);
    target.dispatchEvent(new Event("focus")); // not a start: the page getting focus as it opens
    assert.equal(started(), false, `${type}: before`);
    target.dispatchEvent(new Event(type));
    assert.equal(started(), true, `${type}: after`);
    target.dispatchEvent(new Event(type));
    assert.equal(started(), true, `${type}: still`);
  }
});

test("the starting events are a press, a key, a scroll, a typed value and a chosen file", () => {
  assert.deepEqual([...STARTED_BY].sort(), ["change", "input", "keydown", "pointerdown", "wheel"]);
});

// The soak (soak.mjs) and every helper it loads keep no Playwright element
// handle: a handle (what page.waitForSelector, page.$, page.$$,
// evaluateHandle and elementHandle return) lives in the page until it is
// disposed or the page navigates, and the soak never navigates. One taken on
// a button of Design's (the plane pick's waitForSelector, start.mjs) outlived
// the next Undo's remount, and the button's listeners kept that whole old
// Design alive: nightly 2026-10-29, seed 1, "nodes keeps growing ... 21885 at
// cycle 60", 230 listeners and ~380 nodes more a cycle, none of it the app's.
// They wait with locator(...).waitFor() instead, which holds nothing.
// Run by `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Calls that hand back a handle the page keeps until it is disposed, as `line: text`. */
export function handleCalls(text) {
  return text
    .split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => !line.trim().startsWith("//") && /\.(waitForSelector|\$\$?|evaluateHandle|elementHandle)\(/.test(line))
    .map(([n, line]) => `${n}: ${line.trim()}`);
}

/** soak.mjs and every e2e module it imports, directly or through another. */
function soakModules() {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const text = readFileSync(new URL(name, import.meta.url), "utf8");
    for (const [, dep] of text.matchAll(/^import [^;]*? from "\.\/([^"]+)";/gm)) visit(dep);
  };
  visit("soak.mjs");
  return [...seen];
}

test("the soak loads its helpers (the list this checks is not empty)", () => {
  const modules = soakModules();
  for (const m of ["soak.mjs", "start.mjs", "browser.mjs", "properties.mjs", "sketch-screen.mjs"]) assert.ok(modules.includes(m), `${m} in ${modules}`);
});

test("no module the soak loads keeps an element handle", () => {
  for (const m of soakModules()) assert.deepEqual(handleCalls(readFileSync(new URL(m, import.meta.url), "utf8")), [], m);
});

test("a kept handle is noticed", () => {
  // The line that leaked (start.mjs's pickPlane before this fix), and the other calls that return a handle; a comment and the locator wait are not.
  const text = [
    "  await page.waitForSelector(`#float-plane-${id}:visible, #sketch-plane-${id}:visible`);",
    '  const b = await page.$("#move");',
    '  const all = await p.$$("#browser li");',
    "  const h = await page.evaluateHandle(() => document.body);",
    "  // page.waitForSelector(...) would keep a handle",
    '  await page.locator("#start-hint").waitFor();',
    '  await page.$$eval("#timeline [data-item]", (els) => els.length);',
  ].join("\n");
  assert.deepEqual(handleCalls(text), [
    "1: await page.waitForSelector(`#float-plane-${id}:visible, #sketch-plane-${id}:visible`);",
    '2: const b = await page.$("#move");',
    '3: const all = await p.$$("#browser li");',
    "4: const h = await page.evaluateHandle(() => document.body);",
  ]);
});

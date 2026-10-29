// Browser check of browser storage failing (blind spots B2b, 2026-10-29),
// beyond storage full (smoke.mjs) and no storage at all (smoke.mjs). Each
// fault is planted in IndexedDB before the page loads, on a project already
// kept (the 40 × 30 × 20 box made 50 wide: 50 · 30 · 20 = 30,000 mm³):
// - its opening fails, or a read fails: the app starts on a new project and
//   says why in words; the kept project is not lost (the next visit with
//   storage well opens it);
// - its opening never answers: the app used to stay blank for good; now it
//   starts after STORAGE_ANSWER_MS (15 s) and says so;
// - a write fails: the status says so in words; the change is not lost (the
//   page's leaving journal puts it back next visit);
// - a write never answers: "Saving…" used to show for good; now the words
//   come after 15 s.
// In every case Save still gives a file holding the latest design.
// 1280 px; run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { liveSite } from "./live-site.mjs";
import { pinProperties } from "./properties.mjs";
import { startWithBox } from "./start.mjs";

const ANSWER_MS = 15_000; // packages/storage/src/autosave.ts, STORAGE_ANSWER_MS
const NOT_ANSWERING = "Not saved: browser storage isn't answering, so your latest changes aren't stored yet (use Save to keep your work as a file)";
const site = await liveSite(4248);
const browser = await launch();
let failed = false;

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.stack ?? e}`);
  }
}

/** Plants a fault in IndexedDB on every later page load (until `window.healthy` is set in sessionStorage). */
function planted(fault) {
  if (sessionStorage.getItem("healthy")) return;
  const failing = (what) => {
    const request = { error: new DOMException(`planted ${what} failure`, "UnknownError"), onerror: null, onsuccess: null, onupgradeneeded: null, onblocked: null };
    setTimeout(() => request.onerror?.({ target: request, preventDefault() {} }));
    return request;
  };
  // A request that never settles, as an IndexedDB that stopped answering gives.
  const silent = () => ({ onerror: null, onsuccess: null, onupgradeneeded: null, onblocked: null });
  if (fault === "open fails") indexedDB.open = () => failing("open");
  if (fault === "open never answers") indexedDB.open = () => silent();
  if (fault === "read fails") IDBObjectStore.prototype.get = () => failing("read");
  if (fault === "write fails") IDBObjectStore.prototype.put = () => failing("write");
  if (fault === "write never answers") IDBObjectStore.prototype.put = () => silent();
}

const volume = (p) => p.evaluate(() => document.querySelector("#volume")?.textContent);
const saveState = (p) => p.evaluate(() => document.querySelector("#save-status")?.dataset.state);

/** A page with the 50 wide box kept in this browser, then `fault` planted for every load after. */
async function kept(fault) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const p = await context.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.goto(site.url);
  await startWithBox(p);
  await pinProperties(p);
  await p.fill("#width", "50");
  await p.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved");
  await context.addInitScript(planted, fault);
  return p;
}

/** Saves to a file (Save, the name box's default): the file's text. */
async function saved(p) {
  const [download] = await Promise.all([p.waitForEvent("download"), p.click("#save")]);
  return readFileSync(await download.path(), "utf8");
}

/** The next visit with storage well again. */
async function healthyVisit(p) {
  await p.evaluate(() => sessionStorage.setItem("healthy", "1"));
  await p.reload();
}

for (const fault of ["open fails", "read fails", "open never answers"]) {
  await check(`storage that ${fault}: the app starts on a new project and says why; the kept one opens next visit`, async () => {
    const p = await kept(fault);
    const began = Date.now();
    await p.reload();
    // Never a blank app: the empty design's hint shows, with why in words.
    await p.waitForSelector("#start-hint", { state: "visible", timeout: ANSWER_MS + 10_000 });
    const waited = Date.now() - began;
    if (fault === "open never answers") assert.ok(waited >= ANSWER_MS * 0.9, `waited ${waited} ms: storage is given its time`);
    const why = await p.textContent("#file-status");
    const expected = {
      "open fails": /^Projects can't be kept in this browser \(browser storage failed: can't open the project database \(UnknownError: planted open failure\)\)\. Use Save to keep your work as a file\.$/,
      "read fails": /^Projects can't be kept in this browser \(browser storage failed: can't read ".+" \(UnknownError: planted read failure\)\)\. Use Save to keep your work as a file\.$/,
      "open never answers": /^Projects can't be kept in this browser \(browser storage didn't answer\)\. Use Save to keep your work as a file\.$/,
    }[fault];
    assert.match(why, expected);
    // The app works: a box built, and Save gives a file holding it.
    await startWithBox(p);
    assert.match(await saved(p), /"width": ?40\b/);
    // Nothing pretends to autosave.
    assert.equal(await p.textContent("#save-status"), "");
    // The kept project was never lost: storage well again, it opens.
    await healthyVisit(p);
    await p.waitForFunction(() => document.querySelector("#volume")?.textContent === "30,000 mm³", null, { timeout: 15_000 });
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

for (const fault of ["write fails", "write never answers"]) {
  await check(`storage that ${fault}: the status says so in words, Save gives the latest design, and the change comes back next visit`, async () => {
    const p = await kept(fault);
    await p.reload();
    await p.waitForFunction(() => document.querySelector("#volume")?.textContent === "30,000 mm³");
    assert.equal(await saveState(p), "saved", "reading works");
    // 50 · 30 · 25 = 37,500 mm³.
    await p.fill("#height", "25");
    await p.waitForFunction(() => document.querySelector("#volume")?.textContent === "37,500 mm³");
    if (fault === "write fails") {
      await p.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "error");
      assert.match(await p.textContent("#save-status"), /^Not saved: browser storage failed: can't save "project\/.+" \(UnknownError: planted write failure\)$/);
    } else {
      // Still waiting at 0.9 × the deadline (after the 1 s quiet moment); the words by 1.1 ×.
      await p.waitForTimeout(1000 + ANSWER_MS * 0.9);
      assert.equal(await p.textContent("#save-status"), "Saving…");
      await p.waitForFunction((words) => document.querySelector("#save-status")?.textContent === words, NOT_ANSWERING, { timeout: ANSWER_MS * 0.2 + 1000 });
      // A change meanwhile doesn't put "Saving…" back: 50 · 30 · 30 = 45,000 mm³.
      await p.fill("#height", "30");
      await p.waitForFunction(() => document.querySelector("#volume")?.textContent === "45,000 mm³");
      await p.waitForTimeout(1500);
      assert.equal(await p.textContent("#save-status"), NOT_ANSWERING);
    }
    // Save gives a file holding the latest design.
    const height = fault === "write fails" ? 25 : 30;
    assert.match(await saved(p), new RegExp(`"height": ?${height}\\b`), "the file holds the latest height");
    // The change was never lost: the next visit with storage well puts it back.
    await healthyVisit(p);
    const want = `${(50 * 30 * height).toLocaleString("en-US")} mm³`;
    await p.waitForFunction((v) => document.querySelector("#volume")?.textContent === v, want, { timeout: 15_000 });
    await p.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved");
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

await browser.close();
await site.close();
if (failed) process.exit(1);

// Browser check that a change survives the page going before autosave has
// stored it (timeline bug hunt, finding 1: a reload or close within about
// a second of an edit lost it, in every engine). Each check makes its
// change and leaves while the top bar still says "Saving…", so autosave's
// quiet moment has not come:
//   - a width typed, then reloaded at once (1280 px, and 375 px with taps);
//   - the hunt's own steps: Box, Sketch 1 (a square), Extrude 1, Go to the
//     start, reloaded at once: all three items and the marker come back;
//   - a file opened says Saving… until it is kept, and once it says Saved a
//     reload brings the file back, not the last project (issue #247);
//   - a burst of widths, then the tab closed (its beforeunload run): no
//     question asked, and a new tab opens the last width;
//   - localStorage refusing the journal (as when it is full): a saved page
//     reloads without asking, and closing while a change waits asks first,
//     and staying keeps the page;
//   - browser storage full: a reload shows the last width, Save writes it,
//     and it is stored once there is room (real-use hunt B1).
// Every page comes back saying Saved, with no journal entry left.
// Run with `npm run e2e` (after `npm run build`); `E2E_BROWSER` picks the engine.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { clickPlane, TOP } from "./sketch-screen.mjs";
import { preview } from "vite";
import { withPropertiesFolded, pinProperties } from "./properties.mjs";
import { gridSnapOn, openPanel, startWithBox, pickPlane } from "./start.mjs";

const server = await preview({ preview: { port: 4232, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4232/";
const browser = await launch();
const errors = [];
const UNSAVED_PREFIX = "panoshape.unsaved/"; // packages/storage/src/unsaved.ts

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n  ${e.stack ?? e}`);
  }
}

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(() => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const status = (page) => page.$eval("#save-status", (s) => s.dataset.state);
const journal = (page) => page.evaluate((prefix) => Object.keys(localStorage).filter((k) => k.startsWith(prefix)), UNSAVED_PREFIX);
const volume = (page, want) => until(page, (w) => document.querySelector("#volume")?.textContent === w, want, `the volume ${want}`);

/** A context of its own (its own IndexedDB and localStorage, kept across reloads), the app open on the box, inserted and stored. */
async function fresh(width, { touch = false, init } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch });
  if (init) await context.addInitScript(init);
  const page = await open(context);
  // A new browser: the default box is stored as a new project.
  await until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "the box stored");
  return { context, page };
}

/** A new page in `context`: on a new browser (no `want`) the box is inserted into the empty new project (U0c); else the stored project showing `want`. */
async function open(context, want) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  if (want === undefined) await startWithBox(page);
  else await volume(page, want);
  await pinProperties(page); // the size boxes are in the panel, folded at the start on a wide screen (U0b)
  return page;
}

/** Types `value` into the width box as a person would (a click first, which is the user's gesture a leave question needs). */
async function typeWidth(page, value, tap) {
  await openPanel(page, "properties", tap); // phone: the size boxes are in the Properties sheet, closed until its toggle (U5)
  await press(page, "#width", tap);
  await page.fill("#width", value);
}

/** After the page has come back: the project was put back and stored, and the journal is empty. */
async function cameBack(page) {
  await until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "Saved after coming back");
  assert.equal(await page.textContent("#file-status"), "", "no message");
  assert.deepEqual(await journal(page), [], "no journal entry left");
}

const bar = (page) =>
  page.$$eval("#timeline .timeline-bar > li", (lis) =>
    lis.filter((li) => !li.classList.contains("timeline-bar-more-slot")).map((li) => (li.classList.contains("timeline-bar-marker") ? "|" : li.dataset.item + (li.dataset.rolledBack ? " rolled back" : ""))),
  );

try {
  for (const [width, tap] of [
    [1280, false],
    [375, true],
  ]) {
    await check(`a width typed and the page reloaded at once, still Saving…, comes back (${width} px${tap ? ", taps" : ""})`, async () => {
      const { context, page } = await fresh(width, { touch: tap });
      const id = await page.evaluate(() => document.body.dataset.projectId);
      await typeWidth(page, "50", tap);
      await volume(page, "30,000 mm³"); // V = 50 · 30 · 20, worked by hand
      assert.equal(await status(page), "saving", "left before autosave's quiet moment");
      await page.reload();
      await volume(page, "30,000 mm³");
      assert.equal(await page.inputValue("#width"), "50");
      assert.equal(await page.evaluate(() => document.body.dataset.projectId), id, "the same stored project");
      await cameBack(page);
      await context.close();
    });
  }

  await check("the hunt's steps: Box, Sketch 1, Extrude 1, Go to the start, reloaded at once: all of it and the marker come back", async () => {
    const { context, page } = await fresh(1280);
    // A 10 × 10 square on XY, extruded 10: 1,000 mm³ (the panel shows the last body).
    await page.click("#create-sketch");
    await pickPlane(page, "XY", false);
    await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
    await gridSnapOn(page);
    await page.click("#sketch-tool-rectangle");
    // The sketch's panel floats over the square's corners on a wide screen (U0b).
    await withPropertiesFolded(page, async () => {
      for (const p of [
        [50, 0],
        [60, 10],
      ])
        await clickPlane(page, p, TOP);
    });
    await until(page, () => document.querySelector("#sketch-status")?.textContent === "4 lines, a closed outline.", null, "the square closed");
    await page.click("#sketch-extrude");
    await page.fill("#extrude-distance", "10");
    await page.click("#extrude-ok");
    await volume(page, "1,000 mm³");
    await until(page, () => document.querySelector("#viewport").dataset.sketching !== "true", null, "the sketch finished");
    // As the hunt did: wait for Saved, then move the marker and reload within a second.
    await until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "the extrude stored");
    const items = (await bar(page)).filter((i) => i !== "|");
    assert.equal(items.length, 3, `Box, Sketch 1, Extrude 1: ${items}`);
    await page.click('#timeline [data-button="start"]');
    await until(page, () => document.querySelector("#viewport").dataset.shape === "none", null, "nothing built");
    assert.equal(await status(page), "saving", "left before autosave's quiet moment");
    await page.reload();
    await until(page, () => document.querySelector("#timeline .timeline-bar-marker"), null, "the bar");
    await until(page, () => document.querySelector("#viewport").dataset.shape === "none", null, "nothing built after the reload");
    assert.deepEqual(await bar(page), ["|", ...items.map((i) => `${i} rolled back`)]);
    assert.equal(await page.textContent("#volume"), "—");
    await cameBack(page);
    await context.close();
  });

  // The hunt's follow-up: Open (or a drop, the same path) within the quiet moment after an edit stopped the old
  // project's autosave, which dropped the waiting save, so the stored old project lacked its last edit.
  await check("a width typed and a file opened at once, still Saving…: the old project is stored with the width, the file opens as a new project", async () => {
    const { context, page } = await fresh(1280);
    const old = await page.evaluate(() => document.body.dataset.projectId);
    // A file of the box made 60 wide, from Save: V = 60 · 30 · 20 = 36,000 mm³.
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
    const file = JSON.parse(await download.path().then((p) => import("node:fs").then((fs) => fs.readFileSync(p, "utf8"))));
    file.workspaces.design.timeline.features[0].intent.parameters.width = 60;
    await typeWidth(page, "50", false);
    await volume(page, "30,000 mm³"); // 50 · 30 · 20
    assert.equal(await status(page), "saving", "opened before autosave's quiet moment");
    await page.setInputFiles("#open-file", { name: "sixty.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
    await volume(page, "36,000 mm³");
    await until(page, (o) => document.body.dataset.projectId && document.body.dataset.projectId !== o, old, "the file kept as a new project");
    await until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "the file stored");
    // The old project, read straight from the store: the width typed before Open.
    const width = () =>
      page.evaluate(
        (id) =>
          new Promise((resolve, reject) => {
            const r = indexedDB.open("fission", 1);
            r.onerror = () => reject(r.error);
            r.onsuccess = () => {
              const get = r.result.transaction("kv").objectStore("kv").get(`project/${id}`);
              get.onsuccess = () => {
                const v = typeof get.result === "string" ? JSON.parse(get.result) : get.result;
                resolve(v?.workspaces?.design?.timeline?.features?.[0]?.intent?.parameters?.width ?? null);
              };
              get.onerror = () => reject(get.error);
            };
          }),
        old,
      );
    for (let i = 0; i < 50 && (await width()) !== 50; i++) await page.waitForTimeout(100);
    assert.equal(await width(), 50, "the old project holds its last width");
    assert.deepEqual(await journal(page), [], "no journal entry left");
    await context.close();
  });

  await check("a file opened says Saving… until it is kept, and reloaded once it says Saved, the file comes back (issue #247)", async () => {
    const { context, page } = await fresh(1280);
    // A file of the box made 70 wide, from Save: V = 70 · 30 · 20 = 42,000 mm³ (the box is 40 · 30 · 20 = 24,000).
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
    const file = JSON.parse(await download.path().then((p) => import("node:fs").then((fs) => fs.readFileSync(p, "utf8"))));
    file.workspaces.design.timeline.features[0].intent.parameters.width = 70;
    // A slow store (the nightly monkey's, holding hundreds of projects on a busy runner): the list of kept projects,
    // which opening a file looks through for a copy of it, answers 1.5 s late, so the file shows well before it is kept.
    await page.evaluate(() => {
      const list = IDBObjectStore.prototype.getAllKeys;
      IDBObjectStore.prototype.getAllKeys = function (...args) {
        const request = list.apply(this, args);
        let held = true;
        request.addEventListener("success", (e) => {
          if (!held) return;
          e.stopImmediatePropagation(); // the store's own onsuccess waits
          setTimeout(() => ((held = false), request.dispatchEvent(new Event("success"))), 1500);
        });
        return request;
      };
    });
    await page.setInputFiles("#open-file", { name: "seventy.spindle", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
    await volume(page, "42,000 mm³");
    // Shown, not yet kept: the mark said "Saved" here (the last project's), and a reload brought the 24,000 mm³ box back.
    assert.equal(await status(page), "saving", "the opened file is not kept yet, so the mark says Saving…");
    await until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "the file stored");
    await page.reload(); // the store as it is again
    await volume(page, "42,000 mm³");
    assert.equal(await status(page), "saved");
    await context.close();
  });

  await check("a burst of widths and the tab closed: no question asked, a new tab opens the last width", async () => {
    const { context, page } = await fresh(1280);
    const asked = [];
    page.on("dialog", (d) => (asked.push(d.type()), d.dismiss()));
    for (const w of ["41", "42", "43", "44", "45"]) await typeWidth(page, w);
    await volume(page, "27,000 mm³"); // 45 · 30 · 20
    assert.equal(await status(page), "saving", "left before autosave's quiet moment");
    await Promise.all([page.waitForEvent("close", { timeout: 15000 }), page.close({ runBeforeUnload: true })]);
    const again = await open(context, "27,000 mm³");
    assert.equal(await again.inputValue("#width"), "45");
    assert.deepEqual(asked, [], "the journal kept the change, so nothing was asked");
    await cameBack(again);
    await context.close();
  });

  await check("localStorage refusing the journal: a saved page reloads without asking; closing while Saving… asks first, and staying keeps the page", async () => {
    // As a full localStorage does: every journal write throws.
    const { context, page } = await fresh(1280, {
      init: () => {
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (String(k).startsWith("panoshape.unsaved/")) throw new DOMException("the quota has been exceeded", "QuotaExceededError");
          return set.call(this, k, v);
        };
      },
    });
    const asked = [];
    page.on("dialog", (d) => (asked.push(d.type()), d.dismiss()));
    await typeWidth(page, "50");
    await volume(page, "30,000 mm³");
    await until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "Saved");
    // A reload runs beforeunload as a close does. (Playwright's WebKit never finishes a close
    // that runs beforeunload on a page with no listener, so the saved page is reloaded instead.)
    await page.reload();
    await volume(page, "30,000 mm³");
    assert.deepEqual(asked, [], "a saved page asks nothing");
    // Now a change still waiting: closing asks; dismissing the question stays.
    await typeWidth(page, "60");
    await volume(page, "36,000 mm³"); // 60 · 30 · 20
    assert.equal(await status(page), "saving");
    await page.close({ runBeforeUnload: true });
    for (let i = 0; i < 50 && asked.length === 0; i++) await page.waitForTimeout(100);
    assert.deepEqual(asked, ["beforeunload"]);
    assert.equal(page.isClosed(), false, "staying keeps the page");
    // leaving() started the save straight away, without waiting for another quiet moment.
    await until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "Saved");
    assert.deepEqual(await journal(page), []);
    // The page still counts as opening for SETTLED_MS after it showed (the reopen guard, reopen.ts):
    // a tab opened before then would start a new project instead, so wait for its mark to clear.
    await until(page, () => localStorage.getItem("panoshape.opening") === null, null, "the page counted as opened");
    await open(context, "36,000 mm³");
    await context.close();
  });

  await check("browser storage full: a reload shows the last width, Save writes it, and it is stored once there is room", async () => {
    // Real-use hunt B1: the change the store refused (full) was put back nowhere, so a reload showed the older
    // stored width and Save to file wrote that. A full disk, emulated: while localStorage "full" is set, every
    // IndexedDB put fails as a full disk does (QuotaExceededError, the transaction aborted).
    const { context, page } = await fresh(1280, {
      init: () => {
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...a) {
          const r = put.apply(this, a);
          if (localStorage.getItem("full")) this.transaction.abort();
          return r;
        };
      },
    });
    const full = (on) => page.evaluate((on) => (on ? localStorage.setItem("full", "1") : localStorage.removeItem("full")), on);
    try {
      await full(true);
      await typeWidth(page, "50");
      await volume(page, "30,000 mm³"); // 50·30·20
      await until(page, () => document.querySelector("#save-status").dataset.state === "error", null, "the save refused");
      await page.reload();
      await volume(page, "30,000 mm³");
      assert.match(await page.textContent("#file-status"), /couldn't be stored \(.+\); they are shown, and kept in this browser until it has room: Save keeps them as a file\./);
      // It tries to store it at once, and says it couldn't: never "Saved".
      await until(page, () => document.querySelector("#save-status").dataset.state === "error", null, "not said to be saved");
      const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
      const file = JSON.parse(readFileSync(await download.path(), "utf8"));
      assert.equal(file.workspaces.design.timeline.features[0].intent.parameters.width, 50, "Save writes what is shown");
      // Another edit while still full: kept too, and shown after a reload.
      await pinProperties(page);
      await typeWidth(page, "45");
      await volume(page, "27,000 mm³"); // 45·30·20
      await page.reload();
      await volume(page, "27,000 mm³");
      // Room again: the next change is stored, and the journal is empty.
      await full(false);
      await pinProperties(page);
      await typeWidth(page, "60");
      await volume(page, "36,000 mm³"); // 60·30·20
      await until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "stored");
      assert.deepEqual(await journal(page), []);
      await page.reload();
      await volume(page, "36,000 mm³");
      await cameBack(page);
    } finally {
      await context.close();
      // The refused saves are this check's own doing.
      errors.splice(0, Infinity, ...errors.filter((e) => !/AbortError|aborted|QuotaExceeded/i.test(e)));
    }
  });

  await check("no page errors", async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  await server.close();
}
if (failed) {
  console.log(`${failed} leave-save check(s) failed`);
  process.exit(1);
}

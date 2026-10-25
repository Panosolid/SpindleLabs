// Browser checks of short names and Rename (U0e, the owner's ask): every
// item is shown by its short name ("Box 1", "Cylinder 1"), its description
// in the tooltip; Rename in an item's menu opens a small box where the
// menu was, the name selected; Enter (or Rename) saves it as one undo step
// "Rename Box 1", Escape keeps it; an empty name, one over 40 characters
// or another item's is refused with why, in the box, which stays open;
// the name is kept through Undo, Redo and a reload. At 1280 px with the
// mouse and the keyboard, and 375 px with taps, with deliberate breaks
// that fail. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { insertPreset, startWithBox } from "./start.mjs";

const server = await preview({ preview: { port: 4238, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4238/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const undoTitle = (page) => page.getAttribute("#undo", "title");
const rebuilt = (page) => until(page, () => document.querySelector("#viewport")?.dataset.rebuilding !== "true", null, "the rebuild landed");
/** Each bar item's tooltip: "1. Box 1", then on its own line the description. */
const barTitles = (page) => page.$$eval("#timeline [data-item]", (els) => els.map((e) => e.title));
const bodies = (page) => page.$$eval('#browser .tree-row[data-node^="body-"]', (rows) => rows.map((r) => r.textContent));
/** The browser's Timeline rows: each item's name and its tooltip (the name over the description). */
const timelineRows = (page) => page.$$eval('#browser [data-node="timeline"] .tree-row', (rows) => rows.map((r) => [r.textContent, r.title]));
/** Whether a box is whole on a screen `width` × `height`. */
const fits = (box, width, height) => box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 0.5 && box.y + box.height <= height + 0.5;

async function fresh(width, touch) {
  const context = await browser.newContext({ viewport: { width, height: width > 640 ? 800 : 667 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("kept")) indexedDB.deleteDatabase("fission");
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  return page;
}

/** Opens item `id`'s menu from the bar: a right-click, or (taps) a tap on it and on its ⋯. */
async function barMenu(page, id, tap) {
  await rebuilt(page);
  const item = page.locator(`#timeline [data-item="${id}"]`);
  await item.scrollIntoViewIfNeeded();
  if (tap) {
    // A tap picks the item and shows its ⋯; a tap on an item already picked would put the ⋯ away.
    if ((await page.locator(`#timeline [data-more="${id}"]`).count()) === 0) await item.tap();
    await page.tap(`#timeline [data-more="${id}"]`);
  } else await item.click({ button: "right" });
  await until(page, () => document.getElementById("row-menu").open, null, `${id}'s menu`);
}

/** Opens item `id`'s Rename box from the bar's menu. */
async function openRename(page, id, tap) {
  await barMenu(page, id, tap);
  await press(page, "#row-menu-rename", tap);
  await until(page, () => document.getElementById("rename-box").open, null, "the rename box");
}

/** Types `name` over the selected name and saves it: Enter with the keyboard, the Rename button with taps. */
async function typeAndSave(page, name, tap) {
  await page.fill("#rename-input", name);
  if (tap) await page.tap("#rename-save");
  else await page.keyboard.press("Enter");
}

/** What the box shows now: open or not, the name in its line, the refusal (null when none). */
const boxState = (page) =>
  page.evaluate(() => {
    const why = document.getElementById("rename-why");
    return { open: document.getElementById("rename-box").open, value: document.getElementById("rename-input").value, why: why.hidden ? null : why.textContent };
  });

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`not ok - ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

try {
  for (const [width, tap] of [[1280, false], [375, true]]) {
    const at = `${width} px${tap ? ", taps" : ""}`;
    const height = width > 640 ? 800 : 667;

    await check(`${at}: items show short names, the description in the tooltip; Rename saves one undo step, kept through Undo, Redo and a reload`, async () => {
      const page = await fresh(width, tap);
      try {
        await startWithBox(page, tap);
        await insertPreset(page, "cylinder", tap);
        await until(page, () => document.querySelectorAll("#timeline [data-item]").length === 2, null, "two items");
        await rebuilt(page);
        // Worked by hand: the first box is Box 1, the first cylinder Cylinder 1 (Insert's sizes, ⌀40 × 20).
        assert.deepEqual(await barTitles(page), ["1. Box 1\nBox: 40 × 30 × 20 mm", "2. Cylinder 1\nCylinder: ⌀40 × 20 mm"]);
        // The menu offers Rename, named for the item, before Delete.
        await barMenu(page, "feature-1", tap);
        assert.deepEqual(await page.$$eval("#row-menu button", (bs) => bs.map((b) => b.id)), ["row-menu-edit", "row-menu-marker", "row-menu-suppress", "row-menu-rename", "row-menu-delete"]);
        assert.equal(await page.getAttribute("#row-menu-rename", "aria-label"), "Rename Box 1");
        await press(page, "#row-menu-rename", tap);
        await until(page, () => document.getElementById("rename-box").open, null, "the rename box");
        // The box: the name in it, all selected and focused, whole on the screen.
        assert.deepEqual(await boxState(page), { open: true, value: "Box 1", why: null });
        assert.equal(await page.textContent("#rename-heading"), "Rename Box 1");
        assert.deepEqual(await page.evaluate(() => { const i = document.activeElement; return [i?.id, i.selectionStart, i.selectionEnd]; }), ["rename-input", 0, 5]);
        assert.ok(fits(await page.locator("#rename-box").boundingBox(), width, height), "the box fits the screen");
        if (shots) await page.screenshot({ path: `${shots}/rename-box-${width}.png` });
        if (tap) await typeAndSave(page, "Base", tap);
        else {
          // Typing replaces the selected name (no fill): the keyboard as a person uses it, then Enter.
          await page.keyboard.type("Base");
          await page.keyboard.press("Enter");
        }
        await until(page, () => !document.getElementById("rename-box").open, null, "the box closed");
        await until(page, () => document.querySelector('#timeline [data-item="feature-1"]').title.startsWith("1. Base\n"), null, "the bar's new name");
        assert.deepEqual(await barTitles(page), ["1. Base\nBox: 40 × 30 × 20 mm", "2. Cylinder 1\nCylinder: ⌀40 × 20 mm"], "the description never changes");
        assert.equal(await undoTitle(page), "Undo Rename Box 1 (Ctrl+Z)");
        // The bodies keep their own rows; the volume is the box's and the cylinder's, nothing rebuilt differently.
        assert.deepEqual(await bodies(page), ["Body 1", "Body 2"]);
        // The browser's Timeline rows (open the group): the names, the tooltips the names over the descriptions.
        if (tap) await page.tap("#browser-toggle");
        await press(page, '#browser details[data-node="timeline"] > summary', tap);
        assert.deepEqual(await timelineRows(page), [["Base", "Base\nBox: 40 × 30 × 20 mm"], ["Cylinder 1", "Cylinder 1\nCylinder: ⌀40 × 20 mm"]]);
        if (tap) await page.tap("#browser-toggle");
        // Undo gives Box 1 back; Redo Base again.
        await press(page, "#undo", tap);
        await until(page, () => document.querySelector('#timeline [data-item="feature-1"]').title.startsWith("1. Box 1\n"), null, "undone");
        await press(page, "#redo", tap);
        await until(page, () => document.querySelector('#timeline [data-item="feature-1"]').title.startsWith("1. Base\n"), null, "redone");
        // A new box after the rename is the second box: Box 2 (one box there, 1 + 1), whatever the first is called.
        await insertPreset(page, "box", tap);
        await until(page, () => document.querySelectorAll("#timeline [data-item]").length === 3, null, "three items");
        assert.equal((await barTitles(page))[2], "3. Box 2\nBox: 40 × 30 × 20 mm");
        // Saved, then reloaded: the names are in the project.
        await until(page, () => document.querySelector("#save-status").dataset.state === "saved", null, "Saved");
        await page.evaluate(() => sessionStorage.setItem("kept", "1"));
        await page.reload();
        await until(page, () => document.querySelectorAll("#timeline [data-item]").length === 3, null, "the reloaded design");
        assert.deepEqual((await barTitles(page)).map((t) => t.split("\n")[0]), ["1. Base", "2. Cylinder 1", "3. Box 2"]);
      } finally {
        await page.context().close();
      }
    });

    await check(`${at}: an empty name, one over 40 characters and another item's are refused in the box, which stays open; 40 is kept; Escape saves nothing`, async () => {
      const page = await fresh(width, tap);
      try {
        await startWithBox(page, tap);
        await insertPreset(page, "cylinder", tap);
        await until(page, () => document.querySelectorAll("#timeline [data-item]").length === 2, null, "two items");
        await openRename(page, "feature-2", tap);
        // The box's name, ignoring case: refused, words naming the item that has it.
        await typeAndSave(page, "box 1", tap);
        await until(page, () => !document.getElementById("rename-why").hidden, null, "the refusal");
        assert.deepEqual(await boxState(page), { open: true, value: "box 1", why: "Box 1 is already the name of another item: each item needs its own name, since messages name items by them" });
        assert.equal(await page.getAttribute("#rename-input", "aria-invalid"), "true");
        // Taller with the refusal's words, it is still whole on the screen, its buttons too (a phone's menu opens near the bottom).
        assert.ok(fits(await page.locator("#rename-box").boundingBox(), width, height), "the box with its refusal fits the screen");
        if (shots) await page.screenshot({ path: `${shots}/rename-refused-${width}.png` });
        // Empty.
        await typeAndSave(page, "   ", tap);
        await until(page, (w) => document.getElementById("rename-why").textContent === w, "A name can't be empty: type one, or press Escape to keep Cylinder 1", "empty refused");
        // 41 characters (and 1.1 × 40 = 44) refused, saying how many; 40 kept.
        await typeAndSave(page, "c".repeat(44), tap);
        await until(page, (w) => document.getElementById("rename-why").textContent === w, "A name can have at most 40 characters: this one has 44", "44 refused");
        await typeAndSave(page, "c".repeat(41), tap);
        await until(page, (w) => document.getElementById("rename-why").textContent === w, "A name can have at most 40 characters: this one has 41", "41 refused");
        assert.equal(await undoTitle(page), "Undo Insert Cylinder (Ctrl+Z)", "nothing recorded by a refusal");
        await typeAndSave(page, "c".repeat(40), tap);
        await until(page, () => !document.getElementById("rename-box").open, null, "40 kept, the box closed");
        await until(page, (w) => document.querySelector('#timeline [data-item="feature-2"]').title.startsWith(w), `2. ${"c".repeat(40)}\n`, "the 40-character name");
        assert.equal(await undoTitle(page), `Undo Rename Cylinder 1 (Ctrl+Z)`);
        // Escape (or Cancel with taps): the box closes, nothing changes.
        await openRename(page, "feature-1", tap);
        await page.fill("#rename-input", "Lid");
        if (tap) await page.tap("#rename-cancel");
        else await page.keyboard.press("Escape");
        await until(page, () => !document.getElementById("rename-box").open, null, "the box closed");
        assert.equal((await barTitles(page))[0], "1. Box 1\nBox: 40 × 30 × 20 mm");
        assert.equal(await undoTitle(page), `Undo Rename Cylinder 1 (Ctrl+Z)`, "no step for a cancel");
        // Its own name again: the box closes and records nothing.
        await openRename(page, "feature-1", tap);
        await typeAndSave(page, "Box 1", tap);
        await until(page, () => !document.getElementById("rename-box").open, null, "the box closed");
        assert.equal(await undoTitle(page), `Undo Rename Cylinder 1 (Ctrl+Z)`, "no step for the same name");
        // Keys typed in the box are words, not shortcuts: "Delete" and "z" leave the timeline as it was.
        await openRename(page, "feature-1", tap);
        await page.focus("#rename-input");
        for (const k of ["Delete", "z", "Control+z", "s"]) await page.keyboard.press(k);
        assert.equal((await boxState(page)).open, true);
        await page.keyboard.press("Escape");
        assert.equal((await barTitles(page)).length, 2, "nothing deleted or undone");
        assert.equal(await undoTitle(page), `Undo Rename Cylinder 1 (Ctrl+Z)`);
      } finally {
        await page.context().close();
      }
    });

    await check(`${at}: the checks fail on a broken box (deliberate breaks)`, async () => {
      const page = await fresh(width, tap);
      try {
        await startWithBox(page, tap);
        await openRename(page, "feature-1", tap);
        // A box 600 px wide runs off a 375 px screen, and one pushed down runs off any: the fit check sees it.
        const wide = await page.addStyleTag({ content: "#rename-box.rename-box-dialog:not(#none) { width: 600px !important; top: 780px !important; }" });
        assert.equal(fits(await page.locator("#rename-box").boundingBox(), width, height), false, "a box off the screen is caught");
        await wide.evaluate((el) => el.remove());
        // Enter (or the Rename button) swallowed before the box hears it: the wait for the saved name times out.
        await page.evaluate(() => {
          const stop = (e) => (e.key === "Enter" || e.type === "click") && e.stopImmediatePropagation();
          document.getElementById("rename-input").addEventListener("keydown", stop, true);
          document.getElementById("rename-save").addEventListener("click", stop, true);
        });
        await typeAndSave(page, "Base", tap);
        await assert.rejects(until(page, () => document.querySelector('#timeline [data-item="feature-1"]').title.startsWith("1. Base\n"), null, "the bar's new name"), /timed out/);
        assert.equal(await undoTitle(page), "Undo Insert Box (Ctrl+Z)", "nothing saved");
      } finally {
        await page.context().close();
      }
    });
  }

  await check("no errors in the console", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  server.httpServer.close();
}
if (failed) {
  console.log(`${failed} rename check(s) failed`);
  process.exit(1);
}

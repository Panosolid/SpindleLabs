// A new project starts empty (U0c, the owner's ask): checks that need a
// part to work on add one first, as a person would, with Insert ▾ (U0d).

import { pinProperties } from "./properties.mjs";

/** Adds a preset as a new body by Insert ▾ (`kind`: box, cylinder, sphere, l-bracket, plate, slot, star). */
export async function insertPreset(page, kind = "box", tap = false) {
  const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
  await press("#insert");
  await press(`#insert-${kind}`);
}

/**
 * The part most checks start from: the 40 × 30 × 20 mm box (V = 40 · 30 · 20
 * = 24,000 mm³), inserted into the empty design a fresh page opens with
 * (its hint showing says it is empty) and built.
 */
export async function startWithBox(page, tap = false) {
  await page.waitForSelector("#start-hint", { state: "visible" });
  await insertPreset(page, "box", tap);
  await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "24,000 mm³");
}

/** Changes the part's shape with the properties' Shape choice (the toolbar's shape buttons until U0d). */
export async function chooseShape(page, kind) {
  await pinProperties(page);
  await openPanel(page, "properties"); // phone: the Properties sheet opens with its toggle (U5)
  await page.selectOption("#shape", kind);
}

/**
 * Reloads to a new, empty project, as every load starts (U0c). The open
 * project is stored first: a reload while a change still waits puts it back
 * from the unsaved-change journal (main.ts), and the hint stays hidden (CI
 * runs 40138678915 and 40141969867).
 */
export async function reloadEmpty(page) {
  await page.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved");
  await page.reload();
  await page.waitForSelector("#start-hint", { state: "visible" });
}

/**
 * File ▾ (U0f2a): chooses item `id` (start-fresh for New, open, file-save,
 * file-export-stl), as a person would, by a click or a tap on File ▾ and
 * then on the item.
 */
export async function chooseFile(page, id, tap = false) {
  const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
  await press("#file-menu");
  await press(`#${id}`);
}

/** File ▾'s item `id` as the menu shows it now, [off, tooltip], read with the menu open and the menu closed again. */
export async function fileItem(page, id) {
  await page.click("#file-menu");
  const state = await page.$eval(`#${id}`, (b) => [b.getAttribute("aria-disabled") === "true", b.title]);
  await page.click("#file-menu");
  return state;
}

/**
 * DESIGN ▾ (U0f2b): shows workspace `id` (design, image, laser…) by its
 * item in the workspace button's menu, as a person would, by a click or a
 * tap on the button and then on the item.
 */
export async function switchTo(page, id, tap = false) {
  const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
  await press("#workspace-menu");
  await press(`#workspace-menu-menu [data-workspace="${id}"]`);
}

/**
 * Phone layout (U5): Properties and Browser are sheets over the view, closed
 * until their toggle (#properties-toggle, #browser-toggle) is pressed, and
 * opening one closes the other. Opens sheet `which` ("properties" or
 * "browser") as a person would, pressing its toggle only if the sheet is
 * closed. A no-op where there is no toggle (wide screens).
 */
export async function openPanel(page, which, tap) {
  tap ??= await page.evaluate(() => navigator.maxTouchPoints > 0); // a touch context taps, a mouse one clicks
  const toggle = `#${which}-toggle`;
  if (!(await page.isVisible(toggle))) return;
  await pressUntil(page, toggle, "true", tap);
}

/**
 * Presses sheet toggle `toggle` until its aria-expanded is `want`, as a person
 * taps again when a sheet didn't move. Reading the state and then pressing is
 * a race: the app opens and closes the Properties sheet by itself as tools
 * start and end, so a sheet read as open can shut just before the press lands
 * and the press opens it again (extrude-drag at 375 px, merge queue
 * 2026-10-29: 30 s waiting for a state that never came). Each press waits up
 * to 5 s; a press that needed repeating is logged, and three that change
 * nothing fail with the state seen.
 */
export async function pressUntil(page, toggle, want, tap) {
  const state = () => page.getAttribute(toggle, "aria-expanded");
  for (let press = 1; press <= 3; press++) {
    if ((await state()) === want) {
      if (press > 1) console.log(`  note: ${toggle} needed ${press - 1} presses to be ${want === "true" ? "open" : "shut"}`);
      return;
    }
    await (tap ? page.tap(toggle) : page.click(toggle));
    const done = await page.waitForFunction(([t, w]) => document.querySelector(t)?.getAttribute("aria-expanded") === w, [toggle, want], { timeout: 5000 }).then(() => true, () => false);
    if (done) {
      if (press > 1) console.log(`  note: ${toggle} needed ${press} presses to be ${want === "true" ? "open" : "shut"}`);
      return;
    }
  }
  throw new Error(`${toggle}: 3 presses and still aria-expanded="${await state()}", not "${want}"`);
}

/** Closes whichever phone sheet is open (Properties, Browser) by pressing its toggle, so the view is clear to tap. A no-op where there are no toggles. */
export async function closePanels(page, tap) {
  tap ??= await page.evaluate(() => navigator.maxTouchPoints > 0);
  for (const which of ["properties", "browser"]) {
    const toggle = `#${which}-toggle`;
    if ((await page.isVisible(toggle)) && (await page.getAttribute(toggle, "aria-expanded")) === "true") await pressUntil(page, toggle, "false", tap);
  }
}

/**
 * Phone layout (U5): Properties and Browser are sheets that cover part of
 * the view, so a person closes the open one before reaching what it covers
 * (the timeline, Undo and Redo docked in the view, the View buttons), and
 * opens Properties before using a control in it (a size box, the sketch's
 * and Extrude's buttons). Makes `page.tap`, `page.click`, `page.fill`,
 * `page.check`, `page.uncheck` and `page.selectOption` do that first, so a long check need
 * not repeat closePanels / openPanel before each press. `covered` are the
 * selector prefixes of what a sheet covers. A no-op where there are no
 * toggles (wide screens).
 */
export function sheetsClearFor(page, covered = ["#timeline", "#undo", "#redo", "#view-controls", "[data-view"]) {
  const orig = {};
  for (const m of ["tap", "click", "fill", "check", "uncheck", "selectOption"]) orig[m] = page[m].bind(page);
  const inProperties = (sel) => typeof sel === "string" && page.evaluate((s) => !!document.querySelector(s)?.closest("#properties"), sel).catch(() => false);
  for (const m of ["tap", "click", "fill", "check", "uncheck", "selectOption"]) {
    page[m] = async (sel, ...rest) => {
      if (typeof sel === "string" && (await page.isVisible("#properties-toggle"))) {
        if (["tap", "click"].includes(m) && covered.some((p) => sel.startsWith(p))) {
          await closePanels(page, m === "tap");
          // The assistant is a sheet too at phone width (a person closes it from Menu ▸ AI): shut it the same way.
          await page.evaluate(() => {
            const a = document.getElementById("assistant");
            if (a && !a.hidden && matchMedia("(max-width: 640px)").matches) document.getElementById("assistant-toggle")?.click();
          });
        }
        else if (await inProperties(sel)) await openPanel(page, "properties", m === "tap");
        else {
          // Something in the assistant's sheet, shut earlier by this wrapper (or never opened): open it as Menu ▸ AI does.
          await page.evaluate((x) => {
            const a = document.getElementById("assistant");
            if (a?.hidden && document.querySelector(x)?.closest("#assistant") && matchMedia("(max-width: 640px)").matches) document.getElementById("assistant-toggle")?.click();
          }, sel);
        }
      }
      return orig[m](sel, ...rest);
    };
  }
  // A press or move in the view itself: an open sheet covers part of the view, so it is closed first, as a person would to reach the face under it.
  for (const [obj, name] of [[page.touchscreen, "tap"], [page.mouse, "click"], [page.mouse, "down"], [page.mouse, "move"]]) {
    const was = obj[name].bind(obj);
    obj[name] = async (...args) => {
      if (await page.isVisible("#properties-toggle")) await closePanels(page, name === "tap");
      return was(...args);
    };
  }
  return page;
}

/** Turns sketch grid snap on. On a phone its box is in the Properties sheet: opened for the tap and closed again, leaving the view clear to draw in (a no-op beyond that where there are no toggles). */
export async function gridSnapOn(page) {
  await openPanel(page, "properties");
  await page.check("#sketch-grid-snap");
  await closePanels(page);
}

/**
 * Picks a sketch plane after Create sketch: on the bar over the view at phone width (phone-float.ts, Ben's iPhone notes
 * 10-28: the plane prompt no longer opens the Properties sheet), else the sketch panel's button.
 */
export async function pickPlane(page, id = "XY", tap) {
  tap ??= await page.evaluate(() => navigator.maxTouchPoints > 0);
  await page.waitForSelector(`#float-plane-${id}:visible, #sketch-plane-${id}:visible`);
  const sel = (await page.isVisible(`#float-plane-${id}`)) ? `#float-plane-${id}` : `#sketch-plane-${id}`;
  await (tap ? page.tap(sel) : page.click(sel));
}

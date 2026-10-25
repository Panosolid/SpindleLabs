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

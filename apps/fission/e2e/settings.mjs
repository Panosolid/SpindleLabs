// Browser check of Settings: the gear button opens a card dialog with the six sections; Close, Escape and a tap outside (wide screens) all leave it, so nothing traps the user; at phone width the button sits behind Menu, the page fits the width and Close is a 44 px target at the top; General's shortcuts button leads to the shortcuts list; nothing is sent to the network.
// Run with `npm run e2e` (after `npm run build`). SHOTS=dir saves screenshots.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4189, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4189/";
const browser = await launch();
const errors = [];
const shots = process.env.SHOTS;
let failed = false;

async function fresh(width, height = 800, touch = false) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  await page.waitForSelector("#settings-open", { state: "attached" });
  return page;
}
const isOpen = (page) => page.evaluate(() => document.getElementById("settings")?.open ?? false);
async function openSettings(page, phone) {
  if (phone) await page.click("#menu-toggle");
  await page.click("#settings-open");
  assert.equal(await isOpen(page), true, "Settings opens");
}
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

try {
  for (const [width, phone] of [[1280, false], [375, true], [393, true]]) {
    await check(`${width} px: opens with the six sections, fits the width, Escape and Close leave`, async () => {
      const page = await fresh(width, phone ? 852 : 800, phone);
      await openSettings(page, phone);
      const titles = await page.$$eval("#settings .settings-card h3", (h) => h.map((x) => x.textContent));
      assert.deepEqual(titles, ["General", "Design", "Phone", "Printing", "Privacy and data", "About"]);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll");
      const close = await page.locator("#settings .close").boundingBox();
      assert.ok(close.y >= 0 && close.x + close.width <= width, "Close is on screen");
      if (phone) assert.ok(close.height >= 44 && close.y < 80, `Close is a 44 px target at the top (height ${close.height}, y ${close.y})`);
      if (shots) await page.screenshot({ path: `${shots}/settings-${width}.png` });
      await page.keyboard.press("Escape");
      assert.equal(await isOpen(page), false, "Escape closes");
      await openSettings(page, phone);
      await page.click("#settings .close", { force: true });
      assert.equal(await isOpen(page), false, "Close closes");
      await page.context().close();
    });
  }
  await check("1280 px: a click outside the card closes it", async () => {
    const page = await fresh(1280);
    await openSettings(page, false);
    await page.mouse.click(5, 400);
    assert.equal(await isOpen(page), false);
    await page.context().close();
  });
  await check("393 px: a tap on the card's text does not close it", async () => {
    const page = await fresh(393, 852, true);
    await openSettings(page, true);
    await page.tap("#settings .settings-card h3");
    assert.equal(await isOpen(page), true);
    await page.context().close();
  });
  await check("General's Show opens the shortcuts list, and the app stays usable after closing both", async () => {
    const page = await fresh(1280);
    await openSettings(page, false);
    await page.click("#settings [data-section=general] .settings-action");
    assert.equal(await isOpen(page), false, "Settings steps aside");
    assert.equal(await page.evaluate(() => document.getElementById("shortcuts")?.open), true, "the shortcuts list is open");
    await page.keyboard.press("Escape");
    await page.click("#settings-open");
    assert.equal(await isOpen(page), true, "Settings opens again");
    await page.context().close();
  });
  await check("About shows the kernel version once it is known", async () => {
    const page = await fresh(1280);
    await page.waitForFunction(() => /kernel v/.test(document.getElementById("version")?.textContent ?? ""));
    await openSettings(page, false);
    const about = await page.textContent("#settings [data-section=about] p");
    assert.match(about, /^SpindleLabs, kernel v\d/);
    await page.context().close();
  });
  assert.deepEqual(errors, [], "no page errors");
} finally {
  await browser.close();
  await server.close();
}
if (failed) process.exit(1);

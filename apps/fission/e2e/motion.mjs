// Browser checks of the small motions (styles/motion.css): a toolbar button
// eases its colours and an icon nudges on hover (mouse only), a press sinks a
// button, a menu fades in, and with prefers-reduced-motion every one of them
// is off. A control (the same button with the .motion class taken off) must
// show none of it. Run with `npm run e2e` (after `npm run build`).
// `E2E_SHOTS=<dir>` saves screenshots.
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4252, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4252/";
const browser = await launch();
const shots = process.env.E2E_SHOTS;
const TOOL = ".toolbar-group-tool";
const duration = (page, sel) => page.$eval(sel, (el) => getComputedStyle(el).transitionDuration);
const iconScale = (page, sel) => page.$eval(sel + " .icon", (el) => getComputedStyle(el).transform);
const settle = (page) => page.waitForTimeout(400);
try {
  for (const reduced of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: reduced ? "reduce" : "no-preference" });
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForSelector(TOOL + ":visible");
    const sel = `${TOOL}:visible:not([aria-disabled="true"]):not(:disabled)`;
    const fast = await duration(page, sel);
    if (!reduced) {
      // --motion-fast is 110 ms = 0.11 s
      assert.match(fast, /^0\.11s/, "buttons ease their colours over 110 ms");
      await page.hover(sel);
      await settle(page);
      // scale(1.1) is matrix(1.1, 0, 0, 1.1, 0, 0)
      assert.match(await iconScale(page, sel), /^matrix\(1\.1,/, "the icon nudges to 110 % on hover");
      await page.mouse.move(5, 400);
      await settle(page);
      assert.equal(await iconScale(page, sel), "none", "and springs back");
      await page.hover(sel);
      await page.mouse.down();
      await settle(page);
      // scale(0.94) is matrix(0.94, …)
      assert.match(await page.$eval(sel, (el) => getComputedStyle(el).transform), /^matrix\(0\.94,/, "a press sinks the button to 94 %");
      await page.mouse.up();
      await page.mouse.move(5, 400);
      if (shots) await page.screenshot({ path: `${shots}/motion-1280.png` });
      // Control: without the class nothing eases or nudges.
      await page.evaluate(() => document.documentElement.classList.remove("motion"));
      assert.equal(await duration(page, sel), "0s", "control: no easing without the motion class");
      await page.hover(sel);
      await settle(page);
      assert.equal(await iconScale(page, sel), "none", "control: no nudge without the motion class");
    } else {
      assert.match(fast, /^1e-05s/, "reduced motion: the duration is 0.01 ms");
      await page.hover(sel);
      await page.mouse.down();
      await settle(page);
      assert.match(await iconScale(page, sel), /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/, "reduced motion: no nudge (scale 1)");
      assert.match(await page.$eval(sel, (el) => getComputedStyle(el).transform), /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/, "reduced motion: no press sink");
      await page.mouse.up();
    }
    await context.close();
  }
  // Touch: no hover nudge (a tap leaves "hover" stuck on a touch screen), but a press still sinks.
  const touch = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
  const page = await touch.newPage();
  await page.goto(url);
  await page.waitForSelector("#menu-toggle");
  assert.equal(await page.evaluate(() => matchMedia("(hover: hover)").matches), false, "a touch screen has no hover");
  assert.match(await duration(page, "#menu-toggle"), /^0\.11s/);
  if (shots) await page.screenshot({ path: `${shots}/motion-375.png` });
  await touch.close();
  console.log("PASS motion: ease, nudge, press, reduced motion off, touch without hover, control without the class");
} finally {
  await browser.close();
  await server.httpServer.close();
}

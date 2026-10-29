// Browser check of the design built again after the kernel starts again
// (real-use hunt E, 2026-10-28), from the hunt's two repros. The kernel's
// memory is capped (kernel-cap.mjs) so a loop of ever bigger spheres traps
// it, in any engine; the kernel worker is wrapped so chosen answers can be
// held back, to set up each order exactly.
// - E1: an edit's free of the old body is on its way when the kernel
//   traps. A fresh kernel numbers its bodies from 1 again, and the old
//   handle used to be freed on it, removing the healed part's own body:
//   the panel said "body 1 is not in the kernel" and the part stayed the
//   old size. Now the healed part is the edited one, held and drawn.
// - E2: a second trap while the first heal's answers are still on their
//   way (a slow phone). The design used to stay red until the next edit;
//   now it builds again by itself.
// 1280 px; run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch, untilBodies } from "./browser.mjs";
import { cappedSite } from "./kernel-cap.mjs";
import { pinProperties } from "./properties.mjs";
import { startWithBox } from "./start.mjs";

const site = await cappedSite(25, 4246);
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

/** A page whose kernel answers can be held: while `window.holding(request)` is true for a request, its answer waits in `window.held`. */
async function page() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    const Real = window.Worker;
    window.held = [];
    window.holding = () => false;
    window.release = () => window.held.splice(0).forEach((run) => run());
    window.Worker = class extends Real {
      constructor(...a) {
        super(...a);
        const asked = new Map();
        let handler = null;
        const post = this.postMessage.bind(this);
        this.postMessage = (m) => (asked.set(m.id, m), post(m));
        super.onmessage = (event) => {
          const request = asked.get(event.data.id);
          asked.delete(event.data.id);
          if (request && window.holding(request)) return void window.held.push(() => handler?.call(this, event));
          handler?.call(this, event);
        };
        Object.defineProperty(this, "onmessage", { get: () => handler, set: (f) => (handler = f) });
      }
    };
  });
  const p = await context.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.goto(`${site.url}?test-hooks`);
  return p;
}

/** Keeps ever bigger spheres until the kernel traps; the words the trapping call answers. */
const trap = (p) =>
  p.evaluate(async () => {
    for (let r = 1; r < 100000; r++) {
      try {
        await window.fissionTest.kernelCall("body_build", { sphere: { radius: r } });
      } catch (e) {
        return e.message;
      }
    }
    return "never ran out";
  });
const RESTARTED = "The geometry kernel ran out of memory or stopped on an internal error, so it was started again."; // packages/core/src/kernel/kernel-client.ts
const rebuilt = (p) => p.waitForFunction(() => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, { timeout: 15000 });
const red = (p) => p.$$eval("#timeline li[data-item]", (lis) => lis.filter((li) => li.dataset.failed === "true").map((li) => li.dataset.item));

await check("E1: an old body's free on its way when the kernel traps never frees the healed part's body", async () => {
  const p = await page();
  await startWithBox(p);
  await pinProperties(p);
  await untilBodies(p, 1);
  // The 40 x 30 x 20 box becomes 50 wide; the old body's free is held when the kernel runs out of memory.
  await p.evaluate(() => (window.holding = (r) => r.op === "body_free"));
  await p.fill("#width", "50");
  await p.waitForFunction(() => window.held.length > 0);
  assert.equal(await trap(p), RESTARTED);
  await p.evaluate(() => ((window.holding = () => false), window.release())); // the old kernel's answer: never taken
  await rebuilt(p);
  await p.waitForTimeout(1000); // the retries of frees at the end of each rebuild have run
  await untilBodies(p, 1, "the healed part's body is held");
  // Worked by hand: 50 x 30 x 20 = 30,000 mm³ (the old 40 wide box was 24,000).
  await p.waitForFunction(() => /30[,\s ]?000/.test(document.querySelector("#volume")?.textContent ?? ""), null, { timeout: 5000 });
  const words = await p.$eval("#properties", (el) => el.innerText);
  assert.ok(!/not in the kernel|Out of date/.test(words), `the panel shows the part, not an error: ${words.slice(-200)}`);
  assert.deepEqual(await red(p), []);
  // One more edit builds on the fresh kernel, and the healed body is still there to be replaced.
  await p.fill("#height", "25");
  await rebuilt(p);
  await p.waitForFunction(() => /37[,\s ]?500/.test(document.querySelector("#volume")?.textContent ?? ""), null, { timeout: 5000 }); // 50 x 30 x 25
  await untilBodies(p, 1);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await check("E2: a second trap while the first heal is on its way builds the design again by itself", async () => {
  const p = await page();
  await startWithBox(p);
  await untilBodies(p, 1);
  // Every answer but the spheres' held: the heal after the first trap can't finish before the second.
  await p.evaluate(() => (window.holding = (r) => !(r.op === "body_build" && r.args[0]?.sphere)));
  assert.equal(await trap(p), RESTARTED);
  assert.equal(await trap(p), RESTARTED);
  await p.evaluate(() => ((window.holding = () => false), window.release()));
  await rebuilt(p);
  await untilBodies(p, 1, "the design built again on the third kernel");
  await p.waitForTimeout(1000);
  assert.deepEqual(await red(p), [], "no item red");
  assert.notEqual(await p.$eval("#viewport", (v) => v.dataset.shape), "none", "the part is drawn");
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await browser.close();
await site.close();
if (failed) process.exit(1);

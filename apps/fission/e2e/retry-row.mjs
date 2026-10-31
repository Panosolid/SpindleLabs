// Browser check of Retry on the row of an item that took the geometry
// kernel too long (step 35d4). Box 1 (40 × 30 × 20) is built, then Cylinder
// 1 inserted while every kernel the page makes stops answering at the
// cylinder's build (a build stuck in a loop, in every fresh kernel too):
// past its time limit (the floor cut to 3 s, ?kernel-deadline) that kernel
// is let go, Cylinder 1 fails red with "took too long" and a Retry on its
// row, and the fresh kernel builds the rest (Box 1) without asking for the
// cylinder again, so one kernel is stopped, not every fresh one in turn.
// Retry asks once more: still stuck, it stops one more kernel and stays
// red; once the kernel answers, Retry builds it and the row's Retry goes.
// 1280 px with a mouse (the browser's Timeline row) and 375 px with taps
// (the bottom bar: the item tapped, then Retry beside its ⋯). Screenshots
// go to E2E_SHOTS when set. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch, untilBodies } from "./browser.mjs";
import { liveSite } from "./live-site.mjs";
import { insertPreset, sheetsClearFor, startWithBox } from "./start.mjs";

const DEADLINE_MS = 3000;
const TOOK_TOO_LONG = "This took the geometry kernel too long, so it was stopped and started again."; // packages/core/src/kernel/kernel-client.ts
const site = await liveSite(4249);
const browser = await launch();
const shots = process.env.E2E_SHOTS;
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

const until = (p, fn, arg, what, timeout = DEADLINE_MS * 4) => p.waitForFunction(fn, arg, { timeout }).catch(() => assert.fail(`${what}: timed out`));
const rebuilt = (p) => until(p, () => document.querySelector("#viewport")?.dataset.rebuilding === "false", null, "the rebuild landed");
const red = (p) => p.$$eval("#timeline li[data-item]", (lis) => lis.filter((li) => li.dataset.failed === "true").map((li) => li.dataset.item));
const rowRetries = (p) => p.$$eval('#browser [data-node="timeline"] .retry-row', (bs) => bs.map((b) => b.dataset.retry));
const stuck = (p) => p.evaluate(() => window.stuckWorkers);

for (const [width, height, tap] of [[1280, 800, false], [375, 667, true]]) {
  await check(`${width} px: a build too long for the kernel fails red with Retry on its row, the rest is built once, and Retry builds it once the kernel answers`, async () => {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: tap });
    // Every worker stops answering (all its messages dropped) from a cylinder's build on, while window.sticky.
    await context.addInitScript(() => {
      window.stuckWorkers = 0;
      window.sticky = false;
      const Real = window.Worker;
      window.Worker = class extends Real {
        constructor(...a) {
          super(...a);
          const post = this.postMessage.bind(this);
          let hung = false;
          this.postMessage = (m) => {
            if (!hung && window.sticky && m.op === "body_build" && JSON.stringify(m.args).includes('"cylinder"')) (hung = true), window.stuckWorkers++;
            if (!hung) post(m);
          };
        }
      };
    });
    const p = await context.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${site.url}?test-hooks&kernel-deadline=${DEADLINE_MS}`);
    if (tap) sheetsClearFor(p);
    await startWithBox(p, tap);
    await untilBodies(p, 1);
    await p.evaluate(() => (window.sticky = true));
    await insertPreset(p, "cylinder", tap);
    // Past the limit: Cylinder 1 (feature-2) red, Box 1 built again on the fresh kernel.
    await until(p, () => document.querySelector('#timeline li[data-item="feature-2"]')?.dataset.failed === "true", null, "Cylinder 1 red");
    await rebuilt(p);
    await untilBodies(p, 1, "Box 1 alone, on the fresh kernel");
    await p.waitForTimeout(DEADLINE_MS * 1.5); // no second kernel stops by itself
    assert.equal(await stuck(p), 1, "one kernel stopped: the fresh one was never asked for the cylinder");
    assert.deepEqual(await red(p), ["feature-2"]);
    assert.deepEqual(await rowRetries(p), ["feature-2"], "Retry on Cylinder 1's row only");
    const title = await p.getAttribute('#timeline li[data-item="feature-2"]', "title");
    assert.ok(title.includes("(failed: took too long)"), `the bar's item says why: ${title}`);
    const rowTitle = await p.getAttribute('#browser [data-node="timeline"] .tree-row[data-node="feature-2"]', "title");
    assert.ok(rowTitle.startsWith("Took too long: Cylinder 1"), `the row says why: ${rowTitle}`);
    const words = await p.$eval("#properties", (el) => el.textContent);
    assert.ok(words.includes(`Cylinder 1 took too long: ${TOOK_TOO_LONG}`), `the panel says what happened: ${words.slice(-300)}`);

    /** Presses Retry: the Timeline row's with a mouse; on a phone the bar's, after tapping the item to pick it. */
    const retry = async () => {
      if (!tap) {
        // The Timeline folder starts folded, as a person finds it: opened by its row.
        if (!(await p.isVisible('#browser .retry-row[data-retry="feature-2"]'))) await p.click('#browser details[data-node="timeline"] > summary');
        return p.click('#browser [data-node="timeline"] .retry-row[data-retry="feature-2"]');
      }
      if (!(await p.isVisible('#timeline .retry-row-bar[data-retry="feature-2"]'))) await p.tap('#timeline li[data-item="feature-2"]');
      const button = p.locator('#timeline .retry-row-bar[data-retry="feature-2"]');
      await button.waitFor();
      // The phone rule: a tap never covers most of the view. Retry is a small button in the bar.
      const box = await button.boundingBox();
      assert.ok(box.width * box.height < 0.02 * width * height, `Retry is small: ${box.width} × ${box.height}`);
      await p.tap('#timeline .retry-row-bar[data-retry="feature-2"]');
    };
    if (tap) {
      await p.tap('#timeline li[data-item="feature-2"]');
      await p.locator('#timeline .retry-row-bar[data-retry="feature-2"]').waitFor();
    } else {
      await p.click('#browser details[data-node="timeline"] > summary');
      await p.locator('#browser .retry-row[data-retry="feature-2"]').waitFor();
    }
    if (shots) await p.screenshot({ path: `${shots}/retry-red-${width}.png` });

    // Retry, still stuck: one more kernel stopped, and it stays red with its Retry.
    await retry();
    await until(p, () => window.stuckWorkers === 2, null, "Retry asked the kernel once more");
    await rebuilt(p);
    await untilBodies(p, 1);
    await p.waitForTimeout(DEADLINE_MS * 1.5);
    assert.equal(await stuck(p), 2, "Retry asks once, never again by itself");
    assert.deepEqual(await red(p), ["feature-2"]);
    assert.deepEqual(await rowRetries(p), ["feature-2"]);

    // The kernel answers now: Retry builds Cylinder 1, nothing is red, and the Retry is gone.
    await p.evaluate(() => (window.sticky = false));
    await retry();
    await untilBodies(p, 2, "Box 1 and Cylinder 1");
    await rebuilt(p);
    assert.deepEqual(await red(p), []);
    assert.deepEqual(await rowRetries(p), []);
    assert.equal(await p.locator("#timeline .retry-row-bar").count(), 0);
    // Cylinder 1 is the part the panel shows: ⌀40 × 20, π · 20² · 20 = 8000π = 25,132.741228… mm³, so its volume, not an error.
    await until(p, () => document.querySelector("#volume")?.textContent === "25,132.74123 mm³", null, "the cylinder's volume shown", 5000).catch(async (e) => assert.fail(`${e.message}: #volume says ${await p.$eval("#volume", (v) => v.textContent).catch(() => "nothing")}`));
    if (shots) await p.screenshot({ path: `${shots}/retry-built-${width}.png` });
    assert.deepEqual(errors, []);
    await context.close();
  });
}

await browser.close();
await site.close();
if (failed) process.exit(1);

// Browser check of the kernel's worker lost in the middle of a call (blind
// spots B2b, 2026-10-29). Seen here first, before the fix: a kernel that
// stopped answering (stuck in a loop) or a worker the browser closed (which
// fires no event at all) left the design "rebuilding" for good, every later
// edit queued behind it and nothing said; a worker that crashed with an
// uncaught error said "Reload the page" for good, though a fresh kernel
// builds the design. Now each is let go and a fresh kernel builds the
// design, the edit that was on its way included, and the project kept in
// the browser reopens with it.
// The faults are planted in the real worker (Playwright's worker handle):
// its next body build is never answered (stuck), closes the worker (gone),
// or throws outside any call (crashed). The kernel's deadline is cut from a
// minute to 3 s (?kernel-deadline, main.ts). A stuck kernel that sticks
// again in every fresh worker (the page drops what it sends) is healed at
// most three times, then the design says so in words and stays editable.
// 1280 px; run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch, untilBodies } from "./browser.mjs";
import { liveSite } from "./live-site.mjs";
import { pinProperties } from "./properties.mjs";
import { startWithBox } from "./start.mjs";

const DEADLINE_MS = 3000;
const NOT_ANSWERING = "The geometry kernel stopped answering, so it was started again."; // packages/core/src/kernel/kernel-client.ts
const site = await liveSite(4247);
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

/**
 * A page on the box, its kernel's deadline cut. With `stuckOn`, every worker
 * the page makes stops answering (all its messages dropped) from the first
 * request `stuckOn` matches: what a kernel stuck in a loop on that build does,
 * in every fresh kernel too.
 */
async function page(stuckOn) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (stuckOn)
    await context.addInitScript((source) => {
      const stuck = new Function("r", `return (${source})(r)`);
      window.stuckWorkers = 0;
      const Real = window.Worker;
      window.Worker = class extends Real {
        constructor(...a) {
          super(...a);
          const post = this.postMessage.bind(this);
          let hung = false;
          this.postMessage = (m) => {
            if (!hung && stuck(m)) (hung = true), window.stuckWorkers++;
            if (!hung) post(m);
          };
        }
      };
    }, stuckOn.toString());
  const p = await context.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.workers = [];
  p.on("worker", (w) => p.workers.push(w));
  await p.goto(`${site.url}?test-hooks&kernel-deadline=${DEADLINE_MS}`);
  await startWithBox(p);
  await pinProperties(p);
  await untilBodies(p, 1);
  return p;
}

/** Plants `mode` in the kernel's worker now running, for its next body build only. */
async function plant(p, mode) {
  const worker = p.workers.at(-1);
  await worker.evaluate((mode) => {
    const real = self.onmessage;
    let armed = true;
    self.onmessage = (event) => {
      if (armed && event.data.op === "body_build") {
        armed = false;
        if (mode === "stuck") return; // never answered, and the worker stays
        if (mode === "gone") return self.close(); // the browser closed it: no event at all
        if (mode === "crashed") return void setTimeout(() => { throw new Error("planted crash"); }); // an uncaught error
      }
      return real.call(self, event);
    };
  }, mode);
}

const until = (p, fn, arg, timeout = DEADLINE_MS * 4) => p.waitForFunction(fn, arg, { timeout });
const rebuilt = (p) => until(p, () => document.querySelector("#viewport")?.dataset.rebuilding === "false");
const red = (p) => p.$$eval("#timeline li[data-item]", (lis) => lis.filter((li) => li.dataset.failed === "true").map((li) => li.dataset.item));
const panel = (p) => p.$eval("#properties", (el) => el.innerText);

for (const mode of ["stuck", "gone", "crashed"]) {
  await check(`the kernel ${mode} in the middle of an edit: a fresh one builds the edit, and the project reopens with it`, async () => {
    const p = await page();
    const made = p.workers.length;
    await plant(p, mode);
    // The 40 × 30 × 20 box made 50 wide: 50 · 30 · 20 = 30,000 mm³ (it was 24,000).
    await p.fill("#width", "50");
    await until(p, () => document.querySelector("#volume")?.textContent === "30,000 mm³");
    await rebuilt(p);
    assert.equal(p.workers.length, made + 1, "one fresh kernel");
    await untilBodies(p, 1, "the edited box, held on the fresh kernel");
    assert.deepEqual(await red(p), []);
    const words = await panel(p);
    assert.ok(!/Reload the page|Out of date/.test(words), `the panel shows the part, not an error: ${words.slice(-200)}`);
    // The next edit builds on the fresh kernel at once: 50 · 30 · 25 = 37,500 mm³.
    await p.fill("#height", "25");
    await until(p, () => document.querySelector("#volume")?.textContent === "37,500 mm³", null, 5000);
    await untilBodies(p, 1);
    // Nothing lost: the project kept in this browser opens with both edits.
    await until(p, () => document.querySelector("#save-status")?.dataset.state === "saved");
    await p.reload();
    await until(p, () => document.querySelector("#volume")?.textContent === "37,500 mm³", null, 15000);
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

await check("a kernel that sticks on the same build in every fresh kernel is healed at most three times, then says so; the design stays editable", async () => {
  // Only the 50 wide box sticks: 50 · 30 · 20.
  const p = await page((r) => r.op === "body_build" && r.args[0]?.box?.width === 50);
  await p.fill("#width", "50");
  // The edit's own try and three heals, each a deadline: then the words, not "rebuilding" for good.
  await until(p, () => window.stuckWorkers === 4, null, DEADLINE_MS * 8);
  await rebuilt(p);
  await p.waitForTimeout(DEADLINE_MS * 1.5); // no fifth try starts by itself
  assert.equal(await p.evaluate(() => window.stuckWorkers), 4, "healed three times, then left");
  const words = await panel(p);
  assert.ok(words.includes(NOT_ANSWERING), `the panel says what happened: ${words.slice(-300)}`);
  // An edit that doesn't stick builds on the fresh kernel: 45 · 30 · 20 = 27,000 mm³.
  await p.fill("#width", "45");
  await until(p, () => document.querySelector("#volume")?.textContent === "27,000 mm³", null, 5000);
  await rebuilt(p);
  assert.deepEqual(await red(p), []);
  await untilBodies(p, 1);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

await browser.close();
await site.close();
if (failed) process.exit(1);

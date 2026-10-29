// Browser check of Undo and Redo (step 20b): the top bar's buttons say what
// they would take back and are off at the ends; Ctrl+Z undoes, Ctrl+Shift+Z
// and Ctrl+Y redo; typing in one box is one step; inside a text field the
// browser's own undo runs, not the project's; undo survives a workspace
// switch; a default Design fills in when first shown is never a step.
// Step 20c: the selection follows undo (dropped with the note when the face
// is gone), undo never re-frames the camera (an opened file still does), and
// at phone width the pair sits in the viewport's corner.
// Every volume is worked out by hand from V = width · depth · height with
// the default depth 30 and height 20.
// Real-use hunt C1, C2 (2026-10-28): two quick Undos or Redos free every body the put-away Design built, and the
// rebuilding flag holds until the last rebuild lands.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { browserName, launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { chooseShape, closePanels, openPanel, sheetsClearFor, startWithBox, switchTo, pickPlane } from "./start.mjs";
import { TOP, screenPoint } from "./sketch-screen.mjs";

const server = await preview({ preview: { port: 4180, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4180/";
const browser = await launch();
const errors = [];

async function fresh(hash = "#design", { box = true, hooks = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + (hooks ? "?test-hooks" : "") + hash); // hooks: window.fissionTest, the kernel's body count
  if (hash === "#design" && box) await startWithBox(page); // a new project starts empty (U0c): the 40 · 30 · 20 box, inserted
  await pinProperties(page); // the size boxes are in the panel, folded at the start on a wide screen (U0b)
  return page;
}
/** Waits until the readout shows `text`, and says what it showed if it never does. */
async function volume(page, text) {
  try {
    await page.waitForFunction((t) => document.querySelector("#volume")?.textContent === t, text, { timeout: 5000 });
  } catch {
    assert.fail(`volume: expected ${text}, saw ${await page.textContent("#volume")}`);
  }
}
/** Each button's state: [disabled, title]. */
const buttons = (page) => page.evaluate(() => ["undo", "redo"].map((id) => [document.getElementById(id).disabled, document.getElementById(id).title]));
const width = (page) => page.inputValue("#width");
/** Types into the width box key by key, as a person does (one input event per key). */
async function typeWidth(page, text) {
  await page.click("#width");
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
}
const selection = (page) => page.evaluate(() => document.body.dataset.selection ?? "");
/** Waits until the viewport shows this shape, built. */
const shape = (page, kind) => page.waitForFunction((k) => document.querySelector("#viewport").dataset.shape === k, kind, { timeout: 5000 });
/** Clicks the middle of the viewport's canvas, where the part is. */
async function clickCentre(page) {
  const box = await page.locator("#viewport canvas").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
/** Takes focus out of any field, so keys go to the app. */
const blur = (page) => page.evaluate(() => document.activeElement?.blur());

let failed = false;
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
  await check("buttons: off at the start, then Undo Change width puts back the old volume and size box, Redo brings it again", async () => {
    const page = await fresh("#design", { box: false });
    try {
      // Design filled in its empty design while it was first shown: not a step.
      await page.waitForSelector("#start-hint", { state: "visible" });
      assert.deepEqual(await buttons(page), [[true, "Nothing to undo"], [true, "Nothing to redo"]]);
      await startWithBox(page);
      assert.deepEqual(await buttons(page), [[false, "Undo Insert Box (Ctrl+Z)"], [true, "Nothing to redo"]]);
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³"); // 50 · 30 · 20
      assert.deepEqual(await buttons(page), [[false, "Undo Change width (Ctrl+Z)"], [true, "Nothing to redo"]]);
      await page.click("#undo");
      await volume(page, "24,000 mm³");
      assert.equal(await width(page), "40");
      assert.deepEqual(await buttons(page), [[false, "Undo Insert Box (Ctrl+Z)"], [false, "Redo Change width (Ctrl+Shift+Z)"]]);
      await page.screenshot({ path: "e2e/undo.png", clip: { x: 0, y: 0, width: 1280, height: 120 } });
      await page.click("#redo");
      await volume(page, "30,000 mm³");
      assert.equal(await width(page), "50");
      assert.deepEqual(await buttons(page), [[false, "Undo Change width (Ctrl+Z)"], [true, "Nothing to redo"]]);
      // Clicking an off button does nothing.
      await page.click("#redo", { force: true });
      await volume(page, "30,000 mm³");
    } finally {
      await page.close();
    }
  });

  await check("typing 6 then 0 in one box is one step; a shape is a step of its own; the walk ends at the start", async () => {
    const page = await fresh();
    try {
      await typeWidth(page, "60"); // the box shows 6, then 60: two input events, well under a second apart
      await volume(page, "36,000 mm³"); // 60 · 30 · 20
      await chooseShape(page, "cylinder");
      assert.deepEqual((await buttons(page))[0], [false, "Undo Change shape to Cylinder (Ctrl+Z)"]);
      await page.click("#undo"); // back to the box, 60 wide
      await volume(page, "36,000 mm³");
      await page.click("#undo"); // the whole typed 60 at once, back to 40
      await volume(page, "24,000 mm³");
      assert.equal(await width(page), "40");
      assert.deepEqual(await buttons(page), [[false, "Undo Insert Box (Ctrl+Z)"], [false, "Redo Change width (Ctrl+Shift+Z)"]]);
      await page.click("#undo"); // the insert: empty again, as the project started
      await page.waitForSelector("#start-hint", { state: "visible" });
      assert.equal(await page.textContent("#volume"), "—");
      assert.deepEqual(await buttons(page), [[true, "Nothing to undo"], [false, "Redo Insert Box (Ctrl+Shift+Z)"]]);
    } finally {
      await page.close();
    }
  });

  await check("keys: Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo (Cmd on a Mac is the same chord)", async () => {
    const page = await fresh();
    try {
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      await page.fill("#width", "10"); // the same box within a second: the same step, 40 → 10
      await volume(page, "6,000 mm³"); // 10 · 30 · 20
      await blur(page);
      await page.keyboard.press("Control+z");
      await volume(page, "24,000 mm³"); // back to 40 in one step
      await page.keyboard.press("Control+Shift+Z");
      await volume(page, "6,000 mm³");
      await page.keyboard.press("Control+z");
      await volume(page, "24,000 mm³");
      await page.keyboard.press("Control+y");
      await volume(page, "6,000 mm³");
      await page.keyboard.press("Meta+z");
      await volume(page, "24,000 mm³");
    } finally {
      await page.close();
    }
  });

  await check("inside a text field Ctrl+Z is the browser's own undo of the typing, not the project's", async () => {
    const page = await fresh();
    try {
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      await page.waitForTimeout(1100); // past the merge time: the next typing is a step of its own
      await typeWidth(page, "70");
      await volume(page, "42,000 mm³"); // 70 · 30 · 20
      // Mark the box: the project's undo mounts Design afresh, which would make a new one.
      await page.$eval("#width", (el) => (el.dataset.mark = "same"));
      await page.keyboard.press("Control+z");
      assert.equal(await page.$eval("#width", (el) => el.dataset.mark ?? "remounted"), "same", "the shell's undo ran inside the field");
      // What Ctrl+Z does in a plain field of this browser, away from the app: Chromium takes the
      // typing back; another engine under test automation may not, and the app's field must then
      // behave exactly as the plain one does (the shell neither blocks nor fakes the browser's undo).
      const plain = await page.context().newPage();
      await plain.setContent('<input id="f">');
      await plain.click("#f");
      await plain.keyboard.type("70");
      await plain.keyboard.press("Control+z");
      const plainUndoes = (await plain.inputValue("#f")) !== "70";
      await plain.close();
      if (browserName === "chromium") assert.equal(plainUndoes, true, "Chromium's own undo takes typing back in a plain field");
      assert.equal((await width(page)) !== "70", plainUndoes, plainUndoes ? "the browser's own undo took the typing back" : `in ${browserName} a plain field keeps the typing after Ctrl+Z, and so must the app's`);
    } finally {
      await page.close();
    }
  });

  await check("undo survives a workspace switch, and works from another workspace", async () => {
    const page = await fresh();
    try {
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      await switchTo(page, "laser");
      await switchTo(page, "design");
      assert.deepEqual((await buttons(page))[0], [false, "Undo Change width (Ctrl+Z)"]);
      await switchTo(page, "laser");
      await blur(page);
      await page.keyboard.press("Control+z"); // undone while Laser is on screen
      await switchTo(page, "design");
      await volume(page, "24,000 mm³");
      assert.equal(await width(page), "40");
    } finally {
      await page.close();
    }
  });

  await check("starting in another workspace: Design's empty design, filled in when it is first shown, is no step", async () => {
    const page = await fresh("#laser");
    try {
      assert.deepEqual(await buttons(page), [[true, "Nothing to undo"], [true, "Nothing to redo"]]);
      await switchTo(page, "design");
      await page.waitForSelector("#start-hint", { state: "visible" });
      await volume(page, "—");
      assert.deepEqual(await buttons(page), [[true, "Nothing to undo"], [true, "Nothing to redo"]]);
    } finally {
      await page.close();
    }
  });

  await check("the selection follows undo and redo while the faces are the same ones", async () => {
    const page = await fresh();
    try {
      await clickCentre(page);
      const picked = await selection(page);
      assert.match(picked, /^(face|edge):feature-1\/[a-z+:-]+$/, "a face or edge of the box at the centre of the view, by name");
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      assert.equal(await selection(page), picked, "a new width keeps the box's faces (17e)");
      await page.click("#undo");
      await volume(page, "24,000 mm³");
      // Undo re-mounts Design on the restored project: still a box with the same faces, so the face stays.
      assert.equal(await selection(page), picked, "kept through Undo");
      assert.equal(await page.isVisible("#selection-note"), false);
      await page.click("#redo");
      await volume(page, "30,000 mm³");
      assert.equal(await selection(page), picked, "kept through Redo");
      const kind = picked.slice(0, picked.indexOf(":"));
      assert.match(await page.$eval("#viewport", (el) => el.dataset.highlight), new RegExp(`${kind}s \\d`), "and drawn");
    } finally {
      await page.close();
    }
  });

  await check("undo to a different shape keeps a face of the same name and drops one that is gone, with the note", async () => {
    const page = await fresh();
    try {
      await chooseShape(page, "cylinder");
      await shape(page, "cylinder");
      await clickCentre(page);
      // The centre of the view is on the cylinder's top.
      assert.equal(await selection(page), "face:feature-1/top", "the cylinder's top");
      await page.click("#undo"); // back to the box: the same feature, which has a top too
      await shape(page, "box");
      await volume(page, "24,000 mm³");
      assert.equal(await selection(page), "face:feature-1/top", "the top is the box's top now");
      assert.equal(await page.isVisible("#selection-note"), false);
      await chooseShape(page, "sphere");
      await shape(page, "sphere");
      // A sphere has no top: dropped by the change of shape, with the note.
      assert.equal(await selection(page), "");
      assert.equal(await page.textContent("#selection-note"), "Taken out of the selection: Top face. The edit took them off the body, so they could not be followed.");
      await page.keyboard.press("Escape");
      await clickCentre(page);
      const half = await selection(page);
      assert.match(half, /^face:feature-1\/(upper|lower)$/, "one of the sphere's halves");
      await page.click("#undo"); // back to the box, which has no halves
      await shape(page, "box");
      await volume(page, "24,000 mm³");
      assert.equal(await selection(page), "", "the sphere's half is not one of the box's faces");
      const word = half.endsWith("upper") ? "Upper" : "Lower";
      assert.equal(await page.textContent("#selection-note"), `Taken out of the selection: ${word} face. The edit took them off the body, so they could not be followed.`);
    } finally {
      await page.close();
    }
  });

  await check("undo and redo keep the camera: no re-framing, the user's view stays, even for a shape", async () => {
    const page = await fresh();
    try {
      const fits = () => page.$eval("#viewport", (el) => Number(el.dataset.fits));
      await page.click('[data-view="top"]'); // the user's own view: straight down
      // 40 → 50 wide: the framed sphere r = √(40²+30²+20²)/2 = 26.9 mm; the new body's centre moves
      // 5 mm and its r = √(50²+30²+20²)/2 = 30.8 mm, 5 + 30.8 = 35.8 < 1.5 · 26.9 = 40.4, so it still fits: no refit.
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      const before = await fits();
      await page.click("#undo");
      await volume(page, "24,000 mm³");
      await page.click("#redo");
      await volume(page, "30,000 mm³");
      await page.click("#undo");
      await volume(page, "24,000 mm³");
      assert.equal(await fits(), before, "undo and redo framed nothing");
      // Still the top view: the centre of the view is the box's centre (20, 15) seen from above, on the +Z face (face 1).
      await clickCentre(page);
      assert.equal(await selection(page), "face:feature-1/top", "the view is still the top view");
      // Another shape, undone: the user's shape change is framed (a new part), its undo is not, as long as
      // the box still fits the framing (box and L-bracket sit in the same place; box ↔ cylinder re-frames
      // because the cylinder sits elsewhere, the needsRefit rule edits use).
      await chooseShape(page, "l-bracket");
      await shape(page, "l-bracket");
      const framed = await fits();
      assert.equal(framed, before + 1, "a new shape by the user is framed");
      await page.click('[data-view="top"]');
      await page.click("#undo");
      await shape(page, "box");
      await page.click("#redo");
      await shape(page, "l-bracket");
      await page.click("#undo");
      await shape(page, "box");
      assert.equal(await fits(), framed, "undoing and redoing the shape framed nothing");
    } finally {
      await page.close();
    }
  });

  await check("undo made in another workspace keeps Design's camera when you come back", async () => {
    const page = await fresh();
    try {
      const fits = () => page.$eval("#viewport", (el) => Number(el.dataset.fits));
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      const before = await fits();
      await switchTo(page, "laser");
      await page.click("#undo");
      await switchTo(page, "design");
      await volume(page, "24,000 mm³");
      assert.equal(await fits(), before);
    } finally {
      await page.close();
    }
  });

  await check("opening a project still frames its part", async () => {
    const page = await fresh();
    try {
      const fits = () => page.$eval("#viewport", (el) => Number(el.dataset.fits));
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³");
      const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
      const fs = await import("node:fs");
      const file = { name: "part.fission.json", mimeType: "application/json", buffer: fs.readFileSync(await download.path()) };
      await page.click("#undo");
      await volume(page, "24,000 mm³");
      const before = await fits();
      await page.setInputFiles("#open-file", file);
      await volume(page, "30,000 mm³");
      assert.equal(await fits(), before + 1, "an opened file is a new part: framed");
    } finally {
      await page.close();
    }
  });

  for (const w of [375, 320]) {
    await check(`phone width ${w} px: Undo and Redo sit in the viewport's corner, one tap, clear of the View buttons, no sideways scroll`, async () => {
      const page = await fresh();
      try {
        await page.setViewportSize({ width: w, height: 740 });
        await openPanel(page, "properties", false); // the sizes are in the Properties sheet, closed until its toggle (U5)
        await page.fill("#width", "50");
        await volume(page, "30,000 mm³");
        assert.equal(await page.isVisible("#undo"), true, "on screen without opening Menu");
        const rect = (sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());
        const port = await rect("#viewport");
        const views = await rect("#view-controls");
        for (const id of ["undo", "redo"]) {
          const b = await rect(`#${id}`);
          assert.ok(b.width >= 44 && b.height >= 44, `${id} is a 44 px tap target: ${JSON.stringify(b)}`);
          assert.ok(b.left >= port.left && b.right <= port.right && b.top >= port.top && b.bottom <= port.bottom, `${id} inside the viewport`);
          assert.ok(b.right <= w, `${id} inside the screen`);
          const overlaps = !(b.right <= views.left || b.left >= views.right || b.bottom <= views.top || b.top >= views.bottom);
          assert.equal(overlaps, false, `${id} clear of the View buttons ${JSON.stringify(views)}`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), w);
        await page.click("#menu-toggle");
        assert.equal(await page.$$eval("#topbar #undo", (els) => els.length), 0, "no longer on the bar or in Menu");
        await page.click("#menu-toggle");
        await page.screenshot({ path: `e2e/undo-${w}.png` });
        await closePanels(page, false); // the Properties sheet (U5) covers the lower part of the view; closed with its toggle, as a person would
        await page.click("#undo"); // one tap
        await volume(page, "24,000 mm³");
        // Back to a wide screen: the pair returns to the bar after Save, as Fusion's (U0f2a).
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForFunction(() => document.getElementById("undo-redo").parentElement.id === "file-bar"); // on the media query's change event
        assert.equal(await page.$eval("#undo-redo", (el) => el.previousElementSibling?.id), "save");
        assert.equal(await page.$eval("#undo-redo", (el) => el.classList.contains("docked")), false);
      } finally {
        await page.close();
      }
    });
  }

  await check("Undo pressed at once after a sketch click drops the click, with no page error (app sweep 2026-10-28)", async () => {
    // A new sketch on XY, a click, and Ctrl+Z before the kernel has rounded the click: the undo takes the sketch out,
    // and the click, still waiting, was for that sketch. On main it went on and threw "there is no sketch sketch-2".
    // The click's rounding (snap_to_grid, place_freely) is held back 400 ms on its way to the kernel's worker, in every
    // engine, so the key always comes first (the sweep's repro slowed Chromium's CPU instead: it threw 5 runs in 5).
    const page = await fresh();
    const before = errors.length;
    try {
      sheetsClearFor(page);
      await page.click("#create-sketch");
      await openPanel(page, "properties", false);
      await pickPlane(page, "XY", false);
      await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
      await closePanels(page, false);
      await page.evaluate(() => {
        const send = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (message, ...rest) {
          if (message?.op === "snap_to_grid" || message?.op === "place_freely") {
            window.kernelHeld = (window.kernelHeld ?? 0) + 1;
            return void setTimeout(() => send.call(this, message, ...rest), 400);
          }
          return send.call(this, message, ...rest);
        };
      });
      const box = await page.locator("#viewport canvas").boundingBox();
      const p = screenPoint(box, [10, 10, 0], TOP);
      await page.mouse.click(p.x, p.y);
      await page.waitForFunction(() => (window.kernelHeld ?? 0) > 0); // the click sent to the kernel, its answer held back
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(1500); // the held answers have come back by now
      assert.deepEqual(errors.slice(before), [], "no page error");
      // Undo took the sketch out (Redo would bring it back); the click drew nothing.
      assert.match(await page.getAttribute("#redo", "title"), /^Redo Create sketch/);
    } finally {
      errors.length = before;
      await page.close();
    }
  });

  await check("two quick Undos and two quick Redos say rebuilding until the last one lands (real-use hunt C2)", async () => {
    // Every Undo and Redo remounts Design while the put-away one's rebuild may still run. Before the fix that rebuild's end
    // set data-rebuilding false while the new Design's rebuild still ran, so a check read the page too early. Each kernel
    // message is held 150 ms, so a second press 60 ms after the first always lands while the first's rebuild runs.
    const page = await fresh("#design", { hooks: true });
    const before = errors.length;
    try {
      await page.fill("#width", "50");
      await volume(page, "30,000 mm³"); // 50 · 30 · 20
      await page.fill("#depth", "40"); // another box, so another step (typing on in one box is one step)
      await volume(page, "40,000 mm³"); // 50 · 40 · 20
      await page.evaluate(() => {
        const send = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (message, ...rest) {
          setTimeout(() => send.call(this, message, ...rest), 150);
        };
      });
      const twice = async (id) => {
        await page.click(id);
        await page.waitForTimeout(60);
        await page.click(id);
        await page.waitForFunction(() => document.querySelector("#viewport").dataset.rebuilding === "false", null, { timeout: 15000 });
        // Read the moment the flag says done: what is shown then must be the last press's design, and it must stay.
        const now = () => page.evaluate(async () => [document.querySelector("#volume")?.textContent, await window.fissionTest.bodyCount()]);
        const atFlag = await now();
        await page.waitForTimeout(1500);
        return [atFlag, await now()];
      };
      for (let round = 1; round <= 3; round++) {
        // Undo, Undo: back to the 40 · 30 · 20 box, 24,000 mm³, one body in the kernel (nothing kept from the put-away rebuilds).
        assert.deepEqual(await twice("#undo"), [["24,000 mm³", 1], ["24,000 mm³", 1]], `round ${round}: two quick Undos, [volume, kernel bodies] at the flag and 1.5 s later`);
        // Redo, Redo: the 50 · 40 · 20 box again, 40,000 mm³, one body.
        assert.deepEqual(await twice("#redo"), [["40,000 mm³", 1], ["40,000 mm³", 1]], `round ${round}: two quick Redos, [volume, kernel bodies] at the flag and 1.5 s later`);
      }
      assert.deepEqual(errors.slice(before), [], "no page error");
    } finally {
      errors.length = before;
      await page.close();
    }
  });

  await check("two quick Undos of a 30-item project leave the kernel holding what it held before the edits (real-use hunt C1)", async () => {
    // Every Undo remounts Design and closes the old cache while its rebuild runs; before the fix that rebuild's own keepOnly
    // at its end kept its bodies for good, about 13 more each time on this project. Each kernel message is held 20 ms, so the
    // rebuild of its 16 bodies is still running when the second Undo comes 150 ms after the first.
    const page = await fresh("#design", { box: false, hooks: true });
    const before = errors.length;
    try {
      await page.waitForSelector("#start-hint", { state: "visible" });
      const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.evaluate(() => document.getElementById("open-file").click())]);
      await chooser.setFiles({ name: "thirty.spindle", mimeType: "application/json", buffer: readFileSync(new URL("../../../tests/golden/thirty-features.panosolid.json", import.meta.url)) });
      /** [Bodies rows, kernel bodies] once the page has stopped changing. */
      const quiet = async () => {
        let last = "";
        for (;;) {
          await page.waitForTimeout(300);
          const now = await page.evaluate(async () => JSON.stringify([document.querySelector("#viewport").dataset.rebuilding, document.querySelectorAll('#browser [data-node^="body-"]').length, await window.fissionTest.bodyCount()]));
          if (now === last && !now.startsWith('["true"')) return JSON.parse(now).slice(1);
          last = now;
        }
      };
      const opened = await quiet();
      assert.ok(opened[1] > 5, `the project built its bodies (${opened})`);
      await page.evaluate(() => {
        const send = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (message, ...rest) {
          setTimeout(() => send.call(this, message, ...rest), 20);
        };
      });
      const edit = async (key, v) => {
        await page.click('#timeline li[data-item="feature-1"]', { button: "right" });
        await page.click("#row-menu-edit");
        await page.fill(`#edit-${key}`, String(v));
        await page.click("#feature-edit-ok");
        await quiet();
      };
      for (let round = 1; round <= 3; round++) {
        await edit("depth", 15 + round);
        await edit("height", 5 + round);
        await page.click("#undo");
        await page.waitForTimeout(150);
        await page.click("#undo");
        // Both edits taken back: the same rows and the same kernel bodies as when the project was opened.
        assert.deepEqual(await quiet(), opened, `round ${round}: [Bodies rows, kernel bodies] after two quick Undos, as opened`);
      }
      assert.deepEqual(errors.slice(before), [], "no page error");
    } finally {
      errors.length = before;
      await page.close();
    }
  });

  assert.deepEqual(errors, [], "no page errors or console errors");
} catch (e) {
  failed = true;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed) process.exit(1);

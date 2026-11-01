// Browser check that Save and Export STL ask for a name and a place, like a
// desktop app (a first-time user's complaint: File > Save just downloaded a
// .json). The test drives the page (navigator.webdriver), which makes the app
// skip both asking steps so the other checks can wait on a download; here
// webdriver is set false so the real paths run:
//   - with a save picker (a fake one, as Chrome's): Save offers the project's
//     name with .spindle, writes the file it returns, a second Save writes the
//     same file without asking again, Save As asks again, a closed picker
//     writes nothing, and Export STL opens the picker with a .stl name;
//   - without a picker (Safari, Firefox): a name box asks first; the typed
//     name downloads as <name>.spindle; Escape saves nothing; at 393 px the
//     box fits the width and leaves the 3D view mostly visible;
//   - an old .json project still opens.
// Run with `npm run e2e` (after `npm run build`); `E2E_BROWSER` picks the engine.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./browser.mjs";
import { chooseFile, startWithBox } from "./start.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4241, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4241/";
const browser = await launch();
const errors = [];
const oldFile = join(tmpdir(), `save-name-old-${process.pid}.json`);

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

/** The fake save picker Chrome has: logs what it was asked, and keeps what is written. `closeNext` makes the next one throw AbortError. */
const FAKE_PICKER = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => false });
  window.__picked = [];
  window.__files = {};
  window.__closeNext = false;
  window.showSaveFilePicker = async (o) => {
    window.__picked.push(o);
    if (window.__closeNext) {
      window.__closeNext = false;
      throw Object.assign(new Error("closed"), { name: "AbortError" });
    }
    const name = window.__chosen ?? o.suggestedName;
    return {
      name,
      createWritable: async () => ({
        write: async (d) => (window.__files[name] = [...(window.__files[name] ?? []), d.byteLength ?? d.size ?? String(d).length]),
        close: async () => {},
      }),
    };
  };
};
const NO_PICKER = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => false });
  delete window.showSaveFilePicker;
};

async function fresh(width, init, tap = false) {
  const context = await browser.newContext({ viewport: { width, height: width < 700 ? 852 : 800 }, hasTouch: tap, acceptDownloads: true });
  await context.addInitScript(init);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await startWithBox(page, tap);
  return { context, page };
}
const picked = (page) => page.evaluate(() => window.__picked.map((o) => [o.suggestedName, JSON.stringify(o.types)]));
const files = (page) => page.evaluate(() => window.__files);
const press = (sel, page, tap) => (tap ? page.tap(sel) : page.click(sel));

await check("with a save picker: Save offers <name>.spindle, writes the file it returns; Save again writes the same file without asking; Save As asks again; a closed picker writes nothing", async () => {
  const { context, page } = await fresh(1280, FAKE_PICKER);
  try {
    await page.evaluate(() => (window.__chosen = "Bracket.spindle"));
    await chooseFile(page, "file-save", false);
    await page.waitForFunction(() => window.__picked.length === 1);
    const [[suggested, types]] = await picked(page);
    assert.equal(suggested, "Untitled.spindle");
    assert.deepEqual(JSON.parse(types), [{ description: "SpindleLabs project", accept: { "application/json": [".spindle"] } }]);
    await page.waitForFunction(() => Object.keys(window.__files).length === 1);
    assert.deepEqual(Object.keys(await files(page)), ["Bracket.spindle"]);
    // Save again: the same file, no new question.
    await chooseFile(page, "file-save", false);
    await page.waitForFunction(() => window.__files["Bracket.spindle"].length === 2);
    assert.equal((await picked(page)).length, 1, "Save again didn't ask");
    // Save As asks again, offering a place and name afresh.
    await page.evaluate(() => (window.__chosen = "Copy.spindle"));
    await chooseFile(page, "file-save-as", false);
    await page.waitForFunction(() => Object.keys(window.__files).length === 2);
    assert.equal((await picked(page)).length, 2);
    // And Save now goes to the new file.
    await chooseFile(page, "file-save", false);
    await page.waitForFunction(() => window.__files["Copy.spindle"].length === 2);
    assert.equal((await picked(page)).length, 2);
    // A closed picker: nothing written, no error shown.
    await page.evaluate(() => (window.__closeNext = true));
    await chooseFile(page, "file-save-as", false);
    await page.waitForFunction(() => window.__picked.length === 3);
    await page.waitForTimeout(200);
    assert.equal(await page.textContent("#file-status"), "");
    assert.deepEqual(Object.fromEntries(Object.entries(await files(page)).map(([k, v]) => [k, v.length])), { "Bracket.spindle": 2, "Copy.spindle": 2 });
    // The file is the project (formatVersion is its first key sorted: the text is JSON).
    await page.evaluate(() => (window.__chosen = "x.spindle"));
  } finally {
    await context.close();
  }
});

await check("with a save picker: Export STL opens it with a .stl name and the STL types, and writes 684 bytes (12 triangles)", async () => {
  const { context, page } = await fresh(1280, FAKE_PICKER);
  try {
    await chooseFile(page, "file-export-stl", false);
    await page.waitForFunction(() => window.__picked.length === 1);
    const [[suggested, types]] = await picked(page);
    assert.match(suggested, /^spindlelabs-box\.stl$|^fission-box\.stl$/);
    assert.deepEqual(JSON.parse(types), [{ description: "STL mesh", accept: { "model/stl": [".stl"] } }]);
    // 80-byte header + 4-byte count + 12 triangles · 50 bytes = 684.
    await page.waitForFunction(() => Object.values(window.__files)[0]?.[0] === 684);
    // Closing the picker saves nothing and says so.
    await page.evaluate(() => (window.__closeNext = true));
    await chooseFile(page, "file-export-stl", false);
    await page.waitForFunction(() => window.__picked.length === 2);
    assert.equal(Object.keys(await files(page)).length, 1);
  } finally {
    await context.close();
  }
});

for (const [width, tap] of [[1280, false], [393, true]]) {
  await check(`without a picker (${width} px${tap ? ", taps" : ""}): a name box asks first, the typed name downloads as <name>.spindle, Escape saves nothing, and the box fits the screen`, async () => {
    const { context, page } = await fresh(width, NO_PICKER, tap);
    try {
      let downloaded = 0;
      page.on("download", () => downloaded++);
      await chooseFile(page, "file-save", tap);
      await page.waitForSelector(".save-name input");
      await page.waitForTimeout(300);
      assert.equal(downloaded, 0, "nothing downloaded before the name was given");
      assert.equal(await page.inputValue(".save-name input"), "Untitled");
      assert.equal(await page.textContent(".save-name .ext"), ".spindle");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "save-name-input", "the name box has the focus");
      // On the screen with a 16 px gutter, at most 40% of the height, 44 px buttons.
      const b = await page.$eval(".save-name form", (f) => f.getBoundingClientRect().toJSON());
      assert.ok(b.left >= 16 - 0.5 && b.right <= width - 16 + 0.5 && b.top >= 0, `fits: ${JSON.stringify(b)}`);
      assert.ok(b.height <= 0.4 * (width < 700 ? 852 : 800), `box height ${b.height}`);
      for (const h of await page.$$eval(".save-name button", (bs) => bs.map((x) => x.getBoundingClientRect().height))) assert.ok(h >= 44, `button ${h}px tall`);
      assert.ok((await page.$eval(".save-name input", (i) => parseFloat(getComputedStyle(i).fontSize))) >= 16, "16 px text, so iOS doesn't zoom");
      // Typing a name and saving downloads it.
      await page.fill(".save-name input", "Bracket v2");
      const [download] = await Promise.all([page.waitForEvent("download"), press(".save-name .ok", page, tap)]);
      assert.equal(download.suggestedFilename(), "Bracket v2.spindle");
      await download.saveAs(join(tmpdir(), `save-name-${process.pid}.spindle`));
      assert.equal(JSON.parse(readFileSync(join(tmpdir(), `save-name-${process.pid}.spindle`), "utf8")).formatVersion, 2);
      assert.equal(await page.$(".save-name"), null, "the box is gone");
      // Escape saves nothing.
      await chooseFile(page, "file-save", tap);
      await page.waitForSelector(".save-name input");
      await page.keyboard.press("Escape");
      await page.waitForSelector(".save-name", { state: "detached" });
      await page.waitForTimeout(300);
      assert.equal(downloaded, 1, "Escape saved nothing");
      // Save As and Save both ask here: a download can't be written again.
      await chooseFile(page, "file-save-as", tap);
      await page.waitForSelector(".save-name input");
      await press(".save-name .cancel", page, tap);
      await page.waitForSelector(".save-name", { state: "detached" });
    } finally {
      await context.close();
    }
  });
}

await check("without a picker, Export STL asks for the name too, and a project saved as .json still opens", async () => {
  const { context, page } = await fresh(1280, NO_PICKER);
  try {
    await chooseFile(page, "file-export-stl", false);
    await page.waitForSelector(".save-name input");
    assert.equal(await page.textContent(".save-name .ext"), ".stl");
    assert.match(await page.inputValue(".save-name input"), /^spindlelabs-box$/);
    await page.fill(".save-name input", "My box");
    const [stl] = await Promise.all([page.waitForEvent("download"), page.click(".save-name .ok")]);
    assert.equal(stl.suggestedFilename(), "My box.stl");
    // The same project as an old-style file opens through Open.
    await chooseFile(page, "file-save", false);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click(".save-name .ok")]);
    await download.saveAs(oldFile);
    await page.setInputFiles("#open-file", oldFile);
    await page.waitForFunction(() => document.querySelector("#volume")?.textContent === "24,000 mm³");
    assert.equal(await page.textContent("#file-status"), "");
  } finally {
    await context.close();
  }
});

// Real-use hunt B5 (2026-11-01): a file opened as "bracket.spindle" offered "Untitled.spindle" on Save (the project's
// own name inside), so a quick Save made a second file beside the one opened. Save offers the opened file's name.
await check("after Open, Save offers the opened file's own name (bracket.spindle, and an old part.json as part.spindle)", async () => {
  const { context, page } = await fresh(1280, FAKE_PICKER);
  try {
    const saved = readFileSync(new URL("./saved.spindle", import.meta.url));
    for (const [name, want] of [["bracket.spindle", "bracket.spindle"], ["Old part.json", "Old part.spindle"]]) {
      await page.evaluate(() => (window.__picked = []));
      await page.setInputFiles("#open-file", { name, mimeType: "application/json", buffer: saved });
      await page.waitForFunction(() => document.querySelector("#volume")?.textContent?.includes("mm³") && document.querySelector("#file-status")?.textContent === "");
      await chooseFile(page, "file-save", false);
      await page.waitForFunction(() => window.__picked.length === 1);
      assert.equal((await picked(page))[0][0], want, `opened ${name}`);
    }
  } finally {
    await context.close();
  }
});

await check("no page errors", () => assert.deepEqual(errors, []));
await browser.close();
await server.close();
if (failed) {
  console.log(`${failed} FAILED`);
  process.exit(1);
}
console.log("all passed");

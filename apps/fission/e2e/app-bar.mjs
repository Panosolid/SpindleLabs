// Browser checks of the app bar's left and right ends (U0f2a, the owner's
// Fusion-like top bar): File ▾ first after the name, then DESIGN ▾ in
// place of the ten workspace tabs (U0f2b), naming the page on screen and
// listing the ten, by mouse, keyboard and taps; listing New, Open…,
// Save and Export STL with their icons, each off and saying why when it
// would do nothing (an empty design, a workspace with nothing to clear or
// export, a sketch being edited); New asks and clears as one undo step;
// Open… opens the file picker; Save and Export STL download the same files
// as the Save icon and the toolbar's STL; Save, Undo and Redo are icons,
// drawn on the 24 grid, their words their names; AI, Guide and Community
// small at the right. At 1280 px with the mouse and the keyboard, one 44 px
// row; at 375 px with taps, File ▾ on the bar with 44 px items, Save in
// File ▾, Undo and Redo docked, the right end behind Menu, nothing wider
// than the screen. Deliberate breaks fail. Run with `npm run e2e` (after
// `npm run build`). `E2E_SHOTS=<dir>` saves screenshots.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { chooseFile, closePanels, fileItem, insertPreset, openPanel, switchTo } from "./start.mjs";

const server = await preview({ preview: { port: 4241, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4241/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const rect = (page, sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());

async function fresh(width, touch) {
  const context = await browser.newContext({ viewport: { width, height: width > 640 ? 800 : 667 }, hasTouch: touch, isMobile: touch, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  await page.addInitScript(() => localStorage.removeItem("fission.properties-pinned"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  await page.waitForSelector("#start-hint", { state: "visible" });
  await page.waitForFunction(() => document.querySelector("#save-status")?.dataset.state === "saved");
  return page;
}

// The words File ▾'s entries say when off (start-fresh.ts, actions.ts, @fission/ui file-menu.ts).
const ALREADY = "New: nothing to clear, the design is already empty.";
const SKETCHING = "New: finish or cancel the sketch first.";
const NO_BODY = "There is no body to download: nothing in the timeline builds.";
const NEW_ON = "New: clear the whole design and start again from an empty one. It asks first, and Undo brings it back.";

/**
 * What is wrong with the bar's icon buttons (Save, Undo, Redo, and File ▾'s
 * items while it is open), in words, read in the page: each shown one has
 * an icon that is drawn (a path inside the 2-22 part of the 24 grid, at
 * least 16 px on screen), a name (its words, or its aria-label), and, for
 * Save, its words out of sight. Empty when all is well.
 */
const barProblems = (page) =>
  page.evaluate(() => {
    const out = [];
    const sels = ["#save", "#undo", "#redo", "#file-menu-menu [role=menuitem]", "#assistant-toggle", "#guide-open", "#community"];
    for (const b of document.querySelectorAll(sels.join(","))) {
      if (!b.checkVisibility()) continue;
      const who = b.id;
      const svg = b.querySelector("svg.icon");
      if (!svg) {
        out.push(`${who}: no icon`);
        continue;
      }
      const boxes = [...svg.querySelectorAll("path")].map((p) => p.getBBox());
      if (boxes.length === 0) out.push(`${who}: an icon with nothing drawn`);
      const [x0, y0] = [Math.min(...boxes.map((r) => r.x)), Math.min(...boxes.map((r) => r.y))];
      const [x1, y1] = [Math.max(...boxes.map((r) => r.x + r.width)), Math.max(...boxes.map((r) => r.y + r.height))];
      if (!(x0 >= 2 - 1e-6 && y0 >= 2 - 1e-6 && x1 <= 22 + 1e-6 && y1 <= 22 + 1e-6)) out.push(`${who}: icon marks at ${x0},${y0} to ${x1},${y1}, off the 2-22 grid`);
      const r = svg.getBoundingClientRect();
      if (r.width < 16 || r.height < 16) out.push(`${who}: icon ${r.width} × ${r.height} px`);
      const name = (b.getAttribute("aria-label") ?? b.textContent).trim();
      if (!name) out.push(`${who}: no name`);
      if (who === "save") {
        const w = b.querySelector(".tool-word").getBoundingClientRect();
        if (b.textContent.trim() !== "Save") out.push(`save: named "${b.textContent.trim()}"`);
        if (w.width > 1) out.push(`save: its words show (${w.width} px wide)`);
      }
    }
    return out;
  });

/** The bar's things left to right, as ids, those on screen only. */
const barOrder = (page) =>
  page.evaluate(() =>
    ["#topbar h1", "#file-menu", "#save", "#undo", "#redo", "#workspace-menu", "#save-status", "#assistant-toggle", "#guide-open", "#community"]
      .map((s) => [s, document.querySelector(s)])
      .filter(([, el]) => el.closest("#topbar") && el.checkVisibility() && el.getBoundingClientRect().width > 0)
      .sort((a, b) => a[1].getBoundingClientRect().left - b[1].getBoundingClientRect().left)
      .map(([s]) => s),
  );

/** File ▾'s rows as [id, icon, off] while it is open. */
const menuRows = (page) => page.$$eval("#file-menu-menu [role=menuitem]", (bs) => bs.map((b) => [b.id, b.querySelector("svg.icon")?.dataset.icon ?? null, b.getAttribute("aria-disabled") === "true"]));

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
  await check("1280 px: one 44 px row: the name, File ▾, Save, Undo, Redo, the tabs, then the status, AI, Guide and Community small at the right; icons on the grid", async () => {
    const page = await fresh(1280, false);
    try {
      assert.deepEqual(await barOrder(page), ["#topbar h1", "#file-menu", "#save", "#undo", "#redo", "#workspace-menu", "#save-status", "#assistant-toggle", "#guide-open", "#community"]);
      assert.equal((await rect(page, "#topbar")).height, 44, "one row");
      assert.equal((await rect(page, "#menu-toggle")).width, 0, "no Menu");
      assert.deepEqual(await barProblems(page), []);
      assert.equal(await page.textContent("#file-menu"), "File ▾");
      // Hand-worked, from icons.ts: Save's line runs M4 15 V20 H20 V15 and M12 3 V14 (the arrow head inside), so x 4 to 20,
      // y 3 to 20: a 16 × 17 box at (4, 3). Undo's arrow head M9 5 L4 10 L9 15 and its bar from (4, 10) to (14.5, 10), then a
      // half circle of radius 5.5 clockwise down to (14.5, 21), its far point at x 14.5 + 5.5 = 20, and on to (11, 21):
      // x 4 to 20, y 5 to 21, a 16 × 16 box at (4, 5). Redo is Undo mirrored about x = 12: the same box.
      const bbox = (sel) =>
        page.$eval(`${sel} svg.icon path:last-child`, (p) => {
          const r = p.getBBox();
          return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 1000) / 1000);
        });
      assert.deepEqual(await bbox("#save"), [4, 3, 16, 17]);
      assert.deepEqual(await bbox("#undo"), [4, 5, 16, 16]);
      assert.deepEqual(await bbox("#redo"), [4, 5, 16, 16]);
      // Save, Undo and Redo at 20 px; the right end's icons 16 px before 13 px words.
      for (const id of ["save", "undo", "redo"]) assert.deepEqual(await page.$eval(`#${id} svg.icon`, (s) => [s.getBoundingClientRect().width, s.getBoundingClientRect().height]), [20, 20], id);
      for (const id of ["assistant-toggle", "guide-open", "community"]) {
        const m = await page.$eval(`#${id}`, (b) => [b.querySelector("svg.icon").getBoundingClientRect().width, getComputedStyle(b).fontSize, b.querySelector(".tool-word").getBoundingClientRect().width > 10]);
        assert.deepEqual(m, [16, "13px", true], id);
      }
      assert.equal(await page.textContent("#ai-status"), "off", "the AI's state still shows, inside its button");
      assert.equal(await page.getAttribute("#save", "title"), "Save the whole project as a .spindle file");
      // Again in DejaVu Sans, the wide font CI's Linux uses for system-ui.
      await page.addStyleTag({ content: "html, body { font-family: 'DejaVu Sans' !important; }" });
      assert.equal((await rect(page, "#topbar")).height, 44, "one row in DejaVu Sans");
      if (shots) await page.screenshot({ path: `${shots}/app-bar-1280.png`, clip: { x: 0, y: 0, width: 1280, height: 44 } });
      // Deliberate breaks: each is caught, by name.
      await page.evaluate(() => document.querySelector("#undo svg.icon").remove());
      assert.deepEqual(await barProblems(page), ["undo: no icon"]);
      await page.evaluate(() => (document.querySelector("#save .tool-word").style.cssText = "position: static; width: auto; height: auto; clip-path: none"));
      assert.ok((await barProblems(page)).some((p) => p.startsWith("save: its words show")), "Save's words shown are caught");
      await page.evaluate(() => document.querySelector("#redo svg.icon path").setAttribute("d", "M1 12H20"));
      assert.ok((await barProblems(page)).some((p) => p.startsWith("redo: icon marks at 1,")), "a mark off the grid is caught");
      await page.evaluate(() => document.getElementById("file-bar").append(Object.assign(document.createElement("span"), { textContent: "x".repeat(200) })));
      assert.notEqual((await rect(page, "#topbar")).height, 44, "a bar too full for one row is caught");
    } finally {
      await page.context().close();
    }
  });

  for (const [width, tap] of [[1280, false], [375, true]]) {
    const at = `${width} px${tap ? ", taps" : ""}`;

    await check(`${at}: File ▾ lists New, Open…, Save, Save As…, Export STL with icons; on an empty design New and Export STL are off, saying why; Open… opens the picker; Save downloads the project`, async () => {
      const page = await fresh(width, tap);
      try {
        await press(page, "#file-menu", tap);
        assert.deepEqual(await menuRows(page), [
          ["start-fresh", "new", true],
          ["open", "open", false],
          ["file-save", "save", false],
          ["file-save-as", "save", false],
          ["file-export-stl", "export", true],
        ]);
        assert.deepEqual(await page.$$eval("#file-menu-menu [role=menuitem]", (bs) => bs.map((b) => b.textContent)), ["New", "Open…", "Save", "Save As…", "Export STL"]);
        assert.equal(await page.getAttribute("#start-fresh", "title"), ALREADY);
        assert.equal(await page.getAttribute("#file-export-stl", "title"), NO_BODY);
        assert.deepEqual(await barProblems(page), [], "every item's icon drawn");
        // On the screen, and 44 px to tap at phone width.
        for (const r of await page.$$eval("#file-menu-menu [role=menuitem]", (bs) => bs.map((b) => b.getBoundingClientRect().toJSON()))) {
          assert.ok(r.left >= 0 && r.right <= width && r.bottom <= (width > 640 ? 800 : 667), `on screen: ${JSON.stringify(r)}`);
          if (tap) assert.ok(r.height >= 44, `44 px to tap: ${r.height}`);
        }
        // File ▾ fills the bar's row top to bottom: 43 px, the 44 px bar under its 1 px line.
        if (tap) assert.equal((await rect(page, "#file-menu")).height, await page.$eval("#topbar", (b) => b.clientHeight), "File ▾ as tall as the bar");
        if (shots) await page.screenshot({ path: `${shots}/file-menu-${width}-empty.png` });
        // An off item does nothing and leaves the menu open.
        await page.click("#start-fresh", { force: true });
        assert.equal(await page.getAttribute("#file-menu", "aria-expanded"), "true");
        assert.equal(await page.evaluate(() => document.getElementById("start-fresh-dialog").open), false);
        // Open… asks for a file.
        const [chooser] = await Promise.all([page.waitForEvent("filechooser"), press(page, "#open", tap)]);
        assert.equal(chooser.isMultiple(), false);
        assert.equal(await page.getAttribute("#file-menu", "aria-expanded"), "false", "a choice closes the menu");
        // Save downloads the project, the same file as the Save icon's (two ways agreeing; at phone width the icon is File ▾'s).
        const [download] = await Promise.all([page.waitForEvent("download"), chooseFile(page, "file-save", tap)]);
        assert.equal(download.suggestedFilename(), "Untitled.spindle");
        const fromMenu = JSON.parse(readFileSync(await download.path(), "utf8"));
        assert.equal(fromMenu.workspaces.design.timeline.features.length, 0, "the empty design");
        if (!tap) {
          const [icon] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
          assert.deepEqual(JSON.parse(readFileSync(await icon.path(), "utf8")), fromMenu);
        } else assert.equal(await page.isVisible("#save"), false, "the Save icon is File ▾'s at phone width");
      } finally {
        await page.context().close();
      }
    });

    await check(`${at}: with a box built, Export STL downloads the toolbar STL's file (12 triangles, 684 bytes); New asks, clears as one undo step, and Undo brings it back`, async () => {
      const page = await fresh(width, tap);
      try {
        await insertPreset(page, "box", tap);
        await until(page, () => document.querySelector("#volume")?.textContent === "24,000 mm³", null, "the box");
        assert.deepEqual(await fileItem(page, "start-fresh"), [false, NEW_ON]);
        assert.equal((await fileItem(page, "file-export-stl"))[0], false, "Export STL on");
        // Binary STL, worked by hand: an 80-byte header, a 4-byte count, then 50 bytes a triangle; a box's six faces are
        // two triangles each, 12 in all: 80 + 4 + 12 · 50 = 684 bytes.
        const [stl] = await Promise.all([page.waitForEvent("download"), chooseFile(page, "file-export-stl", tap)]);
        const bytes = readFileSync(await stl.path());
        assert.equal(bytes.length, 684);
        assert.equal(bytes.readUInt32LE(80), 12);
        assert.match(stl.suggestedFilename(), /\.stl$/);
        // The toolbar's STL gives the same triangles (the 80-byte header may carry other words).
        await page.locator("[data-op=export_stl]").scrollIntoViewIfNeeded();
        const [tool] = await Promise.all([page.waitForEvent("download"), press(page, "[data-op=export_stl]", tap)]);
        assert.deepEqual(readFileSync(await tool.path()).subarray(80), bytes.subarray(80));
        // New: the dialog asks, naming what goes; confirmed, the design is empty (the hint back), New off again.
        await chooseFile(page, "start-fresh", tap);
        await until(page, () => document.getElementById("start-fresh-dialog").open, null, "the dialog");
        assert.match(await page.textContent("#start-fresh-words"), /\(1 feature\)/);
        // Its own styles (start-fresh.css), not the browser's white box: the dark panel #1c1f24 = rgb(28, 31, 36) and
        // the warning-red confirm #6b2328 = rgb(107, 35, 40), hex to decimal by hand (Ben's screenshot, 0.32.x: unstyled).
        const look = await page.evaluate(() => [getComputedStyle(document.getElementById("start-fresh-dialog")).backgroundColor, getComputedStyle(document.getElementById("start-fresh-confirm")).backgroundColor]);
        assert.deepEqual(look, ["rgb(28, 31, 36)", "rgb(107, 35, 40)"]);
        if (shots) await page.screenshot({ path: `${shots}/file-menu-${width}-new-ask.png` });
        await press(page, "#start-fresh-confirm", tap);
        await until(page, () => document.getElementById("start-hint")?.hidden === false, null, "the empty design's hint");
        assert.deepEqual(await fileItem(page, "start-fresh"), [true, ALREADY]);
        assert.equal(await page.getAttribute("#undo", "title"), "Undo Start fresh (Ctrl+Z)");
        await closePanels(page, tap); // Undo is docked in the view; a sheet (Properties, shown by the insert) would cover it
        await press(page, "#undo", tap);
        await until(page, () => document.querySelector("#volume")?.textContent === "24,000 mm³", null, "undone");
        // Escape from the keyboard closes the menu, and from a press outside it.
        await press(page, "#file-menu", tap);
        await page.mouse.click(width / 2, (width > 640 ? 800 : 667) - 120);
        assert.equal(await page.getAttribute("#file-menu", "aria-expanded"), "false", "a press outside closes it");
      } finally {
        await page.context().close();
      }
    });

    await check(`${at}: while a sketch is edited New is off saying why; in Slice and Community New and Export STL are off naming where`, async () => {
      const page = await fresh(width, tap);
      try {
        await insertPreset(page, "box", tap);
        await until(page, () => document.querySelector("#volume")?.textContent === "24,000 mm³", null, "the box");
        await press(page, "#create-sketch", tap);
        assert.deepEqual(await fileItem(page, "start-fresh"), [true, SKETCHING], "the plane prompt");
        await openPanel(page, "properties", tap); // phone: the plane choice is in the Properties sheet, closed until its toggle (U5)
        await press(page, "#sketch-plane-XY", tap);
        await until(page, () => document.querySelector("#viewport").dataset.sketching === "true", null, "sketching");
        assert.deepEqual(await fileItem(page, "start-fresh"), [true, SKETCHING], "in the sketch");
        assert.equal((await fileItem(page, "file-export-stl"))[0], false, "the box still exports while sketching");
        await page.keyboard.press("Escape");
        await page.goto(url + "#slice");
        await until(page, () => document.body.dataset.activeWorkspace === "slice", null, "Slice");
        assert.deepEqual(await fileItem(page, "start-fresh"), [true, "New: Slice has nothing to clear yet. New clears the design in Design."]);
        assert.deepEqual(await fileItem(page, "file-export-stl"), [true, "Export STL: Slice has nothing to export yet. Design exports its bodies as STL."]);
        assert.equal((await fileItem(page, "file-save"))[0], false, "Save works everywhere");
        if (!tap) {
          await page.click("#community");
          assert.deepEqual(await fileItem(page, "start-fresh"), [true, "New: Community has nothing to clear yet. New clears the design in Design."]);
        }
      } finally {
        await page.context().close();
      }
    });
  }

  for (const [width, tap] of [[1280, false], [375, true]]) {
    await check(`${width} px${tap ? ", taps" : ""}: DESIGN ▾ names the page on screen; choosing an item shows that workspace, marks it and renames the button; Escape and a press outside close it`, async () => {
      const page = await fresh(width, tap);
      try {
        const label = () => page.textContent("#workspace-menu");
        assert.equal(await label(), "Design ▾");
        await press(page, "#workspace-menu", tap);
        // At phone width the list is a bottom sheet that scrolls inside itself (U5): a person scrolls an item into view before reading or tapping it.
        const items = await page.$$eval("#workspace-menu-menu [role=menuitem]", (bs) => bs.map((b) => { b.scrollIntoView({ block: "center" }); return b.getBoundingClientRect().toJSON(); }));
        assert.equal(items.length, 10);
        for (const r of items) {
          assert.ok(r.left >= 0 && r.right <= width && r.bottom <= (width > 640 ? 800 : 667), `on screen: ${JSON.stringify(r)}`);
          if (tap) assert.ok(r.height >= 44, `44 px to tap: ${r.height}`);
        }
        if (shots) await page.screenshot({ path: `${shots}/workspace-menu-${width}.png` });
        await press(page, '#workspace-menu-menu [data-workspace="image"]', tap);
        await until(page, () => document.body.dataset.activeWorkspace === "image", null, "Image");
        assert.equal(await label(), "Image ▾");
        assert.equal(new URL(page.url()).hash, "#image");
        await press(page, "#workspace-menu", tap);
        assert.deepEqual(await page.$$eval("#workspace-menu-menu [aria-current=true]", (bs) => bs.map((b) => b.dataset.workspace)), ["image"], "the one on screen marked");
        await page.mouse.click(width / 2, (width > 640 ? 800 : 667) - 60);
        assert.equal(await page.getAttribute("#workspace-menu", "aria-expanded"), "false", "a press outside closes it");
        // A placeholder is chosen as before: its page says Coming soon.
        await switchTo(page, "slice", tap);
        assert.equal(await page.textContent(".placeholder .coming-soon"), "Coming soon");
        assert.equal(await label(), "Slice ▾");
        await switchTo(page, "design", tap);
        await until(page, () => document.body.dataset.activeWorkspace === "design", null, "Design again");
        assert.equal(await label(), "Design ▾");
        if (!tap) {
          await page.click("#community");
          assert.equal(await label(), "Community ▾", "Community, not a workspace, named on the button too");
          // The keyboard: ArrowDown opens it on the first item, arrows move, Enter chooses, Escape gives the focus back.
          await page.focus("#workspace-menu");
          await page.keyboard.press("ArrowDown");
          assert.equal(await page.evaluate(() => document.activeElement?.dataset.workspace), "design");
          await page.keyboard.press("End");
          assert.equal(await page.evaluate(() => document.activeElement?.dataset.workspace), "layout");
          await page.keyboard.press("ArrowUp");
          await page.keyboard.press("Enter");
          await until(page, () => document.body.dataset.activeWorkspace === "image", null, "Image by keys");
          await page.focus("#workspace-menu");
          await page.keyboard.press("ArrowDown");
          await page.keyboard.press("Escape");
          assert.equal(await page.getAttribute("#workspace-menu", "aria-expanded"), "false");
          assert.equal(await page.evaluate(() => document.activeElement?.id), "workspace-menu");
        }
      } finally {
        await page.context().close();
      }
    });
  }

  await check("1280 px, keyboard: ArrowDown on File ▾ opens it on the first item that is on, arrows move, Enter saves, Escape gives the focus back", async () => {
    const page = await fresh(1280, false);
    try {
      await page.focus("#file-menu");
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "open", "New is off on the empty design: Open… first");
      await page.keyboard.press("ArrowDown");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "file-save");
      const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
      assert.equal(download.suggestedFilename(), "Untitled.spindle");
      await page.focus("#file-menu");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Escape");
      assert.equal(await page.getAttribute("#file-menu", "aria-expanded"), "false");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "file-menu");
    } finally {
      await page.context().close();
    }
  });

  await check("375 px, taps: File ▾ on the bar and nothing wider than the screen; Undo and Redo docked as 44 px icons; AI, Guide and Community behind Menu", async () => {
    const page = await fresh(375, true);
    try {
      assert.deepEqual(await barOrder(page), ["#topbar h1", "#file-menu", "#workspace-menu"]);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375, "no sideways scroll");
      assert.equal(await page.evaluate(() => document.getElementById("undo-redo").classList.contains("docked")), true);
      for (const id of ["undo", "redo"]) {
        const b = await rect(page, `#${id}`);
        assert.deepEqual([b.width, b.height], [44, 44], id);
        assert.equal(await page.$eval(`#${id} svg.icon`, (s) => s.dataset.icon), id);
      }
      await page.tap("#menu-toggle");
      for (const id of ["assistant-toggle", "guide-open", "community"]) {
        const b = await rect(page, `#${id}`);
        assert.ok(b.width > 0 && b.left >= 0 && b.right <= 375 && b.height >= 32, `${id} ${JSON.stringify(b)}`);
      }
      assert.deepEqual(await barProblems(page), []);
      if (shots) await page.screenshot({ path: `${shots}/app-bar-375-menu.png` });
      await page.tap("#menu-toggle");
      await page.tap("#file-menu");
      if (shots) await page.screenshot({ path: `${shots}/file-menu-375.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375, "no sideways scroll with File ▾ open");
    } finally {
      await page.context().close();
    }
  });
} finally {
  if (errors.length) {
    failed++;
    console.log(`not ok - no page errors\n  ${errors.join("\n  ")}`);
  }
  await browser.close();
  await server.close();
}
if (failed) {
  console.log(`${failed} check(s) failed`);
  process.exit(1);
}

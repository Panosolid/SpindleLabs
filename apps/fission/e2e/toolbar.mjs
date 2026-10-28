// Browser checks of the Fusion-style toolbar (U0f1, the owner's ask): every
// toolbar button shows its icon (drawn, on the 24 grid, crisp at 24 px),
// keeps its words as its accessible name and starts its tooltip with them,
// and the words never show or leak; each group's name is under its icons
// (beside them, first, at phone width); Create ▾ and Inspect ▾ list their
// tools with icons and run the same thing as the icons, by mouse, keyboard
// and taps; Body facts is off with nothing built and opens the folded
// properties at the numbers once a body is; the tools still to come (Ben,
// 2026-10-26) are greyed in Create ▾, Modify ▾, Construct ▾ and Inspect ▾,
// say what each will do, and do nothing when chosen; the sketch's tools are icons
// over its Create ▾ with Finish Sketch's tick the finish icon. Each at
// 1280 px with the mouse and 375 px with taps, with deliberate breaks that
// fail. Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { insertPreset, openPanel } from "./start.mjs";

const server = await preview({ preview: { port: 4240, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4240/";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;

const until = (page, fn, arg, what) => page.waitForFunction(fn, arg, { timeout: 10000 }).catch(async () => assert.fail(`${what}: timed out`));
const press = (page, sel, tap) => (tap ? page.tap(sel) : page.click(sel));
const rect = (page, sel) => page.$eval(sel, (el) => el.getBoundingClientRect().toJSON());

async function fresh(width, touch) {
  const context = await browser.newContext({ viewport: { width, height: width > 640 ? 800 : 667 }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  await page.addInitScript(() => localStorage.removeItem("fission.properties-pinned"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url + "#design");
  await page.waitForSelector("#start-hint", { state: "visible" });
  return page;
}

/**
 * What is wrong with the toolbar's buttons on screen, in words, read in the
 * page: every button but a group's name (its menu's button) has an icon
 * that is drawn (a path, a box on the 2-22 part of the 24 grid, and at
 * least 20 px on screen), its words are its accessible name, its tooltip
 * starts with them, and its words don't show (the row's buttons) or show
 * inside it (a solo group's and Finish Sketch). Empty when all is well.
 */
const toolbarProblems = (page) =>
  page.evaluate(() => {
    const out = [];
    const shown = (el) => el.checkVisibility();
    for (const b of document.querySelectorAll("#toolbar button")) {
      if (!shown(b) || b.closest("[role=menu], dialog, .toolbar-group-name")) continue;
      const who = b.id || b.textContent;
      const svg = b.querySelector(":scope > svg.icon");
      if (!svg) {
        out.push(`${who}: no icon`);
        continue;
      }
      const paths = [...svg.querySelectorAll("path")];
      if (paths.length === 0) out.push(`${who}: an icon with nothing drawn`);
      const boxes = paths.map((p) => p.getBBox());
      const [x0, y0] = [Math.min(...boxes.map((r) => r.x)), Math.min(...boxes.map((r) => r.y))];
      const [x1, y1] = [Math.max(...boxes.map((r) => r.x + r.width)), Math.max(...boxes.map((r) => r.y + r.height))];
      if (!(x1 - x0 > 0 && y1 - y0 > 0 && x0 >= 2 - 1e-6 && y0 >= 2 - 1e-6 && x1 <= 22 + 1e-6 && y1 <= 22 + 1e-6)) out.push(`${who}: icon marks at ${x0},${y0} to ${x1},${y1}, off the 2-22 grid`);
      const r = svg.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) out.push(`${who}: icon ${r.width} × ${r.height} px`);
      const word = b.querySelector(":scope > .tool-word");
      const words = (word?.textContent ?? "").trim();
      if (!words) out.push(`${who}: no words`);
      const name = b.getAttribute("aria-label") ?? b.textContent.trim();
      if (name !== words) out.push(`${who}: named "${name}", its words "${words}"`);
      if (!b.title.startsWith(words.replace(/ ▾$/, ""))) out.push(`${who}: tooltip "${b.title}" doesn't start with "${words}"`);
      const w = word?.getBoundingClientRect();
      const box = b.getBoundingClientRect();
      if (w && (w.left < box.left - 0.5 || w.right > box.right + 0.5 || w.top < box.top - 0.5 || w.bottom > box.bottom + 0.5)) out.push(`${who}: its words leak out of it`);
      if (b.classList.contains("toolbar-group-tool") && w && w.width > 1) out.push(`${who}: its words show (${w.width} px wide)`);
    }
    return out;
  });

/** What is wrong with the coming tools in the open menus, in words: each must be off, say "Coming soon" at its right and in its tooltip what it will do. */
const comingProblems = (page) =>
  page.$$eval("[role=menu]:not([hidden]) [id^=coming-]", (els) =>
    els.flatMap((e) => {
      const out = [];
      const name = e.querySelector(".menu-button-name")?.textContent ?? "";
      if (e.getAttribute("aria-disabled") !== "true") out.push(`${e.id}: not off`);
      const note = e.querySelector(".menu-button-note")?.textContent ?? "";
      if (note !== "Coming soon") out.push(`${e.id}: says "${note}" at its right`);
      if (!e.title.startsWith(`${name} is coming soon: it will `)) out.push(`${e.id}: tooltip "${e.title}"`);
      return out;
    }),
  );

/** The groups on screen, left to right: each one's name as it reads ("Create ▾"). */
const groupNames = (page) =>
  page.$$eval("#toolbar .toolbar-group", (gs) =>
    gs
      .filter((g) => g.checkVisibility())
      .map((g) => {
        const name = g.querySelector(".toolbar-group-name, .toolbar-group-solo .menu-button-toggle");
        const visibleText = [...name.querySelectorAll("button, span")].filter((e) => e.checkVisibility() && !e.querySelector("button, span")).map((e) => e.textContent.trim());
        return visibleText.join(" ") || name.textContent.trim();
      }),
  );

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
  for (const [width, tap] of [[1280, false], [375, true]]) {
    const at = `${width} px${tap ? ", taps" : ""}`;

    await check(`${at}: every toolbar button an icon drawn on the grid, its words its name and tooltip; the groups in Fusion's order, Create ▾, Modify ▾, Construct ▾, Inspect ▾, Insert ▾, Export`, async () => {
      const page = await fresh(width, tap);
      try {
        assert.deepEqual(await toolbarProblems(page), []);
        assert.deepEqual(await groupNames(page), ["Create ▾", "Modify ▾", "Construct ▾", "Inspect ▾", "Insert ▾", "Export"]);
        // Hand-worked, from icons.ts: the sketch icon's line runs M4 20 V15 L15 4 20 9 9 20 Z, so x and y both from 4 to 20:
        // a 16 × 16 box at (4, 4); the export icon's (M4 15 V20 H20 V15, M12 14 V3, the arrow head) x 4 to 20, y 3 to 20.
        const box = (sel) => page.$eval(`${sel} > svg.icon path:last-child`, (p) => {
          const r = p.getBBox();
          return [r.x, r.y, r.width, r.height];
        });
        assert.deepEqual(await box("#create-sketch"), [4, 4, 16, 16]);
        assert.deepEqual(await box("[data-op=export_stl]"), [4, 3, 16, 17]);
        // 24 px on screen, the grid's own size: one unit a pixel.
        const icon = await rect(page, "#create-sketch > svg.icon");
        assert.deepEqual([icon.width, icon.height], [24, 24]);
        const tool = await rect(page, "#create-sketch");
        if (tap) {
          assert.ok(tool.height >= 44 && tool.width >= 44, `44 px to tap: ${tool.width} × ${tool.height}`);
          // One row: each group's name first, beside its icons.
          const name = await rect(page, "#create-menu");
          assert.ok(name.right <= tool.left + 1 && name.height >= 44, `Create ▾ before its icons and 44 px tall: ${JSON.stringify(name)}`);
          assert.ok((await page.evaluate(() => document.scrollingElement.scrollWidth)) <= width, "no sideways page scroll");
        } else {
          const name = await rect(page, "#create-menu");
          assert.ok(name.top >= tool.bottom - 1, `Create ▾ under its icons: ${name.top} vs ${tool.bottom}`);
        }
        if (shots) await page.screenshot({ path: `${shots}/toolbar-${width}.png`, clip: { x: 0, y: 0, width, height: 140 } });
        // Deliberate breaks: each is caught, by name.
        await page.evaluate(() => document.querySelector("#extrude > svg.icon").remove());
        assert.deepEqual(await toolbarProblems(page), ["extrude: no icon"]);
        await page.evaluate(() => {
          const b = document.getElementById("create-sketch");
          b.setAttribute("aria-label", "Sketch");
          b.title = "Draw on a plane";
        });
        assert.deepEqual(await toolbarProblems(page), ['create-sketch: named "Sketch", its words "Create sketch"', 'create-sketch: tooltip "Draw on a plane" doesn\'t start with "Create sketch"', "extrude: no icon"]);
        // The STL button's words shown, as a lost style rule would show them.
        await page.evaluate(() => (document.querySelector("[data-op=export_stl] .tool-word").style.cssText = "position: static; width: auto; height: auto; clip-path: none"));
        assert.ok((await toolbarProblems(page)).some((p) => /^tool-export_stl: its words (show|leak)/.test(p)), "the words shown are caught");
        await page.evaluate(() => document.querySelector("#inspect-facts svg.icon path:last-child").setAttribute("d", "M1 12H20"));
        assert.ok((await toolbarProblems(page)).some((p) => p.startsWith("inspect-facts: icon marks at 1,")), "a mark off the grid is caught");
      } finally {
        await page.context().close();
      }
    });

    await check(`${at}: Create ▾ lists Create sketch and Extrude with icons; each runs what its icon does; keys too`, async () => {
      const page = await fresh(width, tap);
      try {
        await press(page, "#create-menu", tap);
        await until(page, () => !document.getElementById("create-menu-menu").hidden, null, "the menu opens");
        const rows = await page.$$eval("#create-menu-menu [role=menuitem]", (els) => els.map((e) => [e.id, e.textContent, e.querySelector("svg.icon")?.dataset.icon]));
        assert.deepEqual(rows, [
          ["create-menu-sketch", "Create sketch", "sketch"],
          ["create-menu-extrude", "Extrude", "extrude"],
          // The tools still to come, greyed (coming-soon.ts; the next check).
          ...["revolve", "hole", "pattern", "sweep", "loft"].map((id) => [`coming-${id}`, `${id[0].toUpperCase()}${id.slice(1)}Coming soon`, undefined]),
        ]);
        const menu = await rect(page, "#create-menu-menu");
        assert.ok(menu.left >= 0 && menu.right <= width, `the menu on the screen: ${menu.left}-${menu.right}`);
        await press(page, "#create-menu-sketch", tap);
        await openPanel(page, "properties", tap); // phone: the plane choice is in the Properties sheet, closed until its toggle (U5)
        // The same as the icon: the plane choice.
        await until(page, () => document.getElementById("sketch-panel")?.checkVisibility(), null, "Create sketch's plane choice");
        await page.keyboard.press("Escape");
        await until(page, () => !document.getElementById("sketch-panel")?.checkVisibility(), null, "the plane choice closed");
        // By keyboard: ArrowDown opens at the first row, ArrowDown again and Enter chooses Extrude, whose panel says there is no sketch to extrude.
        await page.focus("#create-menu");
        await page.keyboard.press("ArrowDown");
        assert.equal(await page.evaluate(() => document.activeElement.id), "create-menu-sketch");
        await page.keyboard.press("ArrowDown");
        assert.equal(await page.evaluate(() => document.activeElement.id), "create-menu-extrude");
        await page.keyboard.press("Enter");
        assert.equal(await page.isVisible("#create-menu-menu"), false, "a choice closes the menu");
        const viaMenu = await page.textContent("#properties");
        await page.keyboard.press("Escape");
        await press(page, "#extrude", tap);
        assert.equal(await page.textContent("#properties"), viaMenu, "the menu's Extrude and the icon do the same");
      } finally {
        await page.context().close();
      }
    });

    await check(`${at}: the tools still to come are greyed with "Coming soon", say what each will do, and choosing one does nothing`, async () => {
      const page = await fresh(width, tap);
      try {
        // Construct ▾ holds only tools to come: its button greyed (coming-soon.css), still opening to show them; Modify ▾ has Move (35e2b).
        const faded = await page.$$eval("#modify-menu, #construct-menu, #inspect-menu", (bs) => bs.map((b) => [b.id, getComputedStyle(b).opacity, b.disabled]));
        assert.deepEqual(faded, [["modify-menu", "1", false], ["construct-menu", "0.5", false], ["inspect-menu", "1", false]]);
        const lists = {};
        for (const menu of ["create-menu", "modify-menu", "construct-menu", "inspect-menu"]) {
          await press(page, `#${menu}`, tap);
          await until(page, (m) => !document.getElementById(`${m}-menu`).hidden, menu, `${menu} opens`);
          lists[menu] = await page.$$eval(`#${menu}-menu [id^=coming-]`, (els) => els.map((e) => e.id.slice(7)));
          const box = await rect(page, `#${menu}-menu`);
          assert.ok(box.left >= 0 && box.right <= width, `${menu}'s list on the screen: ${box.left}-${box.right}`);
          await page.keyboard.press("Escape");
        }
        assert.deepEqual(lists, {
          "create-menu": ["revolve", "hole", "pattern", "sweep", "loft"],
          "modify-menu": ["duplicate", "mirror", "combine", "chamfer", "fillet", "shell", "draft"],
          "construct-menu": ["plane", "axis", "point"],
          "inspect-menu": ["measure", "section"],
        });
        await press(page, "#modify-menu", tap);
        await until(page, () => !document.getElementById("modify-menu-menu").hidden, null, "Modify ▾ opens");
        assert.deepEqual(await comingProblems(page), []);
        const fillet = await page.$eval("#coming-fillet", (b) => [b.title, b.getAttribute("aria-disabled"), getComputedStyle(b).color, b.querySelector(".menu-button-note")?.textContent]);
        assert.deepEqual(fillet, ["Fillet is coming soon: it will round the edges you pick.", "true", "rgb(138, 145, 156)", "Coming soon"]);
        if (shots) await page.screenshot({ path: `${shots}/coming-soon-${width}.png`, clip: { x: 0, y: 0, width, height: width > 640 ? 520 : 667 } });
        // Choosing one does nothing: the list stays open, nothing opens, no undo step, nothing in the timeline.
        const before = [await page.textContent("#properties"), await page.getAttribute("#undo", "title"), await page.$$eval("#browser .tree-row", (rs) => rs.length)];
        // Playwright treats an aria-disabled item as off and waits; a person can still click or tap it, so force it.
        await (tap ? page.tap("#coming-fillet", { force: true }) : page.click("#coming-fillet", { force: true }));
        await page.waitForTimeout(200);
        assert.equal(await page.isVisible("#modify-menu-menu"), true, "the list stays open");
        assert.deepEqual([await page.textContent("#properties"), await page.getAttribute("#undo", "title"), await page.$$eval("#browser .tree-row", (rs) => rs.length)], before);
        // The check can fail: one item switched on and one note lost are each caught.
        await page.evaluate(() => {
          document.getElementById("coming-shell").removeAttribute("aria-disabled");
          document.querySelector("#coming-draft .menu-button-note").remove();
        });
        assert.deepEqual(await comingProblems(page), ["coming-shell: not off", 'coming-draft: says "" at its right']);
      } finally {
        await page.context().close();
      }
    });

    await check(`${at}: Body facts off with nothing built, saying why; once a box is in, it opens the folded panel at its numbers`, async () => {
      const page = await fresh(width, tap);
      try {
        assert.equal(await page.isDisabled("#inspect-facts"), true, "off in an empty design");
        await press(page, "#inspect-menu", tap);
        const off = await page.$eval("#inspect-menu-facts", (b) => [b.getAttribute("aria-disabled"), b.title, b.querySelector("svg.icon")?.dataset.icon]);
        assert.deepEqual(off, ["true", "Nothing built yet: insert a preset or extrude a sketch, and its volume, area and faces show here.", "inspect"]);
        await page.keyboard.press("Escape");
        await insertPreset(page, "box", tap);
        await until(page, () => document.querySelector("#volume")?.textContent === "24,000 mm³", null, "the box built");
        await until(page, () => !document.getElementById("inspect-facts").disabled, null, "Body facts on once a body is built");
        if (!tap) {
          // The insert showed the panel for its sizes (U0d); fold it, as a person might, and Body facts opens it again.
          if ((await page.getAttribute("#properties-handle", "aria-expanded")) === "true") await page.click("#properties-handle");
          await until(page, () => document.getElementById("properties").hasAttribute("data-folded"), null, "folded");
        }
        await press(page, "#inspect-facts", tap);
        await until(page, () => !document.getElementById("properties").hasAttribute("data-folded"), null, "Body facts opens the panel");
        // Phone: Body facts opens the Properties sheet itself, so the numbers are not behind a closed sheet (demo rehearsal 10-28).
        if (tap) await until(page, () => document.getElementById("properties-toggle").getAttribute("aria-expanded") === "true", null, "Body facts opens the Properties sheet");
        await page.locator("#volume").scrollIntoViewIfNeeded(); // the sheet scrolls inside itself; the numbers are scrolled into its view
        const numbers = await rect(page, "#volume");
        assert.ok(numbers.top >= 0 && numbers.bottom <= (width > 640 ? 800 : 667) && numbers.width > 0, `the volume on screen: ${JSON.stringify(numbers)}`);
        assert.equal(await page.textContent("#volume"), "24,000 mm³");
        // The menu's Body facts does the same: on now, and the panel stays open.
        await press(page, "#inspect-menu", tap);
        assert.equal(await page.getAttribute("#inspect-menu-facts", "aria-disabled"), null);
        await press(page, "#inspect-menu-facts", tap);
        assert.equal(await page.$eval("#properties", (p) => p.hasAttribute("data-folded")), false);
      } finally {
        await page.context().close();
      }
    });

    await check(`${at}: the sketch's tools are icons over its Create ▾, Extrude over the name Solid, Finish Sketch with the finish icon`, async () => {
      const page = await fresh(width, tap);
      try {
        await press(page, "#create-sketch", tap);
        await openPanel(page, "properties", tap); // phone: the plane choice is in the Properties sheet (U5)
        await press(page, "#sketch-plane-XY", tap);
        await page.waitForSelector("#finish-sketch", { state: "visible" });
        assert.deepEqual(await toolbarProblems(page), []);
        const icons = await page.$$eval("#toolbar .sketchbar-create .toolbar-group-tool", (bs) => bs.map((b) => [b.id, b.querySelector("svg.icon").dataset.icon]));
        assert.deepEqual(icons, [
          ["sketch-tool-line", "line"],
          ["sketch-tool-rectangle", "rectangle"],
          ["sketch-tool-circle", "circle"],
          ["sketch-tool-arc", "arc"],
          ["sketch-tool-centre", "centre-arc"],
          ["sketch-tool-tangent", "tangent-arc"],
          ["sketch-tool-project", "project"],
        ]);
        assert.deepEqual(await groupNames(page), ["Create ▾", "Solid"], "the modelling Create ▾ steps aside; Extrude stays, named Solid");
        assert.equal(await page.$eval("#finish-sketch", (b) => b.querySelector("svg.icon")?.dataset.icon), "finish");
        // A tool chosen by its icon is pressed, and the menu's rows carry the same icons.
        await press(page, "#sketch-tool-circle", tap);
        assert.equal(await page.getAttribute("#sketch-tool-circle", "aria-pressed"), "true");
        await press(page, "#sketch-create", tap);
        const rows = await page.$$eval("#sketch-create-menu > button", (els) => els.map((e) => e.querySelector("svg.icon")?.dataset.icon));
        assert.deepEqual(rows, ["line", "rectangle", "circle", "arc", "project"]);
        if (shots) await page.screenshot({ path: `${shots}/sketchbar-${width}.png`, clip: { x: 0, y: 0, width, height: 180 } });
        await page.keyboard.press("Escape");
        await press(page, "#finish-sketch", tap);
        await until(page, () => document.getElementById("create-sketch").checkVisibility(), null, "back to modelling");
        assert.deepEqual(await groupNames(page), ["Create ▾", "Modify ▾", "Construct ▾", "Inspect ▾", "Insert ▾", "Export"], "the modelling groups back");
      } finally {
        await page.context().close();
      }
    });
  }

  await check("no errors in the browser console", async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await server.close();
}
if (failed) {
  console.log(`toolbar: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("toolbar: all checks passed");

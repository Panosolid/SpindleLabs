// Browser check of the one shortcut table (X7b): ? shows every key, the workspace on screen first; the list is modal (Escape
// closes it and nothing else); keys reach only a workspace on screen, never
// a sleeping one; typing in a field is never taken over; split view sends a
// workspace's keys to it in either pane.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { startWithBox, switchTo } from "./start.mjs";

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4179/";
const browser = await launch();
const errors = [];

async function fresh(width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(url);
  await startWithBox(page); // a new project starts empty (U0c): the 40 × 30 × 20 box, inserted
  await pinProperties(page); // the size boxes are in the panel, folded at the start on a wide screen (U0b)
  return page;
}
const selection = (page) => page.evaluate(() => document.body.dataset.selection ?? "");
const listOpen = (page) => page.evaluate(() => document.getElementById("shortcuts")?.open ?? false);
/** Each section's heading and its rows as "keys: label". */
const listed = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#shortcuts section")].map((s) => ({
      title: s.querySelector("h3").textContent,
      rows: [...s.querySelectorAll("dl > div")].map((d) => `${d.querySelector("dt").textContent}: ${d.querySelector("dd").textContent}`),
    })),
  );

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
  await check("? shows every key, Design's first; the list is modal: Escape closes it and clears nothing", async () => {
    const page = await fresh();
    try {
      await page.click("#browser [data-node=body-1]");
      assert.equal(await selection(page), "body:feature-1");
      await page.keyboard.press("?");
      assert.equal(await listOpen(page), true, "? opens the list");
      // Worked out from the table: Design is on screen, so it comes first, then the
      // app's keys; no placeholder binds a key and Image binds none yet.
      assert.deepEqual(await listed(page), [
        { title: "Design on screen", rows: ["Esc: Clear the selection", "Enter: OK in the Extrude, Move or Rotate panel", "M: Move bodies (outside a sketch)", "Shift+R: Rotate bodies (outside a sketch)", "E: Extrude", "S: Search the commands by name (outside a sketch)", "Ctrl+C: Copy the selected profile as SVG", "L: Line tool (in a sketch)", "R: Rectangle tool (in a sketch)", "C: Circle tool (in a sketch)", "A: 3-point arc tool (in a sketch)", "P: Project tool (in a sketch)", "0 1 2 3 4 5 6 7 8 9 . -: Type a length or width (while drawing a line or rectangle)"] },
        { title: "Everywhere", rows: ["?: Show the keyboard shortcuts", "Ctrl+V: Paste files into the project (a project file, an image…)", "Ctrl+Z: Undo", "Ctrl+Shift+Z Ctrl+Y: Redo"] },
      ]);
      await page.screenshot({ path: "e2e/shortcuts.png" });
      await page.keyboard.press("Escape");
      assert.equal(await listOpen(page), false, "Escape closes the list");
      assert.equal(await selection(page), "body:feature-1", "that Escape was the list's alone");
      await page.keyboard.press("Escape");
      assert.equal(await selection(page), "", "the next Escape clears the selection");
      // Close closes it too.
      await page.keyboard.press("?");
      assert.equal(await listOpen(page), true);
      await page.click("#shortcuts .close");
      assert.equal(await listOpen(page), false);
    } finally {
      await page.close();
    }
  });

  await check("a sleeping workspace hears no key; typing ? in a field types it", async () => {
    const page = await fresh();
    try {
      await page.click("#browser [data-node=body-1]");
      await switchTo(page, "image");
      await page.waitForFunction(() => document.body.dataset.activeWorkspace === "image");
      await page.keyboard.press("Escape");
      assert.equal(await selection(page), "body:feature-1", "Design is asleep: Escape in Image leaves its selection alone");
      // The list from Image: Design is not on screen, so the app's keys come first.
      await page.keyboard.press("?");
      assert.deepEqual((await listed(page)).map((s) => s.title), ["Everywhere", "Design"]);
      await page.keyboard.press("Escape");
      await switchTo(page, "design");
      await page.waitForFunction(() => document.body.dataset.activeWorkspace === "design");
      await page.keyboard.press("Escape");
      assert.equal(await selection(page), "", "awake again: Escape clears");
      // In a text field ? is a character, not the list (Design's own fields take numbers, so add one).
      await page.evaluate(() => document.getElementById("properties").append(Object.assign(document.createElement("input"), { id: "probe", type: "text" })));
      await page.click("#probe");
      await page.keyboard.press("?");
      assert.equal(await listOpen(page), false, "? typed in a text field does not open the list");
      assert.equal(await page.inputValue("#probe"), "?");
    } finally {
      await page.close();
    }
  });

  await check("split view: Design's keys reach it in the second pane, with a placeholder in use beside it", async () => {
    const page = await fresh();
    try {
      // Render in the first pane, Design beside it in the second.
      await switchTo(page, "render");
      await page.waitForFunction(() => document.body.dataset.activeWorkspace === "render");
      await page.click("#split-toggle");
      await page.waitForFunction(() => document.body.dataset.split !== "");
      await page.selectOption("#split-choice", "design");
      await page.waitForFunction(() => document.body.dataset.split === "design");
      await page.click("#split-browser [data-node=body-1]");
      assert.equal(await selection(page), "body:feature-1");
      await page.click("#properties"); // the first pane (Render, no keys) is now the one in use
      await page.keyboard.press("Escape");
      assert.equal(await selection(page), "", "Design is on screen in the second pane, so Escape still reaches it");
      await page.keyboard.press("?");
      assert.deepEqual((await listed(page)).map((s) => s.title), ["Design on screen", "Everywhere"]);
    } finally {
      await page.close();
    }
  });

  // Ben's keys (10-29), Fusion's: E opens Extrude; S opens the command search box, which narrows as you type, runs the
  // marked command on Enter, closes on Escape, and lists a command that is off without running it.
  await check("E opens Extrude; S searches the commands: typing narrows, Enter runs, Escape closes", async () => {
    const page = await fresh();
    try {
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press("e");
      await page.waitForSelector("#extrude-panel", { state: "visible" });
      await page.keyboard.press("Escape");
      await page.waitForSelector("#extrude-panel", { state: "hidden" });
      // S: every command, the box focused.
      await page.keyboard.press("s");
      await page.waitForSelector("#command-search-input", { state: "visible" });
      assert.equal(await page.evaluate(() => document.activeElement?.id), "command-search-input");
      const names = () => page.$$eval("#command-search-list li", (ls) => ls.map((l) => l.querySelector(".command-search-label").textContent));
      const all = await names();
      for (const n of ["Create sketch", "Extrude", "Move", "Body facts", "Box", "Export STL"]) assert.ok(all.includes(n), `${n} in ${all}`);
      // A coming tool is listed, off, saying why; Enter on a list of only it runs nothing.
      await page.fill("#command-search-input", "fillet");
      assert.deepEqual(await names(), ["Fillet"]);
      assert.equal(await page.getAttribute("#command-search-list li", "aria-disabled"), "true");
      await page.keyboard.press("Enter");
      assert.equal(await page.isVisible("#command-search-input"), true, "an off command is not run, the box stays");
      // "mo" narrows to Move first (its name starts so); Enter runs it.
      await page.fill("#command-search-input", "mo");
      assert.equal((await names())[0], "Move");
      await page.keyboard.press("Enter");
      await page.waitForSelector("#move-panel", { state: "visible" });
      assert.equal(await page.isVisible("#command-search-input"), false, "the box closes once a command runs");
      await page.keyboard.press("Escape");
      // Escape closes the box and runs nothing; letters typed in it never reach the shortcuts (m would open Move).
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press("s");
      await page.waitForSelector("#command-search-input", { state: "visible" });
      await page.keyboard.type("m");
      assert.equal(await page.isVisible("#move-panel"), false, "typing m in the box searches, it doesn't open Move");
      await page.keyboard.press("Escape");
      await page.waitForSelector("#command-search-input", { state: "detached" });
      assert.equal(await page.isVisible("#move-panel"), false);
    } finally {
      await page.close();
    }
  });

  assert.deepEqual(errors, [], "no page errors or console errors (a shortcut clash logs one)");
} catch (e) {
  failed = true;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed) process.exit(1);

// DESIGN ▾ (switcher.ts, U0f2b): the button's words for each page, the
// ten items listed by hand with their notes, data and marks, and choosing
// in a real DOM (happy-dom).
import { test } from "node:test";
import assert from "node:assert/strict";
import { COMING_SOON, switcherLabel, workspaceSwitcher, type SwitcherEntry } from "../src/switcher.ts";

const { Window } = await import("happy-dom");

const ENTRIES: SwitcherEntry[] = [
  { id: "design", title: "Design", summary: "Parametric CAD", placeholder: false },
  { id: "render", title: "Render", summary: "Pictures of the part", placeholder: true },
  { id: "image", title: "Image", summary: "Edit pictures", placeholder: false },
];

test("hand-worked: the button names a workspace by its title, another page by the name given, anything else by its id", () => {
  assert.equal(switcherLabel(ENTRIES, "design"), "Design");
  assert.equal(switcherLabel(ENTRIES, "render"), "Render");
  assert.equal(switcherLabel(ENTRIES, "community", { community: "Community" }), "Community");
  assert.equal(switcherLabel(ENTRIES, "elsewhere"), "elsewhere");
});

function made() {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const bar = doc.createElement("nav");
  doc.body.append(bar);
  const chosen: string[] = [];
  const mark = workspaceSwitcher(bar, ENTRIES, (id) => chosen.push(id), { community: "Community" });
  const items = () => [...doc.querySelectorAll<HTMLButtonElement>("#workspace-menu-menu [role=menuitem]")];
  return { window, doc, bar, mark, chosen, items };
}

test("one button in place of the tabs, named for the first workspace until marked; its menu lists every workspace in order", () => {
  const { bar, mark, items, window } = made();
  assert.deepEqual([...bar.children].map((c) => c.className), ["menu-button workspace-menu"], "one button, no tabs");
  assert.equal(bar.querySelectorAll("[role=tab]").length, 0);
  assert.equal(mark.menu.button.textContent, "Design ▾");
  assert.equal(mark.menu.button.dataset.active, "design");
  mark.menu.button.click();
  // Each item: its words, its data-workspace, Coming soon (and data-soon) for one not built yet, the one on screen current.
  const rows = items().map((b) => [b.id, b.dataset.workspace, b.querySelector(".menu-button-name")!.textContent, b.querySelector(".menu-button-note")?.textContent ?? null, "soon" in b.dataset, b.getAttribute("aria-current")]);
  assert.deepEqual(rows, [
    ["workspace-design", "design", "Design", null, false, "true"],
    ["workspace-render", "render", "Render", COMING_SOON, true, null],
    ["workspace-image", "image", "Image", null, false, null],
  ]);
  assert.equal(items()[1].title, "Pictures of the part (coming soon)");
  assert.equal(items()[2].title, "Edit pictures");
  assert.equal(items()[1].getAttribute("aria-disabled"), null, "a placeholder is still chosen: its page says what it will do");
  window.happyDOM.close();
});

test("choosing an item calls choose with its id and closes the menu; marking renames the button and moves the mark", () => {
  const { mark, chosen, items, window } = made();
  mark.menu.button.click();
  items()[2].click();
  assert.deepEqual(chosen, ["image"]);
  assert.equal(mark.menu.isOpen, false);
  // The shell marks the page it then shows.
  mark("image");
  assert.equal(mark.menu.button.textContent, "Image ▾");
  assert.equal(mark.menu.button.dataset.active, "image");
  assert.match(mark.menu.button.title, /^The workspace on screen, Image: /);
  assert.equal(mark.menu.menu.getAttribute("aria-label"), "Image");
  mark.menu.button.click();
  assert.deepEqual(items().filter((b) => b.getAttribute("aria-current") === "true").map((b) => b.dataset.workspace), ["image"]);
  mark.menu.close();
  // Community is no workspace: named on the button, nothing in the list current.
  mark("community");
  assert.equal(mark.menu.button.textContent, "Community ▾");
  mark.menu.button.click();
  assert.equal(items().filter((b) => b.getAttribute("aria-current") === "true").length, 0);
  window.happyDOM.close();
});

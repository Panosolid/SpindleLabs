import { test } from "node:test";
import assert from "node:assert/strict";
import { MENU_GAP, menuButton, menuPlace, type MenuSection } from "../src/menu-button.ts";

const { Window } = await import("happy-dom");

test("hand-worked: the menu goes under the button, moved in from the window's edges", () => {
  // A button at x 100, y 40 to 70 in a 1280 × 720 window; a 200 × 300 menu fits under it: left 100, top 70 + 4.
  assert.deepEqual(menuPlace({ left: 100, top: 40, bottom: 70 }, { width: 200, height: 300 }, { width: 1280, height: 720 }), { left: 100, top: 74 });
  // At x 300 on a 375 px phone the 200 px menu would end at 500: moved left to 375 − 200 − 4 = 171.
  assert.deepEqual(menuPlace({ left: 300, top: 40, bottom: 70 }, { width: 200, height: 300 }, { width: 375, height: 667 }), { left: 171, top: 74 });
  // A button near the bottom (y 600 to 630) of a 720 px window: 630 + 4 + 300 = 934 > 716, so above it: 600 − 4 − 300 = 296.
  assert.deepEqual(menuPlace({ left: 10, top: 600, bottom: 630 }, { width: 200, height: 300 }, { width: 1280, height: 720 }), { left: 10, top: 296 });
  // A menu wider than the window keeps its left edge on the screen.
  assert.equal(menuPlace({ left: 10, top: 0, bottom: 30 }, { width: 500, height: 100 }, { width: 375, height: 667 }).left, MENU_GAP);
});

function made(sections: () => MenuSection[]) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const m = menuButton(doc, { id: "insert", label: "Insert", title: "Add a ready-made shape", sections });
  doc.body.append(m.element);
  const key = (el: Element, k: string) => el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as unknown as Event);
  return { doc, m, key, window };
}

test("a click opens and closes it; choosing runs the item and closes; an off item does nothing", () => {
  const ran: string[] = [];
  const { doc, m } = made(() => [
    { heading: "Presets", items: [{ id: "insert-box", label: "Box", data: { shape: "box" }, run: () => ran.push("box") }] },
    { heading: "From Community", items: [{ id: "insert-community", label: "Community models", off: "Comes with Community", run: () => ran.push("community") }] },
  ]);
  assert.equal(m.button.textContent, "Insert ▾");
  assert.equal(m.menu.hidden, true);
  m.button.click();
  assert.equal(m.menu.hidden, false);
  assert.equal(m.button.getAttribute("aria-expanded"), "true");
  assert.deepEqual([...m.menu.querySelectorAll(".menu-button-heading")].map((h) => h.textContent), ["Presets", "From Community"]);
  const box = doc.getElementById("insert-box")!;
  assert.equal(box.dataset.shape, "box");
  const off = doc.getElementById("insert-community")!;
  assert.equal(off.getAttribute("aria-disabled"), "true");
  assert.equal(off.getAttribute("title"), "Comes with Community", "an off item says why");
  off.click();
  assert.deepEqual(ran, [], "an off item runs nothing");
  assert.equal(m.isOpen, true, "and leaves the menu open");
  box.click();
  assert.deepEqual(ran, ["box"]);
  assert.equal(m.isOpen, false, "a choice closes it");
  m.button.click();
  m.button.click();
  assert.equal(m.isOpen, false, "a second click closes it");
});

test("the keyboard: ArrowDown opens on the first item, arrows wrap past the off one, Escape closes and gives the focus back", () => {
  const { doc, m, key } = made(() => [{ items: ["a", "b", "c"].map((id) => ({ id, label: id.toUpperCase(), off: id === "b" ? "off" : undefined, run: () => {} })) }]);
  let leaked = 0;
  doc.addEventListener("keydown", () => leaked++);
  m.button.focus();
  key(m.button, "ArrowDown");
  assert.equal(m.isOpen, true);
  assert.equal(doc.activeElement?.id, "a");
  key(doc.activeElement!, "ArrowDown");
  assert.equal(doc.activeElement?.id, "c", "the off item is skipped");
  key(doc.activeElement!, "ArrowDown");
  assert.equal(doc.activeElement?.id, "a", "and the list wraps");
  key(doc.activeElement!, "End");
  assert.equal(doc.activeElement?.id, "c");
  key(doc.activeElement!, "Escape");
  assert.equal(m.isOpen, false);
  assert.equal(doc.activeElement, m.button, "the focus goes back to the button");
  assert.equal(leaked, 0, "the menu's own keys never reach the app's shortcuts (Escape would clear the selection too)");
  key(m.button, "Escape");
  assert.equal(leaked, 1, "with the menu closed, Escape is the app's again");
});

test("with the menu open, a letter goes to the next item starting with it and no other key reaches the app's shortcuts", () => {
  // Hunt 10-26: ? pressed with File ▾ open opened the shortcut list over the still-open menu.
  const { doc, m, key, window } = made(() => [{ items: [{ id: "new", label: "New" }, { id: "open", label: "Open…" }, { id: "save", label: "Save" }, { id: "export", label: "Export STL" }].map((i) => ({ ...i, run: () => {} })) }]);
  const leaked: string[] = [];
  doc.addEventListener("keydown", (e) => leaked.push((e as KeyboardEvent).key));
  m.button.focus();
  key(m.button, "ArrowDown");
  assert.equal(doc.activeElement?.id, "new");
  key(doc.activeElement!, "s");
  assert.equal(doc.activeElement?.id, "save", "s goes to Save");
  key(doc.activeElement!, "e");
  assert.equal(doc.activeElement?.id, "export", "e goes to Export STL");
  key(doc.activeElement!, "O");
  assert.equal(doc.activeElement?.id, "open", "O wraps round to Open…, whatever the case");
  key(doc.activeElement!, "?");
  key(doc.activeElement!, "z");
  assert.equal(doc.activeElement?.id, "open", "a letter no item starts with stays put");
  doc.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }) as unknown as Event);
  assert.deepEqual(leaked, [], "?, z and Ctrl+Z never reach the app while the menu is open");
  assert.equal(m.isOpen, true, "and the menu stays open");
  key(doc.activeElement!, "Escape");
  key(m.button, "?");
  assert.deepEqual(leaked, ["?"], "with the menu closed, ? is the app's again");
});

test("a press outside closes it; the sections are read again each time it opens", () => {
  let n = 1;
  const { doc, m, window } = made(() => [{ items: [{ id: `item-${n}`, label: `Item ${n}`, run: () => {} }] }]);
  m.open();
  assert.ok(doc.getElementById("item-1"));
  doc.body.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }) as unknown as Event);
  assert.equal(m.isOpen, false);
  n = 2;
  m.open();
  assert.equal(doc.getElementById("item-1"), null);
  assert.ok(doc.getElementById("item-2"), "a section's items as they are now");
  m.menu.querySelector("button")!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }) as unknown as Event);
  assert.equal(m.isOpen, true, "a press inside keeps it open");
});

test("setLabel renames the button and its menu, keeping an icon; a note shows at an item's right only without a key", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const m = menuButton(doc, {
    id: "w",
    label: "Design",
    title: "t",
    icon: "insert",
    sections: () => [{ items: [{ id: "a", label: "A", key: "K", note: "never shown", run() {} }, { id: "b", label: "B", note: "Coming soon", current: true, run() {} }] }],
  });
  doc.body.append(m.element);
  m.setLabel("Image");
  assert.equal(m.button.textContent, "Image ▾");
  assert.equal(m.button.querySelector("svg.icon")?.getAttribute("data-icon"), "insert", "the icon kept");
  assert.equal(m.menu.getAttribute("aria-label"), "Image");
  m.button.click();
  const a = doc.getElementById("a")!;
  const b = doc.getElementById("b")!;
  assert.equal(a.querySelector(".menu-button-note"), null, "a key wins over a note");
  assert.equal(a.querySelector(".menu-button-key")?.textContent, "K");
  assert.equal(b.querySelector(".menu-button-note")?.textContent, "Coming soon");
  assert.deepEqual([a.getAttribute("aria-current"), b.getAttribute("aria-current")], [null, "true"]);
  window.happyDOM.close();
});

test("sweep bug 21: a menu left open is placed again when the window changes size, and not after it closes", () => {
  const { m, window } = made(() => [{ items: [{ id: "insert-box", label: "Box", run: () => {} }] }]);
  const rect = (r: { left: number; top: number; right: number; bottom: number; width: number; height: number }) => () => ({ ...r, x: r.left, y: r.top, toJSON: () => r });
  // A button at x 300 to 340 of a 375 px window; the menu is 200 x 100. Hand-worked: left = min(300, 375 - 200 - 4) = 171.
  m.button.getBoundingClientRect = rect({ left: 300, top: 10, right: 340, bottom: 40, width: 40, height: 30 }) as never;
  m.menu.getBoundingClientRect = rect({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }) as never;
  window.happyDOM.setViewport({ width: 375, height: 667 });
  m.button.click();
  assert.equal(m.menu.style.left, "171px");
  // The window turns sideways to 667 wide: the button is now at x 500, the menu fits at min(500, 667 - 200 - 4 = 463), so it follows.
  m.button.getBoundingClientRect = rect({ left: 500, top: 10, right: 540, bottom: 40, width: 40, height: 30 }) as never;
  window.happyDOM.setViewport({ width: 667, height: 375 });
  assert.equal(m.menu.style.left, "463px");
  // Closed, a resize leaves the menu alone.
  m.close();
  m.button.getBoundingClientRect = rect({ left: 10, top: 10, right: 50, bottom: 40, width: 40, height: 30 }) as never;
  window.happyDOM.setViewport({ width: 375, height: 667 });
  assert.equal(m.menu.style.left, "463px");
});

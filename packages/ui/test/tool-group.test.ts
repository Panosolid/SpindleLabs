import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { TOOL_ICON_SIZE, toolGroup } from "../src/tool-group.ts";
import { ICON_GRID, withIcon } from "../src/icons.ts";
import { menuButton } from "../src/menu-button.ts";

const page = () => {
  const window = new Window();
  return window.document as unknown as Document;
};
const button = (doc: Document, id: string, words: string) => {
  const b = doc.createElement("button");
  b.id = id;
  b.textContent = words;
  return b;
};

test("withIcon: the icon first, the words kept in a span, so the text and name read as before", () => {
  const doc = page();
  const b = withIcon(button(doc, "extrude", "Extrude"), "extrude", 24);
  const [svg, word] = [...b.children];
  assert.equal(svg.tagName.toLowerCase(), "svg");
  assert.equal(svg.getAttribute("data-icon"), "extrude");
  assert.equal(svg.getAttribute("width"), "24");
  assert.equal(word.className, "tool-word");
  assert.equal(b.textContent, "Extrude", "the svg adds no words");
  assert.ok(b.classList.contains("with-icon"));
  // Words with markup in them move whole.
  const rich = button(doc, "x", "");
  rich.append("Finish ", doc.createElement("b"));
  withIcon(rich, "finish");
  assert.equal(rich.querySelector(".tool-word")!.childNodes.length, 2);
});

test("TOOL_ICON_SIZE is the icons' own grid: one unit a pixel", () => {
  assert.equal(TOOL_ICON_SIZE, ICON_GRID);
});

test("a group with a menu: a row of icon buttons over its name, the name the menu's button", () => {
  const doc = page();
  const g = toolGroup(doc, { name: "Create", menu: { id: "create-menu", title: "Every way", sections: () => [{ items: [{ id: "m-sketch", label: "Create sketch", icon: "sketch", run: () => {} }] }] } });
  g.add([button(doc, "create-sketch", "Create sketch"), "sketch"], [button(doc, "extrude", "Extrude"), "extrude"]);
  assert.equal(g.element.getAttribute("role"), "group");
  assert.equal(g.element.getAttribute("aria-label"), "Create");
  assert.deepEqual([...g.element.children].map((c) => c.className), ["toolbar-group-row", "tool-group-name toolbar-group-name"]);
  // The row: each button its icon, its words its name.
  assert.deepEqual(
    [...g.row.children].map((b) => [b.id, b.querySelector("svg")!.getAttribute("data-icon"), b.getAttribute("aria-label"), b.classList.contains("toolbar-group-tool")]),
    [
      ["create-sketch", "sketch", "Create sketch", true],
      ["extrude", "extrude", "Extrude", true],
    ],
  );
  // The name: the menu's button, "Create ▾", no icon of its own.
  assert.equal(g.menu!.button.id, "create-menu");
  assert.equal(g.menu!.button.textContent, "Create ▾");
  assert.equal(g.menu!.button.querySelector("svg"), null);
  assert.equal(g.element.querySelector(".toolbar-group-name")!.contains(g.menu!.element), true);
  // Opened, its item carries its icon before its name.
  doc.body.append(g.element);
  g.menu!.open();
  const item = doc.getElementById("m-sketch")!;
  assert.equal(item.querySelector(".menu-button-name > svg")!.getAttribute("data-icon"), "sketch");
  assert.equal(item.querySelector(".menu-button-name > svg")!.getAttribute("width"), "16");
  assert.equal(item.textContent, "Create sketch");
});

test("a group without a menu: its name is plain words; a solo group is one button, its icon over its name", () => {
  const doc = page();
  const plain = toolGroup(doc, { name: "Export" });
  assert.equal(plain.menu, null);
  assert.equal(plain.element.querySelector(".toolbar-group-name")!.textContent, "Export");
  const solo = toolGroup(doc, { name: "Insert", solo: "insert", menu: { id: "insert", title: "Insert: add a shape", sections: () => [] } });
  assert.ok(solo.element.classList.contains("toolbar-group-solo"));
  assert.deepEqual([...solo.element.children], [solo.menu!.element], "no row, no separate name");
  const toggle = solo.menu!.button;
  assert.equal(toggle.textContent, "Insert ▾");
  assert.equal(toggle.querySelector(":scope > svg")!.getAttribute("data-icon"), "insert");
  assert.equal(toggle.querySelector(":scope > svg")!.getAttribute("width"), String(TOOL_ICON_SIZE));
  assert.equal(toggle.querySelector(":scope > .tool-word")!.textContent, "Insert ▾");
});

test("a menu button without an icon is as it was (U0d): its words only", () => {
  const doc = page();
  const m = menuButton(doc, { id: "file", label: "File", title: "Files", sections: () => [] });
  assert.equal(m.button.childNodes.length, 1);
  assert.equal(m.button.textContent, "File ▾");
});

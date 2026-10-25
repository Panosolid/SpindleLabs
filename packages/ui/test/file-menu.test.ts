// File ▾ (file-menu.ts, U0f2a): the sections listed by hand for Design and
// for a workspace with no entries, the entries' state read each time the
// menu opens, and the menu itself in a real DOM (happy-dom).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPORT_STL_ID, fileMenu, fileSections, NEW_ID, noExport, noNew, type FileMenuEntry, type FileMenuParts } from "../src/file-menu.ts";

const { Window } = await import("happy-dom");

/** The parts File ▾ is built from, logging each run; `entries` is what the workspace on screen offers. */
function parts(entries: FileMenuParts["entries"], where = "Design") {
  const ran: string[] = [];
  const entry = (id: string, label: string, off?: string): FileMenuEntry => ({ id, label, title: `${label}: tooltip`, off, run: () => ran.push(id) });
  return { ran, entry, parts: { open: entry("open", "Open…"), save: entry("file-save", "Save"), where: () => where, entries } satisfies FileMenuParts };
}

/** Each section as [id, label, icon, off] rows. */
const rows = (p: FileMenuParts) => fileSections(p).map((s) => s.items.map((i) => [i.id, i.label, i.icon, i.off ?? null]));

test("hand-listed: Design's File ▾ is New, Open…, Save, then Export STL, each with its icon", () => {
  const { entry, parts: p } = parts(() => ({ new: entry("start-fresh", "New"), exports: [entry("file-export-stl", "Export STL")] }));
  assert.deepEqual(rows(p), [
    [
      ["start-fresh", "New", "new", null],
      ["open", "Open…", "open", null],
      ["file-save", "Save", "save", null],
    ],
    [["file-export-stl", "Export STL", "export", null]],
  ]);
  // The workspace's tooltip and off state pass through as they are.
  const { entry: e2, parts: p2 } = parts(() => ({ new: e2("start-fresh", "New", "New: nothing to clear, the design is already empty."), exports: [e2("file-export-stl", "Export STL", "There is no body to download.")] }));
  const [first, second] = fileSections(p2);
  assert.equal(first.items[0].off, "New: nothing to clear, the design is already empty.");
  assert.equal(first.items[0].title, "New: tooltip");
  assert.equal(second.items[0].off, "There is no body to download.");
});

test("a workspace with no entries still lists New and Export STL, off and saying why, by its name", () => {
  const { parts: p } = parts(() => null, "Slice");
  assert.deepEqual(rows(p), [
    [
      [NEW_ID, "New", "new", "New: Slice has nothing to clear yet. New clears the design in Design."],
      ["open", "Open…", "open", null],
      ["file-save", "Save", "save", null],
    ],
    [[EXPORT_STL_ID, "Export STL", "export", "Export STL: Slice has nothing to export yet. Design exports its bodies as STL."]],
  ]);
  // So do entries that leave one out, or list no exports.
  const { entry, parts: q } = parts(() => ({ exports: [] }), "Community");
  assert.equal(fileSections(q)[0].items[0].off, noNew("Community"));
  assert.equal(fileSections(q)[1].items[0].off, noExport("Community"));
  assert.equal(entry("x", "X").off, undefined);
});

test("in a real DOM: each opening reads the entries afresh, an entry runs once, an off one never", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  let fresh = true;
  const { ran, entry, parts: p } = parts(() => ({ new: entry("start-fresh", "New", fresh ? "New: nothing to clear." : undefined), exports: [entry("file-export-stl", "Export STL")] }));
  const m = fileMenu(doc, p);
  doc.body.append(m.element);
  assert.equal(m.button.id, "file-menu");
  assert.equal(m.button.textContent, "File ▾");
  assert.match(m.button.title, /^File: /, "the tooltip starts with its words");
  m.button.click();
  const item = (id: string) => doc.getElementById(id)!;
  assert.deepEqual([...m.menu.querySelectorAll("[role=menuitem]")].map((b) => b.id), ["start-fresh", "open", "file-save", "file-export-stl"]);
  assert.equal(item("start-fresh").getAttribute("aria-disabled"), "true");
  assert.equal(item("start-fresh").title, "New: nothing to clear.");
  item("start-fresh").click();
  assert.deepEqual(ran, [], "off: nothing runs");
  m.close();
  fresh = false; // something drawn meanwhile
  m.button.click();
  assert.equal(item("start-fresh").getAttribute("aria-disabled"), null, "read again on opening");
  item("start-fresh").click();
  assert.deepEqual(ran, ["start-fresh"]);
  assert.equal(m.isOpen, false, "a choice closes it");
  for (const id of ["open", "file-save", "file-export-stl"]) {
    m.button.click();
    item(id).click();
  }
  assert.deepEqual(ran, ["start-fresh", "open", "file-save", "file-export-stl"]);
  // Every item has its icon before its words.
  m.button.click();
  assert.deepEqual([...m.menu.querySelectorAll("[role=menuitem] svg.icon")].map((s) => s.getAttribute("data-icon")), ["new", "open", "save", "export"]);
  window.happyDOM.close();
});

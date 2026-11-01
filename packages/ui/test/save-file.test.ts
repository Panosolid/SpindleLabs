// Saving a file (save-file.ts): names worked out by hand, the picker and
// handle paths with fakes, the name box in a real DOM (happy-dom).
import { test } from "node:test";
import assert from "node:assert/strict";
import { askName, baseNameOf, fileNameFor, PROJECT_KIND, saveFile, STL_KIND, type FileHandle } from "../src/save-file.ts";

const { Window } = await import("happy-dom");

test("names are made safe by hand-worked example", () => {
  assert.equal(fileNameFor("Bracket", ".spindle"), "Bracket.spindle");
  // Already has the ending (any case): not doubled.
  assert.equal(fileNameFor("Bracket.SPINDLE", ".spindle"), "Bracket.spindle");
  // Windows' refused characters \ / : * ? " < > | each become one "-": "a/b:c" is three letters and two bad ones, "a-b-c".
  assert.equal(fileNameFor('a/b:c*d?e"f<g>h|i\\j', ".stl"), "a-b-c-d-e-f-g-h-i-j.stl");
  // Dots and spaces at the ends go (a name ending in a dot is refused on Windows); inside they stay.
  assert.equal(fileNameFor("  my.part. ", ".stl"), "my.part.stl");
  // Nothing left: the fallback. Only dots: also nothing.
  assert.equal(fileNameFor("   ", ".spindle"), "Untitled.spindle");
  assert.equal(fileNameFor("...", ".spindle", "Plate"), "Plate.spindle");
  // Device names Windows keeps.
  assert.equal(fileNameFor("con", ".stl"), "con-.stl");
  assert.equal(fileNameFor("COM1", ".stl"), "COM1-.stl");
  assert.equal(fileNameFor("console", ".stl"), "console.stl");
  // Control characters.
  assert.equal(fileNameFor("a\u0000b\nc", ".stl"), "a-b-c.stl");
});

test("a long name is cut at 120 characters with its ending (boundary: 120 stays, 121 is cut)", () => {
  const ext = ".spindle"; // 8 characters, so 112 of the name fit
  assert.equal(fileNameFor("x".repeat(112), ext).length, 120);
  assert.equal(fileNameFor("x".repeat(112), ext), `${"x".repeat(112)}${ext}`);
  assert.equal(fileNameFor("x".repeat(113), ext), `${"x".repeat(112)}${ext}`);
  assert.equal(fileNameFor("x".repeat(500), ext).length, 120);
});

// Regression (files hunt, 2026-11-01): 120 characters of emoji were 480 bytes, over the 255 bytes file systems allow.
const utf8 = (s: string) => new TextEncoder().encode(s).length;

test("a long name is also cut to 200 bytes of UTF-8 with its ending, never inside a character", () => {
  const ext = ".spindle"; // 8 bytes, so 192 bytes of the name fit
  // An emoji is 4 bytes in UTF-8 (and 2 UTF-16 units): 192 / 4 = 48 emoji.
  const emoji = fileNameFor("😀".repeat(200), ext);
  assert.equal(emoji, `${"😀".repeat(48)}${ext}`);
  assert.equal(utf8(emoji), 200);
  // A CJK character is 3 bytes: 192 / 3 = 64 characters.
  const cjk = fileNameFor("設計".repeat(100), ext);
  assert.equal(cjk, `${"設計".repeat(32)}${ext}`);
  assert.equal(utf8(cjk), 200);
  // 95 × "é" (2 bytes each, 190) then an emoji (4) is 194 + 8 = 202 bytes: the emoji goes whole, leaving 190 + 8 = 198.
  const mixed = fileNameFor(`${"é".repeat(95)}😀`, ext);
  assert.equal(mixed, `${"é".repeat(95)}${ext}`);
  assert.ok(mixed.isWellFormed(), "no half of a surrogate pair left");
});

test("the byte limit's boundary: 0.9 × 200 bytes stays, 200 stays, 201 and 1.1 × 200 are cut", () => {
  const ext = ".stl"; // 4 bytes
  // "é" is 2 bytes. 0.9 × 200 = 180 bytes: 176 of name = 88 "é" (92 characters, under the 120-character limit too).
  assert.equal(fileNameFor("é".repeat(88), ext), `${"é".repeat(88)}${ext}`);
  // Exactly 200: 196 of name = 98 "é" (102 characters).
  assert.equal(utf8(fileNameFor("é".repeat(98), ext)), 200);
  assert.equal(fileNameFor("é".repeat(98), ext), `${"é".repeat(98)}${ext}`);
  // 201: 98 "é" and one "x" (197 + 4): the "x" goes.
  assert.equal(fileNameFor(`${"é".repeat(98)}x`, ext), `${"é".repeat(98)}${ext}`);
  // 1.1 × 200 = 220 bytes: 216 of name = 108 "é" (112 characters): cut to 98 "é", 200 bytes.
  assert.equal(fileNameFor("é".repeat(108), ext), `${"é".repeat(98)}${ext}`);
});

test("baseNameOf drops only the ending", () => {
  assert.equal(baseNameOf("Plate.spindle", ".spindle"), "Plate");
  assert.equal(baseNameOf("Plate.stl", ".spindle"), "Plate.stl");
});

/** A page with a picker (or none), a download recorder and a handle log. */
function page(options: { picker?: (o: unknown) => Promise<FileHandle>; webdriver?: boolean } = {}) {
  const window = new Window({ url: "https://example.org/" });
  const doc = window.document as unknown as Document;
  const downloads: string[] = [];
  const win = window as unknown as Record<string, unknown>;
  if (options.picker) win.showSaveFilePicker = options.picker;
  Object.defineProperty(window.navigator, "webdriver", { value: options.webdriver ?? false });
  // happy-dom's anchors don't download: record the name the click would have saved.
  const real = doc.createElement.bind(doc);
  (doc as unknown as { createElement: (t: string) => HTMLElement }).createElement = (t: string) => {
    const el = real(t);
    if (t === "a") el.click = () => void downloads.push((el as HTMLAnchorElement).download);
    return el;
  };
  (window as unknown as { URL: unknown }).URL = URL;
  return { doc, downloads, window };
}

function handle(name: string, written: string[], fail = false): FileHandle {
  return {
    name,
    async createWritable() {
      if (fail) throw new Error("gone");
      return { write: async (d) => void written.push(String(d)), close: async () => {} };
    },
  };
}

test("with the picker: the file it returns is written, its name and handle come back, and nothing downloads", async () => {
  const written: string[] = [];
  let asked: any;
  const h = handle("Chosen.spindle", written);
  const { doc, downloads } = page({ picker: async (o) => ((asked = o), h) });
  const r = await saveFile(doc, { suggestedName: "My part", kind: PROJECT_KIND, bytes: "DATA" });
  assert.deepEqual(r, { status: "saved", name: "Chosen.spindle", handle: h });
  assert.deepEqual(written, ["DATA"]);
  assert.deepEqual(downloads, []);
  assert.equal(asked.suggestedName, "My part.spindle");
  assert.deepEqual(asked.types, [{ description: "SpindleLabs project", accept: { "application/json": [".spindle"] } }]);
});

test("Save again writes the same handle without asking; if that fails the picker asks", async () => {
  const written: string[] = [];
  let asks = 0;
  const first = handle("A.spindle", written);
  const second = handle("B.spindle", written);
  const { doc } = page({ picker: async () => (asks++, second) });
  const again = await saveFile(doc, { suggestedName: "x", kind: PROJECT_KIND, bytes: "2", handle: first });
  assert.deepEqual(again, { status: "saved", name: "A.spindle", handle: first });
  assert.equal(asks, 0);
  assert.deepEqual(written, ["2"]);
  const gone = handle("Gone.spindle", written, true);
  const r = await saveFile(doc, { suggestedName: "x", kind: PROJECT_KIND, bytes: "3", handle: gone });
  assert.deepEqual(r, { status: "saved", name: "B.spindle", handle: second });
  assert.equal(asks, 1);
});

test("a picked file that can't be written fails with its name and why, and nothing downloads (weak-spot hunt 10-29)", async () => {
  let asks = 0;
  const { doc, downloads } = page({ picker: async () => (asks++, handle("Full.stl", [], true)) });
  const r = await saveFile(doc, { suggestedName: "x", kind: STL_KIND, bytes: "S" });
  assert.deepEqual(r, { status: "failed", message: 'Couldn\'t write "Full.stl": gone. Nothing was saved there; try again, or pick another place.' });
  assert.equal(asks, 1);
  assert.deepEqual(downloads, [], "no quiet download elsewhere");
  assert.equal(doc.querySelector(".save-name"), null, "and no name box");
});

test("closing the picker cancels: nothing written, nothing downloaded, no error", async () => {
  const { doc, downloads } = page({
    picker: async () => {
      throw Object.assign(new Error("closed"), { name: "AbortError" });
    },
  });
  assert.deepEqual(await saveFile(doc, { suggestedName: "x", kind: STL_KIND, bytes: "S" }), { status: "cancelled" });
  assert.deepEqual(downloads, []);
});

test("a page driven by a test downloads under the suggested name, ignoring the picker and asking nothing", async () => {
  let asks = 0;
  const { doc, downloads } = page({ picker: async () => (asks++, handle("n", [])), webdriver: true });
  const r = await saveFile(doc, { suggestedName: "Box", kind: STL_KIND, bytes: "S" });
  assert.deepEqual(r, { status: "saved", name: "Box.stl", handle: null });
  assert.deepEqual(downloads, ["Box.stl"]);
  assert.equal(asks, 0);
});

test("without a picker the name box asks: the name typed is downloaded; Cancel, Escape and a tap outside cancel", async () => {
  const { doc, downloads } = page();
  const pending = saveFile(doc, { suggestedName: "Plate", kind: PROJECT_KIND, bytes: "D" });
  const input = doc.querySelector<HTMLInputElement>(".save-name input")!;
  assert.equal(input.value, "Plate"); // the ending is shown beside it, not in it
  assert.equal(doc.querySelector(".save-name .ext")!.textContent, ".spindle");
  assert.equal(doc.activeElement, input);
  input.value = "Bracket v2";
  doc.querySelector<HTMLFormElement>(".save-name form")!.dispatchEvent(new (doc.defaultView as any).Event("submit", { cancelable: true }));
  assert.deepEqual(await pending, { status: "saved", name: "Bracket v2.spindle", handle: null });
  assert.deepEqual(downloads, ["Bracket v2.spindle"]);
  assert.equal(doc.querySelector(".save-name"), null);

  for (const how of ["cancel", "escape", "outside"] as const) {
    const p = saveFile(doc, { suggestedName: "Plate", kind: PROJECT_KIND, bytes: "D" });
    const root = doc.querySelector<HTMLElement>(".save-name")!;
    const W = doc.defaultView as any;
    if (how === "cancel") doc.querySelector<HTMLButtonElement>(".save-name .cancel")!.click();
    else if (how === "escape") root.dispatchEvent(new W.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else root.dispatchEvent(new W.Event("pointerdown", { bubbles: true }));
    assert.deepEqual(await p, { status: "cancelled" }, how);
  }
  assert.deepEqual(downloads, ["Bracket v2.spindle"]); // the cancelled ones saved nothing
});

test("a name typed with bad characters or left empty is made safe, not refused", async () => {
  const { doc, downloads } = page();
  for (const [typed, expected] of [["a/b", "a-b.spindle"], ["", "Untitled.spindle"]] as const) {
    const p = askName(doc, "Plate", PROJECT_KIND);
    doc.querySelector<HTMLInputElement>(".save-name input")!.value = typed;
    doc.querySelector<HTMLFormElement>(".save-name form")!.dispatchEvent(new (doc.defaultView as any).Event("submit", { cancelable: true }));
    assert.equal(await p, expected);
  }
  assert.deepEqual(downloads, []);
});

// U0e2: Rename in an item's menu. `renameItem` (timeline-edits.ts) names
// an item, refusing an empty name, one over NAME_LIMIT characters, one
// with a control character and another item's (ignoring case); its
// copies in other items' provenance follow and no description changes.
// `renameEntry` (timeline-menu.ts) records it as one undo step "Rename
// <old name>". The box (rename-box.ts) in a real DOM: Enter saves, Escape
// cancels, a refusal stays in the box, keys never reach the shortcuts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "@fission/core";
import { partDocument, type DesignDocument } from "../src/document.ts";
import { drawnFrame } from "../src/face-sketch.ts";
import { addFaceSketch, addSketch, drawCircle } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { deleteItem, NAME_LIMIT, renameItem, TIMELINE_STEPS } from "../src/timeline-edits.ts";
import { renameEntry } from "../src/timeline-menu.ts";
import { renameBox } from "../src/rename-box.ts";

const names = (doc: DesignDocument) => doc.timeline.features.map((f) => f.provenance.self.label);
const renamed = (doc: DesignDocument, id: string, typed: string) => {
  const r = renameItem(doc, id, typed);
  if ("refused" in r) throw new Error(`refused: ${r.message}`);
  return r.doc;
};

/** Box 1, Sketch 1 on its top face (from: Box 1), Extrude 1 of it (from: Sketch 1). */
function design(): DesignDocument {
  const s = addFaceSketch(partDocument("box", 40, 30, 20), { plane: "face:feature-1/top", feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  return extrudeSketch(drawCircle(s.doc, s.id, [20, 15], 5).doc, s.id, 8).doc;
}

test("hand-worked: a rename changes the name and its copies, nothing else", () => {
  const doc = design();
  assert.deepEqual(names(doc), ["Box 1", "Sketch 1", "Extrude 1"]);
  const base = renamed(doc, "feature-1", "Base");
  assert.deepEqual(names(base), ["Base", "Sketch 1", "Extrude 1"]);
  // The sketch on its face remembers it by its new name; its description, made with the old one, stays.
  assert.deepEqual(base.timeline.features[1].provenance.from, [{ workspace: "design", id: "feature-1", label: "Base" }]);
  assert.equal(base.timeline.features[1].intent.summary, "Sketch 1 on a face of Box 1");
  // Sketch 1 renamed: Extrude 1's copy follows, its description stays "Extrude Sketch 1 by 8 mm".
  const outline = renamed(base, "sketch-2", "Boss outline");
  assert.deepEqual(outline.timeline.features[2].provenance.from, [{ workspace: "design", id: "sketch-2", label: "Boss outline" }]);
  assert.equal(outline.timeline.features[2].intent.summary, "Extrude Sketch 1 by 8 mm");
  // Nothing else in the document changed.
  const strip = (d: DesignDocument) => JSON.stringify(d, (k, v) => (k === "label" ? undefined : v));
  assert.equal(strip(outline), strip(doc));
  // The deleted sketch is remembered by its new name: the extrude keeps it in its provenance.
  assert.equal(deleteItem(outline, "sketch-2").timeline.features[1].provenance.from[0].label, "Boss outline");
});

test("hand-worked: the spaces round a name go; its own name again changes nothing; a case change of its own name is a rename", () => {
  const doc = design();
  assert.deepEqual(names(renamed(doc, "feature-1", "   Base  ")), ["Base", "Sketch 1", "Extrude 1"]);
  assert.equal(renamed(doc, "feature-1", "Box 1"), doc, "the same document: no undo step");
  assert.equal(renamed(doc, "feature-1", " Box 1 "), doc);
  assert.deepEqual(names(renamed(doc, "feature-1", "box 1")), ["box 1", "Sketch 1", "Extrude 1"]);
});

test("each refusal, with its cause and words, and the document as it was", () => {
  const doc = design();
  const refused = (id: string, typed: string) => {
    const r = renameItem(doc, id, typed);
    return "refused" in r ? [r.refused, r.message] : null;
  };
  assert.deepEqual(refused("feature-1", ""), ["empty", "A name can't be empty: type one, or press Escape to keep Box 1"]);
  assert.deepEqual(refused("feature-1", " \t "), ["empty", "A name can't be empty: type one, or press Escape to keep Box 1"]);
  assert.deepEqual(refused("feature-1", "x".repeat(41)), ["too-long", "A name can have at most 40 characters: this one has 41"]);
  assert.deepEqual(refused("feature-1", "Top\nplate"), ["control", "A name can't have a line break, a tab or another control character in it"]);
  assert.deepEqual(refused("feature-1", "a\u0007b"), ["control", "A name can't have a line break, a tab or another control character in it"]);
  // Another item's name, in any case: names must differ, since messages name items by them.
  for (const taken of ["Sketch 1", "sketch 1", "EXTRUDE 1", " Extrude 1 "])
    assert.deepEqual(refused("feature-1", taken)?.[0], "taken", taken);
  assert.deepEqual(refused("feature-1", "sketch 1"), ["taken", "Sketch 1 is already the name of another item: each item needs its own name, since messages name items by them"]);
  assert.throws(() => renameItem(doc, "feature-9", "Base"), /there is no item feature-9 in the timeline/);
});

test("the 40-character limit: 0.9× and the limit itself pass, the limit + 1 and 1.1× are refused; characters, not code units, are counted", () => {
  assert.equal(NAME_LIMIT, 40);
  const doc = design();
  const ok = (typed: string) => !("refused" in renameItem(doc, "feature-1", typed));
  // 0.9 × 40 = 36 and 40 pass; 41 and 1.1 × 40 = 44 are refused.
  assert.equal(ok("n".repeat(36)), true);
  assert.equal(ok("n".repeat(40)), true);
  assert.equal(ok("n".repeat(41)), false);
  assert.equal(ok("n".repeat(44)), false);
  // "名" is one code unit; "🔩" is two (a surrogate pair) but one character: 40 of them pass, 41 don't.
  assert.equal(ok("名".repeat(40)), true);
  assert.equal("🔩".repeat(40).length, 80);
  assert.equal(ok("🔩".repeat(40)), true);
  assert.equal(ok("🔩".repeat(41)), false);
  // The spaces round it don't count: 40 characters with spaces either side pass.
  assert.equal(ok(`  ${"n".repeat(40)}  `), true);
});

test("a new item never takes a name a rename gave: the next sketch skips one called Sketch 2", () => {
  // The box renamed "Sketch 2", then a new sketch: the sketches are 1, so 1 + 1 = 2, taken, so Sketch 3.
  const doc = renamed(design(), "feature-1", "Sketch 2");
  assert.deepEqual(names(addSketch(doc).doc), ["Sketch 2", "Sketch 1", "Extrude 1", "Sketch 3"]);
});

test("renameEntry records one undo step named with the old name, which one Undo takes back; a refusal records nothing", () => {
  let doc = design();
  const history = createHistory({ capture: () => JSON.stringify(doc), restore: (s) => (doc = JSON.parse(s)) });
  const steps: string[] = [];
  const host = {
    current: () => doc,
    record(step: string, next: DesignDocument) {
      doc = next;
      steps.push(step);
      history.record(step);
    },
  };
  const before = JSON.stringify(doc);
  assert.equal(renameEntry(host, "feature-1", "Base"), null);
  assert.deepEqual(steps, ["Rename Box 1"]);
  assert.equal(TIMELINE_STEPS.rename("Box 1"), "Rename Box 1");
  assert.equal(history.undoLabel(), "Rename Box 1");
  // Refused: the words for the box, nothing recorded.
  assert.equal(renameEntry(host, "sketch-2", "base"), "Base is already the name of another item: each item needs its own name, since messages name items by them");
  assert.equal(renameEntry(host, "sketch-2", ""), "A name can't be empty: type one, or press Escape to keep Sketch 1");
  // Its own name: nothing recorded, the box closes. An item gone since the box opened: the same.
  assert.equal(renameEntry(host, "sketch-2", "Sketch 1"), null);
  assert.equal(renameEntry(host, "feature-9", "Lid"), null);
  assert.deepEqual(steps, ["Rename Box 1"]);
  history.undo();
  assert.equal(JSON.stringify(doc), before);
});

const { Window } = await import("happy-dom");

/** The box in a real DOM, a listener on the document standing in for the app's shortcuts. */
function setup() {
  const window = new Window({ width: 1280, height: 800 });
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const shortcutKeys: string[] = [];
  doc.addEventListener("keydown", (e) => shortcutKeys.push((e as KeyboardEvent).key));
  const box = renameBox(slot);
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const key = (k: string) => $("rename-input").dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as unknown as Event);
  const typeIn = (text: string) => {
    $<HTMLInputElement>("rename-input").value = text;
    $("rename-input").dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  };
  return { box, $, key, typeIn, shortcutKeys, doc };
}

test("the box: opens with the name selected; Enter saves what was typed and closes; Escape closes and saves nothing", () => {
  const t = setup();
  const saved: string[] = [];
  t.box.show("Box 1", { x: 100, y: 200 }, (typed) => (saved.push(typed), null));
  assert.equal(t.box.open, true);
  assert.equal(t.$("rename-heading").textContent, "Rename Box 1");
  const input = t.$<HTMLInputElement>("rename-input");
  assert.equal(input.value, "Box 1");
  assert.equal(t.doc.activeElement, input);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 5], "all of it selected, so typing replaces it");
  t.typeIn("Base");
  t.key("Enter");
  assert.deepEqual(saved, ["Base"]);
  assert.equal(t.box.open, false);
  // Escape: nothing saved.
  t.box.show("Base", { x: 100, y: 200 }, (typed) => (saved.push(typed), null));
  t.typeIn("Lid");
  t.key("Escape");
  assert.equal(t.box.open, false);
  assert.deepEqual(saved, ["Base"]);
  // Cancel and Rename buttons do the same.
  t.box.show("Base", { x: 0, y: 0 }, (typed) => (saved.push(typed), null));
  t.$("rename-cancel").click();
  assert.equal(t.box.open, false);
  t.box.show("Base", { x: 0, y: 0 }, (typed) => (saved.push(typed), null));
  t.typeIn("Lid");
  t.$("rename-save").click();
  assert.deepEqual(saved, ["Base", "Lid"]);
  // Keys typed in the box never reach the app's shortcuts (a Delete or Z typed in a name is not a command).
  assert.deepEqual(t.shortcutKeys, []);
});

test("the box: a refusal stays in it, its words under the line, until the name is typed again", () => {
  const t = setup();
  let tries = 0;
  t.box.show("Box 1", { x: 0, y: 0 }, (typed) => (tries++, typed === "" ? "A name can't be empty: type one, or press Escape to keep Box 1" : null));
  t.typeIn("");
  t.key("Enter");
  assert.equal(t.box.open, true, "still open");
  assert.equal(t.$("rename-why").hidden, false);
  assert.equal(t.$("rename-why").textContent, "A name can't be empty: type one, or press Escape to keep Box 1");
  assert.equal(t.$("rename-input").getAttribute("aria-invalid"), "true");
  t.typeIn("B");
  assert.equal(t.$("rename-why").hidden, true, "typing clears it");
  assert.equal(t.$("rename-input").getAttribute("aria-invalid"), null);
  t.key("Enter");
  assert.equal(t.box.open, false);
  assert.equal(tries, 2);
  // Opened again, the old refusal is gone.
  t.box.show("B", { x: 0, y: 0 }, () => null);
  assert.equal(t.$("rename-why").hidden, true);
});

test("the box stays on the screen: a point past the window's edge is pulled back", () => {
  const t = setup();
  t.box.show("Box 1", { x: 5000, y: 5000 }, () => null);
  // happy-dom lays nothing out (the box is 0 × 0), so it is pulled back to exactly the window's edge, 1280 × 800.
  assert.deepEqual([t.$("rename-box").style.left, t.$("rename-box").style.top], ["1280px", "800px"]);
  t.box.close();
  t.box.show("Box 1", { x: -40, y: -10 }, () => null);
  assert.deepEqual([t.$("rename-box").style.left, t.$("rename-box").style.top], ["0px", "0px"]);
});

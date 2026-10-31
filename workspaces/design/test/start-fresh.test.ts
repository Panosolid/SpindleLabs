// Start fresh (start-fresh.ts): the fresh design worked out by hand, what
// the dialog says goes, when File ▾'s New is off (U0f2a), and the dialog itself in a
// real DOM (happy-dom): it asks first, Cancel and Escape change nothing,
// its keys never reach the app's shortcuts. That it is one undo step that
// Undo takes back, in the real app on the real kernel, is the Chromium
// test (apps/fission/e2e/start-fresh.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson } from "@fission/core";
import { insertPreset, partDocument, readDesignDocument, withPart, type DesignDocument } from "../src/document.ts";
import { addSketch, drawCircle, drawRectangle } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { documentFor } from "../src/commands.ts";
import { ALREADY_FRESH_TITLE, clearedWords, freshDesign, isFresh, SKETCHING_TITLE, START_FRESH_STEP, START_FRESH_TITLE, startFresh } from "../src/start-fresh.ts";

const DESIGN = [{ id: "design" as const, readData: readDesignDocument }];
const reopen = (d: DesignDocument) => projectFromJson(projectToJson({ ...emptyProject("Fresh"), workspaces: { design: d } }), DESIGN).workspaces.design as DesignDocument;

/** The box (feature-1), Sketch 1 (sketch-2, a 40 × 30 rectangle) and Extrude 1 of it (feature-11): two features and one sketch. */
function part(): DesignDocument {
  const s = addSketch(partDocument("box", 40, 30, 20));
  return extrudeSketch(drawRectangle(s.doc, s.id, [0, 0], [40, 30]).doc, s.id, 10).doc;
}

test("the fresh design, written out by hand: nothing in it, the id counter at 1", () => {
  const d = freshDesign();
  // U0c (the owner's ask): a new project starts empty. Version 5 of Design's data; no item has been given an id,
  // so the counter stands at 1 and the first thing added is feature-1 or sketch-1; no body has a number, so the first is Body 1.
  assert.deepEqual(d, { version: 5, nextId: 1, profiles: [], sketches: [], timeline: { features: [] }, bodies: [], nextBody: 1 });
  assert.equal(Object.hasOwn(d.timeline, "marker"), false, "no marker");
  assert.equal(Object.hasOwn(d, "kept"), false);
  assert.equal(START_FRESH_STEP, "Start fresh");
});

test("the fresh design opens cleanly from a file, and the first thing added to it takes the first id", () => {
  assert.deepEqual(reopen(freshDesign()), freshDesign());
  // Each call is a new document, so nothing the workspace changes later can reach the next fresh one.
  assert.notEqual(freshDesign(), freshDesign());
  // A box inserted: feature-1, the counter at 2, the same as a one-box part made directly (two paths agreeing).
  const box = insertPreset(freshDesign(), "box", 40, 30, 20);
  assert.equal(box.id, "feature-1");
  assert.deepEqual(box.doc, partDocument("box", 40, 30, 20));
  // set_part on the empty design (the panel's size boxes, the AI) adds that same box.
  assert.deepEqual(documentFor({ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }, freshDesign()), partDocument("box", 40, 30, 20));
  assert.deepEqual(withPart(freshDesign(), "box", 40, 30, 20), partDocument("box", 40, 30, 20));
});

test("what the dialog says goes, counted by hand", () => {
  // part(): the box and Extrude 1 are features, Sketch 1 a sketch.
  assert.equal(clearedWords(part()), "1 sketch and 2 features");
  // A second sketch (sketch-12) with a circle in it: two sketches.
  const s2 = addSketch(part());
  assert.equal(clearedWords(drawCircle(s2.doc, s2.id, [0, 0], 5).doc), "2 sketches and 2 features");
  // One box alone: one feature, no sketch named.
  const box = partDocument("box", 40, 30, 20);
  assert.equal(clearedWords(box), "1 feature");
  // A plate added (feature-2 with profile-3): two features, still no sketch.
  assert.equal(clearedWords(insertPreset(box, "plate", 60, 40, 5).doc), "2 features");
  // An empty sketch counts: it is in the timeline; with no feature, none is named.
  assert.equal(clearedWords(addSketch(box).doc), "1 sketch and 1 feature");
  assert.equal(clearedWords(addSketch(freshDesign()).doc), "1 sketch");
});

test("isFresh: only a design with nothing in it; anything at all, even an empty sketch, is something to clear", () => {
  assert.equal(isFresh(freshDesign()), true);
  // Saved and opened again, still fresh, though the reader can list its keys in another order.
  assert.equal(isFresh(reopen(freshDesign())), true, "saved and opened again, still fresh");
  const reordered = Object.fromEntries(Object.entries(freshDesign()).reverse()) as unknown as DesignDocument;
  assert.equal(isFresh(reordered), true, "the same keys in another order");
  // Every body deleted by hand: the counter moved on, but there is nothing to clear, and a cleared design would look the same.
  assert.equal(isFresh({ ...freshDesign(), nextId: 3 }), true, "the counter doesn't count");
  assert.equal(isFresh({ ...freshDesign(), timeline: { features: [], marker: "start" } }), true, "nor the marker");
  assert.equal(isFresh(partDocument("box", 40, 30, 20)), false, "one box");
  assert.equal(isFresh(addSketch(freshDesign()).doc), false, "an empty sketch");
  assert.equal(isFresh(part()), false);
  // A ready-made profile or a kept shape left behind is something too (each checked alone: the test breaks one key at a time).
  const plate = insertPreset(freshDesign(), "plate", 60, 40, 5).doc;
  assert.equal(isFresh({ ...plate, timeline: { features: [] } }), false, "a profile left with no feature");
  assert.equal(isFresh({ ...freshDesign(), kept: { "feature-9": {} } } as unknown as DesignDocument), false, "a kept shape");
  assert.equal(isFresh({ ...freshDesign(), kept: {} }), true, "an empty kept record holds nothing");
});

const { Window } = await import("happy-dom");

/** A toolbar slot with Start fresh's dialog in a real DOM, a listener on the document standing in for the app's shortcuts; `choose()` picks New as File ▾ would. */
function setup(design: DesignDocument) {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  let current = design;
  let confirmed = 0;
  const shortcutKeys: string[] = [];
  doc.addEventListener("keydown", (e) => shortcutKeys.push((e as KeyboardEvent).key));
  const f = startFresh(slot, { current: () => current, confirm: () => confirmed++ });
  const $ = (id: string) => doc.getElementById(id) as HTMLElement;
  const key = (target: HTMLElement, k: string) => target.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }) as unknown as Event);
  const set = (d: DesignDocument) => (current = d);
  /** New as File ▾ lists it when it opens, for the design then; run as the menu runs an entry that is on. */
  const choose = () => {
    const entry = f.entry(current, false);
    assert.equal(entry.off, undefined, "New is on");
    entry.run();
  };
  return { doc, slot, f, $, key, set, choose, confirmed: () => confirmed, shortcutKeys };
}

test("File ▾'s New: its id, words and tooltip; off with its reason on a fresh design and while a sketch is edited", () => {
  const { f, slot } = setup(freshDesign());
  assert.equal(slot.querySelector(".tool-group"), null, "no toolbar group: New is in File ▾");
  assert.deepEqual([...slot.querySelectorAll("button")].filter((b) => !b.closest("dialog")), [], "nor a button outside the dialog");
  const fresh = f.entry(freshDesign(), false);
  assert.deepEqual([fresh.id, fresh.label, fresh.title, fresh.off], ["start-fresh", "New", START_FRESH_TITLE, ALREADY_FRESH_TITLE]);
  assert.equal(f.entry(part(), false).off, undefined, "on with something to clear");
  // While a sketch is edited (the plane prompt or the sketch), as the old toolbar button was hidden then; ahead of an empty design's reason.
  assert.equal(f.entry(part(), true).off, SKETCHING_TITLE);
  assert.equal(f.entry(freshDesign(), true).off, SKETCHING_TITLE);
  assert.match(SKETCHING_TITLE, /^New: /);
  assert.match(ALREADY_FRESH_TITLE, /^New: /, "every tooltip starts with its words");
  assert.match(START_FRESH_TITLE, /^New: /);
});

test("the dialog asks first and says what goes; Cancel closes it and clears nothing", () => {
  const { f, $, choose, confirmed } = setup(part());
  assert.equal(f.open, false);
  choose();
  assert.equal(f.open, true);
  assert.equal($("start-fresh-heading").textContent, "Start fresh?");
  assert.equal(
    $("start-fresh-words").textContent,
    "This clears everything in the design (1 sketch and 2 features) and starts again from an empty design, as a new project opens. Undo brings it all back.",
  );
  assert.equal($("start-fresh-cancel").ownerDocument.activeElement?.id, "start-fresh-cancel", "Cancel has the focus: Enter alone never clears");
  $("start-fresh-cancel").click();
  assert.equal(f.open, false);
  assert.equal(confirmed(), 0);
});

test("the dialog's words are for the design when New is chosen, not when the menu opened", () => {
  const { f, $, set } = setup(part());
  const entry = f.entry(part(), false); // the menu opened on part()
  set(addSketch(part()).doc);
  entry.run();
  assert.match($("start-fresh-words").textContent!, /\(2 sketches and 2 features\)/);
});

test("Escape closes the dialog without clearing, and no key pressed in it reaches the app's shortcuts", () => {
  const { f, $, key, choose, confirmed, shortcutKeys } = setup(part());
  choose();
  // R would choose the rectangle tool and Escape would clear the selection, behind the dialog.
  key($("start-fresh-cancel"), "r");
  key($("start-fresh-cancel"), "Escape");
  assert.deepEqual(shortcutKeys, []);
  assert.equal(f.open, false);
  assert.equal(confirmed(), 0);
  // Outside the dialog the keys do reach them: the listener itself works.
  key($("start-fresh-dialog").parentElement!, "r");
  assert.deepEqual(shortcutKeys, ["r"]);
});

test("Start fresh in the dialog confirms exactly once and closes it", () => {
  const { f, $, choose, confirmed } = setup(part());
  choose();
  $("start-fresh-confirm").click();
  assert.equal(confirmed(), 1);
  assert.equal(f.open, false);
});

test("New chosen once the design is fresh opens nothing, even from a menu drawn for an older design", () => {
  const { f, set, confirmed } = setup(part());
  const entry = f.entry(part(), false); // on, as drawn for the part
  set(freshDesign()); // everything deleted meanwhile
  entry.run();
  assert.equal(f.open, false);
  assert.equal(confirmed(), 0);
});

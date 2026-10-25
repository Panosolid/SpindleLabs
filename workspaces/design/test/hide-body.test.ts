// U0f3: the browser's eye on Design's data, hand-worked. hideBody's
// lists and refusals, the reader's checks on `hidden` (each with a document
// broken in exactly that way), a delete taking its id out, and what a hidden
// body no longer is: drawn (shownBodies), selected from a row, offered a
// verb, or in the whole design's STL. Every result is saved and opened
// again, so each is a document the reader takes. The wiring (the eye's
// button, its undo step, the panel's words) is in
// packages/testing/test/workspace-api.test.ts; the browser itself in
// apps/fission/e2e/app-bar.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson, type KernelCalls } from "@fission/core";
import { isHidden, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { deleteItem, hideBody, moveMarker, reorderItem, suppressItem, TIMELINE_STEPS } from "../src/timeline-edits.ts";
import { browserTree, rowReference, type BrowserNode } from "../src/browser.ts";
import { ALL_HIDDEN_STL, NO_BODY_STL, noBodyWords, shownBodyFeature, shownBodyRefs } from "../src/actions.ts";
import { bodyReference } from "../src/references.ts";
import { BodyCache, rebuildTimeline } from "../src/rebuild.ts";
import { shownBodies } from "../src/scene.ts";

const DESIGN = [{ id: "design" as const, readData: readDesignDocument }];
const reopen = (d: DesignDocument) => projectFromJson(projectToJson({ ...emptyProject("Eyes"), workspaces: { design: d } }), DESIGN).workspaces.design as DesignDocument;

/**
 * The box (feature-1, Body 1), Sketch 1 (sketch-2: a 40 × 30 rectangle)
 * and Extrude 1 of it (feature-11, Body 2), as in timeline-edits.test.ts.
 */
function part(): DesignDocument {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const rect = drawRectangle(s.doc, s.id, [0, 0], [40, 30]);
  return extrudeSketch(rect.doc, s.id, 10).doc;
}

test("hand-worked: hiding and showing, the list in timeline order, left out once it is empty, each step named", () => {
  const d = part();
  assert.equal(Object.hasOwn(d, "hidden"), false, "a new design hides nothing");
  // Extrude 1 hidden first, then the box: listed in the timeline's order, the box before it.
  const one = hideBody(d, "feature-11", true);
  assert.deepEqual(one.hidden, ["feature-11"]);
  const two = hideBody(one, "feature-1", true);
  assert.deepEqual(two.hidden, ["feature-1", "feature-11"]);
  assert.deepEqual([isHidden(two, "feature-1"), isHidden(two, "feature-11"), isHidden(two, "sketch-2")], [true, true, false]);
  // Shown again one by one; the list goes when nothing is hidden, so the saved file is as before.
  const back = hideBody(two, "feature-11", false);
  assert.deepEqual(back.hidden, ["feature-1"]);
  const none = hideBody(back, "feature-1", false);
  assert.equal(Object.hasOwn(none, "hidden"), false);
  assert.equal(projectToJson({ ...emptyProject("Eyes"), workspaces: { design: none } }), projectToJson({ ...emptyProject("Eyes"), workspaces: { design: d } }));
  // Nothing else changes: the timeline, sketches and counter are the same objects' values.
  assert.deepEqual({ ...two, hidden: undefined }, { ...d, hidden: undefined });
  // Hiding what is hidden, or showing what shows, gives the same document back (no undo step).
  assert.equal(hideBody(two, "feature-1", true), two);
  assert.equal(hideBody(d, "feature-1", false), d);
  // Every result reads back as it is.
  for (const doc of [one, two, back, none]) assert.deepEqual(reopen(doc), doc);
  // The undo steps, by the Body row's name.
  assert.equal(TIMELINE_STEPS.hide("Body 2"), "Hide Body 2");
  assert.equal(TIMELINE_STEPS.show("Body 2"), "Show Body 2");
});

test("a sketch has no body to hide, and an id not in the timeline is refused", () => {
  const d = part();
  assert.throws(() => hideBody(d, "sketch-2", true), { message: "Sketch 1 is a sketch, which has no body to hide" });
  assert.throws(() => hideBody(d, "sketch-2", false), { message: "Sketch 1 is a sketch, which has no body to hide" });
  assert.throws(() => hideBody(d, "feature-99", true), { message: 'there is no item feature-99 in the timeline' });
});

test("the reader takes a hidden list in any order, and refuses each way of breaking it, saying how", () => {
  const d = part();
  // Out of timeline order (a reorder can leave it so): read as it is.
  const swapped = { ...d, hidden: ["feature-11", "feature-1"] };
  assert.deepEqual(readDesignDocument(structuredClone(swapped)).hidden, ["feature-11", "feature-1"]);
  // A suppressed body, or one after the marker, may stay hidden.
  assert.deepEqual(reopen(hideBody(suppressItem(d, "feature-11", true), "feature-11", true)).hidden, ["feature-11"]);
  assert.deepEqual(reopen(hideBody(moveMarker(d, "feature-1"), "feature-11", true)).hidden, ["feature-11"]);
  const refused = (hidden: unknown) => () => readDesignDocument({ ...structuredClone(d), hidden });
  const NOT_LIST = { message: "Design data's hidden bodies are not a list of solid feature ids (left out when every body shows)" };
  assert.throws(refused([]), NOT_LIST, "an empty list is left out instead");
  assert.throws(refused("feature-1"), NOT_LIST);
  assert.throws(refused({ 0: "feature-1" }), NOT_LIST);
  assert.throws(refused(null), NOT_LIST);
  assert.throws(refused(["sketch-2"]), { message: 'Design data hides sketch-2, which is not a solid feature in the timeline' });
  assert.throws(refused(["feature-99"]), { message: 'Design data hides feature-99, which is not a solid feature in the timeline' });
  assert.throws(refused([1]), { message: "Design data hides 1, which is not a solid feature in the timeline" });
  assert.throws(refused(["feature-1", "feature-1"]), { message: "Design data hides feature-1 twice" });
});

test("deleting a hidden item takes it out of the list, and the list goes with its last id", () => {
  const d = hideBody(hideBody(part(), "feature-1", true), "feature-11", true);
  const noBox = deleteItem(d, "feature-1");
  assert.deepEqual(noBox.hidden, ["feature-11"]);
  const noExtrude = deleteItem(noBox, "feature-11");
  assert.equal(Object.hasOwn(noExtrude, "hidden"), false);
  // Deleting the sketch an extrude is built from keeps the extrude (the rebuild keeps its shape, 24d2), hidden still.
  const noSketch = deleteItem(hideBody(part(), "feature-11", true), "sketch-2");
  assert.deepEqual(noSketch.timeline.features.map((f) => f.id), ["feature-1", "feature-11"]);
  assert.deepEqual(noSketch.hidden, ["feature-11"]);
  // A reorder keeps the list as it is; any order reads.
  const reordered = reorderItem(hideBody(part(), "feature-1", true), "feature-1", 2);
  assert.ok("doc" in reordered, "the box may go last");
  const moved = reordered.doc;
  assert.deepEqual(moved.timeline.features.map((f) => f.id), ["sketch-2", "feature-11", "feature-1"]);
  assert.deepEqual(moved.hidden, ["feature-1"]);
  for (const doc of [noBox, noExtrude, noSketch, moved]) assert.deepEqual(reopen(doc), doc);
});

/** Each row's icon, in the tree's shape: [group, icon, rows] or [row, icon]. */
const icons = (nodes: BrowserNode[]): unknown[] => nodes.map((n) => (n.children ? [n.label, n.icon, icons(n.children)] : [n.label, n.icon]));

test("hand-listed: every row's icon, and the eye on each Body row only", () => {
  const d = hideBody(part(), "feature-11", true);
  const tree = browserTree(d);
  assert.deepEqual(icons(tree), [
    ["Timeline", "folder", [["Box 1", "box"], ["Sketch 1", "sketch"], ["Extrude 1", "extrude"]]],
    ["Sketches", "folder", [["Sketch 1", "sketch"]]],
    ["Profiles", "folder", []],
    ["Bodies", "folder", [["Body 1", "body"], ["Body 2", "body"]]],
    ["Origin", "origin", [["XY plane", "plane"], ["XZ plane", "plane"], ["YZ plane", "plane"], ["X axis", "axis"], ["Y axis", "axis"], ["Z axis", "axis"]]],
  ]);
  // `hidden` is set on Body rows (false or true) and left out on every other row.
  const flat = (nodes: BrowserNode[]): BrowserNode[] => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);
  assert.deepEqual(flat(tree).filter((n) => n.hidden !== undefined).map((n) => [n.id, n.hidden]), [["body-1", false], ["body-2", true]]);
  // A preset's own shape has its own icon (the slot's); a feature type with none has the plain feature icon.
  const slot = flat(browserTree(partDocument("slot", 60, 20, 5)));
  assert.equal(slot.find((n) => n.id === "feature-1")!.icon, "slot");
  const odd = part();
  odd.timeline.features[0] = { ...odd.timeline.features[0], intent: { ...odd.timeline.features[0].intent, type: "toString" } };
  assert.equal(flat(browserTree(odd)).find((n) => n.id === "feature-1")!.icon, "feature", "an inherited name is no icon");
});

test("a hidden body is not selected from its rows, offered a verb, or in the whole design's STL", () => {
  const d = part();
  const hid = hideBody(d, "feature-11", true);
  // Shown: Body 2's row and Extrude 1's Timeline row select it.
  assert.deepEqual(rowReference("body-2", d), bodyReference("feature-11"));
  assert.deepEqual(rowReference("feature-11", d), bodyReference("feature-11"));
  // Hidden: neither does; Body 1's still does.
  assert.equal(rowReference("body-2", hid), null);
  assert.equal(rowReference("feature-11", hid), null);
  assert.deepEqual(rowReference("body-1", hid), bodyReference("feature-1"));
  // Selected all the same (by the AI, another workspace): no verb, as for a body not built.
  assert.equal(shownBodyFeature(bodyReference("feature-11"), hid), null);
  assert.equal(shownBodyFeature(bodyReference("feature-1"), hid)!.id, "feature-1");
  // The whole design's STL: every body shown, in build order.
  assert.deepEqual(shownBodyRefs(d).map((b) => b.id), ["body:feature-1", "body:feature-11"]);
  assert.deepEqual(shownBodyRefs(hid).map((b) => b.id), ["body:feature-1"]);
  const both = hideBody(hid, "feature-1", true);
  assert.deepEqual(shownBodyRefs(both), []);
  // Why it is empty: every body hidden says so and how to show one; nothing built says that instead.
  assert.equal(noBodyWords(both), ALL_HIDDEN_STL);
  assert.equal(ALL_HIDDEN_STL, "There is no body to download: every body is hidden. Show one with its eye in the browser.");
  assert.equal(noBodyWords(moveMarker(d, "start")), NO_BODY_STL);
  // Both failed, one of them hidden: nothing would build if shown, so nothing builds.
  assert.equal(noBodyWords(both, new Set(["feature-1", "feature-11"])), NO_BODY_STL);
  // One hidden, the other failed: the hidden one would download if shown.
  assert.equal(noBodyWords(hid, new Set(["feature-1"])), ALL_HIDDEN_STL);
});

/** A kernel that answers at once: each body_build a new handle, each body_view a view counted in `viewed`. */
function quickKernel() {
  let next = 1;
  const viewed: number[] = [];
  const kernel = {
    call(op: string, ...args: unknown[]) {
      if (op === "sketch_outline") return Promise.resolve({ closed: { args } });
      if (op === "body_build") return Promise.resolve(next++);
      if (op === "body_view") {
        viewed.push(args[0] as number);
        return Promise.resolve({ volume: 1, area: 1, mesh: { positions: [], normals: [], indices: [], triangle_faces: [], edge_lines: [], edge_line_edges: [] }, faces: [], edges: [], face_roles: [], edge_faces: [] });
      }
      return Promise.resolve(undefined);
    },
  } as unknown as KernelCalls;
  return { kernel, viewed };
}

test("a hidden body is still built, but not drawn; the one after it keeps its Body number", async () => {
  const d = hideBody(part(), "feature-1", true);
  const { kernel, viewed } = quickKernel();
  const cache = new BodyCache(kernel);
  const build = await rebuildTimeline(d, cache, kernel);
  // Built as ever (what is built on it still is): both bodies.
  assert.deepEqual([build.results["feature-1"].status, build.results["feature-11"].status], ["built", "built"]);
  // Drawn: Extrude 1's body alone, still Body 2, and only its view asked for.
  const shown = await shownBodies(d, build, cache);
  assert.deepEqual(shown.map((b) => [b.feature, b.place]), [["feature-11", 2]]);
  assert.equal(viewed.length, 1);
  // Shown again: both, Body 1 and Body 2.
  const again = await shownBodies(hideBody(d, "feature-1", false), build, cache);
  assert.deepEqual(again.map((b) => [b.feature, b.place]), [["feature-1", 1], ["feature-11", 2]]);
});

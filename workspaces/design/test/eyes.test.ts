// An eye on everything (Ben, 2026-10-29, as in Fusion): sketches, bodies,
// the origin's axes and planes, and the Sketches, Bodies and Origin
// folders, each shut and opened by `hideRow`; a sketch an extrude uses
// shut by `usedSketchHidden`. Hand-worked lists, what each eye stops
// drawing, the reader's checks (each with a document broken in exactly
// that way), and every result saved and opened again. The Body rows'
// own eyes are hide-body.test.ts; the buttons, undo steps and view are
// packages/testing/test/workspace-api.test.ts and apps/fission/e2e/eyes.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, projectFromJson, projectToJson } from "@fission/core";
import { bodyHidden, EYE_FOLDERS, originDrawn, partDocument, readDesignDocument, sketchHidden, type DesignDocument } from "../src/document.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { deleteItem, hideBody, hideRow, usedSketchHidden } from "../src/timeline-edits.ts";
import { browserTree, eyeId, rowReference, type BrowserNode } from "../src/browser.ts";
import { startTool, sketchDrawings } from "../src/sketch-tool.ts";
import { shownBodyRefs } from "../src/actions.ts";

const DESIGN = [{ id: "design" as const, readData: readDesignDocument }];
const reopen = (d: DesignDocument) => projectFromJson(projectToJson({ ...emptyProject("Eyes"), workspaces: { design: d } }), DESIGN).workspaces.design as DesignDocument;
/** Mulberry32 (as arc-tool.test.ts): a small seeded generator, so a failing session replays from its seed. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const flat = (nodes: BrowserNode[]): BrowserNode[] => nodes.flatMap((n) => [n, ...flat(n.children ?? [])]);
/** Each row's own eye and its folder's, by row id: [shut, folder shut]. */
const eyes = (d: DesignDocument) => Object.fromEntries(flat(browserTree(d)).filter((n) => n.hidden !== undefined).map((n) => [n.id, [n.hidden, n.folderHidden ?? false]]));

/** The box (feature-1, Body 1), Sketch 1 (sketch-2: a 40 × 30 rectangle) and Extrude 1 of it (feature-11, Body 2), as in hide-body.test.ts. */
function part(): DesignDocument {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const rect = drawRectangle(s.doc, s.id, [0, 0], [40, 30]);
  return extrudeSketch(rect.doc, s.id, 10).doc;
}

test("hand-worked: an extrude's sketch is hidden, drawn again by its eye in the same place, and drawn while edited", () => {
  const d = part();
  // Extrude 1 as Design records it: Sketch 1's eye shut, so it is no longer drawn on the floor (Ben's Fusion screenshot).
  const used = usedSketchHidden(d, "sketch-2");
  assert.deepEqual(used.hidden, ["sketch-2"]);
  assert.equal(sketchHidden(used, "sketch-2"), true);
  assert.deepEqual(sketchDrawings(d, null).length, 1, "before: Sketch 1 drawn");
  assert.deepEqual(sketchDrawings(used, null), [], "after: nothing drawn");
  // Its eye opened: drawn again exactly as before (the same plane and the same four lines of the 40 × 30 rectangle).
  const back = hideRow(used, "sketch-2", false);
  assert.equal(Object.hasOwn(back, "hidden"), false, "the list goes with its last id");
  assert.deepEqual(sketchDrawings(back, null), sketchDrawings(d, null));
  assert.equal(sketchDrawings(back, null)[0].lines.length, 4);
  // Edited while hidden: drawn (with its grid and points) as Fusion shows a hidden sketch while it is edited.
  const edited = sketchDrawings(used, { tool: startTool("line", "sketch-2"), grid: 1, pointer: null });
  assert.equal(edited.length, 1);
  assert.ok(edited[0].editing, "the edited sketch is drawn being edited");
  // Nothing but a sketch item is touched; an id that is no sketch gives the design back.
  assert.equal(usedSketchHidden(d, "feature-1"), d);
  assert.equal(usedSketchHidden(d, "sketch-99"), d);
  // Hiding a sketch takes nothing from its bodies: both still drawn and offered.
  assert.deepEqual(shownBodyRefs(used, new Set()).length, 2);
  for (const doc of [used, back]) assert.deepEqual(reopen(doc), doc);
});

test("hand-worked: the lists in their order, each eye's undo naming, folders over rows, planes hidden at first", () => {
  const d = part();
  // Everything shows except the planes (Fusion's), and every eye the browser has is listed with it.
  assert.deepEqual(eyes(d), {
    sketches: [false, false],
    "sketches/sketch-2": [false, false],
    bodies: [false, false],
    "body-1": [false, false],
    "body-2": [false, false],
    origin: [false, false],
    "origin-xy": [true, false],
    "origin-xz": [true, false],
    "origin-yz": [true, false],
    "origin-x": [false, false],
    "origin-y": [false, false],
    "origin-z": [false, false],
  });
  // Shut in this order: the Bodies folder, the Y axis, Extrude 1's body, Sketch 1. Listed items first in timeline
  // order (Sketch 1 before Extrude 1), then the axes and folders in EYE_ROWS' order (the Y axis before the folder).
  let h = hideRow(d, EYE_FOLDERS.bodies, true);
  h = hideRow(h, "origin-y", true);
  h = hideRow(h, "feature-11", true);
  h = hideRow(h, "sketch-2", true);
  assert.deepEqual(h.hidden, ["sketch-2", "feature-11", "origin-y", "folder-bodies"]);
  // The folder shut hides both bodies, whatever their own eyes say: Body 1's is open, but it is not drawn or picked.
  assert.deepEqual([bodyHidden(h, "feature-1"), bodyHidden(h, "feature-11")], [true, true]);
  assert.deepEqual(shownBodyRefs(h, new Set()), []);
  assert.equal(rowReference("body-1", h), null);
  assert.deepEqual(eyes(h)["body-1"], [false, true], "Body 1's own eye open, its folder's shut");
  // The folder opened again: Body 1 back, Body 2 still hidden by its own eye.
  const open = hideRow(h, EYE_FOLDERS.bodies, false);
  assert.deepEqual([bodyHidden(open, "feature-1"), bodyHidden(open, "feature-11")], [false, true]);
  // The origin: the Y axis not drawn, X and Z drawn, no plane; the XZ plane shown; the Origin folder hides all of it.
  const axes = (doc: DesignDocument) => ["origin-x", "origin-y", "origin-z", "origin-xy", "origin-xz", "origin-yz"].map((id) => originDrawn(doc, id));
  assert.deepEqual(axes(h), [true, false, true, false, false, false]);
  const xz = hideRow(h, "origin-xz", false);
  assert.deepEqual(xz.shownPlanes, ["origin-xz"]);
  assert.deepEqual(axes(xz), [true, false, true, false, true, false]);
  const yz = hideRow(xz, "origin-yz", false);
  const xy = hideRow(yz, "origin-xy", false);
  assert.deepEqual(xy.shownPlanes, ["origin-xy", "origin-xz", "origin-yz"], "in ORIGIN_PLANES' order, whatever order they were shown in");
  const shut = hideRow(xz, EYE_FOLDERS.origin, true);
  assert.deepEqual(axes(shut), [false, false, false, false, false, false]);
  assert.deepEqual(shut.shownPlanes, ["origin-xz"], "the plane's own eye is kept for when the folder opens");
  assert.deepEqual(axes(hideRow(shut, EYE_FOLDERS.origin, false)), [true, false, true, false, true, false]);
  // A plane hidden again: the list goes with it.
  assert.equal(Object.hasOwn(hideRow(xz, "origin-xz", true), "shownPlanes"), false);
  // The Sketches folder hides Sketch 1 with its own eye open.
  const sketches = hideRow(d, EYE_FOLDERS.sketches, true);
  assert.equal(sketchHidden(sketches, "sketch-2"), true);
  assert.deepEqual(sketchDrawings(sketches, null), []);
  // Shutting what is shut, or opening what is open, gives the same document back (no undo step).
  assert.equal(hideRow(h, "origin-y", true), h);
  assert.equal(hideRow(d, "sketch-2", false), d);
  assert.equal(hideRow(d, "origin-xy", true), d);
  assert.equal(hideRow(xz, "origin-xz", false), xz);
  for (const doc of [h, open, xz, xy, shut, sketches]) assert.deepEqual(reopen(doc), doc);
});

test("each row's eye is the id its eye shuts; rows without one have none; a Move has no body of its own to hide", () => {
  const d = part();
  const ids = Object.keys(eyes(d)).map((n) => [n, eyeId(d, n)]);
  assert.deepEqual(ids, [
    ["sketches", "folder-sketches"],
    ["sketches/sketch-2", "sketch-2"],
    ["bodies", "folder-bodies"],
    ["body-1", "feature-1"],
    ["body-2", "feature-11"],
    ["origin", "folder-origin"],
    ["origin-xy", "origin-xy"],
    ["origin-xz", "origin-xz"],
    ["origin-yz", "origin-yz"],
    ["origin-x", "origin-x"],
    ["origin-y", "origin-y"],
    ["origin-z", "origin-z"],
  ]);
  for (const node of ["timeline", "profiles", "feature-1", "sketch-2", "body-9", "origin-w"]) assert.equal(eyeId(d, node), null, node);
  assert.throws(() => hideRow(d, "feature-99", true), { message: "there is no item feature-99 in the timeline" });
  assert.throws(() => hideRow(d, "origin-w", true), { message: "there is no item origin-w in the timeline" });
  // A body through hideRow is hideBody's.
  assert.deepEqual(hideRow(d, "feature-1", true), hideBody(d, "feature-1", true));
});

test("deleting a hidden sketch takes it out of the list; the axes and folders stay", () => {
  const h = hideRow(hideRow(usedSketchHidden(part(), "sketch-2"), "origin-z", true), EYE_FOLDERS.sketches, true);
  assert.deepEqual(h.hidden, ["sketch-2", "origin-z", "folder-sketches"]);
  const gone = deleteItem(h, "sketch-2");
  assert.deepEqual(gone.hidden, ["origin-z", "folder-sketches"]);
  assert.deepEqual(reopen(gone), gone);
});

test("the reader takes every eye's id, and refuses each way of breaking the lists, saying how", () => {
  const d = part();
  const read = (extra: object) => readDesignDocument({ ...structuredClone(d), ...extra });
  // Every id the eyes list reads back.
  const all = { hidden: ["sketch-2", "feature-11", "origin-x", "origin-y", "origin-z", "folder-bodies", "folder-sketches", "folder-origin"], shownPlanes: ["origin-xy", "origin-xz", "origin-yz"] };
  assert.deepEqual({ hidden: read(all).hidden, shownPlanes: read(all).shownPlanes }, all);
  const NOT_HIDEABLE = (id: string) => ({ message: `Design data hides ${id}, which is not a solid feature or sketch in the timeline, an origin axis or a folder` });
  // A plane goes in shownPlanes (hidden at first), not hidden; a profile, the Timeline and Profiles folders have no eye.
  assert.throws(() => read({ hidden: ["origin-xy"] }), NOT_HIDEABLE("origin-xy"));
  assert.throws(() => read({ hidden: ["folder-timeline"] }), NOT_HIDEABLE("folder-timeline"));
  assert.throws(() => read({ hidden: ["folder-profiles"] }), NOT_HIDEABLE("folder-profiles"));
  assert.throws(() => read({ hidden: ["origin-x", "origin-x"] }), { message: "Design data hides origin-x twice" });
  assert.throws(() => read({ hidden: ["sketch-2", "sketch-2"] }), { message: "Design data hides sketch-2 twice" });
  const NOT_PLANES = { message: "Design data's shown planes are not a list of origin planes (left out when none shows)" };
  for (const bad of [[], "origin-xy", { 0: "origin-xy" }, null]) assert.throws(() => read({ shownPlanes: bad }), NOT_PLANES, JSON.stringify(bad));
  assert.throws(() => read({ shownPlanes: ["origin-x"] }), { message: "Design data shows origin-x, which is not an origin plane" });
  assert.throws(() => read({ shownPlanes: ["XY"] }), { message: "Design data shows XY, which is not an origin plane" });
  assert.throws(() => read({ shownPlanes: [7] }), { message: "Design data shows 7, which is not an origin plane" });
  assert.throws(() => read({ shownPlanes: ["origin-yz", "origin-yz"] }), { message: "Design data shows origin-yz twice" });
});

test("seeded: 300 random eye presses against a model of what each row's own eye and its folder say", () => {
  // The model: a set of shut eyes (planes start shut), and drawn = own open and folder open. Same seed, same presses.
  const rows = ["sketches/sketch-2", "body-1", "body-2", "origin-xy", "origin-xz", "origin-yz", "origin-x", "origin-y", "origin-z", "sketches", "bodies", "origin"];
  const folderOf: Record<string, string> = { "sketches/sketch-2": "sketches", "body-1": "bodies", "body-2": "bodies" };
  for (const r of rows) if (r.startsWith("origin-")) folderOf[r] = "origin";
  for (const seed of [1, 2, 3]) {
    const random = rng(seed);
    let doc = part();
    const shut = new Set(["origin-xy", "origin-xz", "origin-yz"]);
    for (let n = 0; n < 100; n++) {
      const row = rows[Math.floor(random() * rows.length)];
      const hide = !shut.has(row);
      doc = hideRow(doc, eyeId(doc, row)!, hide);
      if (hide) shut.add(row);
      else shut.delete(row);
      const drawn = (r: string) => !shut.has(r) && !(folderOf[r] && shut.has(folderOf[r]));
      const got = eyes(doc);
      for (const r of rows) assert.deepEqual(got[r], [shut.has(r), folderOf[r] !== undefined && shut.has(folderOf[r])], `seed ${seed} press ${n} (${row}): ${r}'s eye`);
      assert.equal(sketchDrawings(doc, null).length, drawn("sketches/sketch-2") ? 1 : 0, `seed ${seed} press ${n}: Sketch 1 drawn`);
      assert.deepEqual([bodyHidden(doc, "feature-1"), bodyHidden(doc, "feature-11")], [!drawn("body-1"), !drawn("body-2")], `seed ${seed} press ${n}: bodies`);
      for (const r of rows.filter((x) => x.startsWith("origin-"))) assert.equal(originDrawn(doc, r), drawn(r), `seed ${seed} press ${n}: ${r} drawn`);
      if (n % 10 === 0) assert.deepEqual(reopen(doc), doc, `seed ${seed} press ${n}: saved and opened`);
    }
  }
});

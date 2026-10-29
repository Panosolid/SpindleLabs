// The Move panel as two tools (Ben, 2026-10-29: Move and Rotate separate):
// which rows each shows, worked out by hand for every case, in a real DOM
// (happy-dom). Move shows the distances and Snap; Rotate the angles and the
// pivot; a row the tool doesn't show comes up as soon as it holds
// something, so nothing a Move does is ever out of sight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { movePanel, type MoveShow } from "../src/move-panel.ts";
import { NO_MOVE, type MoveValues } from "../src/move.ts";

const { Window } = await import("happy-dom");

function setup() {
  const window = new Window({ width: 1280, height: 800 });
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const panel = movePanel(slot, { typed() {}, ok() {}, cancel() {}, centre() {}, snap() {} });
  const shownRows = () => ["move-distance", "move-angle", "move-pivot-fold", "move-snap"].filter((id) => !(doc.getElementById(id) as HTMLElement).hidden);
  const text = (id: string) => doc.getElementById(id)!.textContent;
  return { doc, panel, shownRows, text };
}

const show = (o: Partial<MoveShow> & { values?: Partial<MoveValues> }): MoveShow => ({ id: null, kind: "move", name: "Move", bodies: ["Box 1"], ...o, values: { ...NO_MOVE, ...o.values } });

test("hand-worked: what Move and Rotate show, new and edited, and the note under them", () => {
  const { doc, panel, shownRows, text } = setup();
  // A new Move: distances and Snap only; the note says what OK does with them; the X distance box has the focus.
  panel.show(show({}));
  assert.deepEqual(shownRows(), ["move-distance", "move-snap"]);
  assert.equal(text("move-note"), "Moved along X, Y and Z.");
  assert.equal(panel.kind, "move");
  assert.equal(doc.activeElement?.id, "move-x");
  assert.equal(doc.getElementById("move-panel")!.dataset.kind, "move");
  // A new Rotate: angles and the pivot, no Snap; its title is the tool's name; the X angle box has the focus.
  panel.show(show({ kind: "rotate", name: "Rotate" }));
  assert.deepEqual(shownRows(), ["move-angle", "move-pivot-fold"]);
  assert.equal(text("move-note"), "Turned about X, then Y, then Z through the pivot.");
  assert.equal(text("move-title"), "Rotate");
  assert.equal(panel.kind, "rotate");
  assert.equal(doc.activeElement?.id, "move-turnX");
  assert.equal(doc.getElementById("move-panel")!.getAttribute("aria-label"), "Rotate");
  // An old file's Move that shifts and turns, opened by Move: the angles and pivot come up too, and the note says both.
  panel.show(show({ id: "feature-3", name: "Move 1", values: { x: 10, turnZ: 90 } }));
  assert.deepEqual(shownRows(), ["move-distance", "move-angle", "move-pivot-fold", "move-snap"]);
  assert.equal(text("move-note"), "Turned about X, then Y, then Z through the pivot, then moved.");
  assert.equal(text("move-title"), "Edit Move 1");
  // A Rotate that somehow holds a shift (a file edited by hand) shows the distances as well: nothing hidden that acts.
  panel.show(show({ id: "feature-4", kind: "rotate", name: "Rotate 1", values: { turnX: 45, z: -0.5 } }));
  assert.deepEqual(shownRows(), ["move-distance", "move-angle", "move-pivot-fold"]);
  // The pivot alone doesn't count: a Move whose pivot is set but turns nothing hides the angles (a pivot only matters to a turn).
  panel.show(show({ values: { pivotX: 20, pivotY: 15, pivotZ: 10 } }));
  assert.deepEqual(shownRows(), ["move-distance", "move-snap"]);
});

test("a snap that turns shows the angles it set, and one back to no turn hides them again", () => {
  const { panel, shownRows } = setup();
  panel.show(show({}));
  panel.setValues({ ...NO_MOVE, x: 5, turnY: 90 });
  assert.deepEqual(shownRows(), ["move-distance", "move-angle", "move-pivot-fold", "move-snap"]);
  panel.setValues({ ...NO_MOVE, x: 5 });
  assert.deepEqual(shownRows(), ["move-distance", "move-snap"]);
  // The smallest turn still counts (1e-9° is not 0): it is never hidden.
  panel.setValues({ ...NO_MOVE, turnZ: 1e-9 });
  assert.ok(shownRows().includes("move-angle"));
});

test("hand-worked: the box a handle's drag changes glows while the drag lasts, and only that box (Ben, 2026-10-28)", () => {
  const { doc, panel } = setup();
  const glowing = () => ["x", "y", "z", "turnX", "turnY", "turnZ", "pivotX", "pivotY", "pivotZ"].filter((k) => doc.getElementById(`move-${k}`)!.classList.contains("move-panel-dragged"));
  panel.show(show({}));
  assert.deepEqual(glowing(), [], "nothing glows before a drag");
  // The X arrow held: X alone glows; a drag of the Z grip after it moves the glow to Z; the drag ending puts it out.
  panel.dragging("x");
  assert.deepEqual(glowing(), ["x"]);
  panel.dragging("turnZ");
  assert.deepEqual(glowing(), ["turnZ"]);
  panel.dragging(null);
  assert.deepEqual(glowing(), []);
  // A drag cut short by the panel opening again (Cancel, then Rotate) leaves no glow behind.
  panel.dragging("y");
  panel.show(show({ kind: "rotate", name: "Rotate" }));
  assert.deepEqual(glowing(), []);
});

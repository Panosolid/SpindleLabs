// Move (step 35e2): the data, worked by hand. A Move holds the bodies it
// moves as `dependsOn` and its numbers as MOVE_PARAMS; these check what it
// asks the kernel for, its words, the changes that make and edit one with
// every refusal, how the timeline treats it (it makes no body, it is
// greyed with a suppressed body, it can't go before what it moves), and
// the file checks. Its rebuild on the real kernel is checked in
// packages/testing/journeys/move.journey.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Feature } from "@fission/core";
import { builds, buildingItems, greyedBy, insertPreset, partDocument, partFeature, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { changedMove, insertMove, moveKindOf, moveMotions, movedSpec, moveSummary, moveValues, NO_MOVE, type MoveValues } from "../src/move.ts";
import { bodyFeatures } from "../src/browser.ts";
import { deleteItem, hideBody, moveMarker, reorderItem, suppressItem } from "../src/timeline-edits.ts";
import { canEditFeature } from "../src/feature-edit.ts";
import { itemMenu } from "../src/timeline-bar.ts";
import { openAction } from "../src/timeline-menu.ts";

const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });
/** Box 1 (40 × 30 × 20) and Cylinder 1 (⌀40 × 20): feature-1 and feature-2, the counter at 3. */
const twoBodies = (): DesignDocument => insertPreset(partDocument("box", 40, 30, 20), "cylinder", 40, 40, 20).doc;
const item = (d: DesignDocument, id: string): Feature => d.timeline.features.find((f) => f.id === id)!;

test("what a Move asks the kernel for, by hand", () => {
  // Nothing turned or shifted: nothing asked.
  assert.deepEqual(moveMotions(NO_MOVE), []);
  // A shift alone: one move.
  assert.deepEqual(moveMotions(v({ x: 10, z: -2.5 })), [{ move: [10, 0, -2.5] }]);
  // 90° about Z through (1, 2, 3): one turn of π/2 rad, the pivot as given; then the shift.
  assert.deepEqual(moveMotions(v({ turnZ: 90, pivotX: 1, pivotY: 2, pivotZ: 3, y: 5 })), [{ turn: { pivot: [1, 2, 3], axis: [0, 0, 1], angle: Math.PI / 2 } }, { move: [0, 5, 0] }]);
  // All three turns, in the order X, Y, Z: 180° = π, −45° = −π/4, 30° = π/6.
  assert.deepEqual(
    moveMotions(v({ turnX: 180, turnY: -45, turnZ: 30 })).map((m) => ("turn" in m ? [m.turn.axis, m.turn.angle] : null)),
    [[[1, 0, 0], Math.PI], [[0, 1, 0], -Math.PI / 4], [[0, 0, 1], Math.PI / 6]],
  );
});

test("a moved spec wraps a shape once and grows its list after that", () => {
  const box = { box: { width: 40, depth: 30, height: 20 } };
  assert.equal(movedSpec(box, []), box, "nothing to do: the same spec");
  const once = movedSpec(box, [{ move: [1, 0, 0] }]);
  assert.deepEqual(once, { moved: { body: box, moves: [{ move: [1, 0, 0] }] } });
  // Never a moved spec inside a moved spec: the kernel refuses that.
  assert.deepEqual(movedSpec(once, [{ move: [0, 2, 0] }]), { moved: { body: box, moves: [{ move: [1, 0, 0] }, { move: [0, 2, 0] }] } });
});

test("a Move's words", () => {
  assert.equal(moveSummary(["Box 1"], v({ x: 10 })), "Move Box 1 by (10, 0, 0) mm");
  assert.equal(moveSummary(["Box 1"], v({ turnZ: 90 })), "Move Box 1 turned 90° about Z");
  assert.equal(moveSummary(["Box 1", "Cylinder 1"], v({ x: 1, turnX: 90, turnZ: -30 })), "Move 2 bodies by (1, 0, 0) mm, turned 90° about X, then -30° about Z");
  assert.equal(moveSummary(["Box 1"], NO_MOVE), "Move Box 1 (not moved yet)");
});

test("insertMove puts a Move of the picked bodies in at the marker, named Move 1, Move 2…", () => {
  const d = twoBodies();
  const a = insertMove(d, ["feature-2", "feature-1"], v({ x: 10 }));
  assert.equal(a.id, "feature-3");
  const m = item(a.doc, "feature-3");
  assert.deepEqual(m.dependsOn, ["feature-2", "feature-1"], "the bodies, in the order picked");
  assert.equal(m.provenance.self.label, "Move 1");
  assert.deepEqual(m.provenance.from.map((r) => r.label), ["Cylinder 1", "Box 1"]);
  assert.equal(m.intent.summary, "Move 2 bodies by (10, 0, 0) mm");
  assert.deepEqual(moveValues(m), v({ x: 10 }));
  assert.equal(a.doc.nextId, 4);
  const b = insertMove(a.doc, ["feature-1"], v({ y: 1 }));
  assert.equal(item(b.doc, b.id).provenance.self.label, "Move 2");
  // At the marker: with it after Box 1, the Move goes second and the marker onto it.
  const at = insertMove(moveMarker(d, "feature-1"), ["feature-1"], v({ z: 1 }));
  assert.deepEqual(at.doc.timeline.features.map((f) => f.id), ["feature-1", "feature-3", "feature-2"]);
  assert.equal(at.doc.timeline.marker, "feature-3");
});

test("insertMove's refusals", () => {
  const d = twoBodies();
  assert.throws(() => insertMove(d, [], NO_MOVE), { message: "pick at least one body to move" });
  assert.throws(() => insertMove(d, ["feature-1", "feature-1"], NO_MOVE), { message: "feature-1 is picked twice" });
  assert.throws(() => insertMove(d, ["feature-9"], NO_MOVE), { message: "feature-9 is not a body in the design" });
  const moved = insertMove(d, ["feature-1"], NO_MOVE).doc;
  assert.throws(() => insertMove(moved, ["feature-3"], NO_MOVE), { message: "feature-3 is not a body in the design" }, "a Move is no body");
  assert.throws(() => insertMove(moveMarker(d, "feature-1"), ["feature-2"], NO_MOVE), { message: "Cylinder 1 comes after the rollback marker, so a move put in at the marker can't move it" });
  assert.throws(() => insertMove(d, ["feature-1"], v({ x: NaN })), { message: "a move needs x as a number, not NaN" });
  assert.throws(() => insertMove(d, ["feature-1"], v({ turnY: Infinity })), { message: "a move needs turnY as a number, not Infinity" });
});

test("changedMove edits the numbers in place, keeping id, place, flags and bodies", () => {
  const { doc, id } = insertMove(twoBodies(), ["feature-1"], v({ x: 10 }));
  const s = suppressItem(doc, id, true);
  const c = changedMove(s, id, v({ x: 25, turnZ: 90 }));
  const m = item(c, id);
  assert.deepEqual(moveValues(m), v({ x: 25, turnZ: 90 }));
  assert.equal(m.intent.summary, "Move Box 1 by (25, 0, 0) mm, turned 90° about Z");
  assert.equal(m.suppressed, true);
  assert.deepEqual(m.dependsOn, ["feature-1"]);
  assert.deepEqual(c.timeline.features.map((f) => f.id), s.timeline.features.map((f) => f.id));
  assert.equal(changedMove(c, id, v({ x: 25, turnZ: 90 })), c, "the same numbers: the same document, no undo step");
  assert.throws(() => changedMove(c, "feature-1", NO_MOVE), { message: "there is no move feature-1 in the design" });
});

test("the timeline treats a Move as an item that makes no body", () => {
  const { doc, id } = insertMove(twoBodies(), ["feature-1"], v({ x: 10 }));
  assert.deepEqual(bodyFeatures(doc).map((f) => f.id), ["feature-1", "feature-2"], "two bodies, not three");
  assert.equal(partFeature(doc)?.id, "feature-2", "the part is the last body, not the Move");
  assert.equal(canEditFeature(item(doc, id)), false);
  // Edit feature is on (35e2b): it opens the Move panel on the Move's numbers, and so does a double-click.
  assert.equal(itemMenu(doc, id).find((e) => e.action === "edit")?.off, null);
  assert.equal(openAction(doc, id), "edit");
  assert.throws(() => hideBody(doc, id, true), { message: "Move 1 is a move, which has no body of its own to hide" });
  // It builds while its body does; greyed by it when it is suppressed (Q3).
  assert.equal(builds(doc, item(doc, id)), true);
  const off = suppressItem(doc, "feature-1", true);
  assert.equal(greyedBy(off, item(off, id)), "feature-1");
  assert.equal(buildingItems(off).has(item(off, id)), false);
  // It can't go before the body it moves.
  assert.deepEqual(reorderItem(doc, id, 0), { refused: "before-dependency", message: "Move 1 can't go before Box 1: it is a move of Box 1" });
  // Nor the body after it.
  assert.deepEqual(reorderItem(doc, "feature-1", 2), { refused: "after-dependent", message: "Box 1 can't go after Move 1: Move 1 is a move of it" });
  // Deleting the Move leaves the bodies as they were.
  assert.deepEqual(deleteItem(doc, id).timeline.features.map((f) => f.id), ["feature-1", "feature-2"]);
});

/** A one-box file with a Move whose intent or bodies are `move`'s. */
const file = (move: Partial<Feature>, params: Record<string, unknown> = { ...NO_MOVE, x: 5 }) => ({
  version: 3,
  nextId: 4,
  profiles: [],
  sketches: [],
  timeline: {
    features: [
      { id: "feature-1", intent: { type: "box", parameters: { width: 40, depth: 30, height: 20 }, summary: "Box: 40 × 30 × 20 mm" }, provenance: { self: { workspace: "design", id: "feature-1", label: "Box 1" }, from: [] }, dependsOn: [], suppressed: false },
      { id: "feature-3", intent: { type: "move", parameters: params, summary: "Move Box 1 by (5, 0, 0) mm" }, provenance: { self: { workspace: "design", id: "feature-3", label: "Move 1" }, from: [] }, dependsOn: ["feature-1"], suppressed: false, ...move },
    ],
  },
});

test("a Move read from a file is checked: its numbers and its bodies", () => {
  assert.deepEqual(moveValues(readDesignDocument(file({})).timeline.features[1]), v({ x: 5 }));
  assert.throws(() => readDesignDocument(file({}, { ...NO_MOVE, x: "5" })), { message: "Design move feature-3: x 5 is not a number" });
  const { turnZ: _, ...noTurn } = NO_MOVE;
  assert.throws(() => readDesignDocument(file({}, noTurn)), { message: "Design move feature-3: turnZ undefined is not a number" });
  assert.throws(() => readDesignDocument(file({}, { ...NO_MOVE, scale: 2 })), { message: 'Design move feature-3 has a number "scale" a move doesn\'t have' });
  assert.throws(() => readDesignDocument(file({ dependsOn: [] })), { message: "Design move feature-3 moves no body" });
  assert.throws(() => readDesignDocument(file({ dependsOn: ["feature-1", "feature-1"] })), { message: "Design move feature-3 moves feature-1 twice" });
  // A body deleted since reads (the rebuild fails the move naming it), but only under the counter, so no new body takes its id.
  assert.deepEqual(readDesignDocument(file({ dependsOn: ["feature-2"] })).timeline.features[1].dependsOn, ["feature-2"]);
  assert.throws(() => readDesignDocument(file({ dependsOn: ["feature-9"] })), { message: "Design data's nextId 4 is not above feature-9, so a new id could repeat it" });
  assert.throws(() => readDesignDocument(file({ dependsOn: ["__proto__"] })), { message: "Design move feature-3 moves __proto__, which is not a body made before it in the timeline" });
  assert.throws(() => readDesignDocument(file({ dependsOn: [7] })), { message: "Design move feature-3 moves 7, which is not a body made before it in the timeline" });
  assert.throws(() => readDesignDocument(file({ dependsOn: ["feature-3"] })), { message: "Design move feature-3 moves feature-3, which is not a body made before it in the timeline" });
  // A body after it: the same refusal.
  const later = file({});
  later.timeline.features.reverse();
  assert.throws(() => readDesignDocument(later), { message: "Design move feature-3 moves feature-1, which is not a body made before it in the timeline" });
});

test("Move and Rotate, two tools making one kind of item: names, words and which tool opens each, by hand", () => {
  // Rotate's words: "Rotate", and "(not turned yet)" while it does nothing.
  assert.equal(moveSummary(["Box 1"], NO_MOVE, "Rotate"), "Rotate Box 1 (not turned yet)");
  assert.equal(moveSummary(["Box 1"], v({ turnZ: 90 }), "Rotate"), "Rotate Box 1 turned 90° about Z");
  assert.equal(moveSummary(["Box 1", "Cylinder 1"], NO_MOVE), "Move 2 bodies (not moved yet)");
  // Names counted per tool: Move 1, Rotate 1, Rotate 2, then Move 2 (the Rotates don't count towards the Moves).
  let d = twoBodies();
  const m1 = insertMove(d, ["feature-1"], v({ x: 10 }));
  const r1 = insertMove(m1.doc, ["feature-1"], v({ turnZ: 90 }), "rotate");
  const r2 = insertMove(r1.doc, ["feature-2"], NO_MOVE, "rotate");
  const m2 = insertMove(r2.doc, ["feature-2"], v({ y: -3 }));
  d = m2.doc;
  assert.deepEqual([m1.id, r1.id, r2.id, m2.id].map((id) => item(d, id).provenance.self.label), ["Move 1", "Rotate 1", "Rotate 2", "Move 2"]);
  assert.equal(item(d, r2.id).intent.summary, "Rotate Cylinder 1 (not turned yet)");
  // Which tool opens each: a shift opens Move; a turn alone opens Rotate; a Rotate that does nothing yet stays Rotate,
  // a Move that does nothing stays Move; an old file's Move that shifts and turns opens Move (its angles shown too).
  assert.deepEqual([m1.id, r1.id, r2.id, m2.id].map((id) => moveKindOf(item(d, id))), ["move", "rotate", "rotate", "move"]);
  assert.equal(moveKindOf(item(insertMove(twoBodies(), ["feature-1"], NO_MOVE).doc, "feature-3")), "move");
  assert.equal(moveKindOf(item(insertMove(twoBodies(), ["feature-1"], v({ x: 1, turnX: 5 }), "rotate").doc, "feature-3")), "move");
  // A turn alone made by Move (as old files have) opens Rotate: what it does is turn.
  assert.equal(moveKindOf(item(insertMove(twoBodies(), ["feature-1"], v({ turnY: -30 })).doc, "feature-3")), "rotate");
  // Edited, each keeps its word: Rotate 1 changed to 45° still says Rotate; Move 1 changed still says Move.
  assert.equal(item(changedMove(d, r1.id, v({ turnZ: 45 })), r1.id).intent.summary, "Rotate Box 1 turned 45° about Z");
  assert.equal(item(changedMove(d, m1.id, v({ x: 20 })), m1.id).intent.summary, "Move Box 1 by (20, 0, 0) mm");
  // A file with a Rotate reads back as it was written.
  assert.deepEqual(readDesignDocument(JSON.parse(JSON.stringify(d))), d);
});

// Regression (Move/timeline bug hunt 2026-11-01): with two bodies and Body 1
// selected, the Feature and Body sections described Body 1 but the
// Parameters' size boxes showed, and changed, the last body. The body the
// boxes describe is now `panelPart`: the selected body when it builds, else
// the last body (`partFeature`), as before; and `withPartAt` changes that
// body, not the last. Every expected value here is read off the design by
// hand (which feature id is which body); the journey
// (packages/testing/journeys/parameters-follow.journey.ts) checks it in the
// real panel on the kernel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertPreset, partFeature, withPart, withPartAt, type DesignDocument } from "../src/document.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { bodyReference, profileReference } from "../src/references.ts";
import { panelPart } from "../src/selection.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { moveMarker, suppressItem } from "../src/timeline-edits.ts";

const empty = (): DesignDocument => ({ version: 7, nextId: 1, profiles: [], sketches: [], timeline: { features: [] }, bodies: [], nextBody: 1 }) as DesignDocument;

/** Box 1 (feature-1) then Box 2 (feature-2), both 40 × 30 × 20. */
function twoBoxes(): DesignDocument {
  const one = insertPreset(empty(), "box", 40, 30, 20);
  return insertPreset(one.doc, "box", 40, 30, 20).doc;
}
const ids = (doc: DesignDocument) => doc.timeline.features.map((f) => f.id);

test("hand case: the two boxes are feature-1 and feature-2, the last one the part", () => {
  const doc = twoBoxes();
  // Two presets from an empty design: ids from the counter, 1 then 2 (a box takes no profile id).
  assert.deepEqual(ids(doc), ["feature-1", "feature-2"]);
  assert.equal(partFeature(doc)?.id, "feature-2");
});

test("nothing selected: the boxes are the last body's, as before", () => {
  assert.equal(panelPart([], null, twoBoxes())?.id, "feature-2");
});

test("Body 1 selected: the boxes are Body 1's", () => {
  assert.equal(panelPart([bodyReference("body:feature-1")], null, twoBoxes())?.id, "feature-1");
});

test("two selected: the newest picked, as the Feature section", () => {
  const doc = twoBoxes();
  assert.equal(panelPart([bodyReference("body:feature-2"), bodyReference("body:feature-1")], null, doc)?.id, "feature-1");
  assert.equal(panelPart([bodyReference("body:feature-1"), bodyReference("body:feature-2")], null, doc)?.id, "feature-2");
});

test("a selected body that does not build (suppressed, after the marker) leaves the boxes on the last body that does", () => {
  const doc = twoBoxes();
  // Box 2 suppressed: the last body that builds is Box 1, whatever names Box 2.
  const off = suppressItem(doc, "feature-2", true);
  assert.equal(panelPart([bodyReference("body:feature-2")], null, off)?.id, "feature-1");
  // The marker after Box 1: Box 2 is rolled back, the same.
  const back = moveMarker(doc, "feature-1");
  assert.equal(panelPart([bodyReference("body:feature-2")], null, back)?.id, "feature-1");
});

test("a selected sketch outline makes no body: the boxes stay on the last body", () => {
  let doc = twoBoxes();
  const s = addSketch(doc);
  doc = drawRectangle(s.doc, s.id, [100, 0], [110, 10]).doc;
  assert.equal(panelPart([profileReference(s.id)], null, doc)?.id, "feature-2");
});

test("an extruded sketch selected is the boxes' body (its distance in the height box)", () => {
  let doc = empty();
  const s = addSketch(doc);
  doc = drawRectangle(s.doc, s.id, [100, 0], [110, 10]).doc;
  const e = extrudeSketch(doc, s.id, 30);
  doc = insertPreset(e.doc, "box", 40, 30, 20).doc;
  assert.equal(panelPart([bodyReference(`body:${e.id}`)], null, doc)?.id, e.id);
});

test("withPartAt Box 1: Box 1 changes in place, Box 2 stays; withPart still changes the last", () => {
  const doc = twoBoxes();
  const one = doc.timeline.features[0];
  const made = withPartAt(doc, one, "box", 50, 30, 20);
  assert.equal(made.id, "feature-1");
  assert.deepEqual(made.doc.timeline.features.map((f) => f.intent.parameters.width), [50, 40]);
  // The old path, for the assistant's set_part: the last body.
  assert.deepEqual(withPart(doc, "box", 50, 30, 20).timeline.features.map((f) => f.intent.parameters.width), [40, 50]);
});

test("withPartAt an extruded sketch: a new box is put in, never replacing the extrude", () => {
  let doc = empty();
  const s = addSketch(doc);
  doc = drawRectangle(s.doc, s.id, [100, 0], [110, 10]).doc;
  const e = extrudeSketch(doc, s.id, 30);
  doc = insertPreset(e.doc, "box", 40, 30, 20).doc;
  const before = ids(doc);
  const made = withPartAt(doc, doc.timeline.features.find((f) => f.id === e.id)!, "box", 10, 10, 10);
  // The new box takes the next id from the counter, never the extrude's, and goes in at the marker (the end).
  assert.notEqual(made.id, e.id);
  assert.deepEqual(ids(made.doc), [...before, made.id]);
  assert.equal(made.doc.timeline.features.find((f) => f.id === e.id)!.intent.parameters.distance, 30, "the extrude is untouched");
});

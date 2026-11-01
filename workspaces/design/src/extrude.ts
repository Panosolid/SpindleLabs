// Extrude a sketch (step 21d, docs/document-model.md sections 3 and 6): a
// new extrude feature after the sketch, depending on it, whose intent is
// `{ sketch, distance }`. The outline is never stored: the kernel finds it
// from the sketch's lines every time the feature is built, so an edit to
// the sketch rebuilds the solid (a live link). A sketch that no longer
// closes leaves the extrude its last shape with a warning (the owner's
// rule, step 24d2, rebuild.ts), or fails it with the kernel's reason when
// it never closed.
//
// Every extrude is a new body ("New body", step 24d1) until booleans join
// them: it is added to the timeline at the marker and replaces nothing.

import type { BodySpec, BodyView, ExtrudeArrow, Feature, KernelCalls } from "@fission/core";
import { counted, freshName, insertAt, insertItem, isSketchExtrude, numberBodies, takenNames, partFeature, shown, specOf, type DesignDocument } from "./document.ts";
import { extrudeSpec, type CurveIds } from "./rebuild.ts";
import { sketchItem } from "./sketch.ts";
import { lengthRefused } from "./typed-entry.ts";

/**
 * How far a new extrude goes until the user drags the arrow or types a
 * distance (mm): 0 (Ben, 2026-10-28: "instead of defaulting to 10mm just
 * start at extrude of 0"), so nothing is built until the user says how far;
 * the arrow stands on the profile, ready to drag.
 */
export const DEFAULT_DISTANCE = 0;

/** What the Extrude panel says when every sketch is after the rollback marker or suppressed, so none is offered. */
export const NO_USABLE_SKETCH = "No sketch can be extruded here: each comes after the rollback marker or is suppressed. Move the marker past one, or unsuppress it.";

/** What the Extrude panel says when the design has no sketch at all. */
export const NO_SKETCH = "There is no sketch to extrude yet: draw one with Create sketch.";

/** What it says while no sketch or face is chosen (UX1b: ✕ cleared it, or none was offered first; UX1c: flat faces too). */
export const PICK_PROFILE_STATUS = "Click a closed sketch or a flat face in the view, or a sketch's row in the browser, to extrude it.";

/** Why an extrude command does nothing with a distance of 0 (UX1b: a negative one goes the other way, so only 0 builds nothing). */
export const ZERO_DISTANCE = "Type a distance other than 0 mm: a negative one goes the other way.";

/** What the Extrude panel's OK says at 0 mm, where Extrude starts (Ben, 2026-10-28): what to do next, in plain words. */
export const ZERO_OK = "Drag the arrow or type a distance first: at 0 mm there is nothing to make. A negative distance goes the other way.";

/** The undo step an extrude is recorded as: "Extrude Sketch 1". */
export const extrudeStep = (doc: DesignDocument, sketchId: string) => `Extrude ${sketchItem(doc, sketchId).provenance.self.label}`;

/** The undo step a typed distance is recorded as, merged per box like the other sizes. */
export const DISTANCE_STEP = "Change extrude distance";

const summary = (sketchLabel: string, distance: number, flip = false) => `Extrude ${sketchLabel} by ${distance} mm${flip ? ", flipped" : ""}`;

/** Whether an extrude of a sketch goes the other way from its sketch's plane (step 26c; Fusion's Flip). */
export const isFlipped = (f: Feature): boolean => f.intent.parameters.flip === true;

/**
 * The document with an extrude of this sketch by `distance` mm added: a
 * new feature with the next id, put in at the marker (insertItem), which
 * must be after the sketch, depending on the sketch; every feature already
 * there stays. It is named "Extrude n", n one more than the extrudes of
 * sketches there are, skipping a name any item has (`freshName`, U0e). The kernel judges the
 * distance and the outline when the feature is built. `flip` sends it the
 * other way from the sketch's plane, its start cap still on the plane
 * (step 26c, Fusion's Flip).
 */
export function extrudeSketch(doc: DesignDocument, sketchId: string, distance: number, flip = false): { doc: DesignDocument; id: string } {
  const sketch = sketchItem(doc, sketchId);
  if (!Number.isFinite(distance)) throw new Error(`an extrude needs its distance in mm, not ${shown(distance)}`);
  if (doc.timeline.features.indexOf(sketch) >= insertAt(doc)) throw new Error(`${sketch.provenance.self.label} comes after the rollback marker, so an extrude put in at the marker can't use it`);
  const id = `feature-${doc.nextId}`;
  const label = sketch.provenance.self.label;
  const name = freshName("Extrude", doc.timeline.features.filter(isSketchExtrude).length, takenNames(doc));
  const feature: Feature = {
    id,
    intent: { type: "extrude", parameters: flip ? { sketch: sketchId, distance, flip: true } : { sketch: sketchId, distance }, summary: summary(label, distance, flip) },
    provenance: { self: { workspace: "design", id, label: name }, from: [{ workspace: "design", id: sketchId, label }] },
    dependsOn: [sketchId],
    suppressed: false,
  };
  return { id, doc: numberBodies({ ...doc, nextId: counted(doc.nextId + 1), timeline: insertItem(doc, feature) }) };
}

/** The document with an extrude of a sketch (the part, `partFeature`, unless `id` names another) going `distance` mm instead. */
export function setExtrudeDistance(doc: DesignDocument, distance: number, id?: string): DesignDocument {
  const old = id === undefined ? partFeature(doc) : doc.timeline.features.find((f) => f.id === id);
  if (!old) throw new Error(id === undefined ? "the design has no body to change the distance of" : `there is no feature ${shown(id)} in the design`);
  if (!isSketchExtrude(old)) throw new Error(`${old.intent.summary} is not an extrude of a sketch`);
  // Its sketch may be gone (deleted: the extrude keeps its last shape, 24d2); its summary then names it as the extrude remembers it.
  const sketchId = old.intent.parameters.sketch as string;
  const there = doc.timeline.features.some((f) => f.id === sketchId);
  const sketchLabel = there ? sketchItem(doc, sketchId).provenance.self.label : (old.provenance.from.find((p) => p.id === sketchId)?.label ?? sketchId);
  const feature: Feature = { ...old, intent: { ...old.intent, parameters: { ...old.intent.parameters, distance }, summary: summary(sketchLabel, distance, isFlipped(old)) } };
  return { ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f === old ? feature : f)) } };
}

/**
 * The document with an extrude of a sketch (the part unless `id` names
 * another) flipped (`on`) or not: it goes the other way from its sketch's
 * plane, its start cap staying on the plane (step 26c). `flip` is left out
 * when off, so a file without flips reads as before. The same document
 * back when it already is.
 */
export function setExtrudeFlip(doc: DesignDocument, on: boolean, id?: string): DesignDocument {
  const old = id === undefined ? partFeature(doc) : doc.timeline.features.find((f) => f.id === id);
  if (!old) throw new Error(id === undefined ? "the design has no body to flip" : `there is no feature ${shown(id)} in the design`);
  if (!isSketchExtrude(old)) throw new Error(`${old.intent.summary} is not an extrude of a sketch`);
  if (typeof on !== "boolean") throw new Error(`flipping ${old.provenance.self.label} needs true or false, not ${shown(on)}`);
  if (isFlipped(old) === on) return doc;
  const { flip: _, ...rest } = old.intent.parameters;
  const sketchId = old.intent.parameters.sketch as string;
  const there = doc.timeline.features.some((f) => f.id === sketchId);
  const sketchLabel = there ? sketchItem(doc, sketchId).provenance.self.label : (old.provenance.from.find((p) => p.id === sketchId)?.label ?? sketchId);
  const feature: Feature = { ...old, intent: { ...old.intent, parameters: on ? { ...rest, flip: true } : rest, summary: summary(sketchLabel, old.intent.parameters.distance as number, on) } };
  return { ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f) => (f === old ? feature : f)) } };
}

/**
 * The body a feature builds, as the kernel's BodySpec. An extrude of a
 * sketch asks the kernel for the sketch's outline now (never stored), or
 * uses its kept shape (`extrudeSpec`); every other feature is read from
 * its intent alone (specOf).
 */
export async function featureSpec(kernel: KernelCalls, doc: DesignDocument, feature: Feature): Promise<BodySpec> {
  return (await featureBuild(kernel, doc, feature)).spec;
}

/** `featureSpec` with, for an extrude of a sketch, the ids of the curves its outline came from (the kept shape's while its sketch is lost), as `featureNames` takes them. */
export async function featureBuild(kernel: KernelCalls, doc: DesignDocument, feature: Feature): Promise<{ spec: BodySpec; curves?: CurveIds }> {
  if (!isSketchExtrude(feature)) return { spec: specOf(doc, feature) };
  // The owner's rule (rebuild.ts): a lost sketch's extrude is built from its kept shape.
  const made = await extrudeSpec(kernel, doc, feature);
  if ("status" in made) throw new Error(made.message);
  return { spec: made.spec, curves: made.curves };
}

// UX1b, Fusion's feel: the extrude previewed in the view as the distance is
// typed or its arrow dragged, before OK records anything. A distance is
// signed there: negative goes the other way from the sketch's plane, which
// is how OK records it (`extrudeSketch` with |d| and Flip).

/**
 * Why a signed distance can't be previewed or recorded, in the words OK
 * uses (`lengthRefused` on its size: under 0.001 mm or over 1 km), or null.
 * The preview asked the kernel first and showed its 330-character refusal
 * for 1e-320 (extrude hunt 2026-11-01). 0 is not refused here: it is
 * where Extrude starts, building nothing but standing the arrow on the
 * profile, and OK says `ZERO_OK` for it.
 */
export function distanceRefused(signed: number): string | null {
  if (signed === 0) return null;
  const refused = lengthRefused(Math.abs(signed));
  return refused === null ? null : `The distance${refused.slice("A length".length)}`;
}

/** A typed distance as the signed mm it means, or null for one that isn't a number or is 0 (which builds nothing). */
export function signedDistance(typed: string): number | null {
  const d = Number(typed);
  return typed.trim() === "" || !Number.isFinite(d) || d === 0 ? null : d;
}

/**
 * The BodySpec of an extrude going `signed` mm, from the spec of the same
 * extrude going 1 mm unflipped (`base`, `featureSpec`'s, worked out once
 * per profile so a drag never asks for its outline or placement again):
 * |signed| mm, flipped when `signed` is negative. The base's own `flip`
 * (a sketch on a back or bottom face faces into the body, rebuild.ts
 * `placedSpec`) is kept and turned by the sign, so the result is exactly
 * what `featureSpec` gives for `extrudeSketch(doc, sketch, |signed|,
 * signed < 0)`.
 */
export function previewSpec(base: BodySpec, signed: number): BodySpec {
  if (!("extrude" in base)) throw new Error("a preview is of an extrude of a sketch");
  const { flip: baseFlip, ...rest } = base.extrude;
  const flip = (baseFlip === true) !== signed < 0;
  return { extrude: { ...rest, distance: Math.abs(signed), ...(flip ? { flip: true } : {}) } };
}

/**
 * Where the distance arrow goes for a preview built `signed` mm (UX1b):
 * its line starts at the start cap's centroid (on the sketch's plane) and
 * runs the way a positive distance goes, which is from that centroid to
 * the end cap's over `signed` (the end cap is |signed| along the
 * extrude's direction, so for a negative distance the direction turns
 * back). Null for a view without the two caps (not an extrude).
 */
export function arrowOf(view: BodyView, signed: number): ExtrudeArrow | null {
  const start = view.face_roles.findIndex((r) => r?.role === "start");
  const end = view.face_roles.findIndex((r) => r?.role === "end");
  if (start < 0 || end < 0 || !(signed !== 0)) return null;
  const s = view.face_centroids[start], e = view.face_centroids[end];
  const way = [0, 1, 2].map((i) => (e[i] - s[i]) / signed);
  const n = Math.hypot(...way);
  if (!(n > 0) || !Number.isFinite(n)) return null;
  // + 0: a component 0 divided by a negative distance is −0, the same direction.
  return { base: [s[0], s[1], s[2]], direction: [way[0] / n + 0, way[1] / n + 0, way[2] / n + 0], distance: signed };
}

// Extrude a flat face of a body, with no sketch drawn first (UX1c, Fusion's
// press-pull from a face; Ben, 2026-10-26). A click on a flat face while
// Extrude is open puts a sketch on that face (sketch.ts `addFaceSketch`,
// the frame Create sketch on a face would give it) holding every edge of
// the face projected (`projectEdges`, each live-linked to its edge by
// name, 27d), and Extrude extrudes that sketch. So the face's outline is
// exact and follows the face through edits upstream with the naming rules
// already proved for face sketches and projections; the timeline shows the
// sketch and the extrude (Fusion shows only the extrude: a known
// difference, to revisit with regions at step 48). Until Combine (35f) the
// extrude is a new body, which the panel says.

import type { Plane } from "@fission/core";
import type { DesignDocument } from "./document.ts";
import { sketchSpot } from "./face-pick.ts";
import { projectPick } from "./projection.ts";
import type { Scene } from "./scene.ts";
import { addFaceSketch, projectEdges, sketchPlane } from "./sketch.ts";

/** A flat face Extrude can use: the design with the face's sketch in it (not yet recorded), that sketch, where it lies and what the panel calls it. */
export interface FaceProfile {
  /** The face's name, as a reference names it ("face:feature-2/end"): its id among the outlines offered. */
  face: string;
  /** The design the face was offered in: the profile is out of date once the design changes. */
  from: DesignDocument;
  doc: DesignDocument;
  sketch: string;
  plane: Plane;
  label: string;
}

/** What a click on a curved face says while Extrude is open. */
export const CURVED_EXTRUDE = "Only flat faces can be extruded, and this face is curved: pick a flat face or a closed sketch.";

/**
 * What a click on a face with holes says: a sketch makes one outline until
 * regions (step 48), so a face's sketch with a hole's edges in it doesn't
 * close one. A tracked compromise (docs/progress/ui.md, UX1c), never a
 * wrong shape: the outline without its holes is not offered.
 */
export const FACE_WITH_HOLES = "This face has holes, and extruding a face with holes comes with regions (step 48): for now pick a face without holes, or draw a sketch on it.";

/** Why a flat face whose edges the kernel found no one closed outline in is not offered (`open`: the kernel's words). */
export const faceOpen = (open: string) => (/separate loops/.test(open) ? FACE_WITH_HOLES : `This face's edges don't make one closed outline (${open}), so it can't be extruded.`);

/** What the panel says about a face's extrude, after its outline is found closed. */
export const FACE_NEW_BODY = "Joining the new body to the one under the face comes with the Combine tool.";

/** The words for face `face` of the body `feature` built (its label). */
export const faceLabel = (featureLabel: string) => `Face of ${featureLabel}`;

/**
 * The face `face` (the scene's joined numbering) as something Extrude can
 * use: a sketch on it holding all its edges, put in at the marker of `doc`.
 * Refused in words for a curved face, a face with no name of its own, a
 * body after the marker, or a face with an edge that can't be projected
 * (all or nothing: a face missing an edge would extrude the wrong shape).
 * Null for no face of a body on screen.
 */
export function faceProfile(doc: DesignDocument, scene: Scene | null, face: number): FaceProfile | { refused: string } | null {
  const spot = sketchSpot({ face, shift: false }, scene);
  if (spot === null || spot.kind === "plane") return null;
  if (spot.kind === "refused") return { refused: spot.message.startsWith("Sketches go on flat faces") ? CURVED_EXTRUDE : spot.message.replace("a sketch on it could not follow it: pick another face or a plane", "an extrude of it could not follow it: pick another face or a closed sketch") };
  let made: { doc: DesignDocument; id: string };
  try {
    made = addFaceSketch(doc, spot.face, spot.drawn);
  } catch (e) {
    return { refused: e instanceof Error ? e.message : String(e) };
  }
  const plane = sketchPlane(made.doc, made.id);
  const picked = projectPick(made.doc, made.id, scene, plane, { face });
  if (picked.note !== null || picked.edges.length === 0) return { refused: picked.note ?? "This face has no edges to extrude." };
  const projected = projectEdges(made.doc, made.id, picked.edges);
  const featureLabel = doc.timeline.features.find((f) => f.id === spot.face.feature)?.provenance.self.label ?? spot.face.feature;
  return { face: spot.face.plane, from: doc, doc: projected.doc, sketch: made.id, plane, label: faceLabel(featureLabel) };
}

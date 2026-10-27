// What the AI assistant is told about the design (25c3): the part as the
// set_part that makes it, the sizes a set_part leaves out keeps (the
// panel's), the timeline in build order with each item's state, and what an
// accepted set_part does: changes the part when it is a preset, else adds a
// new body at the marker (`withPart`), which the preview then says. From
// AI7a, also where create_sketch can put a sketch: the origin planes and
// the flat faces of the bodies on screen, each by its name with the way it
// faces and its centre, and the sketch it would add. From AI7b, which
// sketch is open for the draw commands, and how a sketch's x and y lie on
// each plane and face.

import type { AIView, Command, CommandSpec } from "@fission/core";
import { bodyFeatures } from "./browser.ts";
import { builtFrom, DESIGN_COMMANDS, DRAW_OPS, EXTRUDE_OP, extrudable } from "./commands.ts";
import { inSketch } from "./face-edges.ts";
import { insertAt, isHidden, isSketchItem, keptOf, partFeature, partOf, SKETCH_PLANES, type DesignDocument } from "./document.ts";
import { sketchSpot } from "./face-pick.ts";
import type { Scene } from "./scene.ts";
import { addSketch } from "./sketch.ts";
import { timelineBarItems } from "./timeline-bar.ts";

/** The most timeline items the prompt lists: a small local model's prompt stays short. The last ones are kept. */
export const AI_TIMELINE_ITEMS = 40;

/** The sizes the panel holds, which a set_part keeps for each size it leaves out (workspace.ts `run`). */
export type PanelSizes = { width: number; depth: number; height: number };

/**
 * The AI's view of `doc` with the last rebuild's failures (`failed`) and
 * the panel's sizes. Pure: the same document, failures and sizes give the
 * same words.
 */
export function designAIView(doc: DesignDocument | undefined, failed: ReadonlySet<string>, sizes: PanelSizes, faces: readonly AIFace[] = [], open: string | null = null): AIView {
  const keeps: Record<string, unknown> = { ...sizes };
  const shownFaces = faces.slice(0, AI_FACES);
  const sketches = doc ? extrudable(doc).slice(-AI_SKETCHES).map((f) => f.provenance.self.label) : [];
  const commands = aiCommands(shownFaces, sketches);
  const choiceWords = placeWords(shownFaces);
  if (!doc) return { setup: [], keeps, notes: [...sketchNotes(undefined, faces, shownFaces), ...drawNotes(undefined, null), ...extrudeNotes(undefined, null)], adds: null, commands, choiceWords };
  // The part (the last body that builds) and what makes it; an extruded sketch has no set_part that does.
  const shape = partOf(doc);
  const preset = shape !== null && shape.shape !== "sketch-extrude";
  const setup: Command[] = preset ? [{ op: "set_part", shape: shape.shape, ...shape.sizes }] : [];
  const { features } = doc.timeline;
  const at = insertAt(doc);
  const adds = preset ? null : `a new body as item ${at + 1}, ${at === 0 ? "at the start of the timeline" : `after ${at}. ${features[at - 1].intent.summary}`}`;
  return { setup, keeps, notes: [...timelineNotes(doc, failed, sizes, adds), ...sketchNotes(doc, faces, shownFaces), ...drawNotes(doc, open), ...extrudeNotes(doc, open)], adds, commands, choiceWords };
}

/** The most sketches extrude_sketch's `sketch` offers: the newest ones, like `AI_TIMELINE_ITEMS`. */
export const AI_SKETCHES = 30;

/** The most faces the prompt lists, like `AI_TIMELINE_ITEMS`: the first ones, in the bodies' build order, are kept. */
export const AI_FACES = 30;

/** A flat face a sketch can go on, as the AI is told of it: its name (create_sketch's `on`), its body, which way it faces and its centre. */
export interface AIFace {
  name: string;
  /** "Body 1 (Box 1)": the browser's row and the item that builds it. */
  body: string;
  /** Its outward unit normal and its centre, in mm, as the kernel gives them. */
  outward: readonly number[];
  centre: readonly number[];
  /** Its centre's (x, y) in a sketch started on it (AI7b): the frame create_sketch would give it (`drawnOnFace`). */
  inSketch: readonly [number, number];
}

/** What a face facing straight along an axis is called (Z up, the front looking along −Y: the view cube's names). */
const FACING: Record<string, string> = { "0,0,1": "up (+Z, a top face)", "0,0,-1": "down (−Z, a bottom face)", "0,-1,0": "the front (−Y)", "0,1,0": "the back (+Y)", "1,0,0": "right (+X)", "-1,0,0": "left (−X)" };

/** A number for the prompt: 3 decimals, never "-0". */
const short = (v: number) => String(Number(v.toFixed(3)) + 0);

/** "up (+Z, a top face)" for a face square to an axis (to 3 decimals, which is all the prompt shows), else its normal: "along (0.707, 0, 0.707)". */
export function facingWords(outward: readonly number[]): string {
  const key = outward.map(short).join(",");
  return FACING[key] ?? `along (${outward.map(short).join(", ")})`;
}

/**
 * The flat faces of the bodies on screen a sketch can go on (face-pick.ts
 * `sketchSpot`: flat, with a name of its own), in the bodies' build order,
 * as the AI is told of them. `label` names the item that builds a body.
 */
export function aiFaces(scene: Scene | null, label: (feature: string) => string): AIFace[] {
  if (scene === null) return [];
  const out: AIFace[] = [];
  scene.bodies.forEach((body, b) => {
    for (let i = 0; i < body.view.faces; i++) {
      const spot = sketchSpot({ face: scene.faceStart[b] + i, shift: false }, scene);
      if (spot?.kind !== "face") continue;
      const centre = body.view.face_centroids[i];
      out.push({ name: spot.face.plane, body: `Body ${body.place} (${label(body.feature)})`, outward: body.view.face_normals[i]!, centre, inSketch: inSketch(centre, spot.drawn.plane) });
    }
  });
  return out;
}

/** Design's commands as the AI may use them now: set_part, create_sketch on an origin plane or one of `faces`, and the draw commands (export_stl downloads, so it stays the user's). */
export function aiCommands(faces: readonly AIFace[], sketches: readonly string[] = []): CommandSpec[] {
  const setPart = DESIGN_COMMANDS.find((c) => c.op === "set_part")!;
  const sketch = DESIGN_COMMANDS.find((c) => c.op === "create_sketch")!;
  const draws = DESIGN_COMMANDS.filter((c) => DRAW_OPS.includes(c.op));
  const extrude = DESIGN_COMMANDS.find((c) => c.op === EXTRUDE_OP)!;
  // `sketch` is offered only when a sketch exists to name (an empty list of choices is no schema); a sketch just started is always the default.
  const extrudeWith: CommandSpec = sketches.length === 0 ? extrude : { ...extrude, params: { ...extrude.params, sketch: { type: "choice", values: sketches, optional: true, description: "which sketch to extrude, by name; leave it out for the sketch just started or open, else the newest" } } };
  return [setPart, { ...sketch, params: { on: { ...sketch.params.on, type: "choice", values: [...SKETCH_PLANES, ...faces.map((f) => f.name)] } } }, ...draws, extrudeWith];
}

/** How a sketch's x and y lie on each origin plane (sketch.ts PLANES: y is the normal × x), said once. */
export const SKETCH_AXES = "In a sketch, x and y are in mm on its plane: on XY, x is X and y is Y; on XZ, x is X and y is Z; on YZ, x is Y and y is Z. A sketch on a face has its own x and y; each face's line says where its centre is in them.";

/** The prompt's lines about drawing (AI7b): the sketch open, if any, and whether the draw commands may draw in it. */
function drawNotes(doc: DesignDocument | undefined, open: string | null): string[] {
  const item = open === null || !doc ? undefined : doc.timeline.features.find((f) => f.id === open);
  if (!doc || !item) return ["No sketch is open: to draw, start one with create_sketch first in the same answer; the draw commands then draw in it.", SKETCH_AXES];
  const used = builtFrom(doc, item.id);
  const what = `${item.provenance.self.label} is open (${item.intent.summary})`;
  return [used === null ? `${what}: the draw commands draw in it, unless create_sketch starts another first.` : `${what}, but ${used} is built from it, so the draw commands can't draw in it: start a new sketch with create_sketch first.`, SKETCH_AXES];
}

/** The prompt's lines about extruding (AI7c): which sketch an extrude with no name takes, and what it adds. */
function extrudeNotes(doc: DesignDocument | undefined, open: string | null): string[] {
  const usable = doc ? extrudable(doc) : [];
  const note = "extrude_sketch makes a new body at the timeline marker from a sketch that makes one closed outline, and changes nothing else; a negative distance goes the other way from the sketch's plane.";
  if (usable.length === 0) return [note, "No sketch can be extruded yet, so extrude_sketch only follows a create_sketch and its drawing in the same answer."];
  const opened = usable.find((f) => f.id === open);
  const takes = opened ?? usable.at(-1)!;
  return [note, `With no sketch named, extrude_sketch takes the sketch started earlier in the answer, else ${opened ? "the open sketch" : "the newest sketch"}: ${takes.provenance.self.label}.`];
}

/** Where each place create_sketch can use is, in words for the preview: "the XY plane", "a face of Body 1 (Box 1), facing up (+Z, a top face)". */
function placeWords(faces: readonly AIFace[]): Record<string, string> {
  const words: Record<string, string> = Object.fromEntries(SKETCH_PLANES.map((p) => [p, `the ${p} plane`]));
  for (const f of faces) words[f.name] = `a face of ${f.body}, facing ${facingWords(f.outward)}`;
  return words;
}

/** The prompt's lines about create_sketch: the sketch it adds and where in the timeline, and the faces it can go on. */
function sketchNotes(doc: DesignDocument | undefined, faces: readonly AIFace[], shown: readonly AIFace[]): string[] {
  // The name and place addSketch itself gives (the plane changes neither).
  const made = doc ? addSketch(doc, "XY") : null;
  const at = doc ? insertAt(doc) : 0;
  const name = made ? made.doc.timeline.features.find((f) => f.id === made.id)!.provenance.self.label : "Sketch 1";
  const where = at === 0 ? "at the start of the timeline" : `after ${at}. ${doc!.timeline.features[at - 1].intent.summary}`;
  const adds = `create_sketch adds an empty ${name} as item ${at + 1}, ${where}, and opens it; nothing already in the timeline changes.`;
  if (faces.length === 0) return [adds, "No body is on screen, so a sketch can go only on the XY, XZ or YZ plane."];
  const left = faces.length - shown.length;
  return [
    adds,
    "The flat faces a sketch can go on, by name (create_sketch's on), with the way each faces and its centre:",
    ...shown.map((f) => `- ${f.name}: a face of ${f.body}, facing ${facingWords(f.outward)}, centre (${f.centre.map(short).join(", ")}) mm, which is (${f.inSketch.map(short).join(", ")}) in a sketch on it.`),
    ...(left > 0 ? [`(${left} more face${left === 1 ? "" : "s"} left out)`] : []),
  ];
}

/** The prompt's lines about the timeline: each item and its state, the marker, and what set_part does now. */
function timelineNotes(doc: DesignDocument, failed: ReadonlySet<string>, sizes: PanelSizes, adds: string | null): string[] {
  const { features, marker } = doc.timeline;
  const { items } = timelineBarItems(doc, failed);
  const bodies = bodyFeatures(doc);
  const part = partFeature(doc);
  const lines = features.map((f, i) => {
    const item = items[i];
    const label = `${i + 1}. ${f.intent.summary}.`;
    if (item.suppressed) return `${label} Suppressed: builds nothing.`;
    if (item.rolledBack) return `${label} After the timeline marker: not built.`;
    // 26e (Q3): built on a suppressed item, it is greyed with it.
    if (item.greyed !== null) return `${label} Greyed: builds nothing while ${item.greyed}, which it is built on, is suppressed.`;
    if (isSketchItem(f)) return `${label} A sketch: builds no body.`;
    if (item.failed) return `${label} Failed: builds no body${failed.has(f.id) ? "" : " (its sketch is gone)"}.`;
    const kept = keptOf(doc, f) ? " Its sketch is lost (deleted, or no longer a closed outline), so it builds from the shape it kept." : "";
    const hidden = isHidden(doc, f.id) ? " Hidden by its eye in the browser: not drawn, nor in the whole design's STL." : "";
    return `${label} Builds Body ${bodies.indexOf(f) + 1}.${kept}${hidden}${f === part && adds === null ? " This is the part set_part changes." : ""}`;
  });
  const shown = lines.length > AI_TIMELINE_ITEMS ? [`(${lines.length - AI_TIMELINE_ITEMS} earlier item${lines.length - AI_TIMELINE_ITEMS === 1 ? "" : "s"} left out)`, ...lines.slice(-AI_TIMELINE_ITEMS)] : lines;
  const where =
    marker === undefined ? "The timeline marker is at the end: every item is built." : marker === "start" ? "The timeline marker is at the start: nothing is built." : `The timeline marker is after item ${features.findIndex((f) => f.id === marker) + 1}: items after it are not built.`;
  // The part an extruded sketch: named, so the model knows what the user calls "it" and that set_part leaves it as it is.
  const what = part === null ? "Nothing builds a body, so" : `The part (the last body) is ${features.indexOf(part) + 1}. ${part.intent.summary}, an extruded sketch, which no command you can use changes, so`;
  const does = adds === null ? "set_part changes the part in place." : `${what} set_part adds ${adds}; nothing already in the timeline changes.`;
  return [
    "The design's timeline, in build order:",
    ...shown,
    where,
    does,
    `A size set_part leaves out keeps the value it has now: width ${sizes.width}, depth ${sizes.depth}, height ${sizes.height}.`,
  ];
}

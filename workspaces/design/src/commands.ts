// Design's commands, as data (the command API in core). The panel and the
// AI assistant do the same thing through these: the AI gets schemas
// generated from them and can't do anything a user couldn't. They set
// the part (change it, or add a body at the marker), start a sketch on an
// origin plane or a flat face (AI7a), draw a circle, a rectangle or a line
// in the sketch open (AI7b), extrude a closed sketch into a body (AI7c), rename
// an item (AI7d), and export every body shown.

import type { Command, CommandSpec, Feature } from "@fission/core";
import { insertAt, isSketchExtrude, isSketchItem, SKETCH_PLANES, withPart, type DesignDocument } from "./document.ts";
import type { ShapeKind } from "./profiles.ts";
import { extrudeSketch, NO_SKETCH, NO_USABLE_SKETCH, ZERO_DISTANCE } from "./extrude.ts";
import { NAME_LIMIT, renameItem } from "./timeline-edits.ts";
import { addSketch, drawCircle, drawLine, drawRectangle } from "./sketch.ts";
import { freshDesign } from "./start-fresh.ts";
import { lengthRefused } from "./typed-entry.ts";

export const SHAPES: readonly ShapeKind[] = ["box", "cylinder", "sphere", "l-bracket", "plate", "slot", "star"];

/**
 * Where a draw command's coordinates may go, in mm either way: the kernel's
 * largest feature size (1 km, MAX_SIZE in kernel.json), so a
 * sketch's numbers stay within a part's reach. The kernel holds the exact
 * limits when it looks for the outline, as it does for the tools.
 */
export const SKETCH_REACH = 1e6;

/** The extrude command's name (AI7c): not the plain word, so a working out may still say "extrude". */
export const EXTRUDE_OP = "extrude_sketch";

/** The rename command's name (AI7d). */
export const RENAME_OP = "rename_item";

export const DESIGN_COMMANDS: readonly CommandSpec[] = [
  {
    op: "set_part",
    summary: "Make the part a shape of these sizes. The part is the last body the timeline builds: set_part changes it in place when it is one of these shapes, and otherwise (an extruded sketch, or no body) adds a new body at the timeline marker. Cylinders and spheres use width as the diameter; other shapes extrude a ready-made profile by the height.",
    params: {
      shape: { type: "choice", values: SHAPES, description: "which shape" },
      width: { type: "length", description: "width, or diameter for a cylinder or sphere" },
      // Optional (AI4): a left-out size keeps the part's current one, and cylinders and spheres need
      // no depth. Required, small models filled the sizes a shape ignores with 0, which is refused.
      depth: { type: "length", optional: true, description: "depth; leave it out for a cylinder or sphere, or to keep the current depth" },
      height: { type: "length", optional: true, description: "height, or how far a profile is extruded; leave it out for a sphere, or to keep the current height" },
    },
  },
  {
    op: "create_sketch",
    // AI7a: what Create sketch does after a plane or face is picked. The app adds the flat faces of the bodies on
    // screen to `on` (ai-view.ts `sketchCommand`); this list, the origin planes, is what holds with no body.
    summary: "Start a new empty sketch on an origin plane or a flat face of a body, put in the timeline at the marker and opened for drawing, as Create sketch does. It builds no body.",
    params: {
      on: { type: "choice", values: SKETCH_PLANES, description: "where the sketch goes: XY is the ground plane (seen from the top), XZ the front plane, YZ the right side plane; or the name of a flat face from the design's list of faces" },
    },
  },
  // AI7b: what the circle, rectangle and line tools draw, with typed sizes, in the sketch open (or the one create_sketch
  // just started). x and y are mm in the sketch's own plane (the prompt says how they lie on each plane and face).
  {
    op: "draw_circle",
    summary: "Draw a circle in the sketch that is open (or that create_sketch just started), as the circle tool does. x and y are in mm on the sketch's plane.",
    params: {
      diameter: { type: "length", description: "the circle's diameter, twice its radius" },
      x: { type: "number", min: -SKETCH_REACH, max: SKETCH_REACH, optional: true, description: "the centre's x in the sketch, in mm; leave it out for 0" },
      y: { type: "number", min: -SKETCH_REACH, max: SKETCH_REACH, optional: true, description: "the centre's y in the sketch, in mm; leave it out for 0" },
    },
  },
  {
    op: "draw_rectangle",
    summary: "Draw a rectangle centred on (x, y) in the sketch that is open (or that create_sketch just started), its sides along the sketch's x and y, as the rectangle tool does.",
    params: {
      width: { type: "length", description: "its size along the sketch's x" },
      height: { type: "length", description: "its size along the sketch's y" },
      x: { type: "number", min: -SKETCH_REACH, max: SKETCH_REACH, optional: true, description: "the centre's x in the sketch, in mm; leave it out for 0" },
      y: { type: "number", min: -SKETCH_REACH, max: SKETCH_REACH, optional: true, description: "the centre's y in the sketch, in mm; leave it out for 0" },
    },
  },
  {
    op: "draw_line",
    summary: "Draw a straight line from (x1, y1) to (x2, y2) in the sketch that is open (or that create_sketch just started), as the line tool does. A line ending where another starts shares that point.",
    params: {
      x1: { type: "number", min: -SKETCH_REACH, max: SKETCH_REACH, description: "the start's x in the sketch, in mm" },
      y1: { type: "number", min: -SKETCH_REACH, max: SKETCH_REACH, description: "the start's y in the sketch, in mm" },
      x2: { type: "number", min: -SKETCH_REACH, max: SKETCH_REACH, description: "the end's x in the sketch, in mm" },
      y2: { type: "number", min: -SKETCH_REACH, max: SKETCH_REACH, description: "the end's y in the sketch, in mm" },
    },
  },
  // AI7c: what the Extrude tool does with a typed distance. The sketch is left out for the one just started or open;
  // ai-view.ts adds `sketch` (the sketches before the marker, by name) to the copy the AI is offered.
  {
    op: EXTRUDE_OP,
    summary: "Extrude a closed sketch into a new body by a distance, as the Extrude tool does, put in the timeline at the marker. A negative distance goes the other way from the sketch's plane. It leaves the sketch and every body already there as they are.",
    params: {
      distance: { type: "number", min: -SKETCH_REACH, max: SKETCH_REACH, description: "how far to extrude, in mm; not 0; negative goes the other way from the sketch's plane" },
    },
  },
  // AI7d: what the timeline's Rename does. The item is left out for the one just before the marker (the one this answer has just made);
  // ai-view.ts makes `item` a choice of the items' names in the copy the AI is offered (and drops it when there are none).
  {
    op: RENAME_OP,
    summary: "Give an item in the timeline (a sketch, a body) a new name, as Rename in its menu does; the names of the items built from it follow. Nothing else changes. Every item needs its own name, ignoring capitals.",
    params: {
      item: { type: "text", maxLength: NAME_LIMIT, optional: true, description: "the item's current name; leave it out for the item just made in this answer, else the last one before the marker" },
      name: { type: "text", maxLength: NAME_LIMIT, description: `the new name: at least one character and at most ${NAME_LIMIT}, on one line, not another item's name` },
    },
  },
  {
    op: "export_stl",
    summary: "Download every body shown as one binary STL file, for printing or another program. Warns when a body is too big for STL's single-precision numbers.",
    params: {},
  },
];

/** The draw commands (AI7b): each draws into a sketch. */
export const DRAW_OPS: readonly string[] = ["draw_circle", "draw_rectangle", "draw_line"];

/** The step a draw command is in the undo list as, the tool's own name ("Draw circle"). */
export const DRAW_STEPS: Record<string, string> = { draw_circle: "Draw circle", draw_rectangle: "Draw rectangle", draw_line: "Draw line" };

/** Why the AI may not draw in sketch `id` now, or null: an extrude is built from it, and a sketch edit there must be settled on the kernel first (rebuild.ts `settleKept`), which an AI step can't wait for. */
export function drawRefused(doc: DesignDocument, id: string): string | null {
  const used = builtFrom(doc, id);
  return used ? `${used} is built from this sketch, so the AI can't draw in it yet: draw there yourself, or start a new sketch.` : null;
}

/** The name of the first extrude built from sketch `id`, or null. */
export function builtFrom(doc: DesignDocument, id: string): string | null {
  return doc.timeline.features.find((f) => isSketchExtrude(f) && f.intent.parameters.sketch === id)?.provenance.self.label ?? null;
}

/**
 * Sketch `sketchId` with a parsed draw command drawn in it, exactly as the
 * tool draws it: a circle round (x, y), a rectangle's four lines from
 * corner (x − w/2, y − h/2) to (x + w/2, y + h/2) (corners already there
 * shared), a line between two points (an end already there shared, as a
 * click on it would). A left-out x or y is 0.
 */
export function drawingFor(doc: DesignDocument, sketchId: string, command: Command): DesignDocument {
  const n = (k: string) => (command[k] === undefined ? 0 : (command[k] as number));
  const sketch = doc.sketches.find((x) => x.id === sketchId);
  if (!sketch) throw new Error(`there is no sketch ${sketchId} to draw in`);
  const at = (x: number, y: number) => sketch.points.find((p) => p.x === x && p.y === y)?.id ?? ([x, y] as const);
  // A size the tool's typed box would refuse is refused here too (sweep 2026-10-28: 1e300 reached the view as NaN), before the preview (`check`).
  const sized = (v: number, what: (v: number) => string) => {
    const refused = lengthRefused(v);
    if (refused !== null) throw new Error(`${what(v)} can't be drawn: ${refused[0].toLowerCase()}${refused.slice(1)}`);
    return v;
  };
  switch (command.op) {
    case "draw_circle":
      return drawCircle(doc, sketchId, [n("x"), n("y")], sized(command.diameter as number, (v) => `A circle ⌀${v} mm`) / 2).doc;
    case "draw_rectangle": {
      const [w, h] = [sized(command.width as number, (v) => `A rectangle's width of ${v} mm`), sized(command.height as number, (v) => `A rectangle's height of ${v} mm`)];
      return drawRectangle(doc, sketchId, [n("x") - w / 2, n("y") - h / 2], [n("x") + w / 2, n("y") + h / 2]).doc;
    }
    case "draw_line":
      if (n("x1") === n("x2") && n("y1") === n("y2")) throw new Error(`a line needs two different ends: both are (${n("x1")}, ${n("y1")})`);
      return drawLine(doc, sketchId, at(n("x1"), n("y1")), at(n("x2"), n("y2"))).doc;
  }
  throw new Error(`${command.op} is not a draw command`);
}

/** A draw command in words, for the preview and its undo step: "circle ⌀20 mm at (5, −3)", "rectangle 30 × 20 mm centred at (0, 0)", "line from (0, 0) to (10, 5)". */
export function drawWords(command: Command): string {
  const n = (k: string) => String(command[k] === undefined ? 0 : command[k]).replace("-", "−");
  if (command.op === "draw_circle") return `circle ⌀${n("diameter")} mm at (${n("x")}, ${n("y")})`;
  if (command.op === "draw_rectangle") return `rectangle ${n("width")} × ${n("height")} mm centred at (${n("x")}, ${n("y")})`;
  if (command.op === "draw_line") return `line from (${n("x1")}, ${n("y1")}) to (${n("x2")}, ${n("y2")})`;
  throw new Error(`${command.op} is not a draw command`);
}

/** The sketches an extrude can use: before the marker (an extrude put in there can't use a later one) and not suppressed, as the Extrude tool offers them. */
export function extrudable(doc: DesignDocument): Feature[] {
  const at = insertAt(doc);
  return doc.timeline.features.filter((f, i) => isSketchItem(f) && !f.suppressed && i < at);
}

/**
 * The sketch an extrude_sketch command means: the one it names (by its name
 * in the timeline), else the sketch open (the one just started, when the
 * answer began one), else the newest before the marker, as the Extrude tool
 * chooses. A name that isn't one of the sketches it can use is refused.
 */
export function extrudeTarget(doc: DesignDocument, command: Command, open: string | null = null): string {
  const usable = extrudable(doc);
  if (command.sketch !== undefined) {
    const named = usable.find((f) => f.provenance.self.label === command.sketch);
    if (!named) throw new Error(`there is no sketch ${JSON.stringify(command.sketch)} before the marker to extrude`);
    return named.id;
  }
  const chosen = usable.find((f) => f.id === open) ?? usable.at(-1);
  if (!chosen) throw new Error(doc.timeline.features.some(isSketchItem) ? NO_USABLE_SKETCH : NO_SKETCH);
  return chosen.id;
}

/**
 * The item a rename_item command means: the one it names (by its name in
 * the timeline), else the one just before the marker, which is what the
 * answer has just made when it made something. A name no item has is refused.
 */
export function renameTarget(doc: DesignDocument, command: Command): string {
  const { features } = doc.timeline;
  if (command.item !== undefined) {
    const named = features.find((f) => f.provenance.self.label === command.item);
    if (!named) throw new Error(`there is no item ${JSON.stringify(command.item)} in the timeline to rename`);
    return named.id;
  }
  const last = features[insertAt(doc) - 1];
  if (!last) throw new Error("there is no item to rename: the timeline is empty");
  return last.id;
}

/** A rename_item command in words, for the preview and its undo step: "rename Sketch 1 to base", "rename the newest item to base". */
export function renameWords(command: Command): string {
  return `rename ${command.item === undefined ? "the newest item" : String(command.item)} to ${String(command.name)}`;
}

/** The distance of an extrude_sketch command, refused when it is not a number or is 0 (a negative one goes the other way). */
export function commandDistance(command: Command): number {
  const d = command.distance;
  if (typeof d !== "number" || !Number.isFinite(d)) throw new Error("extrude_sketch needs its distance in mm");
  if (d === 0) throw new Error(ZERO_DISTANCE);
  return d;
}

/** An extrude_sketch command in words, for the preview and its undo step: "extrude Sketch 1 by 15 mm", "extrude the sketch by 8 mm the other way". */
export function extrudeWords(command: Command): string {
  const d = command.distance as number;
  return `extrude ${command.sketch === undefined ? "the sketch" : String(command.sketch)} by ${Math.abs(d)} mm${d < 0 ? " the other way" : ""}`;
}

/** The sketch a draw command goes into when only the document is known: the one just before the marker, which create_sketch has just put in (and opened). */
function lastSketch(doc: DesignDocument): string {
  const item = doc.timeline.features[insertAt(doc) - 1];
  if (!item || !isSketchItem(item)) throw new Error("there is no sketch just started to draw in: start one first");
  return item.id;
}

/** The sizes each shape is built from; the others it ignores. */
const NEEDS: Record<ShapeKind, readonly ("depth" | "height")[]> = { box: ["depth", "height"], cylinder: ["height"], sphere: [], "l-bracket": ["depth", "height"], plate: ["depth", "height"], slot: ["depth", "height"], star: ["depth", "height"] };

/**
 * The document a parsed Design command makes from `current` (none: a fresh
 * part); set_part keeps its sketches, create_sketch (AI7a) adds one on an
 * origin plane, and a draw command (AI7b) draws in the sketch just before
 * the marker. With no part to keep sizes from (the
 * panel's own command always names all three), a size the shape needs but
 * the command leaves out is an error; one it ignores is never read.
 */
export function documentFor(command: Command, current?: DesignDocument | null): DesignDocument {
  // A drawing goes into the sketch just started (Design's run draws in the one open, which create_sketch opens).
  if (DRAW_OPS.includes(command.op)) {
    if (!current) throw new Error(`${command.op}: there is no sketch to draw in: start one first`);
    const id = lastSketch(current);
    const refused = drawRefused(current, id);
    if (refused) throw new Error(refused);
    return drawingFor(current, id, command);
  }
  // An extrude of the sketch named, the one just started or the newest (the kernel judges the outline when it builds).
  if (command.op === EXTRUDE_OP) {
    if (!current) throw new Error(`${EXTRUDE_OP}: there is no sketch to extrude: draw one first`);
    const d = commandDistance(command);
    return extrudeSketch(current, extrudeTarget(current, command), Math.abs(d), d < 0).doc;
  }
  // A rename of the item named, else the one just made.
  if (command.op === RENAME_OP) {
    if (!current) throw new Error(`${RENAME_OP}: there is no item to rename`);
    const renamed = renameItem(current, renameTarget(current, command), String(command.name));
    if ("refused" in renamed) throw new Error(renamed.message);
    return renamed.doc;
  }
  // A sketch on an origin plane, at the marker; one on a face needs the face as built, so only Design's run makes it (workspace.ts).
  if (command.op === "create_sketch") {
    if (!(SKETCH_PLANES as readonly unknown[]).includes(command.on)) throw new Error(`create_sketch: a sketch on a face is placed on the body as built, so only Design can start one; ${JSON.stringify(command.on)} is not XY, XZ or YZ`);
    return addSketch(current ?? freshDesign(), command.on as (typeof SKETCH_PLANES)[number]).doc;
  }
  // export_stl makes no document: it saves the one there is.
  if (command.op !== "set_part") throw new Error(`Design has no command ${command.op}`);
  const { shape, width, depth, height } = command as unknown as { shape: ShapeKind; width: number; depth?: number; height?: number };
  for (const key of NEEDS[shape]) if (command[key] === undefined) throw new Error(`set_part: a ${shape} needs its ${key}`);
  return withPart(current, shape, width, depth ?? width, height ?? width);
}

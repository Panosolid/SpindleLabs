// Design's commands, as data (the command API in core). The panel and the
// AI assistant do the same thing through these: the AI gets schemas
// generated from them and can't do anything a user couldn't. They set
// the part (change it, or add a body at the marker), start a sketch on an
// origin plane or a flat face (AI7a), draw a circle, a rectangle or a line
// in the sketch open (AI7b), and export every body shown.

import type { Command, CommandSpec } from "@fission/core";
import { insertAt, isSketchExtrude, isSketchItem, SKETCH_PLANES, withPart, type DesignDocument } from "./document.ts";
import type { ShapeKind } from "./profiles.ts";
import { addSketch, drawCircle, drawLine, drawRectangle } from "./sketch.ts";
import { freshDesign } from "./start-fresh.ts";

export const SHAPES: readonly ShapeKind[] = ["box", "cylinder", "sphere", "l-bracket", "plate", "slot", "star"];

/**
 * Where a draw command's coordinates may go, in mm either way: the kernel's
 * largest feature size (1 km, MAX_SIZE in kernel/src/tolerance.rs), so a
 * sketch's numbers stay within a part's reach. The kernel holds the exact
 * limits when it looks for the outline, as it does for the tools.
 */
export const SKETCH_REACH = 1e6;

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
  switch (command.op) {
    case "draw_circle":
      return drawCircle(doc, sketchId, [n("x"), n("y")], (command.diameter as number) / 2).doc;
    case "draw_rectangle": {
      const [w, h] = [command.width as number, command.height as number];
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

// DRAFT: will change as the real workspaces are built.
//
// The one 3D viewport every workspace draws into (@fission/viewport
// implements it). Switching workspaces keeps it, so the camera stays put.

import type { DisplayMesh, Outline } from "../kernel/kernel-types.ts";
import type { AnalysisOverlay } from "./overlay.ts";
import type { ImageRep, Plane } from "./representation.ts";

/** A sphere around a body: what the camera frames. */
export interface Framing {
  centre: [number, number, number];
  radius: number;
}

/**
 * What a click (not a camera drag) in the viewport hit: the kernel index of
 * the body's edge within a few pixels of the pointer (step 17c), else of the
 * face under it, or neither for empty space; and whether Shift was held. An
 * edge wins over the face behind it, so at most one of the two is set. The
 * workspace on show decides what that selects.
 */
export interface ViewportPick {
  face: number | null;
  /** Absent or null when no edge was picked. */
  edge?: number | null;
  /**
   * The offered origin plane clicked (showPlanes), by id; absent or null
   * when none was. While planes are offered a click picks the body's face
   * under the pointer whenever there is one (never an edge), else the
   * nearest offered plane: the planes are drawn behind the body (step 26d).
   */
  plane?: string | null;
  shift: boolean;
}

/** A point in a sketch plane's own 2D frame, in mm. */
export type SketchXY = readonly [number, number];

/**
 * A sketch as the viewport draws it (step 21c): its lines in its plane's
 * frame (x along `xAxis`, y along normal × xAxis), drawn over the body.
 * The sketch being edited also has its grid (spacing in mm), its points
 * and what the tool would draw at the pointer (the line tool's rubber
 * band, a rectangle's four sides), empty when it would draw nothing,
 * and where the pointer snapped (Design's snap.ts): its marks, drawn over
 * everything, and the snap in words ("endpoint 10,0"), absent on the grid.
 * `gridSnap` says points snap to the grid (sketch feel SF1), so the grid
 * drawn is the snapping one's multiples; without it the grid drawn is
 * powers of ten, adapting to the zoom (SF2).
 */
export interface SketchDrawing {
  plane: Plane;
  /**
   * Which way the sketch faces against its plane's normal (step 26d): −1
   * for a sketch on a back or bottom face, whose frame keeps the world's
   * axes (so its normal points into the body) and which is looked at from
   * the other side; absent means +1.
   */
  side?: 1 | -1;
  lines: readonly (readonly [SketchXY, SketchXY])[];
  /**
   * A finished sketch whose plane is lost (step 26e: its face is gone, so
   * it stays where it was): drawn red, as the reference app draws a lost
   * profile. Absent means drawn as usual.
   */
  lost?: true;
  /**
   * Edges of bodies projected into it (step 27d), drawn in a colour of
   * their own: its projected curves as segments, and the points of edges
   * seen end on. Absent means none. Not in `lines`.
   */
  projected?: { lines: readonly (readonly [SketchXY, SketchXY])[]; points: readonly SketchXY[] };
  /**
   * `picks` (step 27d, the Project tool): while it is edited, a click or a
   * hover also says which body edge or face is under the pointer
   * (SketchPointer `edge`, `face`), and lights it as a hover does.
   */
  editing?: { grid: number; gridSnap?: boolean; points: readonly SketchXY[]; preview: readonly (readonly [SketchXY, SketchXY])[]; snap?: { label: string; marks: readonly (readonly [SketchXY, SketchXY])[] }; picks?: true };
}

/** An origin plane drawn small at the origin to be picked (Create sketch); one not offered is drawn faint and can't be clicked. */
export interface OriginPlane {
  id: string;
  plane: Plane;
  offered: boolean;
}

/** What the origin draws in the view (showOrigin): each axis shown or not, X, Y, Z, and the planes shown, by id ("origin-xy") with where each lies. */
export interface OriginShown {
  axes: readonly [boolean, boolean, boolean];
  planes: readonly { id: string; plane: Plane }[];
}

/** Every axis and no plane: the origin until a workspace says otherwise. */
export const ORIGIN_AT_FIRST: OriginShown = { axes: [true, true, true], planes: [] };

/**
 * The pointer over the sketch being edited: where it meets the sketch's
 * plane in its frame, or null (off the view, or looking along the plane),
 * and how big a screen pixel is on the plane there (mm), for snapping
 * within a few pixels; absent when the viewport can't tell.
 */
export interface SketchPointer {
  kind: "move" | "click";
  at: SketchXY | null;
  pixel?: number;
  /**
   * While the edited sketch asks for picks (SketchDrawing editing.picks,
   * step 27d): the body edge under the pointer, else its face, as a pick
   * names them (joined indices); null for none. Absent otherwise.
   */
  edge?: number | null;
  face?: number | null;
}

/** A closed sketch outline Extrude offers to pick in the view (UX1b), by its sketch's id, in its plane's frame (as sketch_outline gives it). */
export interface OfferedProfile {
  id: string;
  plane: Plane;
  outline: Outline;
  /** A flat face of a body (UX1c), drawn only under the pointer or chosen: the body shows it already. */
  face?: boolean;
}

/**
 * Extrude's distance arrow (UX1b, Fusion's): it lies on the line base +
 * s·direction (direction a unit vector; s > 0 the way an unflipped extrude
 * goes), with its foot at s = `distance`, the extrude's end, pointing on
 * the way the extrude goes (back down the line for a negative distance).
 */
export interface ExtrudeArrow {
  base: [number, number, number];
  direction: [number, number, number];
  distance: number;
}

/** What Extrude shows in the view while its panel is open (UX1b). */
export interface ExtrudeShow {
  /** The outlines a click picks, drawn as see-through fills on their planes (brighter under the pointer, brightest when chosen). */
  profiles: readonly OfferedProfile[];
  chosen: string | null;
  /** The extrude as OK would make it, drawn see-through; null while there is none (nothing chosen yet, or the kernel refused it). */
  preview: DisplayMesh | null;
  arrow: ExtrudeArrow | null;
}

/**
 * The pointer while Extrude is shown: a click on an offered outline, by
 * id (the nearest one the body doesn't hide), or on none (null), with
 * the body's face under the pointer when no outline is (`face`, joined
 * numbering, so a curved face can be refused in words; UX1c); or the
 * arrow dragged, with the distance where the pointer's ray passes nearest
 * the arrow's line (not snapped), `done` when the button is let go.
 */
export type ExtrudePointer = { kind: "pick"; profile: string | null; face?: number | null } | { kind: "drag"; distance: number; done: boolean };

/** A handle of the Move tool's gizmo (35e2c): the arrow along X, Y or Z, or the ring turning about it. */
export type MoveHandle = "x" | "y" | "z" | "turnX" | "turnY" | "turnZ";

/** What the Move tool shows in the view while its panel is open (35e2c): three arrows along X, Y and Z and three rings about them, at `centre` (mm), where the pivot ends up. */
export interface MoveHandlesShow {
  centre: [number, number, number];
}

/**
 * A Move handle dragged (35e2c): how far since the press, not snapped:
 * along an arrow in mm (where the pointer's ray passes nearest the arrow's
 * line), round a ring in degrees (counter-clockwise looking down its axis,
 * counted on past a whole turn); `done` when the button is let go.
 */
export interface MovePointer {
  handle: MoveHandle;
  amount: number;
  done: boolean;
}

/**
 * What the viewport draws in the selection colour (step 17d): the whole
 * body, and faces and edges by kernel index. Indices the body on screen
 * does not have draw nothing. Analysis overlays stay visible under it.
 */
export interface ViewportHighlight {
  body: boolean;
  faces: readonly number[];
  edges: readonly number[];
}

/** Nothing highlighted. */
export const NO_HIGHLIGHT: ViewportHighlight = Object.freeze({ body: false, faces: [], edges: [] });

/** A corner of the view cube: an isometric view from that corner (front is −Y, right is +X). */
export type CornerView = `${"top" | "bottom"}-${"front" | "back"}-${"left" | "right"}`;

/** The standard views: "home" (three-quarter, the default), the six faces of the view cube and its eight corners. */
export type ViewName = "home" | "top" | "bottom" | "front" | "back" | "left" | "right" | CornerView;

export interface SharedViewport {
  /** The element the viewport fills. */
  readonly element: HTMLElement;
  showBody(mesh: DisplayMesh): void;
  /** Sphere around the current body (radius 0 if none); fit frames the finished sketches drawn too. */
  bodyFraming(): Framing;
  /** Frames the current body; returns what it framed (null if none). */
  fit(): Framing | null;
  /** Turns the camera to a standard view framing the current body; returns what it framed (null if none). */
  setView(name: ViewName): Framing | null;
  /** Frames the selection (as last shown) from the current direction; null, camera untouched, when nothing is selected. */
  fitSelection(): Framing | null;
  /**
   * Look At (sketch feel SF2): the camera square onto the plane, its y axis
   * up on screen, framing the body and the edited sketch (or 50 mm round
   * the plane's origin when there is neither); returns what it framed. The
   * camera is on the side the normal points to, or the other side for
   * `side` −1 (a sketch on a back or bottom face, step 26d), with up on
   * screen then the plane's y or −y, whichever the standard view looking
   * that way has nearer its up (a bottom face is seen as the bottom view
   * sees it, the front at the top).
   */
  lookAt(plane: Plane, side?: 1 | -1): Framing | null;
  /** The edited sketch's points on screen (pixels from the view's top left), so a box can keep clear of them. */
  editedScreenPoints(): { x: number; y: number }[];
  /** A point of the edited sketch's plane on screen (pixels from the view's top left); null with no sketch edited or the point behind the camera. */
  sketchScreenPoint(at: SketchXY): { x: number; y: number } | null;
  /** Paints an analysis overlay on the current body (replaces one with the same id). */
  setOverlay(overlay: AnalysisOverlay): void;
  clearOverlay(id: string): void;
  /** Draws the selection; it stays (across new bodies) until the next call. The shown workspace sets it and puts back NO_HIGHLIGHT on hide. */
  showSelection(highlight: ViewportHighlight): void;
  /**
   * Called on every click in the viewport; the shown workspace sets it and
   * puts back null on hide. While it is set, the face or edge under the
   * pointer is drawn hovered.
   */
  onPick: ((pick: ViewportPick) => void) | null;
  /** Draws these sketches (replacing the ones drawn before); an empty list draws none. While one is being edited the ground grid gives way to its own. */
  showSketches(drawings: readonly SketchDrawing[]): void;
  /**
   * Draws the origin planes small at the origin for picking (a click on an
   * offered one picks it); an empty list takes them away. `faces` (step
   * 26d) are the body's faces that can be picked as well (by index, as
   * picks give them): while planes are shown, the pointer lights only an
   * offered plane or one of these faces, never an edge.
   */
  showPlanes(planes: readonly OriginPlane[], faces?: readonly number[]): void;
  /**
   * Which of the origin's axes and planes the browser's eyes show
   * (Ben, 2026-10-29: an eye on everything): `axes` X, Y and Z, each drawn
   * from the origin as before or not; `planes` drawn as faint squares
   * from the origin (none at first, as in Fusion). Until called, every
   * axis shows and no plane does; a workspace that calls it puts that back
   * when it is put away.
   */
  showOrigin(shown: OriginShown): void;
  /**
   * Draws Extrude's outlines to pick, its preview and its arrow (UX1b);
   * null takes them away. While shown, clicks and arrow drags in the
   * viewport go to onExtrudePointer instead of onPick.
   */
  showExtrude(show: ExtrudeShow | null): void;
  /** Hears the pointer while Extrude is shown; the shown workspace sets it and puts back null on hide. */
  onExtrudePointer: ((pointer: ExtrudePointer) => void) | null;
  /**
   * Draws the Move tool's arrows and rings (35e2c); null takes them away.
   * While shown, a press on one drags it (whatever the navigation mode) and
   * the drag goes to onMovePointer, never to onPick.
   */
  showMoveHandles(show: MoveHandlesShow | null): void;
  /** Hears the Move handles' drags; the shown workspace sets it and puts back null on hide. */
  onMovePointer: ((pointer: MovePointer) => void) | null;
  /**
   * While set and a sketch is being edited (showSketches), clicks and
   * hovers over the viewport come here instead of onPick, with where they
   * meet that sketch's plane. The shown workspace sets it and puts back
   * null on hide.
   */
  onSketchPointer: ((pointer: SketchPointer) => void) | null;
  /**
   * Shows an image as a flat sheet at its real size in mm, lying on the XY
   * plane with its centre at the origin and its top towards +Y, in a
   * top-down 2D view (pan and zoom, no orbit; the standard views and fit
   * all frame the sheet). The body is hidden meanwhile. A second call
   * replaces the image and keeps the camera. Throws a readable Error when
   * the screen's graphics can't hold an image that large. Null shows the
   * same 2D view with nothing in it (a workspace with no image open yet):
   * the background only, never the body.
   */
  showImage(image: ImageRep | null): void;
  /** Leaves the 2D view, removing any image, and gives back the body and the 3D camera as they were before showImage. Does nothing when no image is shown. */
  clearImage(): void;
}

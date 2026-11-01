// The P1S's build area in the design (Ben, 2026-11-01): a box the size of
// what the printer prints, drawn where the slicer will put the plate under
// the bodies shown, red when they won't fit, with the reason in words. It
// follows the slicing engine's own placement rule for the P1S file, so the
// box goes red exactly when Slice for printing would refuse the part as
// off the plate (checked against the engine in test/build-area.test.ts):
//
// - the bodies' footprint (their box seen from above) is centred on the
//   256 × 256 mm plate, whatever their place in the design;
// - the front 5 mm strip is the prime line's: a part reaching into it is
//   moved back, and refused when it is then off the plate (so a part fits
//   at most 251 mm deep);
// - the plate's front-left corner (x < 18 and y < 28 mm) must stay clear:
//   the part (its triangles seen from above, not its box) is moved right
//   or back, whichever is shorter and stays on the plate, else refused;
// - the lowest point goes on the plate, and nothing may print above
//   250 mm (the P1S's printable height under its 256 mm frame).
//
// Placement is in design millimetres, z up; the plate's corner (0, 0) is the
// design point -by.

/** The P1S's plate and height, the prime line's strip and the corner kept clear (mm), as the engine has them. */
export const P1S_AREA: PrinterArea = { width: 256, depth: 256, height: 250, primeStrip: 5, keepOut: { x: 18, y: 28 } };

/** A printer's plate (width × depth), printable height, front prime strip and front-left corner kept clear (mm). */
export interface PrinterArea {
  width: number;
  depth: number;
  height: number;
  primeStrip: number;
  keepOut: { x: number; y: number };
}

/** A mesh seen as the build area reads it: flat xyz positions and triangles (three indices each). */
export interface AreaMesh {
  positions: readonly number[];
  indices: readonly number[];
}

/** Where the build area is drawn, and whether the bodies fit in it. */
export interface BuildArea {
  /** The printable box's corners in the design (mm): the plate under the bodies' lowest point, 250 mm high. */
  lo: [number, number, number];
  hi: [number, number, number];
  /** The front strip (the prime line's) and the front-left corner kept clear, on the plate, each [x0, y0, x1, y1] in the design. */
  strip: [number, number, number, number];
  corner: [number, number, number, number];
  /** Why the bodies don't fit, in words; null when they fit. */
  outside: string | null;
}

const mm = (v: number) => String(Math.round(v * 10) / 10);

/**
 * The least x of triangle `c` (seen from above) cut to y < at, or of y cut
 * to x < at when `swap`: its corners below the line and where its edges
 * cross it (the engine's `least_below`).
 */
function leastBelow(c: readonly (readonly [number, number])[], at: number, swap: boolean): number {
  const along = (p: readonly [number, number]) => (swap ? p[0] : p[1]);
  const value = (p: readonly [number, number]) => (swap ? p[1] : p[0]);
  let least = Infinity;
  for (let k = 0; k < 3; k++) {
    const a = c[k];
    const b = c[(k + 1) % 3];
    const [u, v] = [along(a), along(b)];
    if (u < at) least = Math.min(least, value(a));
    if ((u < at) !== (v < at)) {
      const t = (at - u) / (v - u);
      least = Math.min(least, value(a) + t * (value(b) - value(a)));
    }
  }
  return least;
}

/**
 * How far the bodies moved by `by` must go right (x) or back (y) to clear
 * the plate's front-left corner; null when they already do (the engine's
 * `keep_out_moves`: by their triangles, so a disc whose box overlaps the
 * corner but which does not stays put).
 */
export function keepOutMoves(meshes: readonly AreaMesh[], by: readonly [number, number], printer: PrinterArea = P1S_AREA): [number, number] | null {
  const { x: kx, y: ky } = printer.keepOut;
  let leastX = Infinity;
  let leastY = Infinity;
  for (const m of meshes) {
    for (let t = 0; t + 2 < m.indices.length; t += 3) {
      const c = [0, 1, 2].map((k) => {
        const i = 3 * m.indices[t + k];
        return [m.positions[i] + by[0], m.positions[i + 1] + by[1]] as const;
      });
      if (c.some((p) => p[1] < ky)) leastX = Math.min(leastX, leastBelow(c, ky, false));
      if (c.some((p) => p[0] < kx)) leastY = Math.min(leastY, leastBelow(c, kx, true));
    }
  }
  return leastX < kx ? [kx - leastX, ky - leastY] : null;
}

/**
 * The P1S's build area under `meshes` (the bodies shown), as the slicer
 * would place them for its print file; null with no body. When they don't
 * fit, `outside` says why and the box stays centred under them. `printer`
 * is the P1S's; another only for tests (a planted break).
 */
export function buildArea(meshes: readonly AreaMesh[], printer: PrinterArea = P1S_AREA): BuildArea | null {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    for (let i = 0; i + 2 < m.positions.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], m.positions[i + a]);
        hi[a] = Math.max(hi[a], m.positions[i + a]);
      }
    }
  }
  if (!(lo[0] <= hi[0])) return null;
  const { width, depth, height, primeStrip, keepOut } = printer;
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  let by: [number, number] = [width / 2 - (lo[0] + hi[0]) / 2, depth / 2 - (lo[1] + hi[1]) / 2];
  const off = (b: readonly [number, number]) => !(lo[0] + b[0] >= 0 && hi[0] + b[0] <= width && lo[1] + b[1] >= 0 && hi[1] + b[1] <= depth);
  const area = (outside: string | null): BuildArea => ({
    lo: [-by[0], -by[1], lo[2]],
    hi: [width - by[0], depth - by[1], lo[2] + height],
    strip: [-by[0], -by[1], width - by[0], primeStrip - by[1]],
    corner: [-by[0], -by[1], keepOut.x - by[0], keepOut.y - by[1]],
    outside,
  });
  const tall = size[2] > height ? ` and ${mm(size[2])} mm tall (${height} mm fits)` : "";
  if (off(by)) {
    const parts = [size[0] > width ? `${mm(size[0])} mm wide` : "", size[1] > depth ? `${mm(size[1])} mm deep` : ""].filter(Boolean).join(" and ");
    return area(`Too big for the P1S's plate: the bodies shown are ${parts} (${width} × ${depth} mm fits)${tall}.`);
  }
  if (lo[1] + by[1] < primeStrip) {
    const back: [number, number] = [by[0], by[1] + primeStrip - (lo[1] + by[1])];
    if (off(back)) return area(`Too deep for the P1S: the bodies shown are ${mm(size[1])} mm deep, and the front ${primeStrip} mm of the plate is kept for the nozzle's prime line (${depth - primeStrip} mm fits)${tall}.`);
    by = back;
  }
  const moves = keepOutMoves(meshes, by, printer);
  if (moves !== null) {
    const right: [number, number] = [by[0] + moves[0], by[1]];
    const backward: [number, number] = [by[0], by[1] + moves[1]];
    const [r, b] = [off(right), off(backward)];
    if (!r && (b || moves[0] <= moves[1])) by = right;
    else if (!b) by = backward;
    else return area(`The bodies shown reach into the P1S plate's front-left corner, which must stay clear, and moving them right or back would take them off the plate: make them smaller or turn them (up to ${width - keepOut.x} mm wide or ${depth - keepOut.y} mm deep fits)${tall}.`);
  }
  if (size[2] > height) return area(`Too tall for the P1S: the bodies shown are ${mm(size[2])} mm tall (${height} mm fits).`);
  return area(null);
}

/** The browser's Origin row for the build area (an eye only: not a plane to sketch on, not in the design's file). */
export const BUILD_AREA_ROW = "origin-build-area";
/** Its row's name and hover words. */
export const BUILD_AREA_LABEL = "Build area (P1S)";
export const BUILD_AREA_TITLE = "Shows what a Bambu Lab P1S can print (256 × 256 mm, 250 mm high), where Slice for printing will put the plate under the bodies shown; red when they won't fit, and why.";

/** Where the eye's choice is kept: a view setting of this browser, like the nozzle, never part of a design. */
export const BUILD_AREA_KEY = "spindlelabs.design.buildArea";

/** Whether the build area is shown (off until its eye is opened); false when storage is blocked. */
export function buildAreaShownIn(storage: Pick<Storage, "getItem"> | null): boolean {
  try {
    return storage?.getItem(BUILD_AREA_KEY) === "shown";
  } catch {
    return false;
  }
}

/** Keeps the eye's choice (shown or not); storage blocked: it holds for this page only. */
export function keepBuildAreaShown(storage: Pick<Storage, "setItem" | "removeItem"> | null, shown: boolean): void {
  try {
    if (shown) storage?.setItem(BUILD_AREA_KEY, "shown");
    else storage?.removeItem(BUILD_AREA_KEY);
  } catch {
    // Blocked: the choice still holds until the page reloads.
  }
}

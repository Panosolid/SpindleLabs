// The 3D view's backdrop for pixel checks (UX2): packages/viewport/src/backdrop.ts
// draws a gradient from (30, 38, 52) on the canvas's top row to (14, 16, 22) on
// its bottom row, so an empty pixel's colour depends on its height. Written out
// again here (not imported), so a change there must be made here on purpose:
// halfway down it is ((30 + 14) / 2, (38 + 16) / 2, (52 + 22) / 2) = (22, 27, 37).

const TOP = [30, 38, 52];
const BOTTOM = [14, 16, 22];

/** The empty view's colour a fraction `fy` of the way down the canvas (0 the top row, 1 the bottom). */
export const backdropAt = (fy) => TOP.map((t, i) => t + (BOTTOM[i] - t) * Math.min(1, Math.max(0, fy)));

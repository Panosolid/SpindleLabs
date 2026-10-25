// Bugs planted for the stacked face sketches (journeys/face-stack.journey.ts,
// Ben's idea of 2026-10-24), planted one at a time by run.ts (`--stack`) like
// model-faults.ts's; test/planted.test.ts checks each still applies.

import type { Plant } from "./model-faults.ts";

/** A plant run by the stack journey alone. */
export type StackPlant = Omit<Plant, "run"> & { run: ["stack"] };

const REBUILD = "workspaces/design/src/rebuild.ts";
const FACE = "workspaces/design/src/face-sketch.ts";
const HISTORY = "packages/core/src/model/history.ts";

/**
 * Bugs planted for the stacked face sketches (journeys/face-stack.journey.ts,
 * Ben's idea of 2026-10-24): each a mistake in Design's or core's own code
 * that a chain of sketches on faces would show, `caught` the check named in
 * the journey's first failure (src/stack-design.ts StackFailure: the check,
 * then "after" the step).
 */
export const STACK_PLANTS: Record<string, StackPlant> = {
  "face-flip-ignored": {
    what: "Flip is ignored on an extrude of a face sketch: it always grows the way the sketch faces",
    edits: [{ file: REBUILD, find: "const back = (at.side === -1) !== flip;", replace: "const back = at.side === -1;" }],
    run: ["stack"],
    caught: "face after",
  },
  "cache-ignores-frame": {
    what: "the body cache knows a placed extrude by its profile and distance alone, so a sketch moved with its face keeps its old body",
    edits: [{ file: REBUILD, find: "const key = JSON.stringify(spec);", replace: 'const key = JSON.stringify(spec).replace(/"frame":\{[^}]*\},?/, "");' }],
    run: ["stack"],
    caught: "face after",
  },
  "frame-turns-back": {
    what: "a face sketch's x axis is turned the wrong way (from the face's new normal to the drawn one) when its face turns",
    edits: [{ file: FACE, find: "xAxis: turned(drawn.xAxis, drawn.normal, n), normal: n })!;", replace: "xAxis: turned(drawn.xAxis, n, drawn.normal), normal: n })!;" }],
    run: ["stack"],
    caught: "placement after",
  },
  "origin-drifts": {
    what: "a face sketch's origin, worked out again on every rebuild, is put 1e-8 of its distance from the world's origin too far along the normal (half a nanometre at 50 mm)",
    edits: [{ file: FACE, find: "origin: scale(n, dot(point, n)),", replace: "origin: scale(n, dot(point, n) * (1 + 1e-8))," }],
    run: ["stack"],
    caught: "placement after",
  },
  "undo-goes-two": {
    what: "undo puts back the state two steps back",
    edits: [{ file: HISTORY, find: "      go(index - 1);\n      return label;", replace: "      go(Math.max(0, index - 2));\n      return label;" }],
    run: ["stack"],
    caught: "undo and redo after",
  },
};

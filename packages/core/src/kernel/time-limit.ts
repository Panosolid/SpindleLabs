// How long each kernel call may take before the app gives up on it (step
// 35d3, the kernel watchdog of the boolean plan's rule 6: the only
// wall-clock limit anywhere, so a result never depends on the machine, only
// whether it arrived in time).
//
// A call's limit is its size in "calibration units", times how long one
// unit takes on this device, times HEADROOM, and never under the floor. One
// unit is the calibration boolean: two 10 mm cubes overlapping corner to
// corner, joined (36 face pairs), which the worker times as it starts
// (kernel.worker.ts, `calibrate`), so a slow phone gets limits as much
// longer as its kernel is slower, and is never failed for being slow.
//
// The cost per unit of size is measured on the shipped WebAssembly build
// against that same calibration boolean (2026-10-31, 1.0 ms a unit, the
// 35d2 kernel in Node): each is the worst ratio over sizes, which comes at
// the largest legal input, since every cost grows a little faster than its
// size. So the limit of any legal call is at least HEADROOM times what it
// needs, on any device whose calibration is as slow as its other calls.
import type { KernelOps } from "./kernel-client.ts";
import type { BodyHandle, BodySpec, Loop, Outline, ShapeSpec } from "./kernel-types.ts";

/** No call's limit is shorter: several seconds, so a call never fails for a hiccup of a busy device. */
export const LIMIT_FLOOR_MS = 10_000;

/** How many times its measured worst cost a call may take (as `tests/worst_case.rs` allows the kernel's own budgets: about four). */
export const HEADROOM = 4;

/**
 * One calibration unit's time when the worker didn't measure it (a build
 * without the calibration boolean): 20 ms, twenty times this measuring
 * machine, a slow phone's worth.
 */
export const DEFAULT_UNIT_MS = 20;

/**
 * Units per face pair of a boolean (target faces × tool faces). Measured on
 * crossed gratings of n slots (6 + 4n faces each): A − B, the slowest op,
 * took 0.022 units a pair at n = 5, 0.052 at 20, 0.082 at 55 and 0.166 at
 * 111 (33,613 ms for 202,500 pairs), the costliest legal boolean
 * (`tests/worst_case.rs`).
 */
export const UNITS_PER_PAIR = 0.17;

/**
 * The most face pairs one boolean is timed for: the costliest legal boolean's
 * (111-slot gratings, 450 faces each). Bodies with more faces meet in fewer
 * places than the kernel's cap on meeting points allows, or are refused.
 */
export const MOST_PAIRS = 450 * 450;

/**
 * Units per corner of a body's profile (a circle counting as one, as the
 * kernel counts them): a 100 m plate with 1,996 round holes at the most
 * chords, the most corners a profile may have, built in 18,270 ms and shown
 * in 3,560 ms (10.9 units a corner); 5.8 a corner with 100 holes.
 */
export const UNITS_PER_CORNER = 11;

/** Units of a sphere's mesh at the most chords (a 500 mm sphere: 60 ms to show, 2 faces, 65,024 triangles). */
export const UNITS_PER_SPHERE = 60;

/**
 * Units per face of a body the kernel meshes again (body_view of a hidden
 * body, its STL or STEP), when the face's shape isn't known: a planar face
 * of the 1,996-hole plate took 1.8, a sphere's 30.
 */
export const UNITS_PER_FACE = 30;

/**
 * Units of a sketch's outline per curve, and per pair of curves (each pair
 * is checked for crossings): a closed loop of 2,000 lines took 458 ms
 * (0.23 a curve; 1.15e-4 a pair), 100 lines 5.3 ms (0.053; 5.3e-4).
 */
export const UNITS_PER_CURVE = 0.25;
export const UNITS_PER_CURVE_PAIR = 1.2e-4;

/** The units of finding the outline of a sketch of `curves` lines, circles and arcs. */
export function sketchUnits(curves: number): number {
  return UNITS_PER_CURVE * curves + UNITS_PER_CURVE_PAIR * curves * curves;
}

/**
 * Units of slicing per triangle per layer. Measured at 0.2 mm layers, 3
 * walls, 15 % infill: a 20 mm box 0.06 (12 triangles, 100 layers, 74 ms), a
 * 100 mm cylinder 0.018 (628, 500, 5.5 s), 2 mm gratings of 20 to 55 slots
 * up to 0.073 (1,112 triangles, 10 layers, 813 ms).
 */
export const UNITS_PER_TRIANGLE_LAYER = 0.1;

/**
 * The units of slicing `stl` (binary STL files back to back, as slice_stl
 * takes them) at `layerHeight`: its triangles times its layers (its height
 * over the layer height). A file that doesn't read as STL is refused by the
 * kernel at once, so the part read so far is all that counts.
 */
export function sliceUnits(stl: Uint8Array, layerHeight: number): number {
  const data = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  let triangles = 0;
  let low = Infinity;
  let high = -Infinity;
  for (let at = 0; at + 84 <= stl.byteLength; ) {
    const count = data.getUint32(at + 80, true);
    if (at + 84 + 50 * count > stl.byteLength) break;
    for (let t = 0; t < count; t++) {
      const corners = at + 84 + 50 * t + 12;
      for (let c = 0; c < 3; c++) {
        const z = data.getFloat32(corners + 12 * c + 8, true);
        if (z < low) low = z;
        if (z > high) high = z;
      }
    }
    triangles += count;
    at += 84 + 50 * count;
  }
  const layers = Math.ceil((high - low) / layerHeight);
  return Number.isFinite(layers) && layers > 0 ? UNITS_PER_TRIANGLE_LAYER * triangles * layers : 0;
}

/** A built body's size, as the limits read it: its faces (for booleans) and the units of meshing it again (for its view, STL and STEP). */
export interface BodySize {
  faces: number;
  mesh: number;
}

const loopCorners = (loop: Loop) => ("circle" in loop ? 1 : loop.path.corners.length / 2);

function shape(spec: BodySpec): ShapeSpec {
  return "moved" in spec ? spec.moved.body : spec;
}

/** The units of building `spec` and showing it (make_*, body_build, export_stl). */
export function buildUnits(spec: BodySpec): number {
  const s = shape(spec);
  if ("box" in s) return 4 * UNITS_PER_CORNER;
  if ("cylinder" in s) return UNITS_PER_CORNER;
  if ("sphere" in s) return UNITS_PER_SPHERE;
  const { outer, holes } = s.extrude.profile;
  return UNITS_PER_CORNER * [outer, ...holes].reduce((n, loop) => n + loopCorners(loop), 0);
}

/** How many faces `spec` builds: a face per profile corner (a circle's one) and the two caps; a box 6, a cylinder 3, a sphere 2. */
export function buildFaces(spec: BodySpec): number {
  const s = shape(spec);
  if ("box" in s) return 6;
  if ("cylinder" in s) return 3;
  if ("sphere" in s) return 2;
  const { outer, holes } = s.extrude.profile;
  return 2 + [outer, ...holes].reduce((n, loop) => n + loopCorners(loop), 0);
}

/** A built body's size, from its spec. */
export function builtSize(spec: BodySpec): BodySize {
  return { faces: buildFaces(spec), mesh: buildUnits(spec) };
}

/** The size of a body with `faces` faces whose shapes aren't known (a boolean's result). */
export function facesSize(faces: number): BodySize {
  return { faces, mesh: faces * UNITS_PER_FACE };
}

/**
 * The units of a boolean of `target` with each of `tools` in turn: each
 * tool meets every piece so far, at most all the faces of the target and
 * the tools before it, each step's pairs up to MOST_PAIRS.
 */
export function booleanUnits(target: BodySize, tools: BodySize[]): number {
  let faces = target.faces;
  let units = 0;
  for (const tool of tools) {
    units += Math.min(faces * tool.faces, MOST_PAIRS) * UNITS_PER_PAIR;
    faces += tool.faces;
  }
  return units;
}

/** The time limit, in ms, of a call of `units` on a device where a unit takes `unitMs`, no shorter than `floorMs`. */
export function limitMs(units: number, unitMs: number, floorMs: number = LIMIT_FLOOR_MS): number {
  return Math.max(floorMs, units * unitMs * HEADROOM);
}

/** A handle's size, for the calls that read it. */
export type SizeOf = (body: BodyHandle) => BodySize | undefined;

/**
 * The units of one call (`op` with `args`, handles as the app holds them;
 * `sizeOf` gives a live handle's size). The quick calls (version, the
 * pointer's rounding, freeing, counting) have none: the floor is theirs.
 */
export function callUnits<K extends keyof KernelOps>(op: K, args: KernelOps[K]["args"], sizeOf: SizeOf): number {
  const a = args as unknown[];
  switch (op) {
    case "make_box":
      return buildUnits({ box: { width: 1, depth: 1, height: 1 } });
    case "make_cylinder":
      return buildUnits({ cylinder: { radius: 1, height: 1 } });
    case "make_sphere":
      return buildUnits({ sphere: { radius: 1 } });
    case "make_extrude":
      return buildUnits({ extrude: { profile: a[0] as Outline, distance: 1 } });
    case "body_build":
    case "export_stl":
      return buildUnits(a[0] as BodySpec);
    case "body_view":
    case "body_stl":
    case "body_step":
      return sizeOf(a[0] as BodyHandle)?.mesh ?? 0;
    case "sketch_outline":
      return sketchUnits((a[0] as unknown[]).length + (a[1] as unknown[]).length + (a[2] as unknown[]).length);
    case "slice_stl":
    case "print_file_stl":
      return sliceUnits(a[0] as Uint8Array, a[1] as number);
    default:
      return 0;
  }
}

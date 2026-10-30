// The print preview's playback (H2b, H2c): a slice's G-code played through
// the replayer (gcode.ts, the same one that checks every slice), so the
// preview and its time-lapse show what the printer would do, never a
// separate drawing. Every move of the nozzle becomes one or more straight
// pieces on a clock that starts at 0 with the first move; an arc is cut
// into pieces no more than 5° each, its time shared out by length.
//
// The clock is the replayer's: each move at its feed rate with no
// acceleration, so it runs a little fast against a real printer. It is a
// playback clock, for ordering and pacing the time-lapse; the print time
// the app shows is the engine's estimate, never this.
//
// A layer is a run of extruded pieces at one height: a new one starts when
// the nozzle lays plastic more than STILL above the last layer's height.
// Travels, retractions and primes are kept (the nozzle moves along them in
// the time-lapse) but never drawn as plastic.

import { replay, STILL, type GcodeProblem, type Move, type ReplayOptions } from "./gcode.ts";

/** What a piece of plastic is, from the slicer's `;TYPE:` comments, so the preview colours it. */
export type PrintKind = "outer-wall" | "inner-wall" | "solid-infill" | "sparse-infill" | "support" | "prime" | "other";

/** The `;TYPE:` names our engine writes (and PrusaSlicer's and Bambu Studio's alike), as kinds; any other is "other". */
export function kindOf(feature: string | undefined): PrintKind {
  const f = (feature ?? "").trim().toLowerCase();
  if (f === "outer wall" || f === "external perimeter") return "outer-wall";
  if (f === "inner wall" || f === "perimeter") return "inner-wall";
  if (f === "solid infill" || f === "top surface" || f === "bottom surface" || f === "top solid infill" || f === "internal solid infill") return "solid-infill";
  if (f === "sparse infill" || f === "internal infill") return "sparse-infill";
  if (f.startsWith("support")) return "support";
  if (f === "prime line" || f === "skirt" || f === "brim" || f === "skirt/brim") return "prime";
  return "other";
}

/** The kinds in the order the legend lists them. */
export const PRINT_KINDS: readonly PrintKind[] = ["outer-wall", "inner-wall", "solid-infill", "sparse-infill", "support", "prime", "other"];

/** One layer: its height above the bed and thickness (mm), its pieces (`first` up to but not `end`) and when it starts and ends on the clock (s). */
export interface PlaybackLayer {
  z: number;
  height: number;
  first: number;
  end: number;
  start: number;
  finish: number;
}

/**
 * A slice ready to play. Pieces are in printing order, every nozzle move
 * included; piece i runs from (x, y, z) at `from[3i…]` to `to[3i…]`
 * between `start[i]` and `finish[i]` on the clock. `drawn[i]` is how many
 * plastic pieces come before piece i, so a renderer holding only the
 * plastic in order shows the first `drawn[i]` of them while piece i runs.
 */
export interface Playback {
  count: number;
  from: Float64Array;
  to: Float64Array;
  start: Float64Array;
  finish: Float64Array;
  /** 1 for plastic, 0 for a travel, retraction or prime. */
  plastic: Uint8Array;
  kind: PrintKind[];
  /**
   * The plastic's line width (mm) worked out from its volume, as a printed bead: a rectangle as tall as the
   * layer with half-round sides, area (w − h) × h + π(h/2)², so w = volume ÷ (length × h) + h(1 − π/4);
   * 0 for a move laying none. (Taken as a plain rectangle, a 0.42 mm line read as 0.38 mm.)
   */
  width: Float64Array;
  /** Which layer a piece belongs to: the layer it is drawn in, or for a nozzle move the last layer started (−1 before the first). */
  layer: Int32Array;
  drawn: Uint32Array;
  plasticCount: number;
  layers: PlaybackLayer[];
  /** The clock's last second. */
  seconds: number;
  problems: GcodeProblem[];
}

/** A bead's half-round sides add h(1 − π/4) to the width a plain rectangle of the same area would have. */
const BEAD_SIDES = 1 - Math.PI / 4;

/** The most an arc turns in one piece: 5°. */
export const ARC_STEP = Math.PI / 36;

interface Piece {
  from: [number, number, number];
  to: [number, number, number];
  seconds: number;
}

/** A move as straight pieces: a straight move is one, an arc as many as keeps each under ARC_STEP, the time shared out evenly (an arc's pieces are all one length). */
function piecesOf(m: Move): Piece[] {
  if (!m.arc) return [{ from: [m.from.x, m.from.y, m.from.z], to: [m.to.x, m.to.y, m.to.z], seconds: m.seconds }];
  const { centre, clockwise, sweep } = m.arc;
  const n = Math.max(1, Math.ceil(sweep / ARC_STEP - 1e-9));
  const r = Math.hypot(m.from.x - centre.x, m.from.y - centre.y);
  const a0 = Math.atan2(m.from.y - centre.y, m.from.x - centre.x);
  const turn = clockwise ? -1 : 1;
  const out: Piece[] = [];
  let prev: [number, number, number] = [m.from.x, m.from.y, m.from.z];
  for (let k = 1; k <= n; k++) {
    // The last piece ends exactly where the replayer says the arc ends.
    const at: [number, number, number] =
      k === n ? [m.to.x, m.to.y, m.to.z] : [centre.x + r * Math.cos(a0 + (turn * sweep * k) / n), centre.y + r * Math.sin(a0 + (turn * sweep * k) / n), m.from.z + ((m.to.z - m.from.z) * k) / n];
    out.push({ from: prev, to: at, seconds: m.seconds / n });
    prev = at;
  }
  return out;
}

/** Plays `gcode` through the replayer and lays its moves out on the clock, layer by layer. Never throws: what the replayer can't follow is in `problems`. */
export function playback(gcode: string, options: ReplayOptions = {}): Playback {
  const r = replay(gcode, options);
  const pieces: { piece: Piece; plastic: boolean; kind: PrintKind; volume: number }[] = [];
  for (const m of r.moves) {
    const parts = piecesOf(m);
    const plastic = m.kind === "extrude" && m.volume > 0;
    for (const p of parts) pieces.push({ piece: p, plastic, kind: kindOf(m.feature), volume: plastic ? m.volume / parts.length : 0 });
  }
  const count = pieces.length;
  const out: Playback = {
    count,
    from: new Float64Array(3 * count),
    to: new Float64Array(3 * count),
    start: new Float64Array(count),
    finish: new Float64Array(count),
    plastic: new Uint8Array(count),
    kind: [],
    width: new Float64Array(count),
    layer: new Int32Array(count),
    drawn: new Uint32Array(count),
    plasticCount: 0,
    layers: [],
    seconds: 0,
    problems: r.problems,
  };
  let clock = 0;
  let drawn = 0;
  let layer: PlaybackLayer | null = null;
  for (let i = 0; i < count; i++) {
    const { piece, plastic, kind, volume } = pieces[i];
    out.from.set(piece.from, 3 * i);
    out.to.set(piece.to, 3 * i);
    out.start[i] = clock;
    clock += piece.seconds;
    out.finish[i] = clock;
    out.kind.push(kind);
    out.drawn[i] = drawn;
    if (plastic) {
      const z = Math.max(piece.from[2], piece.to[2]);
      if (layer === null || z > layer.z + STILL) {
        if (layer !== null) layer.end = drawn;
        const below: number = layer === null ? 0 : layer.z;
        layer = { z, height: z - below, first: drawn, end: drawn, start: out.start[i], finish: clock };
        out.layers.push(layer);
      }
      layer.finish = clock;
      const length = Math.hypot(piece.to[0] - piece.from[0], piece.to[1] - piece.from[1], piece.to[2] - piece.from[2]);
      out.width[i] = length > STILL && layer.height > STILL ? volume / (length * layer.height) + layer.height * BEAD_SIDES : 0;
      out.plastic[i] = 1;
      drawn++;
    }
    out.layer[i] = out.layers.length - 1;
  }
  if (layer !== null) layer.end = drawn;
  out.plasticCount = drawn;
  out.seconds = clock;
  return out;
}

/** Where the print is at second `t` of the clock: the piece running, how far along it (0 to 1), the nozzle, and how many plastic pieces are laid (the running one, if plastic, only partly). */
export interface PlaybackMoment {
  piece: number;
  along: number;
  nozzle: [number, number, number];
  laid: number;
  layer: number;
}

/** The moment at second `t` (clamped to the clock); null for a slice with no moves. */
export function momentAt(p: Playback, t: number): PlaybackMoment | null {
  if (p.count === 0) return null;
  const at = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), p.seconds);
  // The first piece that has not finished by `at` (the last at the very end).
  let lo = 0;
  let hi = p.count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p.finish[mid] <= at) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  const span = p.finish[i] - p.start[i];
  const along = span > 0 ? Math.min(Math.max((at - p.start[i]) / span, 0), 1) : 1;
  const nozzle: [number, number, number] = [0, 1, 2].map((k) => p.from[3 * i + k] + (p.to[3 * i + k] - p.from[3 * i + k]) * along) as [number, number, number];
  return { piece: i, along, nozzle, laid: p.drawn[i] + (p.plastic[i] && along >= 1 ? 1 : 0), layer: p.layer[i] };
}

/** The clock's second at which layer `n` (from 0) is finished, so a layer slider and the time-lapse share one clock. */
export function layerDone(p: Playback, n: number): number {
  if (p.layers.length === 0) return 0;
  const k = Math.min(Math.max(Math.round(n), 0), p.layers.length - 1);
  return p.layers[k].finish;
}

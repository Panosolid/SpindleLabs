// The replay checks (Slice P0b): what a replayed G-code file (`replay` in
// gcode.ts) must satisfy before a slice can be trusted. Each check returns
// the problems it found, by line, and an empty list when it passes; each is
// tested with a fault planted in a good file that it must catch
// (test/gcode-checks.test.ts).
//
// - `checkProblems`: every problem the replay itself found (an inch unit, a
//   flow or tool change, an arc it couldn't follow…) fails the file, by line.
// - `checkVolume`: the plastic laid down is within a stated allowance of
//   what the part needs (walls plus the infill's share, worked out by the
//   caller from the part).
// - `checkPrinter`: every point of every move (an arc's furthest points
//   too) stays on the bed and below the printer's height; no feed rate past
//   the printer's fastest; no temperature past the nozzle's or bed's
//   highest.
// - `checkTravel`: no travel crosses a wall without retracting first. The
//   walls are the outlines given per layer, or, with none given, everything
//   already extruded on that layer when the travel starts (stricter: it
//   also refuses crossing infill).
// - `checkLayers`: layers go up and never back down, every layer height
//   (and the first layer's, from the bed at z 0) within decision 7's
//   limits, 0.04–1.0 mm (each allowed STILL of rounding, since a height is
//   the difference of two Z values read from text), and every wall closed: each unbroken run of a wall
//   feature ends where it started, within `closeWithin`.
//
// Geometry here is plain floating point with strict tests (a travel only
// touching a wall at an end point, or running along it, is not a crossing);
// the slices it judges are made of millimetre-sized moves, far from where
// rounding could flip a sign.

import { STILL, type Move, type Replay } from "./gcode.ts";

export interface CheckProblem {
  check: "replay" | "volume" | "bed" | "height" | "feed" | "temperature" | "travel" | "layer-order" | "layer-height" | "open-wall";
  /** The G-code line at fault, or 0 for the whole file. */
  line: number;
  text: string;
}

/** The replay's own problems, as check problems: a file the replayer couldn't follow faithfully can't pass. */
export function checkProblems(r: Replay): CheckProblem[] {
  return r.problems.map((p) => ({ check: "replay", line: p.line, text: `${p.kind}: ${p.text}` }));
}

/** Decision 7's layer height limits, mm. */
export const MIN_LAYER = 0.04;
export const MAX_LAYER = 1.0;

/** The plastic laid down must be within `allowance` (a fraction, 0.05 = 5 %) of `expected` mm³. */
export function checkVolume(r: Replay, expected: number, allowance: number): CheckProblem[] {
  const off = Math.abs(r.volume - expected);
  if (!(off <= allowance * expected)) {
    return [{ check: "volume", line: 0, text: `${r.volume.toFixed(3)} mm³ laid down, ${expected.toFixed(3)} mm³ expected: ${((100 * off) / expected).toFixed(2)} % off, ${(100 * allowance).toFixed(2)} % allowed` }];
  }
  return [];
}

export interface Printer {
  /** The bed, from (0, 0) to (x, y), mm. */
  bed: { x: number; y: number };
  /** The highest the nozzle can go, mm. */
  height: number;
  /** The fastest feed rate, mm/min. */
  maxFeed: number;
  maxNozzle: number;
  maxBed: number;
}

/** The points of a move worth checking against a box: its ends and, for an arc, its furthest points in x and y. */
export function extremes(m: Move): { x: number; y: number; z: number }[] {
  const pts = [m.from, m.to];
  if (m.arc) {
    const { centre, clockwise, sweep } = m.arc;
    const r = Math.hypot(m.from.x - centre.x, m.from.y - centre.y);
    const a0 = Math.atan2(m.from.y - centre.y, m.from.x - centre.x);
    // Each quarter-turn direction (0, π/2, π, 3π/2) the arc sweeps through is a furthest point.
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      let along = clockwise ? a0 - a : a - a0; // how far round the arc that direction is
      along = ((along % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (along <= sweep) {
        const z = m.from.z + (m.to.z - m.from.z) * (sweep === 0 ? 0 : along / sweep);
        pts.push({ x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a), z });
      }
    }
  }
  return pts;
}

/** Everything stays on the bed and within the printer's limits. */
export function checkPrinter(r: Replay, p: Printer): CheckProblem[] {
  const out: CheckProblem[] = [];
  for (const m of r.moves) {
    for (const q of extremes(m)) {
      if (!(q.x >= 0 && q.x <= p.bed.x && q.y >= 0 && q.y <= p.bed.y)) {
        out.push({ check: "bed", line: m.line, text: `(${q.x}, ${q.y}) is off the ${p.bed.x} × ${p.bed.y} mm bed` });
        break;
      }
      if (!(q.z >= 0 && q.z <= p.height)) {
        out.push({ check: "height", line: m.line, text: `z ${q.z} is outside 0–${p.height} mm` });
        break;
      }
    }
    if (m.feed > p.maxFeed) out.push({ check: "feed", line: m.line, text: `F${m.feed} is past the printer's fastest, F${p.maxFeed}` });
  }
  for (const t of r.temperatures) {
    const max = t.heater === "nozzle" ? p.maxNozzle : p.maxBed;
    if (t.celsius > max) out.push({ check: "temperature", line: t.line, text: `${t.heater} ${t.celsius} °C is past its ${max} °C` });
  }
  return out;
}

type P2 = { x: number; y: number };

/** The move's path in XY as a polyline: an arc in pieces no more than 0.001 mm from it. */
export function pathXY(m: Move): P2[] {
  if (!m.arc) return [m.from, m.to];
  const { centre, clockwise, sweep } = m.arc;
  const r = Math.hypot(m.from.x - centre.x, m.from.y - centre.y);
  // A chord of angle θ is r(1 − cos(θ/2)) from its arc; keep that under 0.001 mm.
  const step = r > 0.001 ? 2 * Math.acos(1 - 0.001 / r) : Math.PI / 2;
  const pieces = Math.min(10_000, Math.max(1, Math.ceil(sweep / step)));
  const a0 = Math.atan2(m.from.y - centre.y, m.from.x - centre.x);
  const pts: P2[] = [m.from];
  for (let k = 1; k < pieces; k++) {
    const a = a0 + (clockwise ? -1 : 1) * (sweep * k) / pieces;
    pts.push({ x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) });
  }
  pts.push(m.to);
  return pts;
}

const cross = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Whether segments ab and cd cross properly: each strictly separates the other's ends. */
export function crosses(a: P2, b: P2, c: P2, d: P2): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** A layer: the moves printed at one height, in order. */
export interface Layer {
  z: number;
  moves: Move[];
}

/**
 * The replay's layers: a new layer starts at each extrusion at a new height. Moves that stay at a layer's
 * height belong to it; the moves from leaving it to the next extrusion belong to the next layer.
 */
export function layersOf(r: Replay): Layer[] {
  const layers: Layer[] = [];
  let pending: Move[] = [];
  for (const m of r.moves) {
    if (m.kind === "extrude") {
      const z = m.to.z;
      const last = layers[layers.length - 1];
      if (!last || Math.abs(last.z - z) >= STILL) layers.push({ z, moves: [...pending, m] });
      else last.moves.push(...pending, m);
      pending = [];
    } else {
      // A move at the current layer's height belongs to it; one that leaves it waits for the next layer.
      const last = layers[layers.length - 1];
      if (last && pending.length === 0 && Math.abs(m.from.z - last.z) < STILL && Math.abs(m.to.z - last.z) < STILL) last.moves.push(m);
      else pending.push(m);
    }
  }
  if (pending.length > 0 && layers.length > 0) layers[layers.length - 1].moves.push(...pending);
  return layers;
}

/**
 * No travel crosses a wall while the filament is pushed in. `walls`, when given, holds each layer's
 * outlines (closed polygons) by its height; without it, a layer's walls are what it has extruded so far.
 */
export function checkTravel(r: Replay, walls?: { z: number; outlines: P2[][] }[]): CheckProblem[] {
  const out: CheckProblem[] = [];
  for (const layer of layersOf(r)) {
    const segs: [P2, P2][] = [];
    if (walls) {
      const w = walls.find((l) => Math.abs(l.z - layer.z) < STILL);
      for (const ring of w?.outlines ?? []) for (let i = 0; i < ring.length; i++) segs.push([ring[i], ring[(i + 1) % ring.length]]);
    }
    for (const m of layer.moves) {
      if (m.kind === "extrude" && !walls) {
        const p = pathXY(m);
        for (let i = 0; i + 1 < p.length; i++) segs.push([p[i], p[i + 1]]);
      }
      if (m.kind !== "travel" || m.retracted) continue;
      const p = pathXY(m);
      let hit = false;
      for (let i = 0; i + 1 < p.length && !hit; i++) for (const [c, d] of segs) if (crosses(p[i], p[i + 1], c, d)) { hit = true; break; }
      if (hit) out.push({ check: "travel", line: m.line, text: `travel at z ${layer.z} crosses a wall without retracting` });
    }
  }
  return out;
}

/** Whether a feature name is a wall (the outlines other slicers and ours label as walls or perimeters). */
export const isWall = (feature: string | undefined) => feature !== undefined && /wall|perimeter/i.test(feature);

/** Layers go up, each layer height within MIN_LAYER–MAX_LAYER, and every run of wall ends where it began. */
export function checkLayers(r: Replay, closeWithin: number): CheckProblem[] {
  const out: CheckProblem[] = [];
  const layers = layersOf(r);
  let below = 0; // the bed
  for (const layer of layers) {
    const first = layer.moves.find((m) => m.kind === "extrude")!;
    const h = layer.z - below;
    if (h < 0) out.push({ check: "layer-order", line: first.line, text: `a layer at z ${layer.z} under the one before at ${below}` });
    // Heights come from subtracting two Z values read from text (0.12 − 0.08 is 0.03999999999999999), so
    // each limit is allowed STILL of rounding, far below any real difference in layer height.
    else if (!(h >= MIN_LAYER - STILL && h <= MAX_LAYER + STILL)) out.push({ check: "layer-height", line: first.line, text: `layer at z ${layer.z} is ${h.toFixed(4)} mm high, outside ${MIN_LAYER}–${MAX_LAYER} mm` });
    below = Math.max(below, layer.z);
    // Runs of wall: consecutive extrusions of a wall feature, broken by anything else.
    let run: Move[] = [];
    const close = () => {
      if (run.length > 0) {
        const a = run[0].from;
        const b = run[run.length - 1].to;
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        if (!(gap <= closeWithin)) out.push({ check: "open-wall", line: run[0].line, text: `a wall at z ${layer.z} from line ${run[0].line} to ${run[run.length - 1].line} ends ${gap.toFixed(4)} mm from its start` });
      }
      run = [];
    };
    for (const m of layer.moves) {
      if (m.kind === "extrude" && isWall(m.feature)) {
        if (run.length > 0 && run[run.length - 1].feature !== m.feature) close();
        run.push(m);
      } else close();
    }
    close();
  }
  return out;
}

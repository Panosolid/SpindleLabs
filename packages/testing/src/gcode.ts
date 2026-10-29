// The G-code replayer (Slice P0a): reads a G-code file the way a printer's
// firmware would and works out what it does, so every slice is judged by
// what the printer will actually do, never by "the preview looked right".
// Written apart from the slicing engine, which it checks.
//
// It follows each move and records where the nozzle went, how much plastic
// came out (filament length × the filament's cross-section), the
// retractions, the temperatures asked for and how long the moves take.
// It never throws: anything it can't follow is a `GcodeProblem` with its
// line number, and the replay carries on.
//
// What it understands:
// - G0/G1 straight moves (X Y Z E F), G2/G3 arcs in the XY plane given by
//   their centre (I J, from the start point); an arc given by its radius
//   (R) is a problem, not a guess.
// - G90/G91 absolute/relative axes, M82/M83 absolute/relative extruder,
//   G92 (sets the position, E included, without moving), G28 (homes the
//   named axes, or all three, to 0: printers differ here, so a slice's
//   moves are judged after its start routine's last G28).
// - G10/G11 firmware retraction, counted as retract and prime events with
//   no length known.
// - M104/M109 nozzle and M140/M190 bed temperatures (S), M106/M107 fan.
// - Line numbers (N…), checksums (*…), `;` and `( )` comments, letters in
//   either case, numbers like `.2`, `-.5` and `1.` with or without spaces
//   between words (`G1X10Y5`).
// Every other M command is listed in `ignored` (they don't move anything);
// any other G command is a problem, since it might move. Firmware macros
// (a name like EXCLUDE_OBJECT_START) are listed in `ignored` too.
//
// Firmware differs on one thing that changes the plastic laid down: G90
// after M83. Marlin makes the extruder absolute again; Klipper keeps it
// relative. Following `flavour` (Marlin by default), the replayer reports
// an "ambiguous-extruder" problem when an E value is used in that state,
// so our own writer must always say M82 or M83 after G90.
//
// Plastic: filament pushed while the nozzle moves sideways (in X or Y)
// is laid down along that move. Filament pulled back is a retraction;
// filament pushed back in afterwards first refills it (a prime, not
// plastic), and only what goes beyond is laid down (a standing push past
// the retraction is a blob at that point). Filament pushed during a move
// in Z alone is laid down there too, as a blob.
//
// Time: each move at its feed rate (F, mm/min, kept until changed) over its
// length (XYZ, or E alone for a move of the filament only), with no
// acceleration, so it is a lower bound; P6's estimate adds acceleration.

/**
 * A nozzle move shorter than this (mm) counts as standing still: a filament-only move is timed by the
 * filament and a push there is a blob or a prime. Far above the rounding of positions summed in relative
 * mode (about 1e-13 mm at 1 m) and far below any printer's step (about 0.005 mm), so firmware, which
 * counts whole steps, sees such a move as standing still too.
 */
export const STILL = 1e-6;

export type Flavour = "marlin" | "klipper";

export interface ReplayOptions {
  /** Filament diameter in mm (1.75 unless given). */
  filamentDiameter?: number;
  flavour?: Flavour;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type MoveKind = "extrude" | "travel" | "retract" | "prime" | "blob";

/** One move of the nozzle or the filament (an arc is one move). */
export interface Move {
  line: number;
  kind: MoveKind;
  from: Vec3;
  to: Vec3;
  /** Filament pushed (positive) or pulled (negative) by this move, mm. */
  e: number;
  /** Plastic laid down by this move, mm³. */
  volume: number;
  /** Length of the nozzle's path (XYZ), mm. */
  length: number;
  /** Feed rate, mm/min. */
  feed: number;
  seconds: number;
  /** The feature the slicer said it was printing (its last `;TYPE:` or `;FEATURE:` comment), if any. */
  feature?: string;
  /** Filament still pulled back when the move starts (mm), or a firmware retraction (G10) not yet primed. */
  retracted: boolean;
  /** For an arc: its centre and which way it turns; the path is the arc, not the straight line. */
  arc?: { centre: { x: number; y: number }; clockwise: boolean; sweep: number };
}

export type ProblemKind =
  | "bad-number"
  | "unknown-motion"
  | "arc-radius-form"
  | "bad-arc"
  | "no-feed-rate"
  | "ambiguous-extruder"
  | "bad-temperature";

export interface GcodeProblem {
  line: number;
  kind: ProblemKind;
  text: string;
}

export interface TemperatureEvent {
  line: number;
  heater: "nozzle" | "bed";
  celsius: number;
  /** M109/M190: waits until the heater reaches it. */
  wait: boolean;
}

export interface Replay {
  moves: Move[];
  problems: GcodeProblem[];
  temperatures: TemperatureEvent[];
  /** Lines of G28 (homing). */
  homes: number[];
  /** Firmware retractions (G10) and primes (G11), by line. */
  firmwareRetracts: { line: number; kind: "retract" | "prime" }[];
  /** M commands the replayer reads past, by name, with how many times. */
  ignored: Record<string, number>;
  /** Plastic laid down, mm³. */
  volume: number;
  /** Filament pushed in total, net of retractions, mm. */
  filament: number;
  seconds: number;
  /** Where the nozzle and the extruder ended. */
  end: Vec3 & { e: number };
}

/** One G-code line's command and words, or null for a blank or comment-only line. */
export interface GcodeWord {
  letter: string;
  value: number;
}
export interface ParsedLine {
  line: number;
  command: string;
  words: Map<string, number>;
  /** Letters given with no number (G28 X homes X); a move given one is a bad number. */
  flags: Set<string>;
  problems: GcodeProblem[];
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** Strips comments, a line number and a checksum, and splits the rest into words. */
export function parseLine(raw: string, line: number): ParsedLine | null {
  let text = raw.replace(/\([^)]*\)/g, " ");
  const semi = text.indexOf(";");
  if (semi >= 0) text = text.slice(0, semi);
  const star = text.indexOf("*");
  if (star >= 0) text = text.slice(0, star);
  text = text.trim().toUpperCase();
  if (text === "") return null;
  const problems: GcodeProblem[] = [];
  // A firmware macro (Klipper's EXCLUDE_OBJECT_START NAME=…): a name, not words; it moves nothing.
  const macro = /^([A-Z_][A-Z0-9_]*[A-Z_][A-Z0-9_]*)(\s|=|$)/.exec(text);
  if (macro && !/^[GMTN][\d.]/.test(text)) return { line, command: macro[1], words: new Map(), flags: new Set(), problems };
  // A word is a letter and everything up to the next letter.
  const parts = text.match(/[A-Z][^A-Z]*/g) ?? [];
  const words = new Map<string, number>();
  const flags = new Set<string>();
  let command = "";
  for (const part of parts) {
    const letter = part[0];
    const body = part.slice(1).replace(/\s+/g, "");
    if (letter === "N" && command === "" && words.size === 0) continue;
    if (command === "" && (letter === "G" || letter === "M" || letter === "T")) {
      command = letter + body;
      continue;
    }
    if (body === "") {
      flags.add(letter);
      continue;
    }
    // A number like 1e3 never gets here: E is a word, so X1e3 is X1 E3, as firmware reads it.
    if (!NUMBER.test(body)) {
      problems.push({ line, kind: "bad-number", text: `${letter}${body} is not a number` });
      continue;
    }
    words.set(letter, Number(body));
  }
  if (/[^A-Z0-9.+\-\s]/.test(text)) problems.push({ line, kind: "bad-number", text: `unreadable characters in "${text}"` });
  // G01 is G1, G00 is G0, M082 is M82; G29.1 keeps its point.
  command = command.replace(/^([GMT])0*(\d)/, "$1$2");
  return { line, command, words, flags, problems };
}

/** Replays a whole G-code file. Never throws. */
export function replay(text: string, options: ReplayOptions = {}): Replay {
  const diameter = options.filamentDiameter ?? 1.75;
  const flavour = options.flavour ?? "marlin";
  const area = Math.PI * (diameter / 2) ** 2;
  const out: Replay = {
    moves: [],
    problems: [],
    temperatures: [],
    homes: [],
    firmwareRetracts: [],
    ignored: {},
    volume: 0,
    filament: 0,
    seconds: 0,
    end: { x: 0, y: 0, z: 0, e: 0 },
  };
  let pos = { x: 0, y: 0, z: 0 };
  let e = 0;
  let relativeAxes = false;
  let relativeE = false;
  // Set by G90 after M83 (Marlin turns E absolute, Klipper keeps it relative) until M82/M83 settles it.
  let ambiguousE = false;
  let feed = 0;
  let retracted = 0;
  let noFeedReported = false;
  let feature: string | undefined;
  let firmwareRetracted = false;

  const lines = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    const said = /;\s*(?:TYPE|FEATURE)\s*:\s*(.*\S)/i.exec(lines[i]);
    if (said) feature = said[1];
    const parsed = parseLine(lines[i], n);
    if (parsed === null) continue;
    out.problems.push(...parsed.problems);
    const { command, words, flags } = parsed;
    if (command === "") continue; // bare words with no command: nothing a firmware would do
    switch (command) {
      case "G0":
      case "G1":
      case "G2":
      case "G3": {
        for (const letter of flags) out.problems.push({ line: n, kind: "bad-number", text: `${letter} without a number` });
        const f = words.get("F");
        if (f !== undefined) feed = f;
        const target = { ...pos };
        for (const axis of ["x", "y", "z"] as const) {
          const v = words.get(axis.toUpperCase());
          if (v !== undefined) target[axis] = relativeAxes ? pos[axis] + v : v;
        }
        let de = 0;
        const ev = words.get("E");
        if (ev !== undefined) {
          if (ambiguousE) out.problems.push({ line: n, kind: "ambiguous-extruder", text: "E after G90 that followed M83: Marlin reads it as absolute, Klipper as relative; say M82 or M83 after G90" });
          const rel = relativeAxes || relativeE;
          de = rel ? ev : ev - e;
        }
        let length: number;
        let arc: Move["arc"];
        if (command === "G2" || command === "G3") {
          if (words.has("R")) {
            out.problems.push({ line: n, kind: "arc-radius-form", text: "arcs given by R are not followed; give the centre with I and J" });
            pos = target;
            e += de;
            continue;
          }
          const ci = words.get("I") ?? 0;
          const cj = words.get("J") ?? 0;
          const centre = { x: pos.x + ci, y: pos.y + cj };
          const r0 = Math.hypot(ci, cj);
          const r1 = Math.hypot(target.x - centre.x, target.y - centre.y);
          if (r0 === 0) {
            out.problems.push({ line: n, kind: "bad-arc", text: "arc with its centre on its start (I and J both 0)" });
            pos = target;
            e += de;
            continue;
          }
          // Firmware accepts a small mismatch between the two radii; report a big one (more than 0.05 mm, Marlin's own limit).
          if (Math.abs(r1 - r0) > 0.05) out.problems.push({ line: n, kind: "bad-arc", text: `arc ends ${Math.abs(r1 - r0).toFixed(4)} mm off its circle` });
          const clockwise = command === "G2";
          const a0 = Math.atan2(pos.y - centre.y, pos.x - centre.x);
          const a1 = Math.atan2(target.y - centre.y, target.x - centre.x);
          let sweep = clockwise ? a0 - a1 : a1 - a0;
          while (sweep <= 0) sweep += 2 * Math.PI; // same start and end: a whole turn
          while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;
          const flat = sweep * r0;
          length = Math.hypot(flat, target.z - pos.z);
          arc = { centre, clockwise, sweep };
        } else {
          length = Math.hypot(target.x - pos.x, target.y - pos.y, target.z - pos.z);
        }
        const sideways = Math.hypot(target.x - pos.x, target.y - pos.y) >= STILL;
        const wasRetracted = retracted > 0 || firmwareRetracted;
        let kind: MoveKind;
        let volume = 0;
        if (de < 0) {
          kind = "retract";
          retracted -= de;
        } else if (de > 0) {
          const refill = Math.min(de, retracted);
          retracted -= refill;
          const laid = de - refill;
          volume = laid * area;
          kind = laid === 0 ? "prime" : sideways ? "extrude" : "blob";
        } else {
          kind = "travel";
        }
        // A move of the filament alone is timed over the filament's own length.
        const timed = length >= STILL ? length : Math.abs(de);
        let seconds = 0;
        if (timed > 0) {
          if (feed > 0) seconds = timed / (feed / 60);
          else if (!noFeedReported) {
            out.problems.push({ line: n, kind: "no-feed-rate", text: "a move before any feed rate (F) was given" });
            noFeedReported = true;
          }
        }
        if (length >= STILL || de !== 0) {
          out.moves.push({ line: n, kind, from: pos, to: target, e: de, volume, length, feed, seconds, retracted: wasRetracted, ...(feature !== undefined ? { feature } : {}), ...(arc ? { arc } : {}) });
        }
        out.volume += volume;
        out.filament += de;
        out.seconds += seconds;
        pos = target;
        e += de;
        break;
      }
      case "G90":
        relativeAxes = false;
        if (relativeE) {
          if (flavour === "marlin") relativeE = false;
          ambiguousE = true;
        }
        break;
      case "G91":
        relativeAxes = true;
        break;
      case "M82":
        relativeE = false;
        ambiguousE = false;
        break;
      case "M83":
        relativeE = true;
        ambiguousE = false;
        break;
      case "G92":
        for (const axis of ["x", "y", "z"] as const) {
          const v = words.get(axis.toUpperCase());
          if (v !== undefined) pos = { ...pos, [axis]: v };
        }
        if (words.has("E")) e = words.get("E")!;
        break;
      case "G28": {
        out.homes.push(n);
        const named = ["X", "Y", "Z"].filter((a) => words.has(a) || flags.has(a));
        const axes = named.length === 0 ? ["X", "Y", "Z"] : named;
        for (const a of axes) pos = { ...pos, [a.toLowerCase()]: 0 };
        break;
      }
      case "G10":
        out.firmwareRetracts.push({ line: n, kind: "retract" });
        firmwareRetracted = true;
        break;
      case "G11":
        out.firmwareRetracts.push({ line: n, kind: "prime" });
        firmwareRetracted = false;
        break;
      case "G4": // dwell: time, no movement
        out.seconds += (words.get("P") ?? 0) / 1000 + (words.get("S") ?? 0);
        break;
      case "M104":
      case "M109":
      case "M140":
      case "M190": {
        const s = words.get("S") ?? words.get("R");
        if (s === undefined || s < 0 || s > 500) {
          out.problems.push({ line: n, kind: "bad-temperature", text: `${command} without a sensible S (0–500 °C)` });
          break;
        }
        out.temperatures.push({ line: n, heater: command === "M104" || command === "M109" ? "nozzle" : "bed", celsius: s, wait: command === "M109" || command === "M190" });
        break;
      }
      default:
        if (/^G\d/.test(command)) out.problems.push({ line: n, kind: "unknown-motion", text: `${command} is not followed and might move the nozzle` });
        else out.ignored[command] = (out.ignored[command] ?? 0) + 1;
    }
  }
  out.end = { ...pos, e };
  return out;
}

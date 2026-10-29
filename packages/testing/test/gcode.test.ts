// The G-code replayer (src/gcode.ts, Slice P0a) against answers worked out
// by hand, then seeded random programs written in every style a slicer
// might use, against a simple model of the same moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLine, replay, STILL, type Replay } from "../src/gcode.ts";
import { seeded, type SeededRandom } from "../src/index.ts";

// Filament cross-section for 1.75 mm filament: π · 0.875² = 2.4052818754…mm².
const A = Math.PI * 0.875 ** 2;
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

/** A 10 mm square walked once at z 0.2 from (0, 0), pushing `perSide` mm of filament along each side. */
function square(perSide: number, mode: "M82" | "M83" = "M83"): string {
  const corners = [[10, 0], [10, 10], [0, 10], [0, 0]];
  const lines = ["G90", mode, "G92 E0", "G0 X0 Y0 Z0.2 F6000", "G1 F1800"];
  let e = 0;
  for (const [x, y] of corners) {
    e += perSide;
    lines.push(`G1 X${x} Y${y} E${mode === "M83" ? perSide : e}`);
  }
  return lines.join("\n");
}

test("hand-worked: a 10 mm square of one 0.4 mm line at a 0.2 mm layer lays down 3.2 mm³", () => {
  // The bead is a band 0.4 wide round a 10 mm square centre line: the outer edge is a 10.4 mm square, the
  // inner a 9.6 mm square, so its area is 10.4² − 9.6² = 108.16 − 92.16 = 16 mm², which is exactly
  // 4 sides × 10 × 0.4: at each corner the 0.2 × 0.2 corner square the side rectangles miss on the outside
  // is the one they overlap on the inside, so there is nothing to take off. Volume 16 × 0.2 = 3.2 mm³.
  // Filament per side: 10 × 0.4 × 0.2 / A = 0.8 / 2.40528… = 0.33260… mm.
  const perSide = (10 * 0.4 * 0.2) / A;
  const r = replay(square(perSide));
  assert.deepEqual(r.problems, []);
  assert.ok(close(r.volume, 3.2, 1e-12), `volume ${r.volume}`);
  assert.ok(close(r.filament, 4 * perSide, 1e-12));
  assert.deepEqual(r.moves.map((m) => m.kind), ["travel", "extrude", "extrude", "extrude", "extrude"]);
  // Time: the travel goes 0.2 mm up at 6000 mm/min = 100 mm/s, 0.002 s; the square is 40 mm at
  // 1800 mm/min = 30 mm/s, 4/3 s. Total 1.33533… s.
  assert.ok(close(r.seconds, 0.002 + 40 / 30, 1e-12), `seconds ${r.seconds}`);
  assert.deepEqual(r.end, { x: 0, y: 0, z: 0.2, e: 4 * perSide });
});

test("a deliberately wrong E amount fails the hand-worked check", () => {
  // The same square with each side's E doubled lays down 6.4 mm³, so the 3.2 mm³ check above must refuse it.
  const r = replay(square((2 * 10 * 0.4 * 0.2) / A));
  assert.ok(close(r.volume, 6.4, 1e-12));
  assert.equal(close(r.volume, 3.2, 1e-12), false);
  // And 1 % short is caught too: the check is the volume, not a rough look.
  const short = replay(square((0.99 * 10 * 0.4 * 0.2) / A));
  assert.equal(close(short.volume, 3.2, 1e-3), false);
});

test("absolute (M82) and relative (M83) extrusion of the same square agree", () => {
  const perSide = (10 * 0.4 * 0.2) / A;
  const abs = replay(square(perSide, "M82"));
  const rel = replay(square(perSide, "M83"));
  assert.deepEqual(abs.problems, []);
  assert.ok(close(abs.volume, rel.volume, 1e-12));
  assert.ok(close(abs.volume, 3.2, 1e-12));
});

test("hand-worked: retracting, travelling and priming back lays down nothing; priming past it is a blob", () => {
  const text = [
    "G90", "M83", "G1 X0 Y0 Z0.2 F3000",
    "G1 E-0.8 F2400", // retract 0.8 mm standing still
    "G0 X30 Y40 F6000", // travel 50 mm (3-4-5)
    "G1 E0.8 F2400", // prime the same 0.8 back: no plastic
    "G1 E-0.5", // retract 0.5 again
    "G1 E0.7", // prime 0.7: refills 0.5, the other 0.2 comes out on the spot
  ].join("\n");
  const r = replay(text);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.moves.map((m) => m.kind), ["travel", "retract", "travel", "prime", "retract", "blob"]);
  // Only the 0.2 mm past the retraction is plastic: 0.2 · A = 0.48105… mm³.
  assert.ok(close(r.volume, 0.2 * A, 1e-12));
  assert.ok(close(r.filament, -0.8 + 0.8 - 0.5 + 0.7, 1e-12));
  // Time: 0.2 up at 50 mm/s (0.004 s), 0.8 of filament at 40 mm/s (0.02 s), 50 mm at 100 mm/s (0.5 s),
  // then 0.8, 0.5 and 0.7 of filament at 40 mm/s (0.02 + 0.0125 + 0.0175 s). Total 0.574 s.
  assert.ok(close(r.seconds, 0.574, 1e-12), `seconds ${r.seconds}`);
});

test("hand-worked: a retraction while moving (a wipe), then printing on, refills before laying down", () => {
  const text = ["G90", "M83", "G1 F600", "G1 X10 E-0.3", "G1 X20 E1.3"].join("\n");
  const r = replay(text);
  assert.deepEqual(r.moves.map((m) => m.kind), ["retract", "extrude"]);
  // The second move's first 0.3 refills the wipe's retraction; 1.0 mm of filament is laid down: A mm³.
  assert.ok(close(r.moves[1].volume, A, 1e-12));
  assert.ok(close(r.volume, A, 1e-12));
});

test("hand-worked: G92 E0 restarts absolute E without moving; G91 makes the axes relative", () => {
  const text = [
    "G90", "M82", "G1 F1200",
    "G1 X10 E2", // 2 mm of filament
    "G92 E0", // the extruder counter restarts; nothing moves
    "G1 X20 E1", // 1 more mm
    "G91", // XYZ and E relative from here (M82 is overridden by G91)
    "G1 X5 Y5 E0.5", // to (25, 5), 0.5 mm
    "G90", "M82", // back to absolute, said explicitly
    "G1 X0 Y0", // travel home
  ].join("\n");
  const r = replay(text);
  assert.deepEqual(r.problems, []);
  assert.ok(close(r.filament, 3.5, 1e-12));
  assert.ok(close(r.volume, 3.5 * A, 1e-12));
  assert.deepEqual(r.moves.map((m) => [m.to.x, m.to.y]), [[10, 0], [20, 0], [25, 5], [0, 0]]);
  // The E counter ends at 1.5: G92 set it to 0, then +1 (absolute E1) and +0.5 (relative).
  assert.equal(r.end.e, 1.5);
});

test("hand-worked: arcs by their centre", () => {
  // From (10, 0), clockwise round (0, 0) to (0, -10): a quarter turn of radius 10, 2π · 10 / 4 = 5π mm.
  const q = replay(["G90", "M83", "G1 X10 Y0 F600", "G2 X0 Y-10 I-10 J0 E1"].join("\n"));
  assert.deepEqual(q.problems, []);
  const arc = q.moves[1];
  assert.ok(close(arc.length, 5 * Math.PI, 1e-12), `${arc.length}`);
  assert.ok(close(arc.arc!.sweep, Math.PI / 2, 1e-12));
  assert.deepEqual(arc.arc!.centre, { x: 0, y: 0 });
  // The same ends counter-clockwise go the long way: three quarters, 15π.
  const long = replay(["G90", "M83", "G1 X10 Y0 F600", "G3 X0 Y-10 I-10 J0"].join("\n"));
  assert.ok(close(long.moves[1].length, 15 * Math.PI, 1e-12));
  // Start and end the same: a whole circle, 20π, at 10 mm/s → 2π s.
  const full = replay(["G90", "G1 X10 Y0 F600", "G3 X10 Y0 I-10 J0"].join("\n"));
  assert.ok(close(full.moves[1].length, 20 * Math.PI, 1e-12));
  assert.ok(close(full.moves[1].seconds, 2 * Math.PI, 1e-12));
  // A helix: a whole turn of radius 10 climbing 1 mm is √((20π)² + 1²) long.
  const helix = replay(["G90", "G1 X10 Y0 F600", "G3 X10 Y0 Z1 I-10 J0"].join("\n"));
  assert.ok(close(helix.moves[1].length, Math.hypot(20 * Math.PI, 1), 1e-12));
});

test("arcs it can't follow are problems, not guesses", () => {
  const r = replay(["G90", "G1 X10 Y0 F600", "G2 X0 Y10 R10", "G2 X5 Y5 I0 J0", "G2 X30 Y0 I-10 J0"].join("\n"));
  assert.deepEqual(r.problems.map((p) => [p.line, p.kind]), [[3, "arc-radius-form"], [4, "bad-arc"], [5, "bad-arc"]]);
});

test("hand-worked: the arc's end is checked against its circle at Marlin's 0.05 mm", () => {
  // Radius 10 from the start; an end at radius 10.045 (0.9 × 0.05 off) passes, 10.055 (1.1 ×) is reported.
  const at = (r: number) => replay(["G90", "G1 X10 Y0 F600", `G2 X0 Y-${r} I-10 J0`].join("\n")).problems.map((p) => p.kind);
  assert.deepEqual(at(10 + 0.9 * 0.05), []);
  assert.deepEqual(at(10 + 1.1 * 0.05), ["bad-arc"]);
});

test("hand-worked: a nozzle move under STILL (1e-6 mm) is standing still, at 0.9× and 1.1×", () => {
  // A 0.5 mm retraction at 600 mm/min = 10 mm/s with the nozzle moving 0.9 × STILL: standing still, so the
  // time is the filament's 0.5 / 10 = 0.05 s. Moving 1.1 × STILL it is a moving retraction timed by the
  // nozzle's path: 1.1e-6 / 10 = 1.1e-7 s.
  const at = (d: number) => replay(["G90", "M83", "G1 F600", `G1 X${(d * STILL).toFixed(12)} E-0.5`].join("\n")).moves[0];
  assert.ok(close(at(0.9).seconds, 0.05, 1e-12));
  assert.ok(close(at(1.1).seconds, 1.1e-7, 1e-6));
  // A push after it: standing still it is a blob; moving 1.1 × STILL sideways it is a line.
  const push = (d: number) => replay(["G90", "M83", "G1 F600", `G1 X${(d * STILL).toFixed(12)} E0.5`].join("\n")).moves[0].kind;
  assert.equal(push(0.9), "blob");
  assert.equal(push(1.1), "extrude");
  // A move of 0.9 × STILL with no filament is no move at all.
  assert.equal(replay(["G90", "G1 F600", `G1 X${(0.9 * STILL).toFixed(12)}`].join("\n")).moves.length, 0);
});

test("reading lines: line numbers, checksums, comments, case, packed words and short numbers", () => {
  const p = parseLine("N10 g01X10.Y-.5 e.25 (a note) F1800*45 ; and a comment", 1)!;
  assert.equal(p.command, "G1");
  assert.deepEqual(Object.fromEntries(p.words), { X: 10, Y: -0.5, E: 0.25, F: 1800 });
  assert.deepEqual(p.problems, []);
  assert.equal(parseLine("   ; only a comment", 2), null);
  assert.equal(parseLine("", 3), null);
  assert.equal(parseLine("M082", 4)!.command, "M82");
  assert.equal(parseLine("G29.1", 5)!.command, "G29.1");
  assert.deepEqual(parseLine("G1 X1.2.3", 6)!.problems.map((p) => p.kind), ["bad-number"]);
  // A letter with no number is a flag (G28 X); in a move it is a bad number.
  assert.deepEqual([...parseLine("G1 X", 7)!.flags], ["X"]);
  assert.deepEqual(replay("G1 X").problems.map((p) => p.kind), ["bad-number"]);
  // 1e3 is not a number G-code knows: E is a word, so firmware reads X1e3 as X1 E3, and so does this.
  assert.deepEqual(Object.fromEntries(parseLine("G1 X1e3", 8)!.words), { X: 1, E: 3 });
  assert.equal(parseLine("EXCLUDE_OBJECT_START NAME=part_1", 9)!.command, "EXCLUDE_OBJECT_START");
});

test("a bad number is reported and the rest of the move still happens", () => {
  const r = replay(["G90", "G1 F600", "G1 X1.2.3 Y5"].join("\n"));
  assert.deepEqual(r.problems.map((p) => [p.line, p.kind]), [[3, "bad-number"]]);
  assert.deepEqual(r.end, { x: 0, y: 5, z: 0, e: 0 });
});

test("unknown motion, no feed rate, temperatures, homing, macros and firmware retraction", () => {
  const text = [
    "M140 S60", "M104 S215", "M190 S60", "M109 S215",
    "G28", "G29", // G29 (bed levelling) is not followed: it might move
    "EXCLUDE_OBJECT_START NAME=a",
    "M106 S255",
    "G1 X5", // before any F
    "G1 X6", // reported once only
    "G10", "G11",
    "M104", // no temperature given
  ].join("\n");
  const r = replay(text);
  assert.deepEqual(r.problems.map((p) => [p.line, p.kind]), [[6, "unknown-motion"], [9, "no-feed-rate"], [13, "bad-temperature"]]);
  assert.deepEqual(r.temperatures.map((t) => [t.heater, t.celsius, t.wait]), [["bed", 60, false], ["nozzle", 215, false], ["bed", 60, true], ["nozzle", 215, true]]);
  assert.deepEqual(r.homes, [5]);
  assert.deepEqual(r.firmwareRetracts.map((f) => f.kind), ["retract", "prime"]);
  assert.deepEqual(r.ignored, { EXCLUDE_OBJECT_START: 1, M106: 1 });
  assert.equal(r.seconds, 0);
});

test("hand-worked: G28 homes only the axes it names", () => {
  const r = replay(["G90", "G1 X10 Y20 Z5 F600", "G28 X", "G1 Y20"].join("\n"));
  assert.deepEqual(r.end, { x: 0, y: 20, z: 5, e: 0 });
});

test("hand-worked: G90 after M83 is ambiguous; Marlin and Klipper lay down different plastic", () => {
  // After M83, E1 then E2 push 1 + 2 = 3 mm. Then G90: Marlin turns E absolute, so the next E3 pushes
  // 3 − 3 = 0 (the counter already reads 3); Klipper keeps E relative, so it pushes 3 more: 6 mm.
  const text = ["G90", "M83", "G1 F600", "G1 X1 E1", "G1 X2 E2", "G90", "G1 X3 E3"].join("\n");
  const marlin = replay(text);
  const klipper = replay(text, { flavour: "klipper" });
  assert.ok(close(marlin.filament, 3, 1e-12));
  assert.ok(close(klipper.filament, 6, 1e-12));
  for (const r of [marlin, klipper]) assert.deepEqual(r.problems.map((p) => [p.line, p.kind]), [[7, "ambiguous-extruder"]]);
  // Saying M83 again after G90 settles it: no problem, both agree.
  const said = text.replace("G90\nG1 X3", "G90\nM83\nG1 X3");
  assert.deepEqual(replay(said).problems, []);
  assert.ok(close(replay(said).filament, replay(said, { flavour: "klipper" }).filament, 1e-12));
});

test("a 2.85 mm filament lays down (2.85 / 1.75)² times as much per mm", () => {
  const r = replay(["G90", "M83", "G1 F600", "G1 X10 E1"].join("\n"), { filamentDiameter: 2.85 });
  assert.ok(close(r.volume, Math.PI * 1.425 ** 2, 1e-12));
});

// --- Seeded random programs against a simple model ---------------------------------------------------

/** What a program does, move by move, in absolute coordinates: the model's own words. */
interface ModelMove {
  to: [number, number, number];
  /** Filament pushed (+) or pulled (−) during the move. */
  de: number;
  feed: number;
}

interface ModelAnswer {
  volume: number;
  filament: number;
  seconds: number;
  path: [number, number, number][];
  /** Each move's filament. */
  pushed: number[];
}

/** The model: plastic is what's pushed beyond what was pulled back, timed at each move's own speed. */
function model(moves: ModelMove[]): ModelAnswer {
  let at: [number, number, number] = [0, 0, 0];
  let owed = 0;
  let volume = 0;
  let filament = 0;
  let seconds = 0;
  const path: [number, number, number][] = [];
  const pushed: number[] = [];
  for (const m of moves) {
    pushed.push(m.de);
    const len = Math.hypot(m.to[0] - at[0], m.to[1] - at[1], m.to[2] - at[2]);
    if (m.de < 0) owed += -m.de;
    else {
      const back = Math.min(owed, m.de);
      owed -= back;
      volume += (m.de - back) * A;
    }
    filament += m.de;
    seconds += (len > 0 ? len : Math.abs(m.de)) / (m.feed / 60);
    at = m.to;
    path.push(at);
  }
  return { volume, filament, seconds, path, pushed };
}

const pick = <T,>(r: SeededRandom, xs: readonly T[]): T => xs[Math.floor(r.next() * xs.length)];
/** A number as G-code takes it: never in 1e-7 form (firmware would read the e as an E word). */
const fmt = (v: number) => v.toFixed(12).replace(/\.?0+$/, "");
/** A value on a 0.001 grid, so writing it and reading it back is exact. */
const grid = (r: SeededRandom, lo: number, hi: number) => Math.round((lo + r.next() * (hi - lo)) * 1000) / 1000;

function randomMoves(r: SeededRandom, count: number): ModelMove[] {
  const moves: ModelMove[] = [];
  let at: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const shape = r.next();
    const to: [number, number, number] = [...at];
    let de = 0;
    if (shape < 0.5) {
      to[0] = grid(r, 0, 250);
      to[1] = grid(r, 0, 250);
      de = grid(r, 0, 2);
    } else if (shape < 0.65) {
      to[0] = grid(r, 0, 250);
      to[1] = grid(r, 0, 250);
    } else if (shape < 0.75) to[2] = grid(r, 0, 250);
    else if (shape < 0.9) de = -grid(r, 0.001, 2);
    else de = grid(r, 0.001, 2.5);
    if (de === 0 && to.every((v, k) => v === at[k])) to[0] = at[0] + 1;
    moves.push({ to, de, feed: pick(r, [600, 1800, 3000, 7200, 12000, 1234.5]) });
    at = to;
  }
  return moves;
}

/** Writes the moves as G-code in a randomly changing style: the replayer must see through all of it. */
function writeProgram(r: SeededRandom, moves: ModelMove[], plant?: "absolute-as-relative"): string {
  const out: string[] = ["G90", "M82", "G92 E0"];
  let relAxes = false;
  let relE = false;
  let at: [number, number, number] = [0, 0, 0];
  let eCounter = 0;
  let feed = -1;
  let n = 1;
  moves.forEach((m, i) => {
    // Now and then switch style; after G90 always say M82 or M83 (firmware differs otherwise).
    if (r.next() < 0.1) {
      relAxes = !relAxes;
      out.push(relAxes ? "G91" : "G90");
      if (!relAxes) {
        relE = r.next() < 0.5;
        out.push(relE ? "M83" : "M82");
      }
    }
    if (!relAxes && r.next() < 0.1) {
      relE = !relE;
      out.push(relE ? "M83" : "M82");
    }
    if (r.next() < 0.05) {
      eCounter = grid(r, -5, 5);
      out.push(`G92 E${eCounter}`);
    }
    const words: string[] = [pick(r, ["G1", "G1", "G0", "G01"])];
    const letters = ["X", "Y", "Z"];
    for (let k = 0; k < 3; k++) {
      const changed = m.to[k] !== at[k];
      if (!changed && r.next() < 0.8) continue;
      words.push(letters[k] + (fmt(relAxes ? m.to[k] - at[k] : m.to[k])));
    }
    const eRel = relAxes || relE;
    const planted = plant === "absolute-as-relative" && i === Math.floor(moves.length / 2) && !eRel && m.de !== 0;
    if (m.de !== 0 || r.next() < 0.2) {
      eCounter += m.de;
      words.push("E" + (fmt(eRel || planted ? m.de : eCounter)));
    }
    if (m.feed !== feed || r.next() < 0.1) {
      words.push(`F${m.feed}`);
      feed = m.feed;
    }
    let line = r.next() < 0.3 ? words.join("") : words.join(" ");
    if (r.next() < 0.3) line = line.toLowerCase();
    if (r.next() < 0.2) line += " ; move " + i;
    if (r.next() < 0.1) line = `N${n++} ${line}*${Math.floor(r.next() * 256)}`;
    out.push(line);
    at = m.to;
  });
  return out.join(r.next() < 0.5 ? "\n" : "\r\n");
}

/** The first way the replay differs from the model, or null. */
function differs(rp: Replay, m: ModelAnswer): string | null {
  if (rp.problems.length > 0) return `problems: ${rp.problems.map((p) => `${p.line} ${p.kind}`).join(", ")}`;
  if (!close(rp.volume, m.volume, 1e-9)) return `volume ${rp.volume} vs ${m.volume}`;
  if (!close(rp.filament, m.filament, 1e-9)) return `filament ${rp.filament} vs ${m.filament}`;
  if (!close(rp.seconds, m.seconds, 1e-9)) return `seconds ${rp.seconds} vs ${m.seconds}`;
  if (rp.moves.length !== m.path.length) return `${rp.moves.length} moves vs ${m.path.length}`;
  for (let i = 0; i < m.path.length; i++) {
    const t = rp.moves[i].to;
    if (![t.x, t.y, t.z].every((v, k) => close(v, m.path[i][k], 1e-9))) return `move ${i} ends at ${[t.x, t.y, t.z]} vs ${m.path[i]}`;
    if (!close(rp.moves[i].e, m.pushed[i], 1e-9)) return `move ${i} pushes ${rp.moves[i].e} vs ${m.pushed[i]}`;
  }
  return null;
}

const BASE = BigInt(process.env.FISSION_SEED ?? "8301");
const SEEDS = 200;

test(`seeded: ${SEEDS} random programs in mixed styles replay to the model (FISSION_SEED=${BASE})`, () => {
  for (let s = 0n; s < BigInt(SEEDS); s++) {
    const seed = BASE + s;
    const r = seeded(seed);
    const moves = randomMoves(r, 150);
    const text = writeProgram(r, moves);
    const why = differs(replay(text), model(moves));
    assert.equal(why, null, `FISSION_SEED=${seed}: ${why}`);
  }
});

test("planted: the seeded comparison catches one absolute E written as relative", () => {
  // The same programs with one move's E written relative while the extruder is absolute: the replay must
  // differ from the model for every seed where that move pushes or pulls filament in absolute mode.
  let caught = 0;
  let planted = 0;
  for (let s = 0n; s < 200n; s++) {
    const seed = BASE + s;
    const r = seeded(seed);
    const moves = randomMoves(r, 150);
    const clean = writeProgram(seeded(seed + 1_000_000n), moves);
    const broken = writeProgram(seeded(seed + 1_000_000n), moves, "absolute-as-relative");
    if (clean === broken) continue;
    planted++;
    if (differs(replay(broken), model(moves)) !== null) caught++;
  }
  assert.ok(planted >= 10, `only ${planted} programs got the planted fault`);
  assert.equal(caught, planted);
});

test("planted: the model comparison catches a replayer that forgets retractions", () => {
  // A wrong replay (every push counted as plastic, retractions ignored) must not match the model.
  const r = seeded(BASE);
  const moves = randomMoves(r, 150);
  const rp = replay(writeProgram(r, moves));
  const forgetful: Replay = { ...rp, volume: rp.moves.reduce((v, m) => v + Math.max(0, m.e) * A, 0) };
  assert.notEqual(differs(forgetful, model(moves)), null);
});

test("never throws: random bytes and broken lines give problems, not exceptions", () => {
  const r = seeded(BASE);
  const alphabet = "GMTXYZEFIJRSPN0123456789.-+ ;()*\n\r\t_=abcxyz#!é\u0000";
  for (let i = 0; i < 300; i++) {
    let text = "";
    const len = Math.floor(r.next() * 400);
    for (let k = 0; k < len; k++) text += alphabet[Math.floor(r.next() * alphabet.length)];
    const rp = replay(text);
    assert.ok(Number.isFinite(rp.seconds) || rp.seconds === Infinity || Number.isNaN(rp.seconds));
    assert.ok(Array.isArray(rp.problems));
  }
});

// Weak-spot hunt E (2026-10-29): what the replayer got wrong, each worked out by hand.

test("hand-worked: G21 (mm) and G17 (XY plane) are what we assume, so no problem; G20 (inches) is one", () => {
  // Almost every slicer writes G21 first; reporting it trained people to ignore the problem list.
  assert.deepEqual(replay(["G21", "G17", "G90", "G1 X10 F1000"].join("\n")).problems, []);
  // G20 would make X10 mean 254 mm: not followed, and a problem.
  assert.deepEqual(replay(["G20", "G1 X10 F1000"].join("\n")).problems.map((p) => [p.line, p.kind]), [[1, "inches"]]);
});

test("hand-worked: Marlin's M82 after G91 makes the extruder absolute again; Klipper's G91 keeps it relative", () => {
  // G91 then M82, then E5 twice. Marlin 2.x: G91 turns every axis relative, M82 turns E back to absolute,
  // so E5 then E5 push 5 then 5 − 5 = 0: 5 mm. Klipper reads E relative whenever the axes are (G91): 10 mm.
  const text = ["G90", "M82", "G92 E0", "G1 F600", "G91", "M82", "G1 X1 E5", "G1 X1 E5"].join("\n");
  assert.ok(close(replay(text).filament, 5, 1e-12), `${replay(text).filament}`);
  assert.ok(close(replay(text, { flavour: "klipper" }).filament, 10, 1e-12));
});

test("hand-worked: a retraction pulled in two pieces and pushed back in full leaves nothing retracted", () => {
  // −0.1 − 0.2 = −0.3 in doubles is −0.30000000000000004 and +0.3 leaves 4e-17 "still retracted": the
  // travel after the full prime was taken as retracted, so a wall it crossed was excused. Under STILL it is none.
  const r = replay(["G90", "M83", "G1 X10 Y10 F1000", "G1 E-0.1", "G1 E-0.2", "G1 E0.3", "G1 X50 Y10"].join("\n"));
  assert.equal(r.moves.at(-1)!.kind, "travel");
  assert.equal(r.moves.at(-1)!.retracted, false);
  // A real retraction still counts: pulled 0.3, pushed 0.2, 0.1 mm is still out.
  const part = replay(["G90", "M83", "G1 X10 Y10 F1000", "G1 E-0.3", "G1 E0.2", "G1 X50 Y10"].join("\n"));
  assert.equal(part.moves.at(-1)!.retracted, true);
});

test("hand-worked: an arc it can't follow still takes the nozzle to its end, as a straight move", () => {
  // G2 X500 Y500 R10 from (10, 10): a printer drives to (500, 500) (or stops); the move was dropped, so the bed
  // check never saw (500, 500). It is now recorded straight, with its problem.
  const r = replay(["G28", "G1 X10 Y10 F1000", "G2 X500 Y500 R10"].join("\n"));
  assert.deepEqual(r.problems.map((p) => [p.line, p.kind]), [[3, "arc-radius-form"]]);
  const m = r.moves.at(-1)!;
  assert.deepEqual([m.line, m.to.x, m.to.y, m.arc], [3, 500, 500, undefined]);
  // Straight from (10, 10) to (500, 500): 490·√2 mm.
  assert.ok(close(m.length, 490 * Math.SQRT2, 1e-12));
});

test("hand-worked: after G92 X/Y/Z the moves are where the nozzle really is", () => {
  // G28 puts the nozzle at x 0; G92 X220 says "you are at 220" without moving; G1 X200 then moves 20 mm
  // left of the end stop: x = 200 − 220 = −20, off the bed. Homing X again ends the shift.
  const r = replay(["G28", "G92 X220", "G1 X200 Y10 F1000", "G28 X", "G1 X5"].join("\n"));
  assert.deepEqual(r.moves.map((m) => [m.to.x, m.to.y]), [[-20, 10], [5, 10]]);
  // Z too: G92 Z5 at z 0, then Z1 is 4 mm below the bed.
  assert.equal(replay(["G28", "G92 Z5", "G1 Z1 F600"].join("\n")).moves[0].to.z, -4);
});

test("a temperature past 500 °C is a problem and still a temperature, so the printer check sees it", () => {
  const r = replay("M104 S600");
  assert.deepEqual(r.problems.map((p) => p.kind), ["bad-temperature"]);
  assert.deepEqual(r.temperatures.map((t) => [t.heater, t.celsius]), [["nozzle", 600]]);
});

test("commands that change what moves do are problems; their harmless forms are not", () => {
  // Each of these changes the plastic, the speed, the steps or the limits behind the moves the replay follows.
  const changing = ["M221 S300", "M220 S50", "M92 E1000", "M200 D1.75", "M211 S0", "M302 P1", "T1"];
  for (const c of changing) assert.deepEqual(replay(c).problems.map((p) => p.kind), ["machine-setting"], c);
  // Slicers reset flow and speed to 100 % and select the first tool; Bambu's M221 X/Y/Z is something else.
  for (const c of ["M221 S100", "M220 S100", "M200 D0", "T0", "M221 X0 Y0 Z1", "M221"]) assert.deepEqual(replay(c).problems, [], c);
});

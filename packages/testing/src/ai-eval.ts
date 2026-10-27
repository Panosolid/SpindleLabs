// The AI evaluation suite: fixed prompts, each with a project state and
// the commands a correct answer contains. runEval works with any
// AIProvider; scripts/ai-eval-ollama.ts runs it on real models through
// Ollama (the A10 check, AI3). Success rates
// per task type are tracked over time like the fuzzer's metrics.

import { type Command, type CommandSpec } from "@fission/core";
import { askForCommands, systemPrompt, type AIProvider } from "@fission/ai";

/** "cannot": a request no offered command can do; the right answer is no commands and a plain reason (AI5c). */
export type TaskType = "create" | "edit-parameter" | "reference-geometry" | "explain" | "cannot";

export interface EvalCase {
  id: string;
  taskType: TaskType;
  prompt: string;
  /** The project the prompt is asked about, as the commands that build it (empty: a new project). */
  setup: Command[];
  /** Parameters the part must have after the answer; others are ignored. Lengths compare to 1e-9 relative. Empty: the answer must send no commands. */
  expected: Partial<Command>[];
  /** Cases that need commands not built yet name what they wait for, and are skipped by runEval. */
  waitsFor?: string;
}

export const EVAL_CASES: readonly EvalCase[] = [
  // AI7a: an empty sketch on an origin plane, named by its letters.
  { id: "sketch-xy", taskType: "create", prompt: "Start a new sketch on the XY plane.", setup: [], expected: [{ op: "create_sketch", on: "XY" }] },
  // AI7b: a sketch with a shape drawn in it. The circle's diameter is given; the centre is (10, 5) in the sketch.
  { id: "circle-in-sketch", taskType: "create", prompt: "Sketch a circle 12 mm in diameter on the XY plane, centred at (10, 5).", setup: [], expected: [{ op: "create_sketch", on: "XY" }, { op: "draw_circle", diameter: 12, x: 10, y: 5 }] },
  { id: "line-in-sketch", taskType: "create", prompt: "On the YZ plane, sketch a line from (0, 0) to (20, 10).", setup: [], expected: [{ op: "create_sketch", on: "YZ" }, { op: "draw_line", x1: 0, y1: 0, x2: 20, y2: 10 }] },
  { id: "box-by-sizes", taskType: "create", prompt: "Make a box 40 by 30 by 20 mm.", setup: [], expected: [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }] },
  { id: "cylinder-diameter", taskType: "create", prompt: "I need a cylinder 25 mm across and 60 mm tall.", setup: [], expected: [{ op: "set_part", shape: "cylinder", width: 25, height: 60 }] },
  { id: "sphere-radius", taskType: "create", prompt: "A ball with a radius of 15 mm.", setup: [], expected: [{ op: "set_part", shape: "sphere", width: 30 }] },
  {
    id: "wider-box",
    taskType: "edit-parameter",
    prompt: "Make it 10 mm wider.",
    setup: [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }],
    expected: [{ op: "set_part", shape: "box", width: 50, depth: 30, height: 20 }],
  },
  // AI3: more cases, so the A10 check has more than four answers to judge. Expected sizes worked by hand.
  { id: "cube", taskType: "create", prompt: "A 25 mm cube.", setup: [], expected: [{ op: "set_part", shape: "box", width: 25, depth: 25, height: 25 }] },
  // 4 cm = 40 mm, 3 cm = 30 mm, 2 cm = 20 mm.
  { id: "box-in-cm", taskType: "create", prompt: "Make a box 4 cm by 3 cm by 2 cm.", setup: [], expected: [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }] },
  { id: "plate-sizes", taskType: "create", prompt: "A plate 80 by 60 mm and 5 mm thick.", setup: [], expected: [{ op: "set_part", shape: "plate", width: 80, depth: 60, height: 5 }] },
  // Radius 6 → diameter (width) 12; long = height 100.
  { id: "rod-radius", taskType: "create", prompt: "A rod with a 6 mm radius, 100 mm long.", setup: [], expected: [{ op: "set_part", shape: "cylinder", width: 12, height: 100 }] },
  {
    id: "twice-as-tall",
    taskType: "edit-parameter",
    prompt: "Make it twice as tall.",
    setup: [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }],
    expected: [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 40 }], // 2 × 20
  },
  {
    id: "depth-to-15",
    taskType: "edit-parameter",
    prompt: "Reduce the depth to 15.",
    setup: [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }],
    expected: [{ op: "set_part", shape: "box", width: 40, depth: 15, height: 20 }],
  },
  {
    id: "shorter-cylinder",
    taskType: "edit-parameter",
    prompt: "Make it 10 mm shorter.",
    setup: [{ op: "set_part", shape: "cylinder", width: 25, depth: 30, height: 60 }],
    expected: [{ op: "set_part", shape: "cylinder", width: 25, height: 50 }], // 60 − 10
  },
  {
    id: "box-to-sphere",
    taskType: "edit-parameter",
    prompt: "Turn it into a sphere just as wide.",
    setup: [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }],
    expected: [{ op: "set_part", shape: "sphere", width: 40 }],
  },
  {
    id: "hole-top-centre",
    taskType: "reference-geometry",
    prompt: "Add a 5 mm hole in the middle of the top face.",
    setup: [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }],
    expected: [{ op: "hole", face: "<stable id of the top face>", diameter: 5, depth: "through" }],
    waitsFor: "the hole command and stable face ids (steps 24 and 54)",
  },
];

// AI4: the held-out set. Written before the prompt was changed and never
// used while writing it, so a better score here means the prompt got
// better at the job, not at these particular sentences. It covers the same
// kinds of mistake the first run found (radius, cube, units) in new words,
// plus answers that must stay as they are (a diameter is not doubled).
// Never edit these to match a prompt; add new held-out cases instead.
const BOX: Command = { op: "set_part", shape: "box", width: 40, depth: 30, height: 20 };
const CYLINDER: Command = { op: "set_part", shape: "cylinder", width: 25, depth: 30, height: 60 };
export const HELD_OUT_CASES: readonly EvalCase[] = [
  // Radius 9 → diameter (width) 18.
  { id: "held-cylinder-radius", taskType: "create", prompt: "A cylinder with a radius of 9 mm and a height of 40 mm.", setup: [], expected: [{ op: "set_part", shape: "cylinder", width: 18, height: 40 }] },
  // Already a diameter: stays 40, not 80.
  { id: "held-cylinder-diameter", taskType: "create", prompt: "A cylinder 40 mm in diameter and 10 mm high.", setup: [], expected: [{ op: "set_part", shape: "cylinder", width: 40, height: 10 }] },
  // "Across" is the diameter: 5 cm = 50 mm.
  { id: "held-sphere-cm", taskType: "create", prompt: "A sphere 5 cm across.", setup: [], expected: [{ op: "set_part", shape: "sphere", width: 50 }] },
  // A cube is a box with three equal sides: 18, 18, 18.
  { id: "held-cube-sides", taskType: "create", prompt: "Make a cube, 18 mm on each side.", setup: [], expected: [{ op: "set_part", shape: "box", width: 18, depth: 18, height: 18 }] },
  // 3 cm = 30 mm on every side.
  { id: "held-cube-cm", taskType: "create", prompt: "I want a cube with 3 cm sides.", setup: [], expected: [{ op: "set_part", shape: "box", width: 30, depth: 30, height: 30 }] },
  // 1 inch = 25.4 mm exactly, so 2 in = 50.8 mm.
  { id: "held-box-inches", taskType: "create", prompt: "A box 2 inches wide, 1 inch deep and 1 inch tall.", setup: [], expected: [{ op: "set_part", shape: "box", width: 50.8, depth: 25.4, height: 25.4 }] },
  // 0.5 m = 500 mm.
  { id: "held-box-metres", taskType: "create", prompt: "A box 0.5 m wide, 200 mm deep and 100 mm tall.", setup: [], expected: [{ op: "set_part", shape: "box", width: 500, depth: 200, height: 100 }] },
  // Radius 1.5 cm = 15 mm → diameter 30 mm.
  { id: "held-ball-radius-cm", taskType: "create", prompt: "A ball, radius 1.5 cm.", setup: [], expected: [{ op: "set_part", shape: "sphere", width: 30 }] },
  // New radius 20 → width 40; the height 60 is kept.
  { id: "held-set-radius", taskType: "edit-parameter", prompt: "Make the radius 20 mm.", setup: [CYLINDER], expected: [{ op: "set_part", shape: "cylinder", width: 40, height: 60 }] },
  // 2 cm = 20 mm, so the height 20 becomes 40.
  { id: "held-taller-cm", taskType: "edit-parameter", prompt: "Make it 2 cm taller.", setup: [BOX], expected: [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 40 }] },
  // The sphere's width 30 is its diameter, so radius 15; double → 30, diameter 60.
  { id: "held-double-radius", taskType: "edit-parameter", prompt: "Double its radius.", setup: [{ op: "set_part", shape: "sphere", width: 30, depth: 30, height: 30 }], expected: [{ op: "set_part", shape: "sphere", width: 60 }] },
  // 40 / 2 = 20.
  { id: "held-half-width", taskType: "edit-parameter", prompt: "Make it half as wide.", setup: [BOX], expected: [{ op: "set_part", shape: "box", width: 20, depth: 30, height: 20 }] },
  // "Across" is already the diameter: 50; the height 60 is kept.
  { id: "held-across-edit", taskType: "edit-parameter", prompt: "Make it 50 mm across.", setup: [CYLINDER], expected: [{ op: "set_part", shape: "cylinder", width: 50, height: 60 }] },
  // Diameter 30 → width 30; the box's height 20 is kept.
  { id: "held-box-to-cylinder", taskType: "edit-parameter", prompt: "Change it to a cylinder 30 mm in diameter.", setup: [BOX], expected: [{ op: "set_part", shape: "cylinder", width: 30, height: 20 }] },
  // AI7a: a sketch started on the plane meant. The front is XZ and the side YZ (Z up, the view cube's names); the part stays.
  { id: "held-sketch-front", taskType: "create", prompt: "Begin a sketch on the front plane so I can draw an outline.", setup: [BOX], expected: [{ op: "create_sketch", on: "XZ" }] },
  { id: "held-sketch-yz", taskType: "create", prompt: "I'd like to work in a sketch on the YZ plane.", setup: [], expected: [{ op: "create_sketch", on: "YZ" }] },
  // AI7b: Ben's circle and the rectangle, "cannot" until AI7b, with their real answers (new ids, as the
  // rule above says). Radius 10 → diameter 20; the front is XZ; centred on the origin, as nothing else is said.
  { id: "held-circle-sketch", taskType: "create", prompt: "Draw a circle with radius 10mm as a sketch on the XY plane.", setup: [], expected: [{ op: "create_sketch", on: "XY" }, { op: "draw_circle", diameter: 20 }] },
  { id: "held-rectangle-sketch", taskType: "create", prompt: "Sketch a 30 by 20 mm rectangle on the front plane.", setup: [BOX], expected: [{ op: "create_sketch", on: "XZ" }, { op: "draw_rectangle", width: 30, height: 20 }] },
  // AI5c: requests no offered command can do. The right answer is no
  // commands and a plain reason, never a stand-in shape (Ben's circle sketch
  // came back as a 20 × 0.01 mm cylinder, 2026-10-26). Written after
  // CANNOT_RULE and never used to word it. When a command for one arrives
  // (AI7), its case moves to a new held-out case with the real answer. Arcs
  // and text came with AI7b, when the circle and the rectangle moved.
  { id: "held-cannot-hole", taskType: "cannot", prompt: "Drill an 8 mm hole straight through the middle of it.", setup: [BOX], expected: [] },
  { id: "held-cannot-fillet", taskType: "cannot", prompt: "Round off every edge with a 2 mm fillet.", setup: [BOX], expected: [] },
  { id: "held-cannot-arc", taskType: "cannot", prompt: "In a sketch on the XY plane, draw an arc of radius 15 mm from (0, 0) to (30, 0).", setup: [], expected: [] },
  { id: "held-cannot-text", taskType: "cannot", prompt: "Engrave the word HELLO into the top face.", setup: [BOX], expected: [] },
];

const same = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b)) : a === b;

/** Whether `actual` contains each expected command (by the parameters given), in order: command by command, for any commands. */
export function commandsMatch(actual: readonly Command[], expected: readonly Partial<Command>[]): boolean {
  let i = 0;
  for (const c of actual) if (i < expected.length && Object.entries(expected[i]).every(([k, v]) => same(c[k], v))) i++;
  return i === expected.length;
}

/**
 * The part after these commands, as set_part's parameters. Until the
 * timeline (steps 24–25) the part is one set_part: each command's parameters
 * replace the ones it names and the rest are kept, as Design's run does.
 */
export function partAfter(commands: readonly Partial<Command>[]): Record<string, unknown> {
  const part: Record<string, unknown> = {};
  for (const c of commands) for (const [k, v] of Object.entries(c)) if (k !== "op") part[k] = v;
  return part;
}

/**
 * Whether the part the answer leaves (on top of the setup) has every
 * expected parameter. Judged on the result, so a wrong command after a
 * right one fails, and a size left out to keep it is right (AI4). When
 * nothing is expected (a "cannot" case), only no commands is right.
 */
export function matches(setup: readonly Command[], actual: readonly Command[], expected: readonly Partial<Command>[]): boolean {
  // Nothing expected: anything sent stands in for what can't be done.
  if (expected.length === 0) return actual.length === 0;
  if (actual.length === 0) return false;
  // Every other command (create_sketch, AI7a; the draws, AI7b; an export) exactly as expected, in order: none missing, none extra.
  const others = (cs: readonly Partial<Command>[]) => cs.filter((c) => c.op !== "set_part");
  const [got, want] = [others(actual), others(expected)];
  // A circle or rectangle with no centre given is centred on the sketch's origin (AI7b), so x and y left out are 0.
  const centred = (c: Partial<Command>) => (c.op === "draw_circle" || c.op === "draw_rectangle" ? { x: 0, y: 0, ...c } : c);
  const alike = (a: Partial<Command>, b: Partial<Command>) => Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => same(a[k], v));
  if (got.length !== want.length || !got.every((c, i) => alike(centred(c), centred(want[i])))) return false;
  const sets = (cs: readonly Partial<Command>[]) => cs.filter((c) => c.op === "set_part");
  const part = partAfter([...setup, ...sets(actual)]);
  // No set_part expected: the part must be left exactly as the setup made it (none added, nothing changed).
  if (sets(expected).length === 0) return alike(part, partAfter(setup));
  return Object.entries(partAfter(sets(expected))).every(([k, v]) => same(part[k], v));
}

export interface EvalResult {
  id: string;
  taskType: TaskType;
  passed: boolean;
  /** 1 or 2 when the answer was usable (2: only after the retry); 0 when it never was. */
  attempts: 0 | 1 | 2;
  detail: string;
  /** The model's working out (AI5c), "" when it gave none or the answer was unusable. */
  explanation: string;
}

/** Runs every ready case against a provider. */
export async function runEval(provider: AIProvider, cases: readonly EvalCase[], specs: readonly CommandSpec[]): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const c of cases) {
    if (c.waitsFor) continue;
    const system = systemPrompt(c.setup, specs);
    const answer = await askForCommands(provider, { system, messages: [{ role: "user", content: c.prompt }] }, specs);
    const passed = answer.ok && matches(c.setup, answer.commands, c.expected);
    results.push({ id: c.id, taskType: c.taskType, passed, attempts: answer.ok ? answer.attempts : 0, detail: answer.ok ? JSON.stringify(answer.commands) : answer.error, explanation: answer.ok ? answer.explanation : "" });
  }
  return results;
}

/** Success rate per task type, 0–1. */
export function successRates(results: readonly EvalResult[]): Partial<Record<TaskType, number>> {
  const out: Partial<Record<TaskType, number>> = {};
  for (const t of new Set(results.map((r) => r.taskType))) {
    const of = results.filter((r) => r.taskType === t);
    out[t] = of.filter((r) => r.passed).length / of.length;
  }
  return out;
}

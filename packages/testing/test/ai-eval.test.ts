import { test } from "node:test";
import assert from "node:assert/strict";
import type { AIProvider } from "@fission/ai";
import { parseCommand } from "@fission/core";
import { DESIGN_COMMANDS } from "@fission/design";
import { EVAL_CASES, HELD_OUT_CASES, matches, runEval, successRates } from "../src/ai-eval.ts";

test("every ready case's expected answer is itself a valid command", () => {
  for (const c of [...EVAL_CASES, ...HELD_OUT_CASES].filter((c) => !c.waitsFor))
    for (const e of c.expected) {
      // Fill parameters the case doesn't care about with a valid length.
      const full = e.op === "set_part" ? { depth: 1, height: 1, ...e } : e;
      assert.ok(parseCommand(full, DESIGN_COMMANDS).ok, `${c.id}: ${JSON.stringify(full)}`);
    }
  assert.ok(EVAL_CASES.some((c) => c.waitsFor), "the hole case from the spec is listed, waiting for its command");
});

test("every cannot case asks for something no offered command does, and expects nothing", () => {
  const cannot = HELD_OUT_CASES.filter((c) => c.taskType === "cannot");
  assert.ok(cannot.length >= 4);
  for (const c of cannot) assert.deepEqual(c.expected, [], c.id);
  // None of Design's commands draws arcs or text, drills or rounds: if one is added, these cases must be revisited (AI7).
  assert.deepEqual(DESIGN_COMMANDS.map((s) => s.op), ["set_part", "create_sketch", "draw_circle", "draw_rectangle", "draw_line", "export_stl"]);
  // Ben's own words were one of them until AI7b drew circles; now they want the circle itself, not a refusal.
  const ben = HELD_OUT_CASES.filter((c) => /circle with radius 10mm as a sketch on the XY plane/.test(c.prompt));
  assert.deepEqual(ben.map((c) => [c.taskType, c.expected]), [["create", [{ op: "create_sketch", on: "XY" }, { op: "draw_circle", diameter: 20 }]]]);
});

test("matching judges the part the answer leaves, on the expected parameters only", () => {
  const box = { op: "set_part", shape: "box", width: 40, depth: 30, height: 20 };
  assert.equal(matches([], [box], [{ op: "set_part", width: 40 }]), true);
  assert.equal(matches([], [box], [{ op: "set_part", width: 40.1 }]), false);
  assert.equal(matches([], [], []), true);
  // A "cannot" case (AI5c): any command at all stands in for what can't be done, even one that changes nothing.
  assert.equal(matches([], [box], []), false, "Ben's circle sketch answered with a cylinder");
  assert.equal(matches([box], [box], []), false, "a command that changes nothing is still not a refusal");
  assert.equal(matches([box], [], [{ op: "set_part", width: 40 }]), false, "no answer is not an answer, even when the part already fits");
});

test("hand-worked: a sketch case wants that sketch on that plane, and the part as it was (AI7a)", () => {
  const box = { op: "set_part", shape: "box", width: 40, depth: 30, height: 20 };
  const front = [{ op: "create_sketch", on: "XZ" }];
  assert.equal(matches([box], [{ op: "create_sketch", on: "XZ" }], front), true);
  // The front taken as the top (XY), or a second sketch: wrong.
  assert.equal(matches([box], [{ op: "create_sketch", on: "XY" }], front), false);
  assert.equal(matches([box], [{ op: "create_sketch", on: "XZ" }, { op: "create_sketch", on: "XZ" }], front), false);
  // A stand-in part beside the sketch, or a box changed: wrong; the same box sent again leaves the part as it was: right.
  assert.equal(matches([], [{ op: "set_part", shape: "cylinder", width: 20, depth: 20, height: 0.01 }, { op: "create_sketch", on: "XZ" }], front), false);
  assert.equal(matches([box], [{ ...box, width: 41 }, { op: "create_sketch", on: "XZ" }], front), false);
  assert.equal(matches([box], [box, { op: "create_sketch", on: "XZ" }], front), true);
  // A part case answered with a sketch beside the right part: wrong (an extra command).
  assert.equal(matches([], [box, { op: "create_sketch", on: "XY" }], [{ op: "set_part", width: 40 }]), false);
});

test("hand-worked: a draw case wants that shape in a new sketch, a centre left out being the origin (AI7b)", () => {
  // Ben's circle: radius 10 → diameter 20, on XY, centred on the origin.
  const want = [{ op: "create_sketch", on: "XY" }, { op: "draw_circle", diameter: 20 }];
  const sketch = { op: "create_sketch", on: "XY" };
  assert.equal(matches([], [sketch, { op: "draw_circle", diameter: 20 }], want), true);
  assert.equal(matches([], [sketch, { op: "draw_circle", diameter: 20, x: 0, y: 0 }], want), true, "the origin said out loud is the same circle");
  assert.equal(matches([], [sketch, { op: "draw_circle", diameter: 10 }], want), false, "the radius taken as the diameter");
  assert.equal(matches([], [sketch, { op: "draw_circle", diameter: 20, x: 1 }], want), false, "moved off the origin");
  assert.equal(matches([], [{ op: "draw_circle", diameter: 20 }], want), false, "no sketch started to draw in");
  assert.equal(matches([], [sketch, { op: "draw_rectangle", width: 20, height: 20 }], want), false, "a square is not a circle");
  // A centre given must be met: (10, 5), not the origin.
  const at = [sketch, { op: "draw_circle", diameter: 12, x: 10, y: 5 }];
  assert.equal(matches([], at, at), true);
  assert.equal(matches([], [sketch, { op: "draw_circle", diameter: 12 }], at), false);
  // Rectangle sides swapped: 20 along x and 30 along y is another rectangle.
  const rect = [{ op: "create_sketch", on: "XZ" }, { op: "draw_rectangle", width: 30, height: 20 }];
  assert.equal(matches([], [rect[0], { op: "draw_rectangle", width: 20, height: 30 }], rect), false);
});

test("a right command followed by a wrong one fails: the part ends up wrong", () => {
  // Worked by hand: set_part replaces the sizes it names, so [width 50, then width 40] leaves width 40.
  const setup = [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }];
  const right = { op: "set_part", shape: "box", width: 50, depth: 30, height: 20 };
  assert.equal(matches(setup, [right], [right]), true);
  assert.equal(matches(setup, [right, setup[0]], [right]), false);
  assert.equal(matches(setup, [setup[0], right], [right]), true, "the last word counts");
});

test("a size left out keeps the current one, as Design's run does", () => {
  // "Make it 10 mm wider" on 40 × 30 × 20, answered with only shape and width: depth 30 and height 20 stay.
  const setup = [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }];
  assert.equal(matches(setup, [{ op: "set_part", shape: "box", width: 50 }], [{ op: "set_part", shape: "box", width: 50, depth: 30, height: 20 }]), true);
  // On a new part there is nothing to keep, so a left-out depth is missing, not 30.
  assert.equal(matches([], [{ op: "set_part", shape: "box", width: 40, height: 20 }], [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }]), false);
});

test("the suite scores a provider per task type", async () => {
  // A stand-in provider that always answers "box 40 × 30 × 20".
  const provider: AIProvider = {
    kind: "ollama",
    structuredOutput: true,
    check: async () => ({ ok: true }),
    complete: async () => JSON.stringify({ commands: [{ op: "set_part", shape: "box", width: 40, depth: 30, height: 20 }] }),
  };
  const results = await runEval(provider, EVAL_CASES, DESIGN_COMMANDS);
  // Worked by hand: 40 × 30 × 20 is right for "box-by-sizes" and "box-in-cm" (4 cm × 3 cm × 2 cm) only,
  // so create 2 of 10 (AI7a's sketch case and AI7b's circle and line are the other three) and edit 0 of 5;
  // the hole case is skipped. Every answer was usable first time.
  assert.deepEqual(successRates(results), { create: 2 / 10, "edit-parameter": 0 });
  assert.equal(results.length, 15);
  assert.deepEqual(results.filter((r) => r.passed).map((r) => r.id), ["box-by-sizes", "box-in-cm"]);
  assert.ok(results.every((r) => r.attempts === 1));
});

test("the held-out cases are new: no id or sentence shared with the original cases", () => {
  const ids = new Set(EVAL_CASES.map((c) => c.id));
  const prompts = new Set(EVAL_CASES.map((c) => c.prompt.toLowerCase()));
  for (const c of HELD_OUT_CASES) {
    assert.ok(!ids.has(c.id) && !prompts.has(c.prompt.toLowerCase()), c.id);
    assert.ok(c.id.startsWith("held-"), `${c.id}: held-out ids start with "held-" so a report can't mix them up`);
  }
  assert.equal(new Set(HELD_OUT_CASES.map((c) => c.id)).size, HELD_OUT_CASES.length, "ids are unique");
});

test("the held-out cases catch the first run's mistakes", () => {
  const byId = (id: string) => HELD_OUT_CASES.find((c) => c.id === id)!;
  // Radius 9 read as the diameter gives width 9; right is 2 × 9 = 18.
  assert.equal(matches([], [{ op: "set_part", shape: "cylinder", width: 9, depth: 1, height: 40 }], byId("held-cylinder-radius").expected), false);
  assert.equal(matches([], [{ op: "set_part", shape: "cylinder", width: 18, depth: 1, height: 40 }], byId("held-cylinder-radius").expected), true);
  // The opposite mistake: a diameter doubled as if it were a radius (80 instead of 40).
  assert.equal(matches([], [{ op: "set_part", shape: "cylinder", width: 80, depth: 1, height: 10 }], byId("held-cylinder-diameter").expected), false);
  // A cube made as a cylinder.
  assert.equal(matches([], [{ op: "set_part", shape: "cylinder", width: 18, depth: 18, height: 18 }], byId("held-cube-sides").expected), false);
  // Centimetres left unconverted (5 instead of 50), and inches (2 instead of 50.8).
  assert.equal(matches([], [{ op: "set_part", shape: "sphere", width: 5, depth: 1, height: 1 }], byId("held-sphere-cm").expected), false);
  assert.equal(matches([], [{ op: "set_part", shape: "box", width: 2, depth: 1, height: 1 }], byId("held-box-inches").expected), false);
});

test("the suite scores a provider on the held-out cases", async () => {
  // A stand-in provider that always answers "cylinder, width 18, height 40".
  const provider: AIProvider = {
    kind: "ollama",
    structuredOutput: true,
    check: async () => ({ ok: true }),
    complete: async () => JSON.stringify({ commands: [{ op: "set_part", shape: "cylinder", width: 18, depth: 30, height: 40 }] }),
  };
  const results = await runEval(provider, HELD_OUT_CASES, DESIGN_COMMANDS);
  // Worked by hand: only "held-cylinder-radius" expects a cylinder 18 wide and 40 tall, so create 1 of 12
  // (8 parts, AI7a's 2 sketches, AI7b's circle and rectangle) and edit 0 of 6; it never refuses, so cannot 0 of 4.
  assert.equal(results.length, 22);
  assert.deepEqual(successRates(results), { create: 1 / 12, "edit-parameter": 0, cannot: 0 });
  assert.deepEqual(results.filter((r) => r.passed).map((r) => r.id), ["held-cylinder-radius"]);
});

test("a provider that always says it can't passes only the cannot cases", async () => {
  const provider: AIProvider = {
    kind: "ollama",
    structuredOutput: true,
    check: async () => ({ ok: true }),
    complete: async () => JSON.stringify({ explanation: "No command can do that yet.", commands: [] }),
  };
  const results = await runEval(provider, HELD_OUT_CASES, DESIGN_COMMANDS);
  // Worked by hand: the 4 cannot cases expect no commands; the 18 others expect a part or a sketch, and no answer is neither.
  assert.deepEqual(successRates(results), { create: 0, "edit-parameter": 0, cannot: 1 });
  assert.deepEqual(results.filter((r) => r.passed).map((r) => r.id), ["held-cannot-hole", "held-cannot-fillet", "held-cannot-arc", "held-cannot-text"]);
});

test("the evaluation asks with Design's own command wording, as the panel does", async () => {
  const systems: string[] = [];
  const provider: AIProvider = {
    kind: "ollama",
    structuredOutput: true,
    check: async () => ({ ok: true }),
    complete: async (r) => {
      systems.push(r.system);
      return JSON.stringify({ commands: [] });
    },
  };
  await runEval(provider, HELD_OUT_CASES.slice(0, 1), DESIGN_COMMANDS.filter((c) => c.op === "set_part"));
  // Design's set_part says width is the diameter for cylinders and spheres; the model only learns it from the prompt.
  assert.match(systems[0], /^ {2}width: width, or diameter for a cylinder or sphere \(millimetres, more than 0\)$/m);
  assert.match(systems[0], /^ {2}depth: depth; leave it out for a cylinder or sphere, or to keep the current depth \(millimetres, more than 0; optional\)$/m);
  assert.doesNotMatch(systems[0], /export/i, "only the offered command is described");
});

// The first ten examples of seed 1, each checked by hand from its words
// (the working is beside each), with the working out each carries (AI5c). This also pins the generator: the same
// seed must give these same examples. When a recipe changes on purpose,
// check the new ten by hand again before changing this list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DESIGN_COMMANDS } from "@fission/design";
import { generate, RECIPES, RULES } from "../src/index.ts";
import { fakeKernel } from "./fakes.ts";

const part = (shape: string, width: number, depth: number, height: number) => ({ op: "set_part", shape, width, depth, height });
const exportStl = { op: "export_stl" };

const now = (shape: string, w: number, d: number, h: number) => `The part now is ${shape}: width ${w} mm, depth ${d} mm, height ${h} mm.`;
const so = (shape: string, w: number, d: number, h: number, isNew = false) => `So the ${isNew ? "new " : ""}part is ${shape}: width ${w} mm, depth ${d} mm, height ${h} mm.`;
const exported = "No size changes; the whole part is exported as an STL file.";

// [setup, words, working out, commands]. Each working out is checked line by line against the words, by hand.
// AI7a's sketch recipe changed seed 1's draws, so these ten and the later four were checked by hand again.
const sketchOn = (on: string) => ({ op: "create_sketch", on });
const sketched = (on: string) => `So there is a new empty sketch on the ${on} plane, ready to draw in.`;
const HAND_CHECKED = [
  // Only the export; the part stays.
  [[part("slot", 156, 13, 20)], "Download it as an STL file.", `${now("a slot", 156, 13, 20)} ${exported}`, [exportStl]],
  // XZ named by its letters: a sketch there, and the cylinder untouched.
  [[part("cylinder", 105, 105, 1.5)], "I want to sketch on XZ.", `The part stays as it is. ${sketched("XZ")}`, [sketchOn("XZ")]],
  // Narrower takes from the width: 19 − 4 = 15; a sphere's depth and height are kept as they are.
  [
    [part("sphere", 19, 19, 19)],
    "4mm narrower, please.",
    `${now("a sphere", 19, 19, 19)} Narrower changes the width: 19 − 4 = 15 mm. Every other size stays. ${so("a sphere", 15, 19, 19)}`,
    [part("sphere", 15, 19, 19)],
  ],
  // The ground is the XY plane (Z up): a new project, so nothing else is said.
  [[], "Open a new sketch on ground, please.", `The ground plane is the XY plane. ${sketched("XY")}`, [sketchOn("XY")]],
  // A radius of 148 is a diameter (width) of 2 × 148 = 296.
  [
    [part("cylinder", 182, 182, 213)],
    "I want the radius to be 148 mm.",
    `${now("a cylinder", 182, 182, 213)} The width is the diameter, twice the radius: 2 × 148 = 296 mm. Every other size stays. ${so("a cylinder", 296, 182, 213)}`,
    [part("cylinder", 296, 182, 213)],
  ],
  // A new shape keeps every size.
  [[part("slot", 51, 1, 2.5)], "Change the shape to a plate.", `${now("a slot", 51, 1, 2.5)} Only the shape changes, to a plate; every size stays. ${so("a plate", 51, 1, 2.5)}`, [part("plate", 51, 1, 2.5)]],
  // 7.5 cm = 75 mm, 1 cm = 10 mm, 3 cm = 30 mm; the legs are width and depth, the thickness the height; then the export.
  [
    [],
    "An L bracket 7.5cm×1 cm, 3cm thick and give me the STL file.",
    `An L bracket's legs are its width and depth, and its thickness is the height. 7.5 cm is 75 mm, 1 cm is 10 mm and 3 cm is 30 mm. ${so("an L bracket", 75, 10, 30, true)} Then it is exported as an STL file.`,
    [part("l-bracket", 75, 10, 30), exportStl],
  ],
  // "The XY": the plane by its letters, over a slot that stays.
  [[part("slot", 134, 1, 44)], "I want to sketch on the XY.", `The part stays as it is. ${sketched("XY")}`, [sketchOn("XY")]],
  // A new shape keeps every size.
  [[part("l-bracket", 39, 126, 9)], "Make it a box instead.", `${now("an L bracket", 39, 126, 9)} Only the shape changes, to a box; every size stays. ${so("a box", 39, 126, 9)}`, [part("box", 39, 126, 9)]],
  [[part("cylinder", 281, 15, 52)], "Export the STL.", `${now("a cylinder", 281, 15, 52)} ${exported}`, [exportStl]],
];

// Later examples of seed 1, chosen for what the first ten lack, each checked by hand.
const LATER = {
  // A radius of 2 is a width of 2 × 2 = 4, and a sphere is 4 every way. Asked over an old part, which it replaces.
  16: [
    [part("cylinder", 3, 39, 66)],
    "I want a sphere with a radius of 2 mm.",
    `This replaces the part there is now. The radius is 2 mm, and the width is the diameter, twice the radius: 2 × 2 = 4 mm. A sphere is as deep and as tall as it is wide. ${so("a sphere", 4, 4, 4, true)}`,
    [part("sphere", 4, 4, 4)],
  ],
  // Halving makes it smaller: 52 × 0.5 = 26, the depth and height kept.
  23: [
    [part("sphere", 52, 52, 52)],
    "Halve the width.",
    `${now("a sphere", 52, 52, 52)} That multiplies the width by 0.5: 52 × 0.5 = 26 mm. Every other size stays. ${so("a sphere", 26, 52, 52)}`,
    [part("sphere", 26, 52, 52)],
  ],
  // A line drawn in a sketch: a sketch can be started (AI7a) but nothing drawn in it until AI7b, and the answer is all
  // or nothing, so no commands, the reason said plainly and what can be done instead.
  33: [
    [part("star", 39, 39, 13)],
    "Draw a line 1 cm long on the top face.",
    "There is no command for drawing in a sketch yet, so this can't be done and nothing was made. What can be done now is making or resizing a whole ready-made shape (a box, cylinder, sphere, plate, L bracket, slot or star), or starting an empty sketch on a plane.",
    [],
  ],
  // Every size three times: 3 × 3 = 9, 98 × 3 = 294, 39 × 3 = 117.
  35: [
    [part("cylinder", 3, 98, 39)],
    "Make it three times as big.",
    `${now("a cylinder", 3, 98, 39)} That multiplies every size by 3: 3 × 3 = 9 mm, 98 × 3 = 294 mm, 39 × 3 = 117 mm. ${so("a cylinder", 9, 294, 117)}`,
    [part("cylinder", 9, 294, 117)],
  ],
  // Inches: 7.75 × 25.4 = 196.85 (7 × 25.4 = 177.8, 0.75 × 25.4 = 19.05).
  55: [
    [part("l-bracket", 4, 8, 1)],
    "Set the depth to 7.75 inches.",
    `${now("an L bracket", 4, 8, 1)} 7.75 inches is 196.85 mm. The depth becomes 196.85 mm. Every other size stays. ${so("an L bracket", 4, 196.85, 1)}`,
    [part("l-bracket", 4, 196.85, 1)],
  ],
};

test("the first ten examples of seed 1, checked by hand", async () => {
  const g = await generate({ seed: 1n, count: 10, specs: DESIGN_COMMANDS, rules: RULES, recipes: RECIPES, kernel: fakeKernel(), heldOut: [] });
  assert.ok(g.ok);
  assert.deepEqual(
    g.examples.map((e) => [e.setup, e.prompt, e.explanation, e.commands]),
    HAND_CHECKED,
  );
});

test("later examples of seed 1 with a radius, a smaller size, a refusal, a whole scale and inches, checked by hand", async () => {
  const g = await generate({ seed: 1n, count: 60, specs: DESIGN_COMMANDS, rules: RULES, recipes: RECIPES, kernel: fakeKernel(), heldOut: [] });
  assert.ok(g.ok);
  for (const [i, want] of Object.entries(LATER)) {
    const e = g.examples[Number(i)];
    assert.deepEqual([e.setup, e.prompt, e.explanation, e.commands], want, `example ${i}`);
  }
});

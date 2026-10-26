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
const HAND_CHECKED = [
  // A new shape keeps every size.
  [[part("slot", 156, 13, 20)], "Change the shape to a cylinder.", `${now("a slot", 156, 13, 20)} Only the shape changes, to a cylinder; every size stays. ${so("a cylinder", 156, 13, 20)}`, [part("cylinder", 156, 13, 20)]],
  // A plate's thickness is its height: 105 / 2 = 52.5; width 21 and depth 3 kept.
  [
    [part("plate", 21, 3, 105)],
    "Make it half as thick.",
    `${now("a plate", 21, 3, 105)} The thickness is the height. That multiplies the height by 0.5: 105 × 0.5 = 52.5 mm. Every other size stays. ${so("a plate", 21, 3, 52.5)}`,
    [part("plate", 21, 3, 52.5)],
  ],
  // Three sizes of a box are width, depth, height; the one unit (mm) is written after the last.
  [[], "Can you make a 59 × 30 × 4mm box?", `Its sizes are the width, depth and height, in that order. ${so("a box", 59, 30, 4, true)}`, [part("box", 59, 30, 4)]],
  // Wider is the width: 6 + 236.5 = 242.5.
  [
    [part("star", 6, 6, 9)],
    "Can you make the star 236.5mm wider?",
    `${now("a star", 6, 6, 9)} Wider changes the width: 6 + 236.5 = 242.5 mm. Every other size stays. ${so("a star", 242.5, 6, 9)}`,
    [part("star", 242.5, 6, 9)],
  ],
  // Only the export; the part stays.
  [[part("cylinder", 1, 2, 109.5)], "Give me the STL file.", `${now("a cylinder", 1, 2, 109.5)} ${exported}`, [exportStl]],
  // A new shape keeps every size.
  [[part("l-bracket", 135, 2, 4)], "Change the shape to a sphere.", `${now("an L bracket", 135, 2, 4)} Only the shape changes, to a sphere; every size stays. ${so("a sphere", 135, 2, 4)}`, [part("sphere", 135, 2, 4)]],
  [[part("star", 2, 2, 9)], "Export it as an STL.", `${now("a star", 2, 2, 9)} ${exported}`, [exportStl]],
  // A sketch: Design has no command that draws one, so no commands, and the reason said plainly (AI5c).
  [
    [part("star", 1, 1, 2)],
    "Draw a 6.5 inches by 29 mm rectangle in a sketch on the XY plane.",
    "There is no command for drawing a sketch yet, so this can't be done and nothing was made. What can be done now is making or resizing a whole ready-made shape: a box, cylinder, sphere, plate, L bracket, slot or star.",
    [],
  ],
  [[part("plate", 2, 10, 25)], "Give me the STL file.", `${now("a plate", 2, 10, 25)} ${exported}`, [exportStl]],
  [[part("star", 3, 3, 4)], "Download it as an STL file.", `${now("a star", 3, 3, 4)} ${exported}`, [exportStl]],
];

// Later examples of seed 1, chosen for what the first ten lack, each checked by hand.
const LATER = {
  // Inches: 0.5 × 25.4 = 12.7, 2.5 × 25.4 = 63.5, 3 × 25.4 = 76.2. Asked over an old part, which it replaces.
  31: [
    [part("l-bracket", 15, 2.5, 6)],
    "An L bracket 0.5×2.5 in, 3 in thick.",
    `This replaces the part there is now. An L bracket's legs are its width and depth, and its thickness is the height. 0.5 inches is 12.7 mm, 2.5 inches is 63.5 mm and 3 inches is 76.2 mm. ${so("an L bracket", 12.7, 63.5, 76.2, true)}`,
    [part("l-bracket", 12.7, 63.5, 76.2)],
  ],
  // Shorter takes from the height: 24 − 6.5 = 17.5.
  42: [
    [part("box", 2, 70, 24)],
    "Can you make it 6.5mm shorter?",
    `${now("a box", 2, 70, 24)} Shorter changes the height: 24 − 6.5 = 17.5 mm. Every other size stays. ${so("a box", 2, 70, 17.5)}`,
    [part("box", 2, 70, 17.5)],
  ],
  // Every size three times: 8 × 3 = 24, 16 × 3 = 48, 33 × 3 = 99.
  54: [
    [part("cylinder", 8, 16, 33)],
    "Make it three times as big.",
    `${now("a cylinder", 8, 16, 33)} That multiplies every size by 3: 8 × 3 = 24 mm, 16 × 3 = 48 mm, 33 × 3 = 99 mm. ${so("a cylinder", 24, 48, 99)}`,
    [part("cylinder", 24, 48, 99)],
  ],
  // A radius of 33 is a diameter (width) of 2 × 33 = 66, and a sphere is 66 every way.
  58: [
    [part("l-bracket", 8.5, 78, 4.5)],
    "Make a sphere with a radius of 33 mm.",
    `This replaces the part there is now. The radius is 33 mm, and the width is the diameter, twice the radius: 2 × 33 = 66 mm. A sphere is as deep and as tall as it is wide. ${so("a sphere", 66, 66, 66, true)}`,
    [part("sphere", 66, 66, 66)],
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

test("later examples of seed 1 with inches, a smaller size, a whole scale and a radius, checked by hand", async () => {
  const g = await generate({ seed: 1n, count: 60, specs: DESIGN_COMMANDS, rules: RULES, recipes: RECIPES, kernel: fakeKernel(), heldOut: [] });
  assert.ok(g.ok);
  for (const [i, want] of Object.entries(LATER)) {
    const e = g.examples[Number(i)];
    assert.deepEqual([e.setup, e.prompt, e.explanation, e.commands], want, `example ${i}`);
  }
});

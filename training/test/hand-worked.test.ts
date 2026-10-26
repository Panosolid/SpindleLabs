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
// AI7a's sketch recipe and AI7b's drawing recipe changed seed 1's draws, so these ten and the later ones were checked by hand again.
const sketchOn = (on: string) => ({ op: "create_sketch", on });
const sketched = (on: string) => `So there is a new sketch on the ${on} plane, ready to draw in.`;
const CAN_DO = "What can be done now is making or resizing a whole ready-made shape (a box, cylinder, sphere, plate, L bracket, slot or star), or starting a sketch on a plane and drawing circles, rectangles and lines in it.";
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
  // The ground is the XY plane (Z up); the ends are mm in the sketch, as written.
  [
    [],
    "Draw a line from (-68, 79) to (83, -40) mm in a sketch on ground.",
    "The ground plane is the XY plane. The ends are given in mm in the sketch. So there is a new sketch on the XY plane, and in it a line from (−68, 79) to (83, −40).",
    [sketchOn("XY"), { op: "draw_line", x1: -68, y1: 79, x2: 83, y2: -40 }],
  ],
  // Half as wide: 2 × 0.5 = 1.
  [
    [part("star", 2, 2, 148)],
    "Make it half as wide.",
    `${now("a star", 2, 2, 148)} That multiplies the width by 0.5: 2 × 0.5 = 1 mm. Every other size stays. ${so("a star", 1, 2, 148)}`,
    [part("star", 1, 2, 148)],
  ],
  [[part("cylinder", 257, 25, 35)], "I want to sketch on the XY plane.", `The part stays as it is. ${sketched("XY")}`, [sketchOn("XY")]],
  // XZ by its letters; both ends as written.
  [
    [],
    "Sketch a line from (88, 50) to (-75, -65) mm on the XZ plane.",
    "The ends are given in mm in the sketch. So there is a new sketch on the XZ plane, and in it a line from (88, 50) to (−75, −65).",
    [sketchOn("XZ"), { op: "draw_line", x1: 88, y1: 50, x2: -75, y2: -65 }],
  ],
  [[part("slot", 134, 1, 44)], "I want to sketch on the XY.", `The part stays as it is. ${sketched("XY")}`, [sketchOn("XY")]],
  // A new shape keeps every size.
  [[part("l-bracket", 39, 126, 9)], "Make it a box instead.", `${now("an L bracket", 39, 126, 9)} Only the shape changes, to a box; every size stays. ${so("a box", 39, 126, 9)}`, [part("box", 39, 126, 9)]],
  [[part("cylinder", 281, 15, 52)], "Export the STL.", `${now("a cylinder", 281, 15, 52)} ${exported}`, [exportStl]],
];

// Later examples of seed 1, chosen for what the first ten lack, each checked by hand.
const LATER = {
  // Every size twice: 11.5 × 2 = 23, 6 × 2 = 12, 188 × 2 = 376.
  15: [
    [part("l-bracket", 11.5, 6, 188)],
    "Make it twice as big.",
    `${now("an L bracket", 11.5, 6, 188)} That multiplies every size by 2: 11.5 × 2 = 23 mm, 6 × 2 = 12 mm, 188 × 2 = 376 mm. ${so("an L bracket", 23, 12, 376)}`,
    [part("l-bracket", 23, 12, 376)],
  ],
  // Smaller: 10 × 0.5 = 5.
  16: [
    [part("slot", 540, 10, 5.5)],
    "Make it half as deep.",
    `${now("a slot", 540, 10, 5.5)} That multiplies the depth by 0.5: 10 × 0.5 = 5 mm. Every other size stays. ${so("a slot", 540, 5, 5.5)}`,
    [part("slot", 540, 5, 5.5)],
  ],
  // The back is the XZ plane (the same plane as the front); "across" is the diameter, 23; the centre as written.
  27: [
    [],
    "In a sketch on back, draw a circle 23mm across centred at (-38, 32) mm.",
    "The back plane is the XZ plane. The centre is given in mm in the sketch. So there is a new sketch on the XZ plane, and in it a circle ⌀23 mm at (−38, 32).",
    [sketchOn("XZ"), { op: "draw_circle", diameter: 23, x: -38, y: 32 }],
  ],
  // A radius of 48 is a width of 2 × 48 = 96, and a sphere is 96 every way.
  44: [
    [],
    "I want a sphere 48mm in radius.",
    `The radius is 48 mm, and the width is the diameter, twice the radius: 2 × 48 = 96 mm. A sphere is as deep and as tall as it is wide. ${so("a sphere", 96, 96, 96, true)}`,
    [part("sphere", 96, 96, 96)],
  ],
  // Arcs can't be drawn yet (circles, rectangles and lines can): no commands, the reason, and what can be done.
  46: [
    [part("cylinder", 14, 54.5, 3)],
    "Draw an arc of radius 5 cm in a sketch on the YZ plane.",
    `There is no command for drawing arcs yet, so this can't be done and nothing was made. ${CAN_DO}`,
    [],
  ],
  // Inches: 2.25 × 25.4 = 57.15 and 2 × 25.4 = 50.8; the radius doubled: 2 × 57.15 = 114.3.
  47: [
    [],
    "Make a disc of radius 2.25 in, 2 inches thick.",
    `A disc is a cylinder. 2.25 inches is 57.15 mm and 2 inches is 50.8 mm. The radius is 57.15 mm, and the width is the diameter, twice the radius: 2 × 57.15 = 114.3 mm. A new cylinder is as deep as it is wide. How thick it is, 50.8 mm, is the height. ${so("a cylinder", 114.3, 114.3, 50.8, true)}`,
    [part("cylinder", 114.3, 114.3, 50.8)],
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

test("later examples of seed 1 with a whole scale, a smaller size, a centred circle, a radius, a refusal and inches, checked by hand", async () => {
  const g = await generate({ seed: 1n, count: 60, specs: DESIGN_COMMANDS, rules: RULES, recipes: RECIPES, kernel: fakeKernel(), heldOut: [] });
  assert.ok(g.ok);
  for (const [i, want] of Object.entries(LATER)) {
    const e = g.examples[Number(i)];
    assert.deepEqual([e.setup, e.prompt, e.explanation, e.commands], want, `example ${i}`);
  }
});

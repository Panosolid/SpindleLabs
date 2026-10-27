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
// AI7a's sketch recipe, AI7b's drawing recipe and AI7c's extrude recipe changed seed 1's draws, so these ten and the later ones were checked by hand again.
const sketchOn = (on: string) => ({ op: "create_sketch", on });
const extrude = (distance: number) => ({ op: "extrude_sketch", distance });
const sketched = (on: string) => `So there is a new sketch on the ${on} plane, ready to draw in.`;
const CAN_DO = "What can be done now is making or resizing a whole ready-made shape (a box, cylinder, sphere, plate, L bracket, slot or star), or starting a sketch on a plane, drawing circles, rectangles and lines in it and extruding it.";
const HAND_CHECKED = [
  // A cube is a box with every side the same: 3.5 cm = 35 mm; then the export.
  [[], "I'd like a cube, 3.5cm on each side. Then download it as an STL file.", `A cube is a box with every side the same. 3.5 cm is 35 mm. ${so("a box", 35, 35, 35, true)} Then it is exported as an STL file.`, [part("box", 35, 35, 35), exportStl]],
  // A radius of 155 is a diameter of 2 × 155 = 310; XZ by its letters; the centre as written.
  [
    [],
    "Sketch a circle with a radius of 155 millimetres centred at (15, 32) mm on the XZ plane.",
    "The diameter is twice the radius: 2 × 155 = 310 mm. The centre is given in mm in the sketch. So there is a new sketch on the XZ plane, and in it a circle ⌀310 mm at (15, 32).",
    [sketchOn("XZ"), { op: "draw_circle", diameter: 310, x: 15, y: 32 }],
  ],
  // Half as deep: 296 × 0.5 = 148.
  [
    [part("box", 59, 296, 28)],
    "Make it half as deep.",
    `${now("a box", 59, 296, 28)} That multiplies the depth by 0.5: 296 × 0.5 = 148 mm. Every other size stays. ${so("a box", 59, 148, 28)}`,
    [part("box", 59, 148, 28)],
  ],
  // Only the export; the part stays.
  [[part("slot", 114, 45, 42)], "Export the STL.", `${now("a slot", 114, 45, 42)} ${exported}`, [exportStl]],
  // 0.15 m = 150 mm across and 150 mm out: a circle of diameter 150 on XY, extruded 150 (AI7c).
  [
    [],
    "In a sketch on XY, draw a circle 0.15 m across, then extrude it 0.15 m.",
    "0.15 m is 150 mm. It is centred on the sketch's origin. So there is a new sketch on the XY plane, and in it a circle ⌀150 mm at (0, 0). Then extrude the sketch by 150 mm.",
    [sketchOn("XY"), { op: "draw_circle", diameter: 150 }, extrude(150)],
  ],
  [[part("slot", 51, 1, 2.5)], "Export the STL.", `${now("a slot", 51, 1, 2.5)} ${exported}`, [exportStl]],
  // A chamfer has no command: no commands and the reason.
  [[part("plate", 11, 50, 72)], "Chamfer the top edges by 135 mm.", `There is no command for a chamfer yet, so this can't be done and nothing was made. ${CAN_DO}`, []],
  // Taller adds to the height: 30 + 67 = 97; the width and depth stay.
  [
    [part("cylinder", 86, 86, 30)],
    "Can you make the cylinder 67mm taller?",
    `${now("a cylinder", 86, 86, 30)} Taller changes the height: 30 + 67 = 97 mm. Every other size stays. ${so("a cylinder", 86, 86, 97)}`,
    [part("cylinder", 86, 86, 97)],
  ],
  // 1 inch = 25.4 mm, on every side.
  [[], "Make a cube with 1 inch sides.", `A cube is a box with every side the same. 1 inch is 25.4 mm. ${so("a box", 25.4, 25.4, 25.4, true)}`, [part("box", 25.4, 25.4, 25.4)]],
  // 3 mm replaces the 68 mm height.
  [
    [part("box", 10, 25, 68)],
    "Change the height to 3 millimetres.",
    `${now("a box", 10, 25, 68)} The height becomes 3 mm. Every other size stays. ${so("a box", 10, 25, 3)}`,
    [part("box", 10, 25, 3)],
  ],
];

// Later examples of seed 1, chosen for what the first ten lack, each checked by hand.
const LATER = {
  // 0.5 inch = 12.7 mm, 0.75 inch = 19.05 mm; the radius doubled: 2 × 12.7 = 25.4; the centre as written; YZ by its letters.
  11: [
    [],
    "In a sketch on YZ, draw a circle of radius 0.5 in centred at (38, -20) mm, then extrude it 0.75 in.",
    "0.5 inches is 12.7 mm and 0.75 inches is 19.05 mm. The diameter is twice the radius: 2 × 12.7 = 25.4 mm. The centre is given in mm in the sketch. So there is a new sketch on the YZ plane, and in it a circle ⌀25.4 mm at (38, −20). Then extrude the sketch by 19.05 mm.",
    [sketchOn("YZ"), { op: "draw_circle", diameter: 25.4, x: 38, y: -20 }, extrude(19.05)],
  ],
  // Smaller: 2 × 0.5 = 1.
  15: [
    [part("sphere", 2, 2, 2)],
    "Make it half as wide.",
    `${now("a sphere", 2, 2, 2)} That multiplies the width by 0.5: 2 × 0.5 = 1 mm. Every other size stays. ${so("a sphere", 1, 2, 2)}`,
    [part("sphere", 1, 2, 2)],
  ],
  // The back is the XZ plane (the same plane as the front); radius 1 doubled is 2; extruded 2.
  25: [
    [],
    "In a sketch on back, draw a circle with a radius of 1mm, then extrude it by 2 mm.",
    "The back plane is the XZ plane. The diameter is twice the radius: 2 × 1 = 2 mm. It is centred on the sketch's origin. So there is a new sketch on the XZ plane, and in it a circle ⌀2 mm at (0, 0). Then extrude the sketch by 2 mm.",
    [sketchOn("XZ"), { op: "draw_circle", diameter: 2 }, extrude(2)],
  ],
  // A radius of 48 is a width of 2 × 48 = 96, and a sphere is 96 every way.
  45: [
    [],
    "I want a sphere 48mm in radius.",
    `The radius is 48 mm, and the width is the diameter, twice the radius: 2 × 48 = 96 mm. A sphere is as deep and as tall as it is wide. ${so("a sphere", 96, 96, 96, true)}`,
    [part("sphere", 96, 96, 96)],
  ],
  // Arcs can't be drawn yet (circles, rectangles and lines can): no commands, the reason, and what can be done.
  47: [
    [part("cylinder", 14, 54.5, 3)],
    "Draw an arc of radius 5 cm in a sketch on the YZ plane.",
    `There is no command for drawing arcs yet, so this can't be done and nothing was made. ${CAN_DO}`,
    [],
  ],
  // Inches: 2.25 × 25.4 = 57.15 and 2 × 25.4 = 50.8; the radius doubled: 2 × 57.15 = 114.3.
  48: [
    [],
    "Make a disc of radius 2.25 in, 2 inches thick.",
    `A disc is a cylinder. 2.25 inches is 57.15 mm and 2 inches is 50.8 mm. The radius is 57.15 mm, and the width is the diameter, twice the radius: 2 × 57.15 = 114.3 mm. A new cylinder is as deep as it is wide. How thick it is, 50.8 mm, is the height. ${so("a cylinder", 114.3, 114.3, 50.8, true)}`,
    [part("cylinder", 114.3, 114.3, 50.8)],
  ],
  // A rectangle in inches: 4.75 × 25.4 = 120.65, 2 × 25.4 = 50.8, 0.25 × 25.4 = 6.35; wide is along x, high along y; the centre as written.
  78: [
    [],
    'Draw a 4.75 inches by 2" rectangle centred at (34, -34) mm in a sketch on back, and extrude it by 0.25".',
    "The back plane is the XZ plane. 4.75 inches is 120.65 mm, 2 inches is 50.8 mm and 0.25 inches is 6.35 mm. The first size is along the sketch's x, the second along its y. The centre is given in mm in the sketch. So there is a new sketch on the XZ plane, and in it a rectangle 120.65 × 50.8 mm centred at (34, −34). Then extrude the sketch by 6.35 mm.",
    [sketchOn("XZ"), { op: "draw_rectangle", width: 120.65, height: 50.8, x: 34, y: -34 }, extrude(6.35)],
  ],
  // The other way is a negative distance: a radius of 10 doubled is 20, and −78 goes against the sketch's plane.
  216: [
    [],
    "In a sketch on front, draw a circle with a radius of 10 mm, and extrude it the other way by 78 mm.",
    "The front plane is the XZ plane. The diameter is twice the radius: 2 × 10 = 20 mm. It is centred on the sketch's origin. So there is a new sketch on the XZ plane, and in it a circle ⌀20 mm at (0, 0). The other way is a negative distance: −78 mm. Then extrude the sketch by 78 mm the other way.",
    [sketchOn("XZ"), { op: "draw_circle", diameter: 20 }, extrude(-78)],
  ],
  // 3 mm wide, 1 mm high rectangle centred at (30, −33) on the top (XY) plane; 13 mm the other way is −13.
  227: [
    [],
    "Sketch a rectangle 3 mm wide and 1 mm high centred at (30, -33) mm on the top plane, then extrude it 13mm the other way.",
    "The top plane is the XY plane. The first size is along the sketch's x, the second along its y. The centre is given in mm in the sketch. So there is a new sketch on the XY plane, and in it a rectangle 3 × 1 mm centred at (30, −33). The other way is a negative distance: −13 mm. Then extrude the sketch by 13 mm the other way.",
    [sketchOn("XY"), { op: "draw_rectangle", width: 3, height: 1, x: 30, y: -33 }, extrude(-13)],
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
  const g = await generate({ seed: 1n, count: 300, specs: DESIGN_COMMANDS, rules: RULES, recipes: RECIPES, kernel: fakeKernel(), heldOut: [] });
  assert.ok(g.ok);
  for (const [i, want] of Object.entries(LATER)) {
    const e = g.examples[Number(i)];
    assert.deepEqual([e.setup, e.prompt, e.explanation, e.commands], want, `example ${i}`);
  }
});

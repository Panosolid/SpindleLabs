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

const now = (shape: string, w: number, d: number, h: number) => `The part now is ${shape}: width ${w} mm, depth ${d} mm, height ${h} mm.`;
const so = (shape: string, w: number, d: number, h: number, isNew = false) => `So the ${isNew ? "new " : ""}part is ${shape}: width ${w} mm, depth ${d} mm, height ${h} mm.`;
const exported = "No size changes; the whole part is exported as an STL file.";

// [setup, words, working out, commands]. Each working out is checked line by line against the words, by hand.
// AI7a's sketch recipe, AI7b's drawing recipe, AI7c's extrude recipe and AI7d's two rename recipes changed seed 1's draws, so these ten and the later ones were checked by hand again.
const HAND_CHECKED = [
  // The side is the YZ plane (the view cube's right/left/side face the YZ plane).
  [[], "New sketch on the side plane.", "The side plane is the YZ plane. So there is a new sketch on the YZ plane, ready to draw in.", [{"op": "create_sketch", "on": "YZ"}]],
  // Bottom is the XY plane; the rename names no item: the sketch just started is the one.
  [[], "Create a sketch on bottom and name it \"hinge\".", "The bottom plane is the XY plane. So there is a new sketch on the XY plane. Then the sketch just started is named: rename the newest item to hinge.", [{"op": "create_sketch", "on": "XY"}, {"op": "rename_item", "name": "hinge"}]],
  // XZ by its letters.
  [[], "Create a sketch on XZ.", "So there is a new sketch on the XZ plane, ready to draw in.", [{"op": "create_sketch", "on": "XZ"}]],
  // Three sketches are there (Sketch 1 to 3); the second is Sketch 2, and only its name changes.
  [[{"op": "create_sketch", "on": "YZ"}, {"op": "create_sketch", "on": "XY"}, {"op": "create_sketch", "on": "XY"}], "Rename Sketch 2 to \"base\".", "Only the name changes, so rename Sketch 2 to base; nothing is built or removed.", [{"op": "rename_item", "item": "Sketch 2", "name": "base"}]],
  // 39.5 cm = 395 mm, 3 cm = 30 mm, 5 cm = 50 mm; then the export.
  [[], "Can you make a 39.5cm by 3 cm by 5cm box. Then download it as an STL file.", "Its sizes are the width, depth and height, in that order. 39.5 cm is 395 mm, 3 cm is 30 mm and 5 cm is 50 mm. So the new part is a box: width 395 mm, depth 30 mm, height 50 mm. Then it is exported as an STL file.", [{"op": "set_part", "shape": "box", "width": 395, "depth": 30, "height": 50}, {"op": "export_stl"}]],
  // 1 cm = 10 mm replaces the width 6.
  [[{"op": "set_part", "shape": "star", "width": 6, "depth": 6, "height": 9}], "Make the width 1cm.", "The part now is a star: width 6 mm, depth 6 mm, height 9 mm. 1 cm is 10 mm. The width becomes 10 mm. Every other size stays. So the part is a star: width 10 mm, depth 6 mm, height 9 mm.", [{"op": "set_part", "shape": "star", "width": 10, "depth": 6, "height": 9}]],
  // 2.25 in = 57.15 mm (2.25 × 25.4), 4 in = 101.6 mm (4 × 25.4), 0.25 in = 6.35 mm (0.25 × 25.4).
  [[], "I need a flat plate with two holes, 2.25 \u00d7 4 in and 0.25 inches thick.", "A plate's two sizes across are its width and depth, and its thickness is the height. 2.25 inches is 57.15 mm, 4 inches is 101.6 mm and 0.25 inches is 6.35 mm. So the new part is a plate: width 57.15 mm, depth 101.6 mm, height 6.35 mm.", [{"op": "set_part", "shape": "plate", "width": 57.15, "depth": 101.6, "height": 6.35}]],
  // A sketch never changes the part: YZ by its letters.
  [[{"op": "set_part", "shape": "slot", "width": 44, "depth": 14, "height": 39}], "Start a new sketch on the YZ.", "The part stays as it is. So there is a new sketch on the YZ plane, ready to draw in.", [{"op": "create_sketch", "on": "YZ"}]],
  // 1 inch = 25.4 mm, on every side.
  [[], "Make a cube with 1 inch sides.", "A cube is a box with every side the same. 1 inch is 25.4 mm. So the new part is a box: width 25.4 mm, depth 25.4 mm, height 25.4 mm.", [{"op": "set_part", "shape": "box", "width": 25.4, "depth": 25.4, "height": 25.4}]],
  // 3 mm replaces the 68 mm height.
  [[{"op": "set_part", "shape": "box", "width": 10, "depth": 25, "height": 68}], "Change the height to 3 millimetres.", "The part now is a box: width 10 mm, depth 25 mm, height 68 mm. The height becomes 3 mm. Every other size stays. So the part is a box: width 10 mm, depth 25 mm, height 3 mm.", [{"op": "set_part", "shape": "box", "width": 10, "depth": 25, "height": 3}]],
];

// Later examples of seed 1, chosen for what the first ten lack, each checked by hand.
const LATER = {
  // Back is the XZ plane; a 155 × 207.5 rectangle centred at (31, −27) as written; 115 mm the other way is −115.
  11: [[], "Draw a 155 millimetres by 207.5 millimetres rectangle centred at (31, -27) mm in a sketch on back, and extrude it the other way by 115 millimetres.", "The back plane is the XZ plane. The first size is along the sketch's x, the second along its y. The centre is given in mm in the sketch. So there is a new sketch on the XZ plane, and in it a rectangle 155 \u00d7 207.5 mm centred at (31, \u221227). The other way is a negative distance: \u2212115 mm. Then extrude the sketch by 115 mm the other way.", [{"op": "create_sketch", "on": "XZ"}, {"op": "draw_rectangle", "width": 155, "height": 207.5, "x": 31, "y": -27}, {"op": "extrude_sketch", "distance": -115}]],
  // Bottom is the XY plane; 0.25 in = 6.35 mm, the radius doubled: 2 × 6.35 = 12.7; 1 in = 25.4 mm; the centre as written.
  12: [[], "In a sketch on the bottom plane, draw a circle of radius 0.25 inches centred at (38, -17) mm, and extrude it by 1 inch.", "The bottom plane is the XY plane. 0.25 inches is 6.35 mm and 1 inch is 25.4 mm. The diameter is twice the radius: 2 \u00d7 6.35 = 12.7 mm. The centre is given in mm in the sketch. So there is a new sketch on the XY plane, and in it a circle \u230012.7 mm at (38, \u221217). Then extrude the sketch by 25.4 mm.", [{"op": "create_sketch", "on": "XY"}, {"op": "draw_circle", "diameter": 12.7, "x": 38, "y": -17}, {"op": "extrude_sketch", "distance": 25.4}]],
  // Twice as big: 11.5 × 2 = 23, 6 × 2 = 12, 188 × 2 = 376.
  13: [[{"op": "set_part", "shape": "l-bracket", "width": 11.5, "depth": 6, "height": 188}], "Make it twice as big.", "The part now is an L bracket: width 11.5 mm, depth 6 mm, height 188 mm. That multiplies every size by 2: 11.5 \u00d7 2 = 23 mm, 6 \u00d7 2 = 12 mm, 188 \u00d7 2 = 376 mm. So the part is an L bracket: width 23 mm, depth 12 mm, height 376 mm.", [{"op": "set_part", "shape": "l-bracket", "width": 23, "depth": 12, "height": 376}]],
  // Smaller: half of the depth 10 is 10 × 0.5 = 5.
  14: [[{"op": "set_part", "shape": "slot", "width": 540, "depth": 10, "height": 5.5}], "Make it half as deep.", "The part now is a slot: width 540 mm, depth 10 mm, height 5.5 mm. That multiplies the depth by 0.5: 10 \u00d7 0.5 = 5 mm. Every other size stays. So the part is a slot: width 540 mm, depth 5 mm, height 5.5 mm.", [{"op": "set_part", "shape": "slot", "width": 540, "depth": 5, "height": 5.5}]],
  // Arcs can't be drawn yet: no commands, the reason, and what can be done (now including renaming).
  17: [[{"op": "set_part", "shape": "sphere", "width": 27, "depth": 27, "height": 27}], "Draw an arc of radius 1 cm in a sketch on the XZ plane.", "There is no command for drawing arcs yet, so this can't be done and nothing was made. What can be done now is making or resizing a whole ready-made shape (a box, cylinder, sphere, plate, L bracket, slot or star), or starting a sketch on a plane, drawing circles, rectangles and lines in it, extruding it, and renaming an item.", []],
  // The second of three sketches is Sketch 2, named in the command by its current name.
  24: [[{"op": "create_sketch", "on": "XY"}, {"op": "create_sketch", "on": "XY"}, {"op": "create_sketch", "on": "XY"}], "Can you rename the second sketch \"hinge\"?", "The second sketch is Sketch 2. Only the name changes, so rename Sketch 2 to hinge; nothing is built or removed.", [{"op": "rename_item", "item": "Sketch 2", "name": "hinge"}]],
  // The only sketch is Sketch 1.
  26: [[{"op": "create_sketch", "on": "XZ"}], "Rename the sketch to \"top view\".", "The sketch is Sketch 1. Only the name changes, so rename Sketch 1 to top view; nothing is built or removed.", [{"op": "rename_item", "item": "Sketch 1", "name": "top view"}]],
  // A sketch on XY, then its name: "Lid outline" as written.
  60: [[], "Create a sketch on XY and name it \"Lid outline\".", "So there is a new sketch on the XY plane. Then the sketch just started is named: rename the newest item to Lid outline.", [{"op": "create_sketch", "on": "XY"}, {"op": "rename_item", "name": "Lid outline"}]],
  // The back is the XZ plane; the sketch just started takes the name.
  78: [[], "New sketch on the back plane, called \"hinge\".", "The back plane is the XZ plane. So there is a new sketch on the XZ plane. Then the sketch just started is named: rename the newest item to hinge.", [{"op": "create_sketch", "on": "XZ"}, {"op": "rename_item", "name": "hinge"}]],
  // The latest of three sketches is Sketch 3.
  82: [[{"op": "create_sketch", "on": "XZ"}, {"op": "create_sketch", "on": "YZ"}, {"op": "create_sketch", "on": "XY"}], "Rename the latest sketch to \"bracket\".", "The latest sketch is Sketch 3. Only the name changes, so rename Sketch 3 to bracket; nothing is built or removed.", [{"op": "rename_item", "item": "Sketch 3", "name": "bracket"}]],
};

test("the first ten examples of seed 1, checked by hand", async () => {
  const g = await generate({ seed: 1n, count: 10, specs: DESIGN_COMMANDS, rules: RULES, recipes: RECIPES, kernel: fakeKernel(), heldOut: [] });
  assert.ok(g.ok);
  assert.deepEqual(
    g.examples.map((e) => [e.setup, e.prompt, e.explanation, e.commands]),
    HAND_CHECKED,
  );
});

test("later examples of seed 1 with a whole scale, a smaller size, a centred circle, a radius, a refusal, inches and renames, checked by hand", async () => {
  const g = await generate({ seed: 1n, count: 300, specs: DESIGN_COMMANDS, rules: RULES, recipes: RECIPES, kernel: fakeKernel(), heldOut: [] });
  assert.ok(g.ok);
  for (const [i, want] of Object.entries(LATER)) {
    const e = g.examples[Number(i)];
    assert.deepEqual([e.setup, e.prompt, e.explanation, e.commands], want, `example ${i}`);
  }
});

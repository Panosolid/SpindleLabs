import { test } from "node:test";
import assert from "node:assert/strict";
import { specFor } from "../src/spec.ts";
import { outline } from "../src/profiles.ts";

test("the export describes the same body the viewer shows", () => {
  // Width is a cylinder's or sphere's diameter: 40 wide is radius 20.
  assert.deepEqual(specFor("box", 40, 30, 20), { box: { width: 40, depth: 30, height: 20 } });
  assert.deepEqual(specFor("cylinder", 40, 30, 20), { cylinder: { radius: 20, height: 20 } });
  // A sphere rests on the floor (Ben, 2026-10-28): built round the origin, then lifted by its radius, 20.
  assert.deepEqual(specFor("sphere", 40, 30, 20), { moved: { body: { sphere: { radius: 20 } }, moves: [{ move: [0, 0, 20] }] } });
  // Outlines are extruded by the height.
  assert.deepEqual(specFor("l-bracket", 40, 30, 20), { extrude: { profile: outline("l-bracket", 40, 30), distance: 20 } });
});

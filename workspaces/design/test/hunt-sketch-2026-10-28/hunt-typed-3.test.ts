// Hunt: a typed rectangle width must give corner.x + W to the nearest double of the true sum.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rectangleCorner } from "../../src/typed-entry.ts";

test("corner -3, width 2.1 typed: opposite x is -0.9", () => {
  // -3 + 2.1 = -0.9 by hand; the nearest double to -0.9 is the literal -0.9.
  // The code adds the double 2.1 (2.100000000000000088…) to -3: -0.899999999999999911…, rounds to -0.8999999999999999,
  // so a rectangle typed to meet an existing corner at x = -0.9 gets a stray corner 1 ulp away.
  const c = rectangleCorner([-3, 0.5], [0, 3], { width: 2.1, height: 2.5 })!;
  assert.equal(c[0], -0.9);
});

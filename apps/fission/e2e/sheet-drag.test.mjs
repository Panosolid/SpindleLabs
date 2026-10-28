// When letting go of a dragged phone sheet closes it (src/sheet-drag.ts),
// worked by hand: a release closes past min(120 px, a quarter of the
// sheet's height), or with a flick of 0.5 px/ms or more, never within the
// 6 px slop. The browser side (real touches) is in e2e/phone-sheet.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { closesOnRelease } from "../src/sheet-drag.ts";

test("a short sheet closes past a quarter of its height", () => {
  // 400 px tall: a quarter is 100 px, under 120, so 100 px is the line; 0.9× = 90 stays, 1.1× = 110 closes.
  assert.equal(closesOnRelease(90, 400, 0), false);
  assert.equal(closesOnRelease(110, 400, 0), true);
});

test("a tall sheet closes past 120 px", () => {
  // 800 px tall: a quarter is 200 px, over 120, so 120 px is the line; 0.9× = 108 stays, 1.1× = 132 closes.
  assert.equal(closesOnRelease(108, 800, 0), false);
  assert.equal(closesOnRelease(132, 800, 0), true);
});

test("a flick closes it however short the drag", () => {
  // 10 px down (past the 6 px slop) on a 400 px sheet: only the speed can close it; 0.9 × 0.5 = 0.45 stays, 1.1 × 0.5 = 0.55 closes.
  assert.equal(closesOnRelease(10, 400, 0.45), false);
  assert.equal(closesOnRelease(10, 400, 0.55), true);
});

test("a touch within the slop, or one dragged back up, never closes it", () => {
  assert.equal(closesOnRelease(6, 400, 5), false); // a tap that wobbled, however fast
  assert.equal(closesOnRelease(0, 400, 0), false);
  assert.equal(closesOnRelease(-50, 400, 2), false);
  assert.equal(closesOnRelease(Number.NaN, 400, 2), false);
});

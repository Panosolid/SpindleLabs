import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { BACKDROP_BANDS, BACKDROP_BOTTOM, BACKDROP_TOP, backdropAt, paintBackdrop } from "../src/backdrop.ts";

const near = (a: number[], b: number[]) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

test("the backdrop's colour down the canvas, worked by hand", () => {
  // Top (30, 38, 52) to bottom (14, 16, 22): the ends are the stops themselves.
  assert.ok(near(backdropAt(0), [30, 38, 52]));
  assert.ok(near(backdropAt(1), [14, 16, 22]));
  // Halfway: each channel's mean, ((30 + 14) / 2, (38 + 16) / 2, (52 + 22) / 2) = (22, 27, 37).
  assert.ok(near(backdropAt(0.5), [22, 27, 37]));
  // A fifth of the way down: top + 0.2 × (bottom − top) = (30 − 3.2, 38 − 4.4, 52 − 6) = (26.8, 33.6, 46).
  assert.ok(near(backdropAt(0.2), [26.8, 33.6, 46]));
});

test("the backdrop is a blue, lighter at the top, and never brighter than the old flat grey's top half allows", () => {
  // Blue: the blue channel the largest at every height; lighter at the top than the bottom.
  for (let k = 0; k <= 100; k++) {
    const [r, g, b] = backdropAt(k / 100);
    assert.ok(b > g && g > r, `blue at ${k} %: (${r}, ${g}, ${b})`);
  }
  const sum = (c: number[]) => c[0] + c[1] + c[2];
  assert.ok(sum(BACKDROP_TOP) > sum(BACKDROP_BOTTOM));
  // Dark enough that the lit body (BASE_COLOUR 0x9aa7b8 shaded, every channel above 80) stands out everywhere.
  for (const c of [BACKDROP_TOP, BACKDROP_BOTTOM]) assert.ok(Math.max(...c) < 60, `${c} stays dark`);
});

test("outside the canvas or not a number, the nearer end (never NaN)", () => {
  assert.ok(near(backdropAt(-3), BACKDROP_TOP));
  assert.ok(near(backdropAt(7), BACKDROP_BOTTOM));
  assert.ok(near(backdropAt(Number.NaN), BACKDROP_TOP));
  assert.ok(near(backdropAt(Number.POSITIVE_INFINITY), BACKDROP_BOTTOM));
  assert.ok(near(backdropAt(Number.NEGATIVE_INFINITY), BACKDROP_TOP));
});

/** A stand-in renderer that records what paintBackdrop asks of it (the real one needs WebGL). */
function fakeRenderer(width: number, height: number) {
  const calls: { scissor: [number, number, number, number]; rgb: number[] }[] = [];
  let scissor: [number, number, number, number] = [0, 0, 0, 0];
  let clear = new THREE.Color(0.1, 0.2, 0.3);
  let alpha = 0.5;
  let scissorTest = false;
  const r = {
    getSize: (v: THREE.Vector2) => v.set(width, height),
    getClearColor: (c: THREE.Color) => c.copy(clear),
    getClearAlpha: () => alpha,
    setClearColor: (c: THREE.Color, a: number) => ((clear = c.clone()), (alpha = a)),
    setScissorTest: (on: boolean) => (scissorTest = on),
    setScissor: (x: number, y: number, w: number, h: number) => (scissor = [x, y, w, h]),
    clear: (colour: boolean, depth: boolean, stencil: boolean) => {
      assert.ok(colour && !depth && !stencil, "only the colour is cleared");
      assert.ok(scissorTest, "inside the scissor");
      const rgb = clear.clone().convertLinearToSRGB();
      calls.push({ scissor, rgb: [rgb.r * 255, rgb.g * 255, rgb.b * 255] });
    },
  };
  return { renderer: r as unknown as THREE.WebGLRenderer, calls, state: () => ({ clear, alpha, scissorTest }) };
}

test("paintBackdrop covers the whole canvas in bands, top to bottom, with no gap or overlap, worked by hand", () => {
  const { renderer, calls, state } = fakeRenderer(1280, 678);
  paintBackdrop(renderer);
  assert.equal(calls.length, BACKDROP_BANDS);
  // 678 / 32 = 21.1875 px a band: the first runs from row 0 to round(21.1875) = 21 from the top, so in GL's
  // bottom-up rows it starts at 678 − 21 = 657 and is 21 tall; the last from round(31 × 21.1875) = round(656.8) = 657
  // to 678, so it starts at GL row 0 and is 21 tall.
  assert.deepEqual(calls[0].scissor, [0, 657, 1280, 21]);
  assert.deepEqual(calls[BACKDROP_BANDS - 1].scissor, [0, 0, 1280, 21]);
  let covered = 0;
  for (let i = 0; i < calls.length; i++) {
    const [x, y, w, h] = calls[i].scissor;
    assert.ok(x === 0 && w === 1280 && h > 0);
    if (i > 0) assert.equal(y + h, calls[i - 1].scissor[1], `band ${i} meets the one above`);
    covered += h;
  }
  assert.equal(covered, 678, "every row painted once");
  // The first band's colour is the gradient's at 1/64 of the way down: (30 − 16/64, 38 − 22/64, 52 − 30/64) = (29.75, 37.66, 51.53).
  assert.ok(calls[0].rgb.every((c, i) => Math.abs(c - [29.75, 37.66, 51.53][i]) < 0.01), `${calls[0].rgb}`);
  // Neighbouring bands differ by under one step of 0–255 in every channel, so the bands read as one smooth gradient.
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].rgb.every((c, k) => Math.abs(c - calls[i - 1].rgb[k]) < 1));
  // The renderer is left as it was found.
  const after = state();
  assert.equal(after.scissorTest, false);
  assert.equal(after.alpha, 0.5);
  assert.ok(Math.abs(after.clear.r - 0.1) < 1e-9 && Math.abs(after.clear.g - 0.2) < 1e-9 && Math.abs(after.clear.b - 0.3) < 1e-9);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The clean look's shared values (UX2, theme.css :root): the words on the
// bright blue and on a chosen tool's glow stay readable (WCAG 2's 4.5 : 1
// for text), the corners grow small to large, and a tap target is 44 px.

const css = readFileSync(fileURLToPath(new URL("../src/theme.css", import.meta.url)), "utf8");
const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
const token = (name: string): string => {
  const m = root.match(new RegExp(`--${name}:\\s*([^;]+);`));
  assert.ok(m, `--${name} is defined on :root`);
  return m[1].trim();
};

type Rgba = [number, number, number, number];
/** "#rrggbb", "rgb(r, g, b)" or "rgba(r, g, b, a)" as [r, g, b, a]. */
const colour = (text: string): Rgba => {
  const hex = text.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const [r, g, b, a = 1] = (text.match(/[\d.]+/g) ?? []).map(Number);
  return [r, g, b, a];
};
/** Every colour in a value, in order (a gradient's stops). */
const colours = (text: string): Rgba[] => (text.match(/#[0-9a-f]{6}|rgba?\([^)]*\)/gi) ?? []).map(colour);
const over = ([r, g, b, a]: Rgba, [R, G, B]: Rgba): Rgba => [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];
const linear = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgba) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const READABLE = 4.5;

test("the dark words on the bright blue button, worked by hand", () => {
  const words = colour(token("look-on-accent"));
  const [top, bottom] = colours(token("look-primary-fill"));
  // #07111c: linear (0.0021, 0.0056, 0.0116), luminance 0.2126 × 0.0021 + 0.7152 × 0.0056 + 0.0722 × 0.0116 = 0.0053.
  // The gradient's top #62b6ff: linear (0.1221, 0.4678, 1.0), luminance 0.0260 + 0.3346 + 0.0722 = 0.4327;
  // (0.4327 + 0.05) / (0.0053 + 0.05) = 8.73.
  assert.ok(Math.abs(contrast(words, top) - 8.73) < 0.01, `top ${contrast(words, top)}`);
  // Its bottom #3d98f2: linear (0.0467, 0.3140, 0.8879), luminance 0.0099 + 0.2246 + 0.0641 = 0.2986;
  // (0.2986 + 0.05) / (0.0053 + 0.05) = 6.30.
  assert.ok(Math.abs(contrast(words, bottom) - 6.3) < 0.01, `bottom ${contrast(words, bottom)}`);
  for (const stop of [top, bottom]) assert.ok(contrast(words, stop) >= READABLE);
});

test("a chosen tool's words on its glow over a card stay readable", () => {
  const on = over(colour(token("look-active-fill")), over(colour(token("look-float")), [0, 0, 0, 1]));
  // rgba(74, 168, 255, 0.16) over the card (21, 27, 38) (its 0.96 over black first):
  // about (29.5, 49.6, 72.7); the words #8cc8ff have luminance 0.541; about 7.4 : 1.
  const c = contrast(colour(token("look-accent-text")), on);
  assert.ok(c >= READABLE && Math.abs(c - 7.4) < 0.1, `chosen tool ${c}`);
});

test("the check fails on white words on the bright blue", () => {
  // White (luminance 1) on #62b6ff (0.4327): 1.05 / 0.4827 = 2.18, under 4.5.
  const c = contrast([255, 255, 255, 1], colours(token("look-primary-fill"))[0]);
  assert.ok(Math.abs(c - 2.18) < 0.01);
  assert.ok(c < READABLE);
});

test("corners grow small to large, and a tap target is Apple's 44", () => {
  const px = (name: string) => parseFloat(token(name));
  assert.ok(px("look-radius-s") < px("look-radius-m") && px("look-radius-m") < px("look-radius-l") && px("look-radius-l") < px("look-radius-pill"));
  assert.equal(px("look-target-touch"), 44);
  assert.ok(px("look-target") >= 24, "a mouse target at least WCAG 2.2's 24 px");
  for (const k of [1, 2, 3, 4]) assert.equal(px(`look-space-${k}`), 4 * k, "spacing on a 4 px grid");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { ICONS, ICON_GRID, ICON_LINE, ICON_MARGIN, ICON_NAMES, ICON_TONE, iconSvg, type IconPart } from "../src/icons.ts";

type Box = [number, number, number, number];

/**
 * The box round a path's marks, read back from its commands on their own
 * (not from a renderer): absolute M L H V A C S Z only, anything else throws.
 * An arc is converted to its centre (SVG 1.1 F.6.5) and walked in 256 steps;
 * a C or S curve is walked as its cubic, also in 256 steps.
 */
function pathBounds(d: string): Box {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let i = 0;
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || /[A-Za-z]/.test(t)) throw new Error(`a number expected in "${d}"`);
    return Number(t);
  };
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (x: number, y: number) => {
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], y);
  };
  let [x, y] = [0, 0];
  let [sx, sy] = [0, 0];
  let lastControl: [number, number] | null = null;
  let cmd = "";
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    if (!"MLHVACSZ".includes(cmd)) throw new Error(`command "${cmd}" in "${d}": absolute M L H V A C S Z only`);
    const control = lastControl;
    lastControl = null;
    if (cmd === "M") {
      [x, y] = [num(), num()];
      [sx, sy] = [x, y];
      add(x, y);
      cmd = "L"; // numbers after an M are lines
    } else if (cmd === "L") {
      [x, y] = [num(), num()];
      add(x, y);
    } else if (cmd === "H") {
      x = num();
      add(x, y);
    } else if (cmd === "V") {
      y = num();
      add(x, y);
    } else if (cmd === "Z") {
      [x, y] = [sx, sy];
    } else if (cmd === "C" || cmd === "S") {
      // An S's first control mirrors the last curve's second one through the start, or is the start after anything else.
      const [c1x, c1y] = cmd === "C" ? [num(), num()] : control ? [2 * x - control[0], 2 * y - control[1]] : [x, y];
      const [c2x, c2y, ex, ey] = [num(), num(), num(), num()];
      for (let k = 1; k <= 256; k++) {
        const t = k / 256;
        const u = 1 - t;
        add(u ** 3 * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * ex, u ** 3 * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * ey);
      }
      lastControl = [c2x, c2y];
      [x, y] = [ex, ey];
    } else {
      let [rx, ry] = [Math.abs(num()), Math.abs(num())];
      const phi = (num() * Math.PI) / 180;
      const [large, sweep, ex, ey] = [num(), num(), num(), num()];
      const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
      const [dx, dy] = [(x - ex) / 2, (y - ey) / 2];
      const [x1, y1] = [cos * dx + sin * dy, -sin * dx + cos * dy];
      const grow = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
      if (grow > 1) [rx, ry] = [rx * Math.sqrt(grow), ry * Math.sqrt(grow)];
      const num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
      const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
      const [cx1, cy1] = [(k * rx * y1) / ry, (-k * ry * x1) / rx];
      const [cx, cy] = [cos * cx1 - sin * cy1 + (x + ex) / 2, sin * cx1 + cos * cy1 + (y + ey) / 2];
      const angle = (ux: number, uy: number) => Math.atan2(uy, ux);
      const t1 = angle((x1 - cx1) / rx, (y1 - cy1) / ry);
      let dt = angle((-x1 - cx1) / rx, (-y1 - cy1) / ry) - t1;
      if (sweep === 0 && dt > 0) dt -= 2 * Math.PI;
      if (sweep === 1 && dt < 0) dt += 2 * Math.PI;
      for (let s = 0; s <= 256; s++) {
        const t = t1 + (dt * s) / 256;
        add(cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx, sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy);
      }
      [x, y] = [ex, ey];
    }
  }
  return box;
}

/** The box round every mark of an icon: its lines' centres and its tones' edges (a line's half width overhangs it). */
function iconBounds(parts: readonly IconPart[]): Box {
  const all = parts.map((p) => pathBounds(p.d));
  return [Math.min(...all.map((b) => b[0])), Math.min(...all.map((b) => b[1])), Math.max(...all.map((b) => b[2])), Math.max(...all.map((b) => b[3]))];
}

/** Whether a box is inside the grid less the margin on every side, from 2 to 22 (a line there overhangs to 1.125 and 22.875, still in). */
const onGrid = ([a, b, c, e]: Box) => a >= ICON_MARGIN - 1e-9 && b >= ICON_MARGIN - 1e-9 && c <= ICON_GRID - ICON_MARGIN + 1e-9 && e <= ICON_GRID - ICON_MARGIN + 1e-9;

const near = (a: Box, b: Box, tol = 1e-3) => a.every((v, k) => Math.abs(v - b[k]) <= tol);

test("hand-worked bounds: the circle, the 3-point arc and the S of the eye", () => {
  // The circle icon's ring: two half arcs of radius 8 round (12, 12), from (4, 12) to (20, 12) and back: x and y from 12 − 8 = 4 to 12 + 8 = 20.
  assert.ok(near(pathBounds("M4 12A8 8 0 1 1 20 12A8 8 0 1 1 4 12Z"), [4, 4, 20, 20]));
  // The 3-point arc: an ellipse 8 wide and 13 tall from (4, 18) to (20, 18). The chord is 16 = 2 · 8 long, so it is half the ellipse,
  // centre (12, 18), and the sweep flag 1 takes it over the top: y from 18 − 13 = 5 to 18.
  assert.ok(near(pathBounds("M4 18A8 13 0 0 1 20 18"), [4, 5, 20, 18]));
  // Sweep 0 takes the same half under instead: y from 18 to 18 + 13 = 31.
  assert.ok(near(pathBounds("M4 18A8 13 0 0 0 20 18"), [4, 18, 20, 31]));
  // The eye's top lid starts as an S curve after an M: an S after anything but a curve mirrors nothing, so its first
  // control is its own start. From (2.5, 12) to (12, 5) with second control (8.25, 5): the curve's lowest y is the end's 5 (the
  // controls never go above it), so the box is x 2.5 to 12, y 5 to 12.
  assert.ok(near(pathBounds("M2.5 12S8.25 5 12 5"), [2.5, 5, 12, 12]));
  // The eye's outline: C(5, 7)(8.25, 5) to (12, 5), then S mirrors (8.25, 5) through (12, 5) to (15.75, 5) and ends at (21.5, 12).
  // The top is y = 5, where both curves meet with level tangents (their controls there are level with it), so the upper lid spans
  // x 2.5 to 21.5 and y 5 to 12; the lower lid is the same turned over, y 12 to 19.
  assert.ok(near(pathBounds("M2.5 12C5 7 8.25 5 12 5S19 7 21.5 12C19 17 15.75 19 12 19S5 17 2.5 12Z"), [2.5, 5, 21.5, 19]));
});

test("every icon parses, stays on the 24 grid 2 in from its edge, and has a line part", () => {
  assert.ok(ICON_NAMES.length >= 30, `${ICON_NAMES.length} icons`);
  for (const name of ICON_NAMES) {
    const parts = ICONS[name];
    const box = iconBounds(parts);
    assert.ok(onGrid(box), `${name} reaches ${box.map((v) => v.toFixed(2)).join(", ")}`);
    assert.ok(parts.some((p) => !p.tone), `${name} has a line part`);
    for (const p of parts) assert.doesNotMatch(p.d, /#|rgb|hsl|url/i, `${name}: no colour or reference in its path`);
  }
});

test("the checks can fail: a mark at 23, a relative command, a curve the reader doesn't know", () => {
  // A line to (23, 12) is past 22.
  assert.equal(onGrid(iconBounds([{ d: "M4 12H23" }])), false);
  // At 22, the limit, it is in; 0.1 past it, out.
  assert.equal(onGrid(iconBounds([{ d: "M4 12H22" }])), true);
  assert.equal(onGrid(iconBounds([{ d: "M4 12H22.1" }])), false);
  // An arc that bulges out though both its ends are in: an ellipse 9 wide and 11 tall from (3, 12) to (21, 12) is half the ellipse
  // (the chord is 18 = 2 · 9), centre (12, 12), and over the top it reaches y = 12 − 11 = 1, past 2.
  assert.equal(onGrid(iconBounds([{ d: "M3 12A9 11 0 0 1 21 12" }])), false);
  assert.throws(() => pathBounds("M4 4l4 4"), /absolute M L H V A C S Z only/);
  assert.throws(() => pathBounds("M4 4Q5 5 7 7"), /absolute M L H V A C S Z only/);
  assert.throws(() => pathBounds("M4 4L"), /a number expected/);
});

test("iconSvg: a 24 grid at the asked size, hidden from screen readers, lines in the text colour and the tone a third as strong", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const svg = iconSvg(doc, "circle", 16);
  assert.equal(svg.getAttribute("viewBox"), "0 0 24 24");
  assert.equal(svg.getAttribute("width"), "16");
  assert.equal(svg.getAttribute("aria-hidden"), "true");
  assert.equal(svg.getAttribute("focusable"), "false");
  assert.equal(svg.getAttribute("class"), "icon");
  assert.equal(svg.dataset.icon, "circle");
  const [fill, ring] = [...svg.querySelectorAll("path")];
  // The tone: filled with the text colour at 0.35, no line.
  assert.deepEqual([fill.getAttribute("fill"), fill.getAttribute("fill-opacity"), fill.getAttribute("stroke")], ["currentColor", String(ICON_TONE), "none"]);
  // The line: 1.75 wide, round ends, no fill.
  assert.deepEqual([ring.getAttribute("fill"), ring.getAttribute("stroke"), ring.getAttribute("stroke-width"), ring.getAttribute("stroke-linecap")], ["none", "currentColor", String(ICON_LINE), "round"]);
  assert.equal(iconSvg(doc, "box").getAttribute("width"), "20", "20 px unless asked");
  // Only currentColor anywhere in the markup: an icon has no colour of its own.
  for (const name of ICON_NAMES) {
    const markup = iconSvg(doc, name).outerHTML;
    assert.deepEqual([...new Set(markup.match(/(?:fill|stroke)="([^"]+)"/g) ?? [])].filter((a) => !/="(currentColor|none)"/.test(a)), [], name);
  }
});

test("no two icons are the same drawing", () => {
  const seen = new Map<string, string>();
  for (const name of ICON_NAMES) {
    const key = JSON.stringify(ICONS[name]);
    assert.equal(seen.get(key), undefined, `${name} draws the same as ${seen.get(key)}`);
    seen.set(key, name);
  }
});

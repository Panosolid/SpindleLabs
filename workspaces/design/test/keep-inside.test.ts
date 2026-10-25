// The typed-size boxes and the pointer hint keep inside the view (hunt 3f,
// e2e/regressions/monkey-typed-box-edge.json): drawing near the view's right
// edge, the boxes stuck 4 px out past the window and the page scrolled
// sideways. happy-dom lays nothing out, so each element's drawn box is
// given here the way Chromium measured it: the boxes are 186 px wide and
// drawn 18 px right of and 14 px below the point they are placed at (their
// CSS transform), the hint 18 px right and 30 px up.
import { test } from "node:test";
import assert from "node:assert/strict";
import { typedBoxes } from "../src/typed-boxes.ts";
import { keepInside, pointerHint } from "../src/pointer-hint.ts";

const { Window } = await import("happy-dom");

interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number; x: number; y: number }
const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top });

/** A host at (hx, hy) of size w × h; `drawn` gives the element's box from its style's left/top (in host pixels). */
function setup(hx: number, hy: number, w: number, h: number) {
  const window = new Window();
  const document = window.document as unknown as Document;
  (globalThis as { document?: Document }).document = document;
  const host = document.createElement("div");
  document.body.append(host);
  host.getBoundingClientRect = () => rect(hx, hy, w, h) as DOMRect;
  const draw = (el: HTMLElement, dx: number, dy: number, ew: number, eh: number) => {
    el.getBoundingClientRect = () => rect(hx + parseFloat(el.style.left) + dx, hy + parseFloat(el.style.top) + dy, ew, eh) as DOMRect;
  };
  return { host, draw };
}

test("the typed boxes by the right edge come back inside: the monkey's 4 px worked by hand", () => {
  // The view 1280 px wide at the window's left. The pointer at x 1183 is
  // clamped by the caller to 1280 - 200 = 1080; drawn 18 px further right
  // and 186 px wide, the boxes end at 1080 + 18 + 186 = 1284, 4 px past the
  // view. Moved back 4 px: left 1076, right edge exactly 1280.
  const { host, draw } = setup(0, 0, 1280, 720);
  const boxes = typedBoxes(host, { locks: () => {}, enter: () => {}, escape: () => {} });
  draw(boxes.element, 18, 14, 186, 52);
  boxes.show(["length", "angle"], {}, 1080, 300);
  assert.equal(boxes.element.style.left, "1076px");
  assert.equal(boxes.element.style.top, "300px", "nothing below the view: top unchanged");
  assert.equal(boxes.element.getBoundingClientRect().right, 1280);
});

test("the typed boxes by the bottom edge come back up inside the view", () => {
  // The view 720 px high from y 40 (under a top bar). The pointer at 700 in
  // the view: drawn 14 px lower and 52 px high, the boxes end at
  // 40 + 700 + 14 + 52 = 806, 46 px past the view's bottom (40 + 720 = 760).
  // Moved up 46: top 654, drawn bottom exactly 760.
  const { host, draw } = setup(0, 40, 1280, 720);
  const boxes = typedBoxes(host, { locks: () => {}, enter: () => {}, escape: () => {} });
  draw(boxes.element, 18, 14, 186, 52);
  boxes.show(["length", "angle"], {}, 500, 700);
  assert.equal(boxes.element.style.top, "654px");
  assert.equal(boxes.element.style.left, "500px");
  assert.equal(boxes.element.getBoundingClientRect().bottom, 760);
});

test("inside already: left alone, including exactly touching the edges", () => {
  const { host, draw } = setup(0, 0, 1280, 720);
  const boxes = typedBoxes(host, { locks: () => {}, enter: () => {}, escape: () => {} });
  draw(boxes.element, 18, 14, 186, 52);
  // Right edge 1076 + 18 + 186 = 1280 and bottom 654 + 14 + 52 = 720: on the edges, not past.
  boxes.show(["length"], {}, 1076, 654);
  assert.equal(boxes.element.style.left, "1076px");
  assert.equal(boxes.element.style.top, "654px");
});

test("phone width: boxes centred on a pointer at the left edge come back right", () => {
  // At 375 px the boxes are drawn centred under the point (translate -50%):
  // at x 20 and 186 px wide they start at 20 - 93 = -73. Moved right 73: left 93.
  const { host, draw } = setup(0, 0, 375, 600);
  const boxes = typedBoxes(host, { locks: () => {}, enter: () => {}, escape: () => {} });
  draw(boxes.element, -93, 28, 186, 52);
  boxes.show(["length"], {}, 20, 100);
  assert.equal(boxes.element.style.left, "93px");
  assert.equal(boxes.element.getBoundingClientRect().left, 0);
});

test("fractional overflow rounds outwards, so the box never ends up a part pixel past", () => {
  // Drawn right edge 1280.4: 0.4 px out. Moving 0 (rounding to nearest) would leave it out;
  // it moves a whole 1 px: left 1079, drawn right 1279.4.
  const { host, draw } = setup(0, 0, 1280, 720);
  const boxes = typedBoxes(host, { locks: () => {}, enter: () => {}, escape: () => {} });
  draw(boxes.element, 18.4, 14, 182, 52);
  boxes.show(["length"], {}, 1080, 100);
  assert.equal(boxes.element.style.left, "1079px");
  assert.ok(boxes.element.getBoundingClientRect().right <= 1280);
});

test("an element wider than the view keeps its left edge in (the start of the text shows)", () => {
  const { host, draw } = setup(0, 0, 300, 600);
  const el = host.ownerDocument.createElement("div");
  host.append(el);
  el.style.left = "250px";
  el.style.top = "10px";
  draw(el, 18, 0, 400, 20);
  keepInside(el, host);
  assert.equal(el.style.left, "-18px", "drawn from 0, its right end past the view");
  assert.equal(el.getBoundingClientRect().left, 0);
});

test("the pointer hint by the right edge comes back inside too", () => {
  // A long hint, 260 px, at 1080 drawn from 1098: ends at 1358, 78 px past. Moved back: left 1002.
  const { host, draw } = setup(0, 0, 1280, 720);
  const hint = pointerHint(host);
  draw(hint.element, 18, -30, 260, 20);
  hint.show("Click the line's end, or type its length and angle", 1080, 200);
  assert.equal(hint.element.style.left, "1002px");
  assert.equal(hint.element.getBoundingClientRect().right, 1280);
  // At the top: drawn 30 px above y 10, so from -20; moved down 20.
  hint.show("Click the line's end, or type its length and angle", 400, 10);
  assert.equal(hint.element.style.top, "30px");
  assert.equal(hint.element.style.left, "400px");
});

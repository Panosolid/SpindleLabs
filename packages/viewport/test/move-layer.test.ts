// The Move tool's handles as drawn (move-layer.ts, restyled 2026-10-28):
// slim and small (each piece's size on screen worked by hand from the
// geometry), never wider than a finger's press area so the thin line costs
// no grip, a faint shadow rather than a black outline, the lit handle in
// its own colour moved towards white (worked by hand) with its glow shown
// and every other glow hidden, and the axis colours apart from each other
// and from the selection's blue, so they read on a picked body.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { MoveHandle } from "@fission/core";
import { HOT_MIX, MOVE_COLOURS, MOVE_STYLE, MoveLayer, handleColour } from "../src/move-layer.ts";
import { MOVE_HANDLES, MOVE_PX } from "../src/move-handles.ts";
import { ARROW_GRAB_PX } from "../src/extrude-pick.ts";
import { BASE_COLOUR, SELECTED_MIX, SELECTION_COLOUR, tint } from "../src/highlight.ts";

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((x, i) => x - b[i]));

/** A handle's three layers (shadow, glow, the handle) in the order built. */
function layers(layer: MoveLayer, handle: MoveHandle) {
  const part = layer.group.children.find((c) => c.userData.handle === handle)!;
  const [shadow, glow, drawn] = part.children as THREE.Group[];
  return { shadow, glow, drawn };
}
/** The handle's box on screen axes (CSS px: the group is built 1 unit to the pixel). */
const sizeOf = (o: THREE.Object3D) => {
  o.parent?.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
};

test("the lit handle is its axis colour moved 40% towards white, worked by hand", () => {
  // X 0xe8766f = (232, 118, 111); towards white by 0.4: 232 + 23·0.4 = 241.2, 118 + 137·0.4 = 172.8, 111 + 144·0.4 = 168.6.
  const [r, g, b] = handleColour("x", true).map((c) => c * 255);
  assert.ok(near(r, 241.2, 1e-9) && near(g, 172.8, 1e-9) && near(b, 168.6, 1e-9), `${r}, ${g}, ${b}`);
  assert.equal(HOT_MIX, 0.4);
  // Unlit it is the axis colour itself; a ring shares its axis's colour.
  assert.deepEqual(handleColour("turnX", false).map((c) => Math.round(c * 255)), [232, 118, 111]);
});

test("the arrows are slim with small heads, ending where the hit test says, worked by hand", () => {
  const layer = new MoveLayer();
  // Z arrow along +Z: its width is the head's diameter 2·4.5 = 9 px; its reach from the shaft's start (58) to
  // the head's tip (110), 52 px. The cone's base polygon has 20 sides, so its width is 9·cos(0) to 9·cos(9°).
  const z = sizeOf(layers(layer, "z").drawn);
  assert.ok(z.x <= 9 + 1e-9 && z.x >= 9 * Math.cos(Math.PI / 20) - 1e-9, `width ${z.x}`);
  assert.ok(near(z.z, MOVE_PX.arrowTo - MOVE_PX.arrowFrom, 1e-9), `length ${z.z}`);
  const box = new THREE.Box3().setFromObject(layers(layer, "z").drawn);
  assert.ok(near(box.max.z, 110, 1e-9) && near(box.min.z, 58, 1e-9));
  // A ring is the 45 px circle with a 1.5 px line: 2·45 + 1.5 = 91.5 px across, 1.5 px thick (turnZ lies in XY).
  const ring = sizeOf(layers(layer, "turnZ").drawn);
  assert.ok(near(ring.x, 91.5, 1e-6) && near(ring.z, 1.5, 1e-6), `${ring.x} × ${ring.z}`);
});

test("drawn thinner than before, but no handle is wider than a finger's or a mouse's press area", () => {
  // The press area reaches ARROW_GRAB_PX each side of the line (10 mouse, 22 touch), so 20 and 44 px wide;
  // the drawn head is 9 px wide and the shaft 1.5 px, so the press area is always the larger.
  assert.ok(2 * MOVE_STYLE.head.radius < 2 * ARROW_GRAB_PX.mouse && 2 * ARROW_GRAB_PX.mouse < 2 * ARROW_GRAB_PX.touch);
  assert.ok(MOVE_STYLE.shaft <= 2 && MOVE_STYLE.ring <= 2, "lines are slim");
  assert.ok(MOVE_STYLE.head.radius <= 5 && MOVE_STYLE.head.length <= 12, "heads are small");
});

test("a faint shadow, not a black outline: at most 1 px each side and mostly see-through", () => {
  const layer = new MoveLayer();
  const m = (layers(layer, "y").shadow.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
  assert.ok(m.opacity <= 0.4 && m.transparent, `shadow opacity ${m.opacity}`);
  // 1 px each side: the shadowed Y head is 9 + 2 = 11 px across against the head's 9.
  const [shadowed, drawn] = [sizeOf(layers(layer, "y").shadow), sizeOf(layers(layer, "y").drawn)];
  assert.ok(near(shadowed.x - drawn.x, 2 * MOVE_STYLE.shadow.px, 1e-6) && MOVE_STYLE.shadow.px <= 1, `${shadowed.x} vs ${drawn.x}`);
});

test("only the lit handle glows and brightens; clearing it puts every handle back", () => {
  const layer = new MoveLayer();
  const glowing = () => MOVE_HANDLES.filter((h) => layers(layer, h).glow.visible);
  const colour = (h: MoveHandle) => {
    // Read back in sRGB: Three's own round trip is good to about 1e-5, a ten-thousandth of a level of 255.
    const c = ((layers(layer, h).drawn.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    return [c.r, c.g, c.b];
  };
  assert.deepEqual(glowing(), []);
  for (const h of MOVE_HANDLES) {
    assert.equal(layer.setHot(h), true);
    assert.deepEqual(glowing(), [h]);
    for (const other of MOVE_HANDLES) assert.ok(distance(colour(other), handleColour(other, other === h)) < 1e-4, `${other} while ${h} is lit`);
    assert.equal(layer.setHot(h), false, "the same handle again changes nothing");
  }
  layer.setHot(null);
  assert.deepEqual(glowing(), []);
  for (const h of MOVE_HANDLES) assert.ok(distance(colour(h), handleColour(h, false)) < 1e-4);
});

test("the axis colours stand apart from each other and from a picked body's blue", () => {
  const axes = MOVE_COLOURS.axes.map((hex) => [hex >> 16, (hex >> 8) & 255, hex & 255].map((c) => c / 255));
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(distance(axes[i], axes[j]) > 0.4, `axes ${i} and ${j}`);
  // The picked body: BASE (154, 167, 184) 60% of the way to the selection (74, 168, 255) = (106, 167.6, 226.6).
  const picked = tint(BASE_COLOUR, SELECTION_COLOUR, SELECTED_MIX);
  assert.ok(near(picked[0] * 255, 106, 1e-9) && near(picked[2] * 255, 226.6, 1e-9));
  // Z, the nearest, (79, 109, 255): √(27² + 58.6² + 28.4²)/255 ≈ 0.278 from it; the selection blue itself 0.25.
  for (const [i, c] of axes.entries()) assert.ok(distance(c, picked) > 0.25 && distance(c, SELECTION_COLOUR) > 0.2, `axis ${i} too near the selection`);
  assert.ok(near(distance(axes[2], picked), 0.278, 0.002), `${distance(axes[2], picked)}`);
});

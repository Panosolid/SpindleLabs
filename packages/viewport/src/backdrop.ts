// The 3D view's backdrop (UX2, the owner's ask 2026-10-28: the view looked
// blank): a soft near-black blue gradient, lighter at the top as Fusion's
// sky is, instead of one flat grey. Painted onto each view's canvas before
// its scene, so it fills the canvas top to bottom whatever the camera does.
import * as THREE from "three";
import type { Rgb } from "./highlight.ts";

/** The colour at the canvas's top row, and at its bottom row (0–255 sRGB). */
export const BACKDROP_TOP: Rgb = [30, 38, 52];
export const BACKDROP_BOTTOM: Rgb = [14, 16, 22];

/**
 * The backdrop's colour a fraction `fy` of the way down the canvas (0 the
 * top row, 1 the bottom; outside that, the nearer end; NaN the top), straight-line
 * between the two ends in sRGB as a canvas gradient blends them.
 */
export function backdropAt(fy: number): Rgb {
  const f = Number.isNaN(fy) ? 0 : Math.min(1, Math.max(0, fy));
  const mix = (i: number) => BACKDROP_TOP[i] + (BACKDROP_BOTTOM[i] - BACKDROP_TOP[i]) * f;
  return [mix(0), mix(1), mix(2)];
}

/** How many bands of flat colour `paintBackdrop` draws: the gradient spans at most 30 steps of 0–255 (blue, 52 to 22), so neighbouring bands differ by under one step and read as smooth. */
export const BACKDROP_BANDS = 32;

const colour = new THREE.Color();

/**
 * Paints the backdrop over the whole of the renderer's canvas, before the
 * scene is drawn on it (the renderer must not clear colour itself:
 * `autoClearColor` off). Bands of flat colour, each the gradient's colour
 * at its middle, cleared with the scissor: a clear is all but free, where
 * a textured background is one more full-screen draw every frame, which
 * slowed workspace switching by half in the software renderer the browser
 * checks use (median 48 to 70 ms, e2e/switching.mjs).
 */
export function paintBackdrop(renderer: THREE.WebGLRenderer): void {
  const size = renderer.getSize(new THREE.Vector2());
  const before = renderer.getClearColor(new THREE.Color());
  const alpha = renderer.getClearAlpha();
  renderer.setScissorTest(true);
  for (let i = 0; i < BACKDROP_BANDS; i++) {
    // Band i runs from i/N to (i + 1)/N of the way down; GL counts y up from the bottom.
    const top = Math.round((size.y * i) / BACKDROP_BANDS);
    const bottom = Math.round((size.y * (i + 1)) / BACKDROP_BANDS);
    const [r, g, b] = backdropAt((i + 0.5) / BACKDROP_BANDS);
    renderer.setClearColor(colour.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace), 1);
    renderer.setScissor(0, size.y - bottom, size.x, bottom - top);
    renderer.clear(true, false, false);
  }
  renderer.setScissorTest(false);
  renderer.setClearColor(before, alpha);
}

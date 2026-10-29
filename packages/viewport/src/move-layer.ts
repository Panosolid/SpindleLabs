// What the Move and Rotate tools draw in the view (35e2c; two tools since
// Ben's ask, 2026-10-29): Move's three arrows along X, Y and Z, or
// Rotate's three grips, each a dot on a short arc of the circle about one
// axis, at the point the pivot ends up, the same size on screen at any
// zoom and drawn over everything (they are handles, never hidden by the
// bodies they move). In the app's look (Ben, 2026-10-28: the first, thick
// black-edged handles looked like a cartoon): thin flat lines, small heads
// and dots in muted axis colours, a faint shadow so they read on a light
// body, and the one under the pointer or held lit up with a soft glow in
// its own colour. The press area is wider than the line (MOVE_GRAB_PX,
// room for a finger). Where each sits each frame is move-handles.ts
// placeHandles; viewer.ts sizes and places it per view and drags it.

import * as THREE from "three";
import type { MoveHandle, MoveHandlesShow } from "@fission/core";
import { handleAxis, isRing, MOVE_HANDLES, MOVE_PX, quarterAngle, ringBasis, type Placed } from "./move-handles.ts";

type Rgb = [number, number, number];

/**
 * Each axis's colour, muted to sit on the dark-blue view (sRGB): X coral,
 * Y mint, Z a deep blue, darker and more violet than the selection's sky
 * blue so the Z handles still show on a picked body.
 */
export const MOVE_COLOURS = { axes: [0xe8766f, 0x5fc98a, 0x4f6dff] as const, centre: 0xe6e9ee };

/** How far the handle under the pointer or held moves towards white, so it lights in its own colour. */
export const HOT_MIX = 0.4;

/** The drawn sizes (CSS px): shaft and arc widths, the arrow heads, a grip's dot, the pivot dot, and the shadow and glow round each handle (px each side). */
export const MOVE_STYLE = {
  shaft: 1.5,
  ring: 2,
  head: { radius: 4.5, length: 12 },
  grip: 5,
  dot: 2.5,
  shadow: { px: 1, opacity: 0.35, colour: 0x05080f },
  /** Two see-through layers, the outer fainter, so the light fades out rather than ending in an edge. */
  glow: [{ px: 2, opacity: 0.25 }, { px: 5, opacity: 0.1 }],
  /** The grips' arcs are a little see-through when not lit, so their dots lead. */
  ringOpacity: 0.85,
};

const HANDLE_ORDER = 11; // over Extrude's arrow's 10 too

const rgb = (hex: number): Rgb => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/** A handle's colour (sRGB 0–1): its axis's, or moved HOT_MIX of the way to white when under the pointer or held. */
export function handleColour(handle: MoveHandle, hot: boolean): Rgb {
  const c = rgb(MOVE_COLOURS.axes[handleAxis(handle)]);
  return hot ? (c.map((x) => x + (1 - x) * HOT_MIX) as Rgb) : c;
}

/**
 * One handle's pieces: the shape drawn at `grow` px wider each side (0 the
 * handle itself, the shadow and the glow wider). A grip is built on its
 * circle's plane with the arc's middle on u (ringBasis); `place` turns it
 * round to its quarter each frame.
 */
function handleShape(handle: MoveHandle, grow: number, material: THREE.Material): THREE.Group {
  const axis = handleAxis(handle);
  const part = new THREE.Group();
  if (isRing(handle)) {
    // A torus's arc runs from +X towards +Y: started half the arc before +X, so its middle is on +X, with the dot there.
    const half = (MOVE_PX.arc * Math.PI) / 180;
    const arc = new THREE.Mesh(new THREE.TorusGeometry(MOVE_PX.ring, MOVE_STYLE.ring / 2 + grow, 8, 24, 2 * half), material);
    arc.rotation.z = -half;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(MOVE_STYLE.grip + grow, 16, 12), material);
    dot.position.x = MOVE_PX.ring;
    const spin = new THREE.Group();
    spin.name = "spin";
    spin.add(arc, dot);
    // The circle's plane: X onto u, Y onto v, Z onto the axis (u × v is the axis, so this is a turn, not a mirror).
    const [u, v] = ringBasis(axis);
    const n = [0, 1, 2].map((k) => (k === axis ? 1 : 0));
    part.matrixAutoUpdate = false;
    part.matrix.makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n));
    part.add(spin);
    return part;
  }
  // An arrow along +Y (Three's cylinders and cones are): its shaft, then its head ending at MOVE_PX.arrowTo.
  const { radius, length } = MOVE_STYLE.head;
  const shaftLength = MOVE_PX.arrowTo - length - MOVE_PX.arrowFrom;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(MOVE_STYLE.shaft / 2 + grow, MOVE_STYLE.shaft / 2 + grow, shaftLength + 2 * grow, 10), material);
  shaft.position.y = MOVE_PX.arrowFrom + shaftLength / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(radius + grow, length + 2 * grow, 20), material);
  head.position.y = MOVE_PX.arrowTo - length / 2;
  part.add(shaft, head);
  part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0));
  return part;
}

const overAll = (m: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false, transparent: true, ...m });

export class MoveLayer {
  readonly group = new THREE.Group();
  private shown: MoveHandlesShow | null = null;
  private hot: MoveHandle | null = null;
  private materials = new Map<MoveHandle, THREE.MeshBasicMaterial>();
  private glows = new Map<MoveHandle, THREE.Group>();

  constructor() {
    // Built 1 unit to the pixel; placeAt scales the group to the view's mm per pixel.
    const { shadow, glow } = MOVE_STYLE;
    const shadowMaterial = overAll({ color: shadow.colour, opacity: shadow.opacity });
    for (const handle of MOVE_HANDLES) {
      const ring = isRing(handle);
      const material = overAll({ color: new THREE.Color().setRGB(...handleColour(handle, false), THREE.SRGBColorSpace), opacity: ring ? MOVE_STYLE.ringOpacity : 1 });
      this.materials.set(handle, material);
      const halo = new THREE.Group();
      for (const g of glow) halo.add(handleShape(handle, g.px, overAll({ color: MOVE_COLOURS.axes[handleAxis(handle)], opacity: g.opacity, blending: THREE.AdditiveBlending })));
      halo.visible = false;
      this.glows.set(handle, halo);
      // Shadows first, then the glow, then the handles: drawn over everything, a shadow never over a handle.
      const under = handleShape(handle, shadow.px, shadowMaterial);
      const drawn = handleShape(handle, 0, material);
      under.traverse((m) => (m.renderOrder = HANDLE_ORDER));
      halo.traverse((m) => (m.renderOrder = HANDLE_ORDER + 1));
      drawn.traverse((m) => (m.renderOrder = HANDLE_ORDER + 2));
      const part = new THREE.Group();
      part.add(under, halo, drawn);
      part.userData.handle = handle;
      this.group.add(part);
    }
    // The pivot, a small dot (not a handle: a press there takes nothing).
    const dot = new THREE.Mesh(new THREE.SphereGeometry(MOVE_STYLE.dot, 12, 8), overAll({ color: MOVE_COLOURS.centre }));
    dot.renderOrder = HANDLE_ORDER + 2;
    dot.userData.pivot = true;
    this.group.add(dot);
    this.group.visible = false;
  }

  /** What is shown now (null: the Move panel is not open, or has nothing to move). */
  get state(): MoveHandlesShow | null {
    return this.shown;
  }

  show(show: MoveHandlesShow | null) {
    this.shown = show;
    if (!show) this.setHot(null);
    this.group.visible = show !== null;
  }

  /** The handle under the pointer or held, lit with its glow; true when it changed. */
  setHot(handle: MoveHandle | null): boolean {
    if (handle === this.hot) return false;
    this.hot = handle;
    for (const [h, m] of this.materials) {
      m.color.setRGB(...handleColour(h, h === handle), THREE.SRGBColorSpace);
      m.opacity = h === handle || !h.startsWith("turn") ? 1 : MOVE_STYLE.ringOpacity;
    }
    for (const [h, g] of this.glows) g.visible = h === handle;
    return true;
  }

  get hotHandle(): MoveHandle | null {
    return this.hot;
  }

  /**
   * Places the handles for the view about to draw, `pixel` mm being one CSS
   * pixel at their centre, each where `placed` puts it (an arrow along its
   * axis or the other way, a grip on its quarter) and the rest hidden: each
   * view sizes and places them for its own camera.
   */
  placeAt(pixel: number, placed: readonly Placed[]) {
    if (!this.shown) return;
    this.group.position.set(...this.shown.centre);
    this.group.scale.setScalar(pixel);
    for (const part of this.group.children) {
      const handle = part.userData.handle as MoveHandle | undefined;
      if (handle === undefined) continue;
      const p = placed.find((x) => x.handle === handle);
      part.visible = p !== undefined;
      if (!p) continue;
      if (isRing(handle)) for (const piece of part.children) piece.traverse((o) => o.name === "spin" && (o.rotation.z = quarterAngle(p.quarter)));
      // An arrow the other way: half a turn about an axis across it (a mirror would turn its faces inside out).
      else if (p.sign === 1) part.quaternion.identity();
      else part.quaternion.setFromAxisAngle(new THREE.Vector3(handleAxis(handle) === 2 ? 1 : 0, 0, handleAxis(handle) === 2 ? 0 : 1), Math.PI);
    }
  }
}

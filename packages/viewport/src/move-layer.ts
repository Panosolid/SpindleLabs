// What the Move tool draws in the view (35e2c, Fusion's Move gizmo): three
// arrows along X, Y and Z (red, green, blue, as the axes) and three rings
// about them, at the point the pivot ends up, the same size on screen at
// any zoom and drawn over everything (they are handles, never hidden by
// the bodies they move); the one under the pointer or held is orange. The
// maths is move-handles.ts; viewer.ts sizes it per view and drags it.

import * as THREE from "three";
import type { MoveHandle, MoveHandlesShow } from "@fission/core";
import { handleAxis, MOVE_HANDLES, MOVE_PX } from "./move-handles.ts";

/** Each axis's colour (the axes' own red, green and blue) and the handle's under the pointer or held. */
export const MOVE_COLOURS = { axes: [0xe5534b, 0x57ab5a, 0x4a8cff] as const, hot: 0xffb454 };

/** How thick the shafts and rings are drawn, and how wide the arrow heads (CSS px). */
const SHAFT_PX = 2.5;
const RING_TUBE_PX = 2;
const HEAD = { radius: 7, length: 16 };
const HANDLE_ORDER = 11; // over Extrude's arrow's 10 too
/** A dark edge round every handle (CSS px wider each side), drawn under it, so the green Y handles still show on the picked body's green glow. */
const OUTLINE = { px: 1.5, colour: 0x0b1220 };

export class MoveLayer {
  readonly group = new THREE.Group();
  private shown: MoveHandlesShow | null = null;
  private hot: MoveHandle | null = null;
  private materials = new Map<MoveHandle, THREE.MeshBasicMaterial>();

  constructor() {
    // Built 1 unit to the pixel; placeAt scales the group to the view's mm per pixel.
    const outline = new THREE.MeshBasicMaterial({ color: OUTLINE.colour, depthTest: false, depthWrite: false, transparent: true });
    const o = OUTLINE.px;
    for (const handle of MOVE_HANDLES) {
      const axis = handleAxis(handle);
      const material = new THREE.MeshBasicMaterial({ color: MOVE_COLOURS.axes[axis], depthTest: false, depthWrite: false, transparent: true });
      this.materials.set(handle, material);
      const part = new THREE.Group();
      if (handle.startsWith("turn")) {
        // A torus lies about Z: turned onto X or Y.
        const edge = new THREE.Mesh(new THREE.TorusGeometry(MOVE_PX.ring, RING_TUBE_PX / 2 + o, 6, 64), outline);
        edge.renderOrder = -1; // under the ring (set relative below)
        part.add(edge, new THREE.Mesh(new THREE.TorusGeometry(MOVE_PX.ring, RING_TUBE_PX / 2, 6, 64), material));
        if (axis === 0) part.rotation.y = Math.PI / 2;
        if (axis === 1) part.rotation.x = Math.PI / 2;
      } else {
        // An arrow along +Y (Three's cylinders and cones are): its shaft, then its head ending at MOVE_PX.arrowTo.
        const shaftLength = MOVE_PX.arrowTo - HEAD.length - MOVE_PX.arrowFrom;
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT_PX / 2, SHAFT_PX / 2, shaftLength, 8), material);
        shaft.position.y = MOVE_PX.arrowFrom + shaftLength / 2;
        const head = new THREE.Mesh(new THREE.ConeGeometry(HEAD.radius, HEAD.length, 16), material);
        head.position.y = MOVE_PX.arrowTo - HEAD.length / 2;
        const shaftEdge = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT_PX / 2 + o, SHAFT_PX / 2 + o, shaftLength + 2 * o, 8), outline);
        shaftEdge.position.y = shaft.position.y;
        const headEdge = new THREE.Mesh(new THREE.ConeGeometry(HEAD.radius + 2 * o, HEAD.length + 3 * o, 16), outline);
        headEdge.position.y = head.position.y + o / 2;
        for (const e of [shaftEdge, headEdge]) e.renderOrder = -1;
        part.add(shaftEdge, headEdge, shaft, head);
        part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0));
      }
      // Every handle's edge first, then the handles: drawn over everything, an edge never over a handle.
      part.traverse((m) => (m.renderOrder = m.renderOrder === -1 ? HANDLE_ORDER : HANDLE_ORDER + 1));
      part.userData.handle = handle;
      this.group.add(part);
    }
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

  /** The handle under the pointer or held, drawn orange; true when it changed. */
  setHot(handle: MoveHandle | null): boolean {
    if (handle === this.hot) return false;
    this.hot = handle;
    for (const [h, m] of this.materials) m.color.setHex(h === handle ? MOVE_COLOURS.hot : MOVE_COLOURS.axes[handleAxis(h)]);
    return true;
  }

  get hotHandle(): MoveHandle | null {
    return this.hot;
  }

  /** Places the handles for the view about to draw, `pixel` mm being one CSS pixel at their centre (each view sizes them for its own camera). */
  placeAt(pixel: number) {
    if (!this.shown) return;
    this.group.position.set(...this.shown.centre);
    this.group.scale.setScalar(pixel);
  }
}

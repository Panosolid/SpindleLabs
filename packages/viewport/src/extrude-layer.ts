// What Extrude draws in the view (UX1b, Fusion's feel): the closed sketch
// outlines a click picks, as see-through fills on their planes; the
// extrude as OK would make it, see-through; and the distance arrow on its
// end, the same size on screen at any zoom. The maths is extrude-pick.ts;
// viewer.ts raycasts, hands the pointer on and sizes the arrow per view.

import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { DisplayMesh, ExtrudeShow, OfferedProfile } from "@fission/core";
import { insideOutline, loopPoints } from "./extrude-pick.ts";
import { unhidden } from "./picking.ts";
import { rayOnPlane, toWorld, yAxisOf } from "./sketch-view.ts";

type Vec3 = [number, number, number];

/** The fills' and the preview's blue (the sketch lines' own), and the arrow's, orange while the pointer is on it. */
export const EXTRUDE_COLOURS = { fill: 0x6cc4ff, preview: 0x4aa3ff, arrow: 0x4aa3ff, arrowHot: 0xffb454 };
/** How see-through an outline's fill is: offered, under the pointer, chosen; a flat face offered (UX1c) is not drawn until the pointer is on it, since the body shows it already. */
export const FILL_OPACITY = { offered: 0.16, faceOffered: 0, hover: 0.36, chosen: 0.5 };
/** How see-through the preview's faces are (its edges are drawn solid). */
export const PREVIEW_OPACITY = 0.45;

/** The arrow's shape along its length 1: a shaft of radius 0.05 to 0.68, then a head of radius 0.15 to the tip. */
const SHAFT = { radius: 0.05, length: 0.68 };
const HEAD_RADIUS = 0.15;

const FILL_ORDER = 1;
const PREVIEW_ORDER = 2;
const ARROW_ORDER = 10;

function dispose(group: THREE.Object3D) {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  group.clear();
}

export class ExtrudeLayer {
  readonly group = new THREE.Group();
  private fills = new THREE.Group();
  private preview = new THREE.Group();
  private arrow = new THREE.Group();
  private shown: ExtrudeShow | null = null;
  private fillMeshes = new Map<string, THREE.Mesh>();
  /** The offered profiles that are flat faces (UX1c). */
  private faces = new Set<string>();
  private hover: string | null = null;
  private arrowHot = false;
  private arrowMaterial = new THREE.MeshBasicMaterial({ color: EXTRUDE_COLOURS.arrow, depthTest: false, depthWrite: false, transparent: true });

  constructor() {
    // The arrow is always drawn over everything, as Fusion's is: it is a handle, never hidden by the body it grows.
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(SHAFT.radius, SHAFT.radius, SHAFT.length, 12), this.arrowMaterial);
    shaft.position.y = SHAFT.length / 2;
    const head = new THREE.Mesh(new THREE.ConeGeometry(HEAD_RADIUS, 1 - SHAFT.length, 16), this.arrowMaterial);
    head.position.y = SHAFT.length + (1 - SHAFT.length) / 2;
    for (const m of [shaft, head]) m.renderOrder = ARROW_ORDER;
    this.arrow.add(shaft, head);
    this.arrow.visible = false;
    this.group.add(this.fills, this.preview, this.arrow);
  }

  /** What is shown now (null: Extrude is not open). */
  get state(): ExtrudeShow | null {
    return this.shown;
  }

  /** Draws `show`, rebuilding only what changed: the fills when the profiles do, the preview when its mesh does. */
  show(show: ExtrudeShow | null) {
    const before = this.shown;
    this.shown = show;
    if (show?.profiles !== before?.profiles) this.drawFills(show?.profiles ?? []);
    if (show?.preview !== before?.preview) this.drawPreview(show?.preview ?? null);
    if (!show?.profiles.some((p) => p.id === this.hover)) this.hover = null;
    if (!show?.arrow) this.arrowHot = false;
    this.arrow.visible = !!show?.arrow;
    this.paint();
  }

  private drawFills(profiles: readonly OfferedProfile[]) {
    dispose(this.fills);
    this.fillMeshes.clear();
    this.faces.clear();
    for (const p of profiles) {
      if (p.face) this.faces.add(p.id);
      const shape = new THREE.Shape(loopPoints(p.outline.outer).map(([x, y]) => new THREE.Vector2(x, y)));
      for (const hole of p.outline.holes) shape.holes.push(new THREE.Path(loopPoints(hole).map(([x, y]) => new THREE.Vector2(x, y))));
      const geometry = new THREE.ShapeGeometry(shape);
      // The shape is in the plane's own x and y: placed by the plane's frame (x, normal × x, normal) at its origin.
      const [x, y, n] = [p.plane.xAxis, yAxisOf(p.plane), p.plane.normal];
      geometry.applyMatrix4(new THREE.Matrix4().set(x[0], y[0], n[0], p.plane.origin[0], x[1], y[1], n[1], p.plane.origin[1], x[2], y[2], n[2], p.plane.origin[2], 0, 0, 0, 1));
      // Pulled towards the camera past the body's faces (their offset is +1), so a sketch on a face shows on it, never speckled.
      const material = new THREE.MeshBasicMaterial({ color: EXTRUDE_COLOURS.fill, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = FILL_ORDER;
      this.fills.add(mesh);
      this.fillMeshes.set(p.id, mesh);
    }
  }

  private drawPreview(mesh: DisplayMesh | null) {
    dispose(this.preview);
    if (!mesh) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
    geometry.setIndex(mesh.indices);
    const faces = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: EXTRUDE_COLOURS.preview, transparent: true, opacity: PREVIEW_OPACITY, depthWrite: false, metalness: 0.1, roughness: 0.6 }));
    faces.renderOrder = PREVIEW_ORDER;
    const edges = new LineSegmentsGeometry();
    edges.setPositions(mesh.edge_lines);
    const edgeMaterial = new LineMaterial({ color: EXTRUDE_COLOURS.preview, linewidth: 2, depthWrite: false });
    const lines = new LineSegments2(edges, edgeMaterial);
    lines.onBeforeRender = (renderer) => renderer.getSize(edgeMaterial.resolution);
    lines.renderOrder = PREVIEW_ORDER;
    this.preview.add(faces, lines);
  }

  /** The outline under the pointer (offered) and whether the pointer is on the arrow, drawn brighter. True when either changed. */
  setHover(profile: string | null, arrowHot: boolean): boolean {
    if (profile === this.hover && arrowHot === this.arrowHot) return false;
    this.hover = profile;
    this.arrowHot = arrowHot;
    this.paint();
    return true;
  }

  get hovered(): string | null {
    return this.hover;
  }

  private paint() {
    for (const [id, mesh] of this.fillMeshes) {
      (mesh.material as THREE.MeshBasicMaterial).opacity = id === this.shown?.chosen ? FILL_OPACITY.chosen : id === this.hover ? FILL_OPACITY.hover : this.faces.has(id) ? FILL_OPACITY.faceOffered : FILL_OPACITY.offered;
    }
    this.arrowMaterial.color.setHex(this.arrowHot ? EXTRUDE_COLOURS.arrowHot : EXTRUDE_COLOURS.arrow);
  }

  /**
   * The offered outline a ray from `from` along the unit `dir` meets
   * first, where the body doesn't hide it (picking.ts `unhidden`, given the
   * distance to the first body face along the ray, null for none), or null.
   */
  profileAt(from: Vec3, dir: Vec3, firstFace: number | null): string | null {
    let best: { id: string; distance: number } | null = null;
    for (const p of this.shown?.profiles ?? []) {
      const at = rayOnPlane(from, dir, p.plane);
      if (!at || !insideOutline(p.outline, at)) continue;
      const w = toWorld(p.plane, at);
      const distance = Math.hypot(w[0] - from[0], w[1] - from[1], w[2] - from[2]);
      if (unhidden(distance, firstFace) && (!best || distance < best.distance)) best = { id: p.id, distance };
    }
    return best?.id ?? null;
  }

  /** The arrow's foot (on the extrude's end) and tip in model space, `length` mm long; null while none is shown. */
  arrowEnds(length: number): [Vec3, Vec3] | null {
    const a = this.shown?.arrow;
    if (!a) return null;
    const way = a.distance < 0 ? -1 : 1;
    const foot = a.base.map((b, i) => b + a.distance * a.direction[i]) as Vec3;
    return [foot, foot.map((f, i) => f + way * length * a.direction[i]) as Vec3];
  }

  /** Sets the arrow `length` mm long for the view about to draw (each view sizes it for its own camera). */
  placeArrow(length: number) {
    const ends = this.arrowEnds(length);
    if (!ends) return;
    const [foot, tip] = ends;
    this.arrow.position.set(...foot);
    this.arrow.scale.setScalar(length);
    this.arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(tip[0] - foot[0], tip[1] - foot[1], tip[2] - foot[2]).normalize());
  }
}


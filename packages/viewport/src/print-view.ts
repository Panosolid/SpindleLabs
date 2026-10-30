// The print preview's 3D view (H2b, H2c): a slice's plastic drawn as the
// printed lines themselves, each a lit box as wide as its line and as tall
// as its layer, on the printer's plate, coloured by kind (walls, infill,
// supports), with the nozzle where the clock says it is. It has its own
// small scene and camera (orbit with a drag or one finger, pan with the
// right button or two fingers, zoom with the wheel or a pinch), since the
// preview opens over the Design view rather than in it.
//
// Every line is one instance of a single box, in printing order, so
// showing the print up to a moment is only how many instances are drawn,
// plus the line being laid, drawn on its own and cut where the nozzle is.
// What to draw comes from `Playback` (core's print/playback.ts), the
// G-code played through the replayer: never a separate drawing. Hiding a
// kind squashes its instances to nothing (the order, and so the clock's
// prefix, stays the same); travel moves are thin lines drawn the same way,
// as many as the clock has passed.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { momentAt, type Playback, type PrintKind } from "@fission/core";

/** Each kind's colour, as slicers colour them: warm walls, cooler infill, green supports. */
export const KIND_COLOURS: Record<PrintKind, number> = {
  "outer-wall": 0xff8a3d,
  "inner-wall": 0xffc857,
  "solid-infill": 0xd94f70,
  "sparse-infill": 0x9b6bd6,
  support: 0x3fbf7f,
  prime: 0x7fa7c9,
  other: 0xb0b0b0,
};

/** The plate's size (mm): a Bambu Lab P1S's 256 × 256. */
export const PLATE_MM = 256;

export interface PrintView {
  readonly element: HTMLCanvasElement;
  /** Shows the print as it is at second `t` of the playback's clock. */
  setTime(t: number): void;
  /** Draws only the plastic of `kinds`, and the travel moves when `travel`. */
  setShown(kinds: ReadonlySet<PrintKind>, travel: boolean): void;
  /** Frames the part from the front, a little above. */
  frame(): void;
  /** Call when the host changes size. */
  resize(): void;
  dispose(): void;
}

/** The plastic as one instanced box per line, in printing order. */
function plasticMesh(p: Playback): { mesh: THREE.InstancedMesh; index: Int32Array } {
  const box = new THREE.BoxGeometry(1, 1, 1);
  // The box's base sits on z 0, so a line's box stands on the layer below and reaches the line's own height.
  box.translate(0, 0, -0.5);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 });
  const mesh = new THREE.InstancedMesh(box, material, Math.max(1, p.plasticCount));
  mesh.frustumCulled = false;
  const index = new Int32Array(p.plasticCount);
  const m = new THREE.Matrix4();
  const colour = new THREE.Color();
  let k = 0;
  for (let i = 0; i < p.count; i++) {
    if (!p.plastic[i]) continue;
    index[k] = i;
    lineMatrix(p, i, 1, m);
    mesh.setMatrixAt(k, m);
    mesh.setColorAt(k, colour.setHex(KIND_COLOURS[p.kind[i]]));
    k++;
  }
  mesh.count = 0;
  return { mesh, index };
}

/**
 * The travel moves as line pieces, in order: every nozzle move laying no plastic that goes somewhere
 * (a retraction or a pause, which goes nowhere, is left out), as `positions` (six numbers a piece) and
 * `before[i]`, how many of them come before piece i, so the clock's moment shows the first `before[i]`.
 */
export function travelPieces(p: Playback): { positions: Float32Array; before: Uint32Array; count: number } {
  const before = new Uint32Array(p.count + 1);
  const keep: number[] = [];
  for (let i = 0; i < p.count; i++) {
    before[i] = keep.length;
    if (p.plastic[i]) continue;
    const d = Math.hypot(p.to[3 * i] - p.from[3 * i], p.to[3 * i + 1] - p.from[3 * i + 1], p.to[3 * i + 2] - p.from[3 * i + 2]);
    if (d > 0) keep.push(i);
  }
  before[p.count] = keep.length;
  const positions = new Float32Array(6 * keep.length);
  keep.forEach((i, k) => {
    for (let j = 0; j < 3; j++) {
      positions[6 * k + j] = p.from[3 * i + j];
      positions[6 * k + 3 + j] = p.to[3 * i + j];
    }
  });
  return { positions, before, count: keep.length };
}

const scratch = { a: new THREE.Vector3(), b: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(), x: new THREE.Vector3(1, 0, 0) };

/** Piece i's box up to `along` (0 to 1) of its length: centred on the line, turned to it, its top at the line's height. */
function lineMatrix(p: Playback, i: number, along: number, out: THREE.Matrix4) {
  const { a, b, q, s, x } = scratch;
  a.set(p.from[3 * i], p.from[3 * i + 1], p.from[3 * i + 2]);
  b.set(p.to[3 * i], p.to[3 * i + 1], p.to[3 * i + 2]);
  b.sub(a).multiplyScalar(along);
  const length = Math.hypot(b.x, b.y);
  const layer = p.layers[p.layer[i]];
  const height = layer ? layer.height : 0.2;
  const width = p.width[i] > 0 ? p.width[i] : 0.4;
  // Lengthened by one width so neighbouring lines meet at their corners, as the round bead does.
  s.set(length + width, width, height);
  q.setFromUnitVectors(x, length > 0 ? new THREE.Vector3(b.x / length, b.y / length, 0) : x);
  a.addScaledVector(b, 0.5);
  out.compose(a, q, s);
}

/** The nozzle: a small brass cone pointing down at the plastic under a slim heater block, kept small so it hides little of the print. */
function nozzleMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const tip = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.5, 24), new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.8, roughness: 0.3 }));
  tip.rotation.x = -Math.PI / 2; // the cone's point from +y to −z
  tip.position.z = 1.75;
  const block = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 3), new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.5, roughness: 0.45 }));
  block.position.z = 5;
  g.add(tip, block);
  return g;
}

/** The plate: a dark textured-PEI square with a 10 mm grid, its front-left corner at the origin like the printer's. */
function plateMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(PLATE_MM, PLATE_MM), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.9 }));
  plate.position.set(PLATE_MM / 2, PLATE_MM / 2, -0.01);
  const grid = new THREE.GridHelper(PLATE_MM, PLATE_MM / 10, 0x4a515c, 0x3a4048);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(PLATE_MM / 2, PLATE_MM / 2, 0);
  g.add(plate, grid);
  return g;
}

/** The preview's view of `p`, drawn into a new canvas in `host`. Needs WebGL; throws when the browser has none. */
export function printView(host: HTMLElement, p: Playback): PrintView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x1b1e23);
  const canvas = renderer.domElement;
  canvas.className = "print-view-canvas";
  host.append(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-1, -2, 3);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(2, 1, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404850, 0.8), key, fill, plateMesh());
  const { mesh, index } = plasticMesh(p);
  const partial = new THREE.Mesh(mesh.geometry, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }));
  const nozzle = nozzleMesh();
  const travels = travelPieces(p);
  const travelGeometry = new THREE.BufferGeometry();
  travelGeometry.setAttribute("position", new THREE.BufferAttribute(travels.positions, 3));
  const travelLines = new THREE.LineSegments(travelGeometry, new THREE.LineBasicMaterial({ color: 0x5ec8ff, transparent: true, opacity: 0.55 }));
  travelLines.frustumCulled = false;
  travelLines.visible = false;
  scene.add(mesh, partial, nozzle, travelLines);
  let shownKinds: ReadonlySet<PrintKind> = new Set(p.kind);

  // The part's box, for framing: every plastic line's ends but the prime line's, which runs along the plate's edge.
  const bounds = new THREE.Box3();
  for (let k = 0; k < index.length; k++) {
    const i = index[k];
    if (p.kind[i] === "prime") continue;
    bounds.expandByPoint(scratch.a.set(p.from[3 * i], p.from[3 * i + 1], p.from[3 * i + 2]));
    bounds.expandByPoint(scratch.a.set(p.to[3 * i], p.to[3 * i + 1], p.to[3 * i + 2]));
  }
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(PLATE_MM / 2 - 10, PLATE_MM / 2 - 10, 0), new THREE.Vector3(PLATE_MM / 2 + 10, PLATE_MM / 2 + 10, 20));

  let frameRequested = false;
  const draw = () => {
    frameRequested = false;
    renderer.render(scene, camera);
  };
  const redraw = () => {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(draw);
  };
  controls.addEventListener("change", redraw);

  const m = new THREE.Matrix4();
  let time = p.seconds;
  const view: PrintView = {
    element: canvas,
    setTime(t) {
      time = t;
      const at = momentAt(p, t);
      mesh.count = at ? at.laid : 0;
      travelGeometry.setDrawRange(0, 2 * (at ? travels.before[at.piece] + (at.along >= 1 ? travels.before[at.piece + 1] - travels.before[at.piece] : 0) : 0));
      partial.visible = false;
      if (at && p.plastic[at.piece] && shownKinds.has(p.kind[at.piece]) && at.along > 0 && at.along < 1) {
        lineMatrix(p, at.piece, at.along, m);
        m.decompose(partial.position, partial.quaternion, partial.scale);
        (partial.material as THREE.MeshStandardMaterial).color.setHex(KIND_COLOURS[p.kind[at.piece]]);
        partial.visible = true;
      }
      nozzle.visible = at !== null;
      if (at) nozzle.position.set(at.nozzle[0], at.nozzle[1], at.nozzle[2]);
      redraw();
    },
    setShown(kinds, travel) {
      shownKinds = new Set(kinds);
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let k = 0; k < index.length; k++) {
        const i = index[k];
        if (shownKinds.has(p.kind[i])) lineMatrix(p, i, 1, m);
        else m.copy(zero);
        mesh.setMatrixAt(k, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      travelLines.visible = travel;
      view.setTime(time);
    },
    frame() {
      const centre = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 5);
      const distance = radius / Math.sin(((camera.fov / 2) * Math.PI) / 180);
      camera.position.copy(centre).add(new THREE.Vector3(0.45, -1, 0.75).normalize().multiplyScalar(distance * 1.1));
      camera.near = distance / 100;
      camera.far = distance * 100;
      camera.updateProjectionMatrix();
      controls.target.copy(centre);
      controls.update();
      redraw();
    },
    resize() {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      redraw();
    },
    dispose() {
      controls.dispose();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      (partial.material as THREE.Material).dispose();
      mesh.dispose();
      travelGeometry.dispose();
      (travelLines.material as THREE.Material).dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh && o !== mesh && o !== partial) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
      canvas.remove();
    },
  };
  view.resize();
  view.frame();
  return view;
}

// The print preview's 3D view (H2b, H2c, H2d): a slice's plastic drawn as
// the printed lines themselves, each a rounded strand as wide as its line
// and as tall as its layer (a bead's cross-section: flat-ish top and
// bottom, round sides), on the printer's textured plate, lit by a sky and
// ground light, a warm sun that casts soft shadows and a rim light (no
// reflection map: it cost a phone too much for what it added), coloured by kind (walls, infill,
// supports), with the nozzle where the clock says it is. It has its own
// small scene and camera (orbit with a drag or one finger, pan with the
// right button or two fingers, zoom with the wheel or a pinch), since the
// preview opens over the Design view rather than in it.
//
// Every line is one instance of a single strand, in printing order, so
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

/** How many points go round a strand's cross-section: enough to look round when lit, few enough for a phone. */
export const BEAD_SEGMENTS = 8;

/**
 * One strand of unit length, width and height, along x from −½ to ½, y from −½ to ½, its top at z 0 and
 * its bottom at z −1 (a line's top is at its layer's height). Its cross-section is a squircle,
 * drawn as y = ½·sgn(cos θ)·|cos θ|^½, z = −½ + ½·sgn(sin θ)·|sin θ|^½: flat-ish on top and
 * bottom where it meets the layers above and below, round at the sides as a printed bead is. Smooth normals
 * make it shade round; the ends are closed flat, so it is a closed solid.
 */
export function beadGeometry(segments = BEAD_SEGMENTS): THREE.BufferGeometry {
  const n = Math.max(4, Math.floor(segments));
  const ring: [number, number][] = [];
  const normal: [number, number][] = [];
  const root = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
  // Start half a step round so the top and bottom are flat edges rather than points; then stretch so the
  // widest points reach y ±½ and the flat top and bottom z 0 and −1 exactly, keeping the strand as wide and tall as the file says.
  const angle = (k: number) => ((k + 0.5) / n) * 2 * Math.PI;
  let wide = 0;
  let tall = 0;
  for (let k = 0; k < n; k++) {
    wide = Math.max(wide, Math.abs(root(Math.cos(angle(k)))));
    tall = Math.max(tall, Math.abs(root(Math.sin(angle(k)))));
  }
  for (let k = 0; k < n; k++) {
    const t = angle(k);
    ring.push([(0.5 * root(Math.cos(t))) / wide, -0.5 + (0.5 * root(Math.sin(t))) / tall]);
    // The cross-section's outward normal, near enough for shading: the circle's, pulled towards the flat top and bottom.
    const ny = Math.cos(t) * 0.8;
    const nz = Math.sin(t) * 1.25;
    const l = Math.hypot(ny, nz);
    normal.push([ny / l, nz / l]);
  }
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // Sides: two rings (x −½ and ½), one quad between each pair of neighbouring points.
  for (const x of [-0.5, 0.5])
    for (let k = 0; k < n; k++) {
      positions.push(x, ring[k][0], ring[k][1]);
      normals.push(0, normal[k][0], normal[k][1]);
    }
  for (let k = 0; k < n; k++) {
    const a = k, b = (k + 1) % n;
    indices.push(a, b, n + b, a, n + b, n + a);
  }
  // Flat ends, a fan from each end's first point, facing −x and +x.
  for (const [x, nx] of [[-0.5, -1], [0.5, 1]] as const) {
    const base = positions.length / 3;
    for (let k = 0; k < n; k++) {
      positions.push(x, ring[k][0], ring[k][1]);
      normals.push(nx, 0, 0);
    }
    for (let k = 1; k < n - 1; k++) indices.push(...(nx < 0 ? [base, base + k + 1, base + k] : [base, base + k, base + k + 1]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(indices);
  return g;
}

/** The plastic as one instanced strand per line, in printing order. */
function plasticMesh(p: Playback): { mesh: THREE.InstancedMesh; index: Int32Array } {
  const box = beadGeometry();
  const material = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0 });
  const mesh = new THREE.InstancedMesh(box, material, Math.max(1, p.plasticCount));
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
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

/** The nozzle: a small polished brass cone pointing down at the plastic under a slim heater block, kept small so it hides little of the print, with a warm glow at its tip. */
function nozzleMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const brass = new THREE.MeshStandardMaterial({ color: 0xd4a93a, metalness: 0.55, roughness: 0.3 });
  const tip = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.5, 32), brass);
  tip.rotation.x = -Math.PI / 2; // the cone's point from +y to −z
  tip.position.z = 1.75;
  const block = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 3), new THREE.MeshStandardMaterial({ color: 0x9aa1ab, metalness: 0.3, roughness: 0.45 }));
  block.position.z = 5;
  const glow = new THREE.PointLight(0xff9a4a, 6, 12, 2);
  glow.position.z = 0.6;
  for (const m of [tip, block]) m.castShadow = true;
  g.add(tip, block, glow);
  return g;
}

/** The textured plate's look, drawn once: dark speckled PEI, a fine 10 mm grid and a brighter line every 50 mm. */
function plateTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 2048;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#353941";
  g.fillRect(0, 0, size, size);
  // The speckle: a fixed pattern (seeded), so every opening looks the same.
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 60000; k++) {
    const v = 50 + Math.floor(rand() * 14);
    g.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    g.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
  const step = size / (PLATE_MM / 10);
  for (let k = 0; k <= PLATE_MM / 10; k++) {
    const major = k % 5 === 0;
    g.strokeStyle = major ? "rgba(180, 195, 215, 0.3)" : "rgba(160, 175, 195, 0.13)";
    g.lineWidth = major ? 3 : 2;
    g.beginPath();
    g.moveTo(k * step, 0);
    g.lineTo(k * step, size);
    g.moveTo(0, k * step);
    g.lineTo(size, k * step);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The plate: a 4 mm thick textured-PEI slab with the grid, its top at z 0 and its front-left corner at the origin like the printer's. */
function plateMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const map = plateTexture();
  const top = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : 0x2b2f36, map, roughness: 0.85, metalness: 0.1 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6, metalness: 0.2 });
  // A box's faces in order: +x, −x, +y, −y, +z (the top), −z.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(PLATE_MM, PLATE_MM, 4), [edge, edge, edge, edge, top, edge]);
  plate.position.set(PLATE_MM / 2, PLATE_MM / 2, -2.01);
  plate.receiveShadow = true;
  g.add(plate);
  return g;
}

/** The backdrop: a soft vertical fade from slate to near black, so the print stands out. */
function backdrop(): THREE.Texture | THREE.Color {
  if (typeof document === "undefined") return new THREE.Color(0x1b1e23);
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d");
  if (!g) return new THREE.Color(0x1b1e23);
  const fade = g.createLinearGradient(0, 0, 0, 256);
  fade.addColorStop(0, "#3a4150");
  fade.addColorStop(0.55, "#1d2128");
  fade.addColorStop(1, "#0e1013");
  g.fillStyle = fade;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The preview's view of `p`, drawn into a new canvas in `host`. Needs WebGL; throws when the browser has none. */
export function printView(host: HTMLElement, p: Playback): PrintView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x1b1e23);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // The sun doesn't move with the camera, so its shadows are only worked out again when the print shown changes.
  renderer.shadowMap.autoUpdate = false;
  // A phone (a coarse pointer) gets a smaller shadow map: a quarter of the memory and work.
  const phone = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const canvas = renderer.domElement;
  canvas.className = "print-view-canvas";
  host.append(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  const sky = backdrop();
  scene.background = sky;
  const key = new THREE.DirectionalLight(0xfff4e6, 1.9);
  key.castShadow = true;
  key.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
  key.shadow.radius = 3;
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.45);
  fill.position.set(2, 1, 1);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(1, 2, 1.2);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a332c, 0.9), key, key.target, fill, rim, plateMesh());
  const { mesh, index } = plasticMesh(p);
  const partial = new THREE.Mesh(mesh.geometry, new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0 }));
  partial.castShadow = true;
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

  // The sun from the front left and high up, its shadow box just round the part (with room for the nozzle above it).
  {
    const centre = bounds.getCenter(new THREE.Vector3());
    const r = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 10) + 8;
    key.position.copy(centre).add(new THREE.Vector3(-0.45, -0.7, 1).normalize().multiplyScalar(r * 3));
    key.target.position.copy(centre);
    const cam = key.shadow.camera;
    cam.left = cam.bottom = -r;
    cam.right = cam.top = r;
    cam.near = r;
    cam.far = r * 5;
    cam.updateProjectionMatrix();
    // Small biases in millimetres: a strand is 0.2 mm tall, so anything bigger would lift the shadows off it.
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
  }

  let frameRequested = false;
  let shadowsStale = true;
  let shadowLayer = Number.NaN;
  let shadowLaid = 0;
  const draw = () => {
    frameRequested = false;
    if (shadowsStale) {
      renderer.shadowMap.needsUpdate = true;
      shadowsStale = false;
    }
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
      // While it plays, the shadows are worked out again once a layer, not every frame: the line being laid casts next
      // to nothing, and a phone keeps its frame rate.
      const layer = at ? at.layer : -1;
      if (layer !== shadowLayer || mesh.count < shadowLaid) shadowsStale = true;
      if (shadowsStale) {
        shadowLayer = layer;
        shadowLaid = mesh.count;
      }
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
      shadowsStale = true;
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
          // The plate has a material for each face (its top textured).
          for (const mat of [o.material].flat() as THREE.MeshStandardMaterial[]) {
            mat.map?.dispose();
            mat.dispose();
          }
        }
      });
      if (sky instanceof THREE.Texture) sky.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
  view.resize();
  view.frame();
  return view;
}

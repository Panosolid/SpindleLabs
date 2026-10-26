// Browser check that every visible body edge is drawn as a clear dark line
// (Fusion's shaded-with-edges look; the owner, 2026-10-26: "where two faces
// with similar shading meet (like the notch) it's hard to read the shape").
// Before, an edge was a one-device-pixel WebGL line: faint, jagged, and
// speckled grey wherever a finished sketch's line lay on it (an extrude's
// sketch on its own edges: the circle round a cylinder's base looked dotted).
//
// The file (version 3, two bodies): Sketch 1 on XY, a 60 × 40 outline with a
// V notch in its back edge, (0,0) (60,0) (60,40) (35,40) (20,15) (10,40)
// (0,40), extruded 15 mm (Body 1); Sketch 2 on XZ (sketch x = X, y = Z,
// normal −Y, sketch.ts), a circle radius 5 at (30, 7), extruded 15 mm along
// −Y (Body 2: the cylinder (x − 30)² + (z − 7)² ≤ 25, −15 ≤ y ≤ 0, standing
// on Body 1's front face y = 0, as in the owner's screenshot).
//
// Probes, through the app's camera (`?test-hooks`), at points along a model
// edge: the pixels across the line from −STRIP to +STRIP device px, and a
// reference REF px away on each side. Only probes where both references are
// body faces (the edge lies between two faces, the case the owner meant),
// the point is on the canvas (not under a panel) and no other edge is within
// reach are kept; a base-circle point counts only if the cylinder hides
// neither it nor its neighbours 3° either way (ray against the solid
// cylinder, below).
// 1. Width: EDGE_WIDTH_PX = 2 CSS px, so 2 × dpr device px dark across the
//    line. The median dark run over the probes must be at least
//    2 × dpr − 0.5 (a one-pixel line, the old drawing, gives 1 at dpr 1 and
//    at most 2 at dpr 2, so it fails) and at most 2 × dpr + 1.
// 2. Every probe is dark somewhere across the line (no gaps): on the face-
//    to-face edges of Body 1 and the cylinder's front circle, and on the
//    base circle where Sketch 2's circle lies on the edge (the old drawing
//    let the sketch's grey win in spots there).
// "Dark" is every channel below DARK: EDGE_COLOUR is (11, 12, 14), the
// faces are lit BASE_COLOUR (154, 167, 184) and no face here is darker
// than about 70 in any channel (measured with E2E_MEASURE=1).
// At 1280 px (dpr 1, mouse) and 375 px (dpr 2, taps). In `npm run e2e`.
import assert from "node:assert/strict";
import { browserName, launch } from "./browser.mjs";
import { preview } from "vite";

const server = await preview({ preview: { port: 4212, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4212/?test-hooks#design";
const browser = await launch();
const errors = [];
const shots = process.env.E2E_SHOTS;
const MEASURE = process.env.E2E_MEASURE === "1";

/** Half the strip across a line, in device pixels per dpr. */
const STRIP = 5;
/** How far each side's reference pixel is from the line, in device pixels per dpr. */
const REF = 8;
/** A pixel is dark when every channel is below this. */
const DARK = 45;
/** A reference pixel is on a face when every channel is above this (the background is (20, 22, 26), its grid lines under 80). */
const FACE = 60;

const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const scale = (a, s) => a.map((x) => x * s);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.sqrt(dot(a, a)));
const T = Math.tan(Math.PI / 8);

/** Where model point `p` is on the canvas, as a fraction of its width and height (the pinhole camera of hidden-edges.mjs, 45° field of view). */
function onCanvas(cam, aspect, p) {
  const forward = unit(sub(cam.target, cam.position));
  const right = unit(cross(forward, cam.up));
  const up = cross(right, forward);
  const v = sub(p, cam.position);
  return [(dot(v, right) / (dot(v, forward) * T * aspect) + 1) / 2, (1 - dot(v, up) / (dot(v, forward) * T)) / 2];
}

const outline = [[0, 0], [60, 0], [60, 40], [35, 40], [20, 15], [10, 40], [0, 40]];
const feat = (id, type, parameters, label, from) => ({
  id,
  intent: { type, parameters, summary: label },
  provenance: { self: { workspace: "design", id, label }, from: from ? [{ workspace: "design", id: from, label: from }] : [] },
  dependsOn: from ? [from] : [],
  suppressed: false,
});
const project = {
  formatVersion: 2,
  name: "Edges",
  units: { length: "mm" },
  materials: [],
  links: [],
  workspaces: {
    design: {
      version: 3,
      nextId: 40,
      profiles: [],
      sketches: [
        {
          id: "sketch-1",
          points: outline.map(([x, y], i) => ({ id: `point-${2 + i}`, x, y })),
          curves: outline.map((_, i) => ({ id: `line-${10 + i}`, kind: "line", start: `point-${2 + i}`, end: `point-${2 + ((i + 1) % outline.length)}` })),
          constraints: [],
        },
        { id: "sketch-30", points: [{ id: "point-31", x: 30, y: 7 }], curves: [{ id: "circle-32", kind: "circle", centre: "point-31", radius: 5 }], constraints: [] },
      ],
      timeline: {
        features: [
          feat("sketch-1", "sketch", { plane: "XY" }, "Sketch 1"),
          feat("feature-20", "extrude", { sketch: "sketch-1", distance: 15 }, "Extrude 1", "sketch-1"),
          feat("sketch-30", "sketch", { plane: "XZ" }, "Sketch 2"),
          feat("feature-33", "extrude", { sketch: "sketch-30", distance: 15 }, "Extrude 2", "sketch-30"),
        ],
      },
    },
  },
};

/** The cylinder's circle at y (0: the base, on Body 1's front face; −15: the front cap), at angle a. */
const onCircle = (y, a) => [30 + 5 * Math.cos(a), y, 7 + 5 * Math.sin(a)];
/** Whether the solid cylinder lies between the camera and model point p (the ray c + t(p − c), 0 < t < 1 − 1e-3). */
function cylinderHides(c, p) {
  const d = sub(p, c);
  const [ox, oz] = [c[0] - 30, c[2] - 7];
  // |(ox, oz) + t (dx, dz)|² = 25: a t² + b t + k = 0.
  const a = d[0] * d[0] + d[2] * d[2];
  const b = 2 * (ox * d[0] + oz * d[2]);
  const k = ox * ox + oz * oz - 25;
  const disc = b * b - 4 * a * k;
  if (disc <= 0) return false;
  let lo = (-b - Math.sqrt(disc)) / (2 * a);
  let hi = (-b + Math.sqrt(disc)) / (2 * a);
  // −15 ≤ c.y + t d.y ≤ 0.
  const [y0, y1] = [(-15 - c[1]) / d[1], (0 - c[1]) / d[1]].sort((u, v) => u - v);
  lo = Math.max(lo, y0, 1e-9);
  hi = Math.min(hi, y1, 1 - 1e-3);
  return lo < hi;
}

/** Every body edge as model segments (circles as 96-sided polygons): what a probe must keep clear of. */
const circle = (y) => Array.from({ length: 96 }, (_, i) => [onCircle(y, (2 * Math.PI * i) / 96), onCircle(y, (2 * Math.PI * (i + 1)) / 96)]);
const outlineEdges = outline.flatMap(([x, y], i) => {
  const [x2, y2] = outline[(i + 1) % outline.length];
  return [[[x, y, 0], [x2, y2, 0]], [[x, y, 15], [x2, y2, 15]], [[x, y, 0], [x, y, 15]]];
});
const ALL_EDGES = [...outlineEdges, ...circle(0), ...circle(-15)];
/** Screen distance from point s to the segment p → q. */
function screenDistance(s, p, q) {
  const d = [q[0] - p[0], q[1] - p[1]];
  const t = Math.max(0, Math.min(1, ((s[0] - p[0]) * d[0] + (s[1] - p[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1])));
  return Math.hypot(s[0] - p[0] - t * d[0], s[1] - p[1] - t * d[1]);
}

async function fresh(width, touch, dpr) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: touch, deviceScaleFactor: dpr });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector("#start-hint", { state: "visible", timeout: 15000 });
  await page.setInputFiles("#open-file", { name: "Edges.fission.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForFunction(() => document.querySelectorAll('#browser [data-node="timeline"] .tree-row').length === 4, null, { timeout: 15000 });
  await page.waitForFunction(async () => (await window.fissionTest.bodyCount()) === 2, null, { timeout: 15000 });
  return page;
}

/** The canvas's pixels (device pixels, RGBA) a moment after it settles, the camera, and where the canvas is on the page. */
async function grab(page) {
  await page.waitForTimeout(400);
  const cam = await page.evaluate(() => window.fissionTest.camera());
  const shot = await page.evaluate(() => {
    const src = document.querySelector("#viewport canvas");
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0);
    const r = src.getBoundingClientRect();
    return { dpr: src.width / r.width, box: [r.x, r.y], width: c.width, height: c.height, data: Array.from(ctx.getImageData(0, 0, c.width, c.height).data) };
  });
  return { cam, ...shot, at: (x, y) => Array.from(shot.data.slice(4 * (y * shot.width + x), 4 * (y * shot.width + x) + 3)) };
}

/**
 * Probes `img` across the model edge at each point of `points` (each with a
 * second point a little along the edge, for its screen direction), keeping
 * those clear of other edges and on a face both sides. Each probe: where it
 * is, its strip, its dark run (the most dark pixels in a row across) and
 * whether any strip pixel is dark.
 */
async function probe(page, img, points, own) {
  const aspect = img.width / img.height;
  const px = (p) => {
    const [fx, fy] = onCanvas(img.cam, aspect, p);
    return [fx * img.width, fy * img.height];
  };
  const others = ALL_EDGES.filter((e) => !own(e));
  const reach = (REF + 2) * img.dpr;
  const kept = [];
  for (const [p, along] of points) {
    const [x, y] = px(p);
    if (x < reach || y < reach || x >= img.width - reach || y >= img.height - reach) continue;
    if (others.some(([a, b]) => screenDistance([x, y], px(a), px(b)) < reach)) continue;
    const [x2, y2] = px(along);
    const len = Math.hypot(x2 - x, y2 - y);
    const n = [-(y2 - y) / len, (x2 - x) / len];
    const pixel = (k) => img.at(Math.round(x + n[0] * k), Math.round(y + n[1] * k));
    const refs = [pixel(-REF * img.dpr), pixel(REF * img.dpr)];
    if (!refs.every((r) => r.every((c) => c > FACE))) continue;
    const strip = Array.from({ length: 2 * STRIP * img.dpr + 1 }, (_, i) => pixel(i - STRIP * img.dpr));
    let run = 0;
    let best = 0;
    for (const s of strip) {
      run = s.every((c) => c < DARK) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    kept.push({ at: [Math.round(x), Math.round(y)], client: [img.box[0] + x / img.dpr, img.box[1] + y / img.dpr], strip, run: best });
  }
  // Only probes on the canvas itself, not under the browser panel, view cube or navigation bar.
  const onCanvasToo = await page.evaluate((cs) => cs.map(([x, y]) => document.elementFromPoint(x, y)?.tagName === "CANVAS"), kept.map((k) => k.client));
  return kept.filter((_, i) => onCanvasToo[i]);
}

const segment = (a, b, n = 24) => Array.from({ length: n - 1 }, (_, i) => (i + 1) / n).map((t) => [add(a, scale(sub(b, a), t)), add(a, scale(sub(b, a), t + 0.01))]);
const sameSegment = (a, b) => (e) => e[0].every((v, i) => v === a[i]) && e[1].every((v, i) => v === b[i]);
const median = (xs) => [...xs].sort((u, v) => u - v)[Math.floor(xs.length / 2)];
const say = (r) => r.map((p) => `at ${p.at}: run ${p.run} strip ${JSON.stringify(p.strip)}`).join("\n  ");

let failed = false;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.stack ?? e}`);
  }
}

try {
  for (const [width, touch, dpr] of [[1280, false, 1], [375, true, 2]])
    await check(`every visible edge is a clear dark line ${2 * dpr} device px wide, sketch lines on edges never show through (${width} px, dpr ${dpr}${touch ? ", taps" : ""})`, async () => {
      const page = await fresh(width, touch, dpr);
      try {
        const img = await grab(page);
        assert.equal(img.dpr, dpr, "the canvas is drawn at the page's pixel ratio");
        if (shots) await page.locator("#viewport").screenshot({ path: `${shots}/edge-lines-${width}.png` });
        // Body 1's edges between two lit faces from the home view (the camera is +X, −Y, +Z of the part):
        // the front face's top edge and its right edge, the right face's top edge, and the notch's lit side
        // (20,15)→(35,40) along the top face.
        const faceToFace = [
          [[0, 0, 15], [60, 0, 15]],
          [[60, 0, 0], [60, 0, 15]],
          [[60, 0, 15], [60, 40, 15]],
          [[20, 15, 15], [35, 40, 15]],
        ];
        const body1 = [];
        for (const [a, b] of faceToFace) body1.push(...(await probe(page, img, segment(a, b), (e) => sameSegment(a, b)(e) || sameSegment(b, a)(e))));
        const ring = (y, keep) => Array.from({ length: 72 }, (_, i) => (2 * Math.PI * i) / 72).filter(keep).map((a) => [onCircle(y, a), onCircle(y, a + 0.01)]);
        const ownCircle = (y) => (e) => e[0][1] === y && e[1][1] === y && Math.hypot(e[0][0] - 30, e[0][2] - 7) > 4.99;
        const cap = await probe(page, img, ring(-15, () => true), ownCircle(-15));
        const deg3 = (3 * Math.PI) / 180;
        const seen = (a) => [a - deg3, a, a + deg3].every((b) => !cylinderHides(img.cam.position, onCircle(0, b)));
        const base = await probe(page, img, ring(0, seen), ownCircle(0));
        if (MEASURE) console.log(`body 1\n  ${say(body1)}\ncap\n  ${say(cap)}\nbase\n  ${say(base)}`);

        assert.ok(body1.length >= 20, `enough probes on Body 1's face-to-face edges (${body1.length})`);
        assert.ok(cap.length >= 5, `enough probes on the cylinder's front circle (${cap.length})`);
        assert.ok(base.length >= 5, `enough probes on the cylinder's base circle, where Sketch 2's circle lies (${base.length})`);
        for (const [what, r] of [["Body 1's edges", body1], ["the cylinder's front circle", cap], ["the cylinder's base circle (Sketch 2's circle on it)", base]]) {
          const gaps = r.filter((p) => p.run === 0);
          assert.equal(gaps.length, 0, `${what}: no dark pixel across the line at ${gaps.length} of ${r.length} probes:\n  ${say(gaps)}`);
        }
        const runs = [...body1, ...cap].map((p) => p.run);
        const m = median(runs);
        assert.ok(m >= 2 * dpr - 0.5 && m <= 2 * dpr + 1, `the edges are 2 CSS px wide: median dark run ${m} device px, want ${2 * dpr} (runs ${runs.join(" ")})`);
      } finally {
        await page.context().close();
      }
    });
} finally {
  await browser.close();
  server.httpServer.close();
}
if (errors.length) {
  console.log(`FAIL page errors:\n  ${errors.join("\n  ")}`);
  failed = true;
}
console.log(failed ? `edge-lines: FAILED (${browserName})` : `edge-lines: all passed (${browserName})`);
process.exit(failed ? 1 : 0);

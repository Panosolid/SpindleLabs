// UX1b: Extrude like Fusion, the pure parts. A typed distance read as
// signed mm; the preview's BodySpec from the 1 mm one (hand-worked on XY
// and on a back face, and against featureSpec of the extrude OK records
// for 500 seeded distances); the arrow from the preview's caps; and the
// panel in a real DOM (Flip turns the sign, ✕, Enter only when OK is on).
// The kernel's side (volumes, picks, drags, one undo step) is in
// packages/testing/journeys/extrude-preview.journey.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodySpec, BodyView, KernelCalls, Outline } from "@fission/core";
import { partDocument } from "../src/document.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { arrowOf, extrudeSketch, featureSpec, previewSpec, signedDistance } from "../src/extrude.ts";
import { extrudePanel, PICK_PROFILE } from "../src/extrude-panel.ts";

test("hand-worked: a typed distance is signed mm; 0, empty and words are none", () => {
  assert.equal(signedDistance("10"), 10);
  assert.equal(signedDistance("-4"), -4, "negative: the other way");
  assert.equal(signedDistance(" 2.5 "), 2.5);
  assert.equal(signedDistance("1e3"), 1000);
  assert.equal(signedDistance("0"), null, "0 builds nothing");
  assert.equal(signedDistance("-0"), null);
  assert.equal(signedDistance(""), null);
  assert.equal(signedDistance("  "), null);
  assert.equal(signedDistance("ten"), null);
  assert.equal(signedDistance("Infinity"), null);
});

const square: Outline = { outer: { path: { corners: [0, 0, 10, 0, 10, 10, 0, 10], bulges: [] } }, holes: [] };

test("hand-worked: the preview's spec is the 1 mm spec at |d|, flipped for a negative d, a back face's own flip turned by the sign", () => {
  // On XY (no frame): 1 mm up becomes 7 mm up, or 5 mm down (flip).
  const xy: BodySpec = { extrude: { profile: square, distance: 1 } };
  assert.deepEqual(previewSpec(xy, 7), { extrude: { profile: square, distance: 7 } });
  assert.deepEqual(previewSpec(xy, -5), { extrude: { profile: square, distance: 5, flip: true } });
  // A sketch on a bottom face: its frame's normal points into the box, so the 1 mm spec is already flipped
  // (rebuild.ts placedSpec, going out of the box). +3 keeps that; −3 goes into the box: no flip.
  const frame = { origin: [0, 0, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
  const bottom: BodySpec = { extrude: { profile: square, distance: 1, frame, flip: true } };
  assert.deepEqual(previewSpec(bottom, 3), { extrude: { profile: square, distance: 3, frame, flip: true } });
  assert.deepEqual(previewSpec(bottom, -3), { extrude: { profile: square, distance: 3, frame } });
  assert.throws(() => previewSpec({ box: { width: 1, depth: 1, height: 1 } }, 2), { message: "a preview is of an extrude of a sketch" });
});

/** A kernel that answers sketch_outline with the square, as the real one would for a 10 × 10 rectangle. */
const squareKernel: KernelCalls = {
  call: (async (op: string) => {
    if (op !== "sketch_outline") throw new Error(`unexpected kernel call ${op}`);
    return { closed: square };
  }) as KernelCalls["call"],
};

/** A small seeded generator (mulberry32), so every run draws the same cases. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("seeded: for 500 distances on XY, XZ and YZ the preview's spec is exactly featureSpec of the extrude OK records", async () => {
  const rand = seeded(26);
  for (const plane of ["XY", "XZ", "YZ"] as const) {
    const s = addSketch(partDocument("box", 10, 10, 10), plane);
    const doc = drawRectangle(s.doc, s.id, [0, 0], [10, 10]).doc;
    const one = extrudeSketch(doc, s.id, 1);
    const base = await featureSpec(squareKernel, one.doc, one.doc.timeline.features.find((f) => f.id === one.id)!);
    for (let n = 0; n < 500; n++) {
      const d = (rand() - 0.5) * 2 * 10 ** (rand() * 4 - 1); // ±0.1 mm to ±1000 mm
      if (d === 0) continue;
      const made = extrudeSketch(doc, s.id, Math.abs(d), d < 0);
      const recorded = await featureSpec(squareKernel, made.doc, made.doc.timeline.features.find((f) => f.id === made.id)!);
      assert.deepEqual(previewSpec(base, d), recorded, `${plane} at ${d} mm`);
    }
  }
});

/** A view of an extrude whose start cap's centroid is `start` and end cap's `end` (the only fields arrowOf reads). */
const capped = (start: number[], end: number[]) => ({ face_roles: [{ role: "side", boundary: 0, piece: 0 }, { role: "start" }, { role: "end" }], face_centroids: [[9, 9, 9], start, end] }) as unknown as BodyView;

test("hand-worked: the arrow runs from the start cap's centroid the way a positive distance goes", () => {
  // 5 mm up from (1, 2, 3): the end cap at (1, 2, 8), (8 − 3) / 5 = 1 along z.
  assert.deepEqual(arrowOf(capped([1, 2, 3], [1, 2, 8]), 5), { base: [1, 2, 3], direction: [0, 0, 1], distance: 5 });
  // −5: the end cap below, at (1, 2, −2); (−2 − 3) / −5 = 1: the same line, the foot at −5 on it.
  assert.deepEqual(arrowOf(capped([1, 2, 3], [1, 2, -2]), -5), { base: [1, 2, 3], direction: [0, 0, 1], distance: -5 });
  // On a slanted plane: 2 mm along (0.6, 0, 0.8) from the origin, the end cap at (1.2, 0, 1.6).
  const slanted = arrowOf(capped([0, 0, 0], [1.2, 0, 1.6]), 2)!;
  slanted.direction.forEach((v, i) => assert.ok(Math.abs(v - [0.6, 0, 0.8][i]) < 1e-15));
  // No caps (a box), or a distance of 0: no arrow.
  assert.equal(arrowOf({ face_roles: [{ role: "top" }], face_centroids: [[0, 0, 0]] } as unknown as BodyView, 5), null);
  assert.equal(arrowOf(capped([0, 0, 0], [0, 0, 0]), 0), null);
  assert.equal(arrowOf(capped([0, 0, 0], [0, 0, 0]), 5), null, "caps in one place: no direction");
});

const { Window } = await import("happy-dom");

function setup() {
  const window = new Window({ width: 1280, height: 800 });
  const doc = window.document as unknown as Document;
  const slot = doc.createElement("div");
  doc.body.append(slot);
  const heard: string[] = [];
  const panel = extrudePanel(slot, {
    distance: (t) => void heard.push(`distance ${t}`),
    flip: (t) => void heard.push(`flip ${t}`),
    clear: () => void heard.push("clear"),
    ok: (t) => void heard.push(`ok ${t}`),
    cancel: () => void heard.push("cancel"),
  });
  const $ = (id: string) => doc.getElementById(id) as HTMLElement;
  return { window, panel, heard, $ };
}

test("the panel: the profile picked or how to pick one, ✕ only with one, Flip turns the sign, typing is heard, Enter is OK only when it is on", () => {
  const { window, panel, heard, $ } = setup();
  panel.show(null, "10");
  assert.equal($("extrude-profile").textContent, PICK_PROFILE);
  assert.equal(($("extrude-clear") as HTMLButtonElement).hidden, true, "nothing to clear");
  panel.showProfile("Sketch 2");
  assert.equal($("extrude-profile").textContent, "Sketch 2");
  assert.equal(($("extrude-clear") as HTMLButtonElement).hidden, false);
  $("extrude-clear").click();
  // Flip: 10 → −10 → 10, each heard; on an empty box or 0 nothing.
  $("extrude-flip").click();
  assert.equal((($("extrude-distance")) as HTMLInputElement).value, "-10");
  $("extrude-flip").click();
  const box = $("extrude-distance") as HTMLInputElement;
  box.value = "0";
  $("extrude-flip").click();
  box.value = "";
  $("extrude-flip").click();
  box.value = "7.5";
  box.dispatchEvent(new window.Event("input") as unknown as Event);
  // Enter while OK is off (no closed outline yet) does nothing; once on it is OK with the box's text.
  const enter = () => box.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" }) as unknown as Event);
  enter();
  assert.equal(panel.ready, false);
  panel.showStatus("Sketch 2 makes a closed outline.", true);
  assert.equal(panel.ready, true);
  enter();
  panel.showDistance("12");
  assert.equal(panel.typed, "12");
  $("extrude-ok").click();
  $("extrude-cancel").click();
  assert.deepEqual(heard, ["clear", "flip -10", "flip 10", "distance 7.5", "ok 7.5", "ok 12", "cancel"]);
  panel.hide();
  assert.equal(panel.shown, false);
  assert.equal(panel.ready, false);
  assert.equal(panel.typed, "");
});

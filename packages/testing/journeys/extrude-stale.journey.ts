// Extrude hunt 2026-11-01, on the real kernel: what the Extrude panel shows
// must stay true while it is open. (1) The design changing under a chosen
// sketch (the box under a face sketch resized, so the sketch moves, or its
// projected edges change shape) builds the preview and checks the outline
// again, so OK makes the body shown. (2) A sketch whose curves are all
// projected and don't close says so in PROJECTED_OPEN's words, not "no
// lines yet". (3) A distance outside 0.001 mm..1 km is refused in the
// preview with the words OK uses, not the kernel's 330-character refusal,
// and no stale preview stays on screen. Run with `npm run journeys`.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import { addFaceSketch, addSketch, drawLine, drawnFrame, drawRectangle, facePlane, featureSpec, partDocument, PROJECTED_OPEN, type DesignDocument } from "@fission/design";
import { app, kernel } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;

const near = (got: number, want: number, what: string, eps = 1e-9) => assert.ok(Math.abs(got - want) <= eps * Math.max(1, Math.abs(want)), `${what}: ${got}, expected ${want}`);

async function openExtrude(a: App) {
  a.$("#extrude")!.click();
  await a.settle();
}

/** The distance typed, as a keystroke does; `wait` false leaves the kernel's answer still out. */
async function type(a: App, text: string, wait = true) {
  const box = a.$("#extrude-distance") as HTMLInputElement;
  box.value = text;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  if (wait) await a.settle();
}

/** A size box of the part panel set to `value` and left, as a user types and tabs out. */
async function setSize(a: App, id: "width" | "depth" | "height", value: string) {
  const box = a.$(`#${id}`) as HTMLInputElement;
  box.value = value;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  box.dispatchEvent(new a.window.Event("change", { bubbles: true }) as unknown as Event);
  await a.settle();
}

const panel = (a: App) => a.$("#extrude-panel")!;
const previewVolume = (a: App) => panel(a).dataset.previewVolume ?? "";
const status = (a: App) => a.$("#extrude-status")!.textContent ?? "";
const error = (a: App) => a.$("#extrude-error")!.textContent ?? "";

/** The z range of the preview mesh on screen. */
function previewZ(a: App): [number, number] {
  const p = a.extrudeShown()!.preview!.positions;
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < p.length; i += 3) [lo, hi] = [Math.min(lo, p[i]), Math.max(hi, p[i])];
  return [lo, hi];
}

/** The body the last feature of the document builds (built, read and freed). */
async function madeView(doc: DesignDocument): Promise<BodyView> {
  const handle = await kernel.call("body_build", await featureSpec(kernel, doc, doc.timeline.features.at(-1)!));
  try {
    return await kernel.call("body_view", handle);
  } finally {
    await kernel.call("body_free", handle);
  }
}

test("hand-worked: a face sketch's preview follows the box resized under it while Extrude is open, and OK makes that body", async () => {
  // A 10 × 10 × 10 box from the origin; Sketch 1 on its top face (z = 10), a 3 × 3 square.
  const top = addFaceSketch(partDocument("box", 10, 10, 10), { plane: facePlane("feature-1", "top"), feature: "feature-1" }, drawnFrame([0, 0, 1], [5, 5, 10]));
  const a = await app(drawRectangle(top.doc, top.id, [1, 1], [4, 4]).doc);
  await openExtrude(a);
  await type(a, "5");
  // 5 mm up from the top face: z 10..15, 3 · 3 · 5 = 45 mm³.
  assert.deepEqual(previewZ(a), [10, 15]);
  near(Number(previewVolume(a)), 45, "before");
  await setSize(a, "height", "20");
  assert.ok(a.extrudeShown(), "Extrude stays open");
  // The box now 20 tall: its top at z = 20, the sketch on it, so 5 mm up spans z 20..25 (still 45 mm³), and the arrow
  // stands on the square's centre (2.5, 2.5) at z = 20.
  assert.deepEqual(previewZ(a), [20, 25], "the preview follows the face");
  assert.deepEqual(a.extrudeShown()!.arrow, { base: [2.5, 2.5, 20], direction: [0, 0, 1], distance: 5 });
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  const made = await madeView(a.doc());
  assert.deepEqual([made.bounds[0][2], made.bounds[1][2]], [20, 25], "OK makes the body the preview showed");
  near(made.volume, 45, "made");
  assert.ok(await a.close());
});

test("hand-worked: a sketch of a face's projected edges is previewed at the face's new size when the box grows while Extrude is open", async () => {
  // The top face of a 10 × 10 × 10 box extruded once (its sketch holds the face's four edges projected), then that
  // extrude taken out again, so the box is the part and Sketch 1 is a sketch of projected edges only.
  const first = await app(partDocument("box", 10, 10, 10));
  await openExtrude(first);
  const face = first.extrudeShown()!.profiles.find((p) => p.face && Math.abs(p.plane.normal[2]) > 0.9 && p.plane.origin[2] > 5)!;
  await first.extrudePointer({ kind: "pick", profile: face.id });
  await type(first, "5");
  (first.$("#extrude-ok") as HTMLButtonElement).click();
  await first.settle();
  const recorded = first.doc();
  assert.ok(await first.close());
  const sketch = recorded.sketches.at(-1)!.id;
  const doc: DesignDocument = { ...recorded, timeline: { ...recorded.timeline, features: recorded.timeline.features.filter((f) => f.intent.type !== "extrude") } };
  assert.ok((doc.sketches.at(-1)!.projected ?? []).length === 4, "four projected edges");
  const a = await app(doc);
  await openExtrude(a);
  assert.equal(a.extrudeShown()!.chosen, sketch);
  await type(a, "3");
  // The 10 × 10 face by 3 mm: 300 mm³.
  near(Number(previewVolume(a)), 300, "before");
  await setSize(a, "width", "30");
  // The face now 30 × 10, its projected edges with it: 30 · 10 · 3 = 900 mm³, from z = 10 to 13.
  near(Number(previewVolume(a)), 900, "the preview follows the projected edges");
  assert.deepEqual(previewZ(a), [10, 13]);
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  near((await madeView(a.doc())).volume, 900, "made");
  assert.ok(await a.close());
});

test("a sketch whose curves are all projected and don't close says why in PROJECTED_OPEN's words", async () => {
  // One line, marked as a projected edge: it joins nothing, so the outline leaves it out and nothing is left.
  const s = addSketch(partDocument("box", 10, 10, 10));
  const d = drawLine(s.doc, s.id, [0, 0], [10, 0]);
  const doc: DesignDocument = { ...d.doc, sketches: d.doc.sketches.map((k) => (k.id === s.id ? { ...k, projected: [{ id: "projection-99", feature: "feature-1", edge: "top/front", made: d.id }] } : k)) };
  const a = await app(doc);
  await openExtrude(a);
  assert.equal(status(a), `Sketch 1 can't be extruded: ${PROJECTED_OPEN}.`);
  assert.equal((a.$("#extrude-ok") as HTMLButtonElement).disabled, true);
  assert.ok(await a.close());
});

test("a distance under 0.001 mm or over 1 km is refused in the preview in OK's words, with no preview left on screen", async () => {
  const s = addSketch(partDocument("box", 10, 10, 10));
  const a = await app(drawRectangle(s.doc, s.id, [20, 0], [30, 10]).doc);
  await openExtrude(a);
  const tooSmall = "The distance must be at least 0.001 mm, the smallest piece the modeller keeps.";
  const tooBig = "The distance can be at most 1000000 mm (1 km), the largest size the modeller works at.";
  for (const [typed, words] of [["1e-320", tooSmall], ["0.0009", tooSmall], ["-0.0009", tooSmall], ["1000001", tooBig], ["-1e7", tooBig]] as const) {
    await type(a, typed);
    assert.equal(error(a), words, typed);
    assert.equal(previewVolume(a), "", `${typed}: no preview`);
  }
  // At the edges: 0.0011 (1.1 × the smallest) builds, 10 × 10 × 0.0011 = 0.11 mm³; 1000000 builds, 10⁸ mm³.
  await type(a, "0.0011");
  assert.equal(error(a), "");
  near(Number(previewVolume(a)), 0.11, "0.0011 mm", 1e-6);
  await type(a, "1000000");
  near(Number(previewVolume(a)), 1e8, "1 km", 1e-6);
  // A good distance still building when a refused one is typed: the good one's preview never shows under the words.
  await type(a, "5", false);
  await type(a, "1e-320");
  assert.equal(error(a), tooSmall);
  assert.equal(previewVolume(a), "", "no stale preview");
  assert.equal(a.extrudeShown()!.preview, null);
  assert.ok(await a.close());
});

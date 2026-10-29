// UX1b on the real kernel: Extrude like Fusion. The Design app offers every
// usable sketch's closed outline in the view, a click on one (or its row in
// the browser) chooses it, the extrude is previewed as OK would make it,
// and the distance follows the box typed or the arrow dragged (whole mm,
// negative the other way); OK or Enter records one undo step whose body is
// the preview's, Escape, Cancel or ✕ leave nothing behind (no body kept in
// the kernel, no step). Hand-worked volumes and arrows first, then seeded
// sessions of picks, drags and typing checked against the body OK makes.
// Run with `npm run journeys` after the app build.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView, KernelCalls } from "@fission/core";
import { addSketch, drawCircle, drawLine, drawRectangle, featureSpec, NO_USABLE_SKETCH, partDocument, PICK_PROFILE_STATUS, suppressItem, ZERO_OK, type DesignDocument } from "@fission/design";
import { nodeKernel } from "../src/node-kernel.ts";
import { seeded } from "../src/index.ts";
import { app } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;
const kernel: KernelCalls = nodeKernel();

const near = (got: number, want: number, what: string, eps = 1e-9) => assert.ok(Math.abs(got - want) <= eps * Math.max(1, Math.abs(want)), `${what}: ${got}, expected ${want}`);

/** A box, then Sketch 1 (sketch-2): a 40 × 30 rectangle from the origin; then Sketch 2 (sketch-?) a circle of radius 5 round (70, 15). */
function twoSketches(): DesignDocument {
  const s1 = addSketch(partDocument("box", 10, 10, 10));
  const doc = drawRectangle(s1.doc, s1.id, [0, 0], [40, 30]).doc;
  const s2 = addSketch(doc);
  return drawCircle(s2.doc, s2.id, [70, 15], 5).doc;
}

/** Extrude from the toolbar. */
async function openExtrude(a: App) {
  a.$("#extrude")!.click();
  await a.settle();
}

/** The distance typed into the box, as a keystroke does (an input event each time). */
async function type(a: App, text: string) {
  const box = a.$("#extrude-distance") as HTMLInputElement;
  box.value = text;
  box.dispatchEvent(new a.window.Event("input", { bubbles: true }) as unknown as Event);
  await a.settle();
}

const panel = (a: App) => a.$("#extrude-panel")!;
const shown = (a: App) => a.extrudeShown();
/** The sketches' outlines offered (the box's flat faces are offered after them since UX1c: face-extrude.journey.ts). */
const sketchOffers = (a: App) => shown(a)!.profiles.filter((p) => !p.face);
const previewVolume = (a: App) => Number(panel(a).dataset.previewVolume);

/** The body the last feature of the document builds, as the kernel views it (built, read and freed). */
async function madeView(doc: DesignDocument): Promise<BodyView> {
  const f = doc.timeline.features.at(-1)!;
  const handle = await kernel.call("body_build", await featureSpec(kernel, doc, f));
  try {
    return await kernel.call("body_view", handle);
  } finally {
    await kernel.call("body_free", handle);
  }
}

test("hand-worked: the newest sketch is chosen, both closed outlines offered, and the preview and arrow follow the typed distance", async () => {
  const a = await app(twoSketches());
  await openExtrude(a);
  const sketches = a.doc().sketches.map((s) => s.id);
  assert.deepEqual(sketchOffers(a).map((p) => p.id), sketches, "both sketches close, so both are offered in the view");
  // The newest, Sketch 2, at 0 mm (Ben, 2026-10-28: Extrude starts at 0): nothing previewed, the box says 0, and the
  // arrow already stands on the circle's centre, pointing up, its foot on the plane (0 along it), ready to drag.
  assert.equal(shown(a)!.chosen, sketches[1]);
  assert.equal(a.$("#extrude-profile")!.textContent, "Sketch 2");
  assert.equal((a.$("#extrude-distance") as HTMLInputElement).value, "0");
  assert.equal(shown(a)!.preview, null, "0 mm previews nothing");
  assert.deepEqual(shown(a)!.arrow, { base: [70, 15, 0], direction: [0, 0, 1], distance: 0 });
  // Typed 10: a circle of radius 5 by 10 mm, π · 25 · 10 = 785.398 mm³.
  await type(a, "10");
  near(previewVolume(a), Math.PI * 250, "the circle's preview");
  // The arrow: from the circle's centre on XY, straight up, its foot at the end cap.
  assert.deepEqual(shown(a)!.arrow, { base: [70, 15, 0], direction: [0, 0, 1], distance: 10 });
  // Typed 25: 25 · 25π = 1963.50 mm³, the arrow 25 up.
  await type(a, "25");
  near(previewVolume(a), Math.PI * 625, "at 25 mm");
  assert.equal(shown(a)!.arrow!.distance, 25);
  // Typed −4: the other way, 4 · 25π, the arrow's line the same (its foot at z = −4).
  await type(a, "-4");
  near(previewVolume(a), Math.PI * 100, "at −4 mm");
  assert.deepEqual(shown(a)!.arrow, { base: [70, 15, 0], direction: [0, 0, 1], distance: -4 });
  // Nothing is recorded by previewing, and the kernel keeps no preview body.
  assert.equal(a.history.undoLabel(), null);
  assert.equal(a.doc().timeline.features.length, 3);
  assert.ok(await a.close());
});

test("hand-worked: a click on the other outline chooses it; one on none keeps the choice; the arrow drag snaps to whole mm and flips below the plane", async () => {
  const a = await app(twoSketches());
  await openExtrude(a);
  const [first] = a.doc().sketches.map((s) => s.id);
  await a.extrudePointer({ kind: "pick", profile: first });
  assert.equal(shown(a)!.chosen, first);
  assert.equal(a.$("#extrude-profile")!.textContent, "Sketch 1");
  await type(a, "10");
  // 40 · 30 · 10 = 12,000 mm³; the arrow from the rectangle's centroid (20, 15, 0).
  near(previewVolume(a), 12000, "the rectangle's preview");
  assert.deepEqual(shown(a)!.arrow, { base: [20, 15, 0], direction: [0, 0, 1], distance: 10 });
  await a.extrudePointer({ kind: "pick", profile: null });
  assert.equal(shown(a)!.chosen, first, "a click on empty space keeps the outline chosen");
  // Dragged to 17.4 mm: 17 mm, the box says so, 1200 · 17 = 20,400 mm³.
  await a.extrudePointer({ kind: "drag", distance: 17.4, done: false });
  assert.equal((a.$("#extrude-distance") as HTMLInputElement).value, "17");
  near(previewVolume(a), 20400, "dragged to 17");
  // Dragged below the plane, −0.3 mm: −1, a 1 mm slab under it.
  await a.extrudePointer({ kind: "drag", distance: -0.3, done: true });
  assert.equal((a.$("#extrude-distance") as HTMLInputElement).value, "-1");
  near(previewVolume(a), 1200, "dragged to −1");
  assert.equal(shown(a)!.arrow!.distance, -1);
  // OK: the body made is the preview, under the plane: z from −1 to 0; one undo step.
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(shown(a), null, "the view's outlines, preview and arrow are gone");
  const made = await madeView(a.doc());
  near(made.volume, 1200, "the made body");
  assert.deepEqual(made.bounds, [[0, 0, -1], [40, 30, 0]]);
  assert.equal(a.history.undoLabel(), "Extrude Sketch 1");
  await a.undo();
  assert.equal(a.doc().timeline.features.length, 3, "one undo takes the extrude away");
  assert.ok(await a.close());
});

test("Escape, Cancel and ✕ leave nothing behind; a 0 or empty box shows no preview and OK says why", async () => {
  const a = await app(twoSketches());
  const before = a.doc();
  await openExtrude(a);
  await type(a, "12");
  await a.key("clear-selection"); // Escape
  assert.equal(shown(a), null);
  assert.equal(a.$("#extrude-panel")!.hidden, true);
  assert.equal(a.doc(), before, "nothing changed");
  await openExtrude(a);
  (a.$("#extrude-cancel") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(shown(a), null);
  await openExtrude(a);
  (a.$("#extrude-clear") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(shown(a)!.chosen, null);
  assert.equal(shown(a)!.preview, null);
  assert.equal(a.$("#extrude-profile")!.textContent, "Click a closed sketch or a flat face in the view");
  assert.equal(a.$("#extrude-status")!.textContent, PICK_PROFILE_STATUS);
  assert.equal((a.$("#extrude-ok") as HTMLButtonElement).disabled, true);
  await a.extrudePointer({ kind: "pick", profile: a.doc().sketches[0].id });
  assert.equal(shown(a)!.preview, null, "Extrude starts at 0 mm: nothing previewed");
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(a.$("#extrude-error")!.textContent, ZERO_OK, "OK at the start says what to do");
  assert.equal(a.history.undoLabel(), null, "and records nothing");
  await type(a, "10");
  assert.notEqual(shown(a)!.preview, null);
  await type(a, "0");
  assert.equal(shown(a)!.preview, null, "0 builds nothing");
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  assert.equal(a.$("#extrude-error")!.textContent, ZERO_OK);
  await type(a, "");
  assert.equal(shown(a)!.preview, null);
  await a.key("clear-selection");
  assert.equal(a.doc(), before);
  assert.equal(a.history.undoLabel(), null, "no undo step");
  assert.equal(await a.bodies(), 1, "only the box is kept in the kernel: every preview was freed");
  assert.ok(await a.close());
});

test("Enter (the panel's OK from anywhere) makes it; a too long distance shows the kernel's refusal and no preview", async () => {
  const a = await app(twoSketches());
  await openExtrude(a);
  await type(a, "2000000"); // 2 km: past the kernel's 1 km
  assert.equal(shown(a)!.preview, null);
  assert.match(a.$("#extrude-error")!.textContent!, /distance/);
  await type(a, "3");
  assert.equal(a.$("#extrude-error")!.hidden, true);
  await a.key("extrude-ok");
  assert.equal(a.history.undoLabel(), "Extrude Sketch 2");
  near((await madeView(a.doc())).volume, Math.PI * 75, "3 · 25π");
  assert.ok(await a.close());
});

test("a sketch's row in the browser chooses it, as a click on its outline does; a suppressed sketch is neither offered nor chosen", async () => {
  const a = await app(twoSketches());
  const [first, second] = a.doc().sketches.map((s) => s.id);
  await openExtrude(a);
  const row = [...a.window.document.querySelectorAll<HTMLElement>(".tree-row")].find((r) => r.dataset.node === `sketches/${first}`)!;
  row.click();
  await a.settle();
  assert.equal(shown(a)!.chosen, first);
  await a.key("clear-selection");
  // Sketch 2 suppressed: only Sketch 1 is offered, and a pick of Sketch 2 (a stale click) is refused.
  const b = await app(suppressItem(twoSketches(), second, true));
  await openExtrude(b);
  assert.deepEqual(sketchOffers(b).map((p) => p.id), [first]);
  assert.equal(shown(b)!.chosen, first);
  await b.extrudePointer({ kind: "pick", profile: second });
  assert.equal(shown(b)!.chosen, first);
  assert.ok(await b.close());
  // Every sketch unusable: the panel says why, nothing is offered.
  const c = await app(suppressItem(suppressItem(twoSketches(), second, true), first, true));
  await openExtrude(c);
  assert.deepEqual(sketchOffers(c), []);
  assert.equal(c.$("#extrude-status")!.textContent, NO_USABLE_SKETCH);
  assert.ok(await c.close());
});

test("an open sketch chosen: no preview however the distance is typed, no error over the kernel's reason, and it is not offered in the view", async () => {
  // Sketch 3: two lines of a rectangle's corner, open.
  const s3 = addSketch(twoSketches());
  const doc = drawLine(drawLine(s3.doc, s3.id, [0, 50], [10, 50]).doc, s3.id, [10, 50], [10, 60]).doc;
  const a = await app(doc);
  await openExtrude(a);
  assert.equal(shown(a)!.chosen, s3.id, "the newest is chosen, open or not");
  assert.deepEqual(sketchOffers(a).map((p) => p.id), a.doc().sketches.slice(0, 2).map((s) => s.id), "only the two closed ones are offered");
  assert.match(a.$("#extrude-status")!.textContent!, /^Sketch 3 can't be extruded: it doesn't make one closed outline/);
  await type(a, "5");
  assert.equal(shown(a)!.preview, null);
  assert.equal(shown(a)!.arrow, null);
  assert.equal(a.$("#extrude-error")!.hidden, true, "the status already says why");
  assert.equal((a.$("#extrude-ok") as HTMLButtonElement).disabled, true);
  // A click on a closed one: its preview at the 5 mm typed, 1200 · 5 = 6,000 mm³.
  await a.extrudePointer({ kind: "pick", profile: a.doc().sketches[0].id });
  near(previewVolume(a), 6000, "the rectangle at 5 mm");
  assert.ok(await a.close());
});

test("a sketch on the box's bottom face: the arrow points down, out of the box, and the preview is the body OK makes", async () => {
  const a = await app(partDocument("box", 40, 30, 20));
  a.$("#create-sketch")!.click();
  await a.settle();
  const mesh = a.mesh()!;
  // The bottom face: every one of its points at z = 0.
  const faces = new Map<number, boolean>();
  mesh.triangle_faces.forEach((f, t) => faces.set(f, (faces.get(f) ?? true) && [0, 1, 2].every((k) => mesh.positions[3 * mesh.indices[3 * t + k] + 2] === 0)));
  const bottom = [...faces].find(([, ok]) => ok)![0];
  await a.pick({ face: bottom });
  // A 10 × 10 square on it, the line tool's clicks in the sketch's own frame.
  for (const [x, y] of [[5, 5], [15, 5], [15, 15], [5, 15], [5.3, 4.8]]) await a.click(x, y);
  a.$("#sketch-extrude")!.click();
  await a.settle();
  const arrow = shown(a)!.arrow!;
  assert.deepEqual(arrow.direction.map((v) => v + 0), [0, 0, -1], "a sketch on the bottom faces down");
  assert.equal(arrow.base[2], 0);
  assert.equal(arrow.distance, 0, "standing on the face at 0 mm, where Extrude starts");
  await type(a, "10");
  near(previewVolume(a), 1000, "10 · 10 · 10");
  const preview = shown(a)!.preview!;
  const zs = Array.from({ length: preview.positions.length / 3 }, (_, i) => preview.positions[3 * i + 2]);
  assert.deepEqual([Math.min(...zs), Math.max(...zs)], [-10, 0], "below the box");
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
  const made = await madeView(a.doc());
  assert.equal(made.bounds[0][2], -10);
  assert.equal(made.bounds[1][2], 0);
  assert.ok(await a.close());
});

test("seeded: 5 seeds × 30 sessions of picks, drags and typing: the body OK makes is exactly the last preview, and nothing else is kept", async () => {
  for (const seed of [1n, 2n, 3n, 4n, 5n]) {
    const r = seeded(seed);
    for (let n = 0; n < 30; n++) {
      // A box, then two to four sketches: rectangles and circles at random places on XY.
      let doc = partDocument("box", 10, 10, 10);
      const count = 2 + Math.floor(r.next() * 3);
      for (let k = 0; k < count; k++) {
        const s = addSketch(doc);
        const x = 20 + 60 * k, y = Math.round(r.next() * 40);
        doc = r.next() < 0.5 ? drawRectangle(s.doc, s.id, [x, y], [x + 1 + Math.round(r.next() * 30), y + 1 + Math.round(r.next() * 30)]).doc : drawCircle(s.doc, s.id, [x, y], 1 + Math.round(r.next() * 15)).doc;
      }
      const a = await app(doc);
      await openExtrude(a);
      const ids = a.doc().sketches.map((s) => s.id);
      const done: string[] = [];
      for (let step = 0; step < 6; step++) {
        const roll = r.next();
        if (roll < 0.35) {
          const id = ids[Math.floor(r.next() * ids.length)];
          await a.extrudePointer({ kind: "pick", profile: id });
          done.push(`pick ${id}`);
        } else if (roll < 0.7) {
          const d = (r.next() - 0.3) * 80;
          await a.extrudePointer({ kind: "drag", distance: d, done: r.next() < 0.5 });
          done.push(`drag ${d}`);
        } else {
          const d = String(Math.round((r.next() - 0.3) * 400) / 10 || 1);
          await type(a, d);
          done.push(`type ${d}`);
        }
      }
      const what = `seed ${seed} session ${n}: ${done.join(", ")}`;
      const typed = Number((a.$("#extrude-distance") as HTMLInputElement).value);
      const previewed = previewVolume(a);
      const show = shown(a)!;
      assert.equal(show.arrow!.distance, typed, `${what}: the arrow is at the box's distance`);
      (a.$("#extrude-ok") as HTMLButtonElement).click();
      await a.settle();
      const made = await madeView(a.doc());
      assert.equal(made.volume, previewed, `${what}: OK made the body previewed`);
      // Its end cap where the arrow's foot was.
      const end = made.face_roles.findIndex((role) => role?.role === "end");
      const foot = show.arrow!.base.map((b, i) => b + show.arrow!.distance * show.arrow!.direction[i]);
      made.face_centroids[end].forEach((c, i) => near(c, foot[i], `${what}: end cap centroid ${i}`, 1e-9));
      assert.equal(a.history.undoLabel()?.startsWith("Extrude Sketch"), true, what);
      assert.equal(await a.bodies(), 2, `${what}: the box and the extrude are kept, no preview`);
      assert.ok(await a.close(), what);
    }
  }
});

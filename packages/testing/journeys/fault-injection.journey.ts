// Journey: frontier testing T6b (docs/progress/frontier-testing.md), fault
// injection in the app, as T6a does in the kernel:
// each user action below runs once cleanly, counting the kernel calls it
// makes (C), then C times more on a fresh app, the nth call failing once
// as an internal kernel error (design-app.ts, `failCall`), so every call
// an action makes fails once. After each, against rules written here:
//   - nothing thrown and no promise left rejected unhandled;
//   - the file reads back the same;
//   - the edit happened as it does cleanly or not at all: the file is the
//     one before, or settling it from the one before (`settleKept`, as
//     the next edit does) gives the clean file;
//   - nothing sticks: after an edit made with the kernel well again
//     (suppress then unsuppress the last item, two rebuilds on the same
//     bodies), the file is the clean path's (or, the action not taken,
//     the one before's) after the same edit, settled, and the view shows
//     what a fresh app opened on that file shows (volume, error, kept
//     warning, sketches drawn);
//   - every body is freed when Design is put away.
// The start: a 40 × 30 × 20 box with Sketch 1 on its top, a circle of
// radius 5 at (20, 15) extruded 10 (face-sketch.test.ts, `onTop`).
// Checked by undoing each fix it led to, one at a time (T6b, 2026-10-26):
// a failed view remembered, a failed free thrown, a failed sketch read as
// lying nowhere, a settle's own cache or placementOf's left open, the
// preview freed directly and a closed cache trying a failed free only once
// were each caught here; a delete settling on its own cache is caught only
// with its own cache also left open (the delete reuses the app's bodies to
// ask the kernel less, and is safe either way).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, KernelError, projectFromJson, projectToJson, type KernelCalls, type SketchDrawing } from "@fission/core";
import { addFaceSketch, deleteItem, designWorkspace, drawCircle, drawnFrame, extrudeSketch, partDocument, readDesignDocument, settleKept, type DesignDocument } from "@fission/design";
import { app, chooseShape, close, kernel } from "./design-app.ts";

type App = Awaited<ReturnType<typeof app>>;

const DESIGN = [{ id: "design" as const, readData: readDesignDocument }];
const reopened = (d: DesignDocument) => projectFromJson(projectToJson({ ...emptyProject("Faults"), workspaces: { design: d } }), DESIGN).workspaces.design as DesignDocument;
/** JSON with every object's keys sorted: the file writer sorts them, so their order is no change. */
const canonical = (v: unknown): string => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** The box (feature-1) with Sketch 1 (sketch-2) on its top, its circle extruded 10 (feature-5). */
function start(): DesignDocument {
  const s = addFaceSketch(partDocument("box", 40, 30, 20), { plane: "face:feature-1/top", feature: "feature-1" }, drawnFrame([0, 0, 1], [20, 15, 20]));
  return extrudeSketch(drawCircle(s.doc, s.id, [20, 15], 5).doc, s.id, 10).doc;
}

/** Edit feature on `id`: each size box given typed. */
async function editFeature(a: App, id: string, sizes: Record<string, number>) {
  await a.menu(id, "edit");
  for (const [key, value] of Object.entries(sizes)) (a.$(`#edit-${key}`) as HTMLInputElement).value = String(value);
  a.$("#feature-edit-ok")!.click();
  await a.settle();
  if (!a.$("#feature-edit")!.hidden) {
    a.$("#feature-edit-cancel")!.click();
    await a.settle();
  }
}

/** An action: what it does with the kernel failing, after `setup` done with it well (none: from the start). */
interface Action {
  setup?: (a: App) => Promise<void>;
  /** A step that changes nothing in the file (a rectangle's first corner): checked to change nothing cleanly too. */
  same?: true;
  act: (a: App) => Promise<void>;
}

/** The actions, each from the start (and its setup). */
const ACTIONS: Record<string, Action["act"] | Action> = {
  // The box taller: the sketch's face moves up, the extrude on it with it.
  "edit the box": (a) => editFeature(a, "feature-1", { height: 25 }),
  // The part a sphere: the top face is gone, so the sketch holds where it was and the extrude builds there.
  "the part a sphere": async (a) => {
    chooseShape(a, "Sphere");
    await a.settle();
  },
  // The sketch deleted: the extrude keeps its last shape (asked first, Delete).
  "the sketch deleted": async (a) => {
    await a.menu("sketch-2", "delete");
    if ((a.$("#delete-ask") as HTMLDialogElement | null)?.open) {
      a.$("#delete-ask-confirm")!.click();
      await a.settle();
    }
  },
  // A rectangle drawn on the face sketch around the circle: Edit Sketch, two clicks, Finish.
  "a rectangle drawn on the face": async (a) => {
    await a.menu("sketch-2", "edit-sketch");
    await a.key("sketch-rectangle");
    await a.click(5, 5);
    await a.click(35, 25);
    await a.finish();
  },
  // The extrude suppressed.
  "the extrude suppressed": async (a) => void (await a.menu("feature-5", "suppress")),
  // A user's steps one at a time, each the action after the ones before it (a step that fails is the user's to take
  // again; the rule is for one step): Create sketch on the first face offered, a rectangle drawn there, extruded 5.
  // (Picking the face asks the kernel nothing.)
  "a rectangle's first corner on the face": { setup: (a) => onFace(a, 0), act: (a) => a.click(-5, -5), same: true },
  "a rectangle's last corner on the face": { setup: (a) => onFace(a, 1), act: (a) => a.click(5, 5) },
  "Extrude chosen on the face sketch": { setup: (a) => onFace(a, 2), act: extrudeChosen, same: true },
  "Extrude's OK on the face sketch": { setup: (a) => onFace(a, 3), act: extrudeOk },
  // The box made taller, then Undo: the shell mounts Design afresh on the file before.
  "Undo of a box edit": { setup: (a) => editFeature(a, "feature-1", { height: 25 }), act: async (a) => void (await a.undo()) },
  // Undo then Redo of it: Redo is the one failing.
  "Redo of a box edit": {
    setup: async (a) => {
      await editFeature(a, "feature-1", { height: 25 });
      await a.undo();
    },
    act: async (a) => void (await a.redo()),
  },
  // The extrude's distance edited (Edit feature on an extrude of a face sketch).
  "the extrude's distance edited": (a) => editFeature(a, "feature-5", { height: 4 }),
};

async function createSketch(a: App) {
  a.$("#create-sketch")!.click();
  await a.settle();
}

/** Create sketch on the first face offered and the rectangle tool, then the first `steps` of: its two corners, Extrude chosen with 5 typed. */
async function onFace(a: App, steps: number) {
  await createSketch(a);
  await a.pick({ face: a.planes().faces[0] });
  await a.key("sketch-rectangle");
  if (steps > 0) await a.click(-5, -5);
  if (steps > 1) await a.click(5, 5);
  if (steps > 2) await extrudeChosen(a);
}

async function extrudeChosen(a: App) {
  await a.key("clear-selection");
  a.$("#sketch-extrude")!.click();
  await a.settle();
  (a.$("#extrude-distance") as HTMLInputElement).value = "5";
}

async function extrudeOk(a: App) {
  (a.$("#extrude-ok") as HTMLButtonElement).click();
  await a.settle();
}

const actionOf = (x: Action["act"] | Action): Action => (typeof x === "function" ? { act: x } : x);

/** The edit made with the kernel well again: the last item suppressed and on again, or the other way when it is off (two rebuilds on the same bodies). */
async function again(a: App) {
  const off = a.doc().timeline.features.find((f) => f.id === "feature-5")?.suppressed === true;
  await a.menu("feature-5", off ? "unsuppress" : "suppress");
  await a.menu("feature-5", off ? "suppress" : "unsuppress");
}

/** What the view shows, for comparing with a fresh app's. */
const viewOf = (a: App) => ({ volume: a.volume(), error: a.error() ?? "", warning: a.warning(), drawn: canonical(a.drawings().map((d: SketchDrawing) => ({ plane: d.plane, side: d.side ?? 1, lost: d.lost === true, lines: d.lines }))) });

function sameView(got: ReturnType<typeof viewOf>, want: ReturnType<typeof viewOf>): string | null {
  if (!close(got.volume, want.volume)) return `volume ${got.volume}, a fresh app shows ${want.volume}`;
  if (got.error !== want.error) return `error ${JSON.stringify(got.error)}, a fresh app shows ${JSON.stringify(want.error)}`;
  if (got.warning !== want.warning) return `warning ${JSON.stringify(got.warning)}, a fresh app shows ${JSON.stringify(want.warning)}`;
  if (got.drawn !== want.drawn) return `sketches drawn ${got.drawn.slice(0, 300)}, a fresh app draws ${want.drawn.slice(0, 300)}`;
  return null;
}

/** The clean path of an action: its kernel calls, the file after it, and the files after `again` from it and from the start. */
async function cleanPath(action: Action) {
  const a = await app(start());
  await action.setup?.(a);
  const before = a.doc();
  a.failCall(0);
  await action.act(a);
  if (action.same) assert.equal(canonical(a.doc()), canonical(before), "the step changes nothing in the file");
  else assert.notEqual(canonical(a.doc()), canonical(before), "the action changes the file");
  const calls = a.calls().made;
  const after = a.doc();
  await again(a);
  const afterAgain = a.doc();
  assert.ok(await a.close(), "the clean path frees every body");
  const b = await app(start());
  await action.setup?.(b);
  await again(b);
  const untouchedAgain = b.doc();
  assert.ok(await b.close());
  return { calls, after, afterAgain, untouchedAgain };
}

type Clean = Awaited<ReturnType<typeof cleanPath>>;

/** One faulted run: the action with its nth kernel call failing, checked by the rules above. Null when they held, else what failed. */
async function faulted(name: string, action: Action, clean: Clean, n: number, plugin = designWorkspace): Promise<string | null> {
  const errors: string[] = [];
  const onRejection = (e: unknown) => errors.push(`unhandled: ${(e as Error)?.stack ?? e}`);
  process.on("unhandledRejection", onRejection);
  const a = await app(start(), plugin);
  a.window.addEventListener("error", ((e: ErrorEvent) => errors.push(String(e.error?.stack ?? e.message))) as never);
  let closed = false;
  let op: string | null = null;
  const fail = (what: string) => `${name}, kernel call ${n} failing (${op}): ${what}`;
  try {
    await action.setup?.(a);
    const before = a.doc();
    a.failCall(n);
    await action.act(a);
    op = a.calls().failed;
    a.failCall(0);
    if (op === null) return fail(`call ${n} was never made (the clean path made ${clean.calls})`);
    await a.settle();
    if (errors.length) return fail(`thrown: ${errors.join(" | ")}`);
    const doc = a.doc();
    if (canonical(reopened(doc)) !== canonical(doc)) return fail("the file reads back differently");
    const taken = canonical(doc) !== canonical(before);
    if (taken) {
      const settled = await settleKept(kernel, before, doc);
      if (canonical(settled) !== canonical(clean.after)) return fail(`the file is neither the one before nor, settled, the clean one:\n  ${canonical(settled).slice(0, 600)}\n  clean: ${canonical(clean.after).slice(0, 600)}`);
    }
    await again(a);
    if (errors.length) return fail(`thrown after the kernel was well again: ${errors.join(" | ")}`);
    const end = a.doc();
    const want = taken ? clean.afterAgain : clean.untouchedAgain;
    if (canonical(end) !== canonical(want)) return fail(`after an edit with the kernel well again the file is not the clean path's (action ${taken ? "taken" : "not taken"}):\n  ${canonical(end).slice(0, 600)}\n  clean: ${canonical(want).slice(0, 600)}`);
    const view = viewOf(a);
    const fresh = await app(end, plugin);
    const want2 = viewOf(fresh);
    const freed = await fresh.close();
    if (!freed) return fail("a fresh app on the file didn't free its bodies");
    const differs = sameView(view, want2);
    if (differs) return fail(`a failure stuck: after an edit with the kernel well again, ${differs}`);
    closed = true;
    if (!(await a.close())) return fail("a body was not freed when Design was put away");
    if (errors.length) return fail(`thrown: ${errors.join(" | ")}`);
    return null;
  } catch (e) {
    return fail((e as Error).stack ?? String(e));
  } finally {
    process.off("unhandledRejection", onRejection);
    if (!closed) await a.close();
  }
}

for (const [name, x] of Object.entries(ACTIONS)) {
  const action = actionOf(x);
  test(`fault injection: ${name}, every kernel call failing once in turn`, async () => {
    const clean = await cleanPath(action);
    assert.ok(clean.calls > 0, "the action asks the kernel something");
    const failures: string[] = [];
    for (let n = 1; n <= clean.calls; n++) {
      const r = await faulted(name, action, clean, n);
      if (r) failures.push(r);
    }
    console.log(`${name}: ${clean.calls} kernel calls, each failed once: ${failures.length} failures`);
    assert.deepEqual(failures, []);
  });
}

test("regression: a face sketch deleted while its face's view fails once is refused, never kept off its face", async () => {
  // Found by the run above ("the sketch deleted", call 3, body_view): the settle read the failed sketch as lying
  // nowhere and kept Extrude 1's circle with no placement, so it was built on XY (z 0 to 10) instead of on the box's
  // top (z 20 to 30), for good. Now the settle fails with the kernel's words and nothing is recorded.
  const doc = start();
  let views = 0;
  const failing: KernelCalls = {
    call: ((op: string, ...args: unknown[]) => {
      if (op === "body_view" && ++views === 1) return Promise.reject(new KernelError({ kind: "internal", inputs: [], message: "injected kernel failure (body_view)" }));
      return (kernel.call as (op: string, ...a: unknown[]) => Promise<unknown>)(op, ...args);
    }) as KernelCalls["call"],
  };
  await assert.rejects(settleKept(failing, doc, deleteItem(doc, "sketch-2")), /injected kernel failure \(body_view\)/);
  // With the kernel well, the kept shape lies on the top: origin (0, 0, 20), normal +z (worked out from the box's height 20).
  const settled = await settleKept(kernel, doc, deleteItem(doc, "sketch-2"));
  assert.deepEqual(settled.kept?.["feature-5"]?.placement, { plane: { origin: [0, 0, 20], xAxis: [1, 0, 0], normal: [0, 0, 1] }, side: 1 });
});

test("regression: a settle on a cache of its own frees every body even when a free fails once", async () => {
  // Found by the run above before deletes settled on the app's cache ("the sketch deleted", call 4, body_free): a
  // settle given no cache built on one of its own, and a body whose free failed was left on it for a next use that
  // never came, so the kernel held it for good. Its own cache is now closed after, which tries such a free again.
  const doc = start();
  const held = (await kernel.call("body_count")) as number;
  let frees = 0;
  const failing: KernelCalls = {
    call: ((op: string, ...args: unknown[]) => {
      if (op === "body_free" && ++frees === 1) return Promise.reject(new KernelError({ kind: "internal", inputs: [], message: "injected kernel failure (body_free)" }));
      return (kernel.call as (op: string, ...a: unknown[]) => Promise<unknown>)(op, ...args);
    }) as KernelCalls["call"],
  };
  const settled = await settleKept(failing, doc, deleteItem(doc, "sketch-2"));
  assert.ok(frees >= 2, "a free failed and another was asked");
  assert.ok(settled.kept?.["feature-5"], "the settle's own answer stands");
  assert.equal(await kernel.call("body_count"), held, "every body the settle built is freed");
});

// Step 35d4: an item whose kernel call runs past its time limit fails with
// "took too long", the rest of the design is built again from the document
// on the fresh kernel, and that item is not tried again (so a call that is
// always too long stops one kernel, not every fresh one in turn) until
// Retry, or an edit to it or to an item before it. And the kernel keeps a
// display mesh only for the bodies on screen (`BodyCache.showOnly`).
// The app's own KernelClient runs over a stand-in worker (as
// restart-handles.test.ts): a kernel numbering its bodies from 1 that never
// answers a body build `hangs` matches, so the client's real time limit
// (the floor, cut to FLOOR_MS) lets that call go and starts a fresh worker.
// The design's side is as workspace.ts wires it: onRestart forgets the
// cache's bodies and builds the design again (`heal`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { KernelClient, KERNEL_TOOK_TOO_LONG, type BodySpec, type Feature, type KernelRequest, type KernelResponse } from "@fission/core";
import { insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import { insertMove, NO_MOVE } from "../src/move.ts";
import { BodyCache, rebuildTimeline, SlowItems, tookTooLong, type FeatureResult, type TimelineBuild } from "../src/rebuild.ts";
import { shownBodies } from "../src/scene.ts";
import { BOX_VIEW } from "./views.ts";

const FLOOR_MS = 40;

/**
 * One worker: bodies 1, 2, 3…; a build whose spec `hangs` matches is never
 * answered, nor is anything after it (one thread, stuck in that call, as
 * the real kernel's worker); `posted` is every request it got.
 */
class StandInWorker {
  static all: StandInWorker[] = [];
  static hangs: (spec: BodySpec) => boolean = () => false;
  /** Every body_view hangs: meshing a body again, too long. */
  static hangsView = false;
  /** Ops whose answer is a refusal (kind internal): a kernel that fails to hide, say. */
  static refuse = new Set<string>();
  onmessage: ((e: { data: KernelResponse | { ready: true; unitMs: number } }) => void) | null = null;
  onerror: unknown = null;
  posted: KernelRequest[] = [];
  next = 1;
  stuck = false;
  constructor() {
    StandInWorker.all.push(this);
    // Calibrated very fast, so every call here has the floor as its limit.
    queueMicrotask(() => this.onmessage?.({ data: { ready: true, unitMs: 1e-3 } }));
  }
  terminate() {}
  postMessage(r: KernelRequest) {
    this.posted.push(r);
    const { id, op, args } = r;
    if (op === "body_build" && StandInWorker.hangs(args[0] as BodySpec)) this.stuck = true;
    if (op === "body_view" && StandInWorker.hangsView) this.stuck = true;
    if (this.stuck) return;
    queueMicrotask(() => {
      if (StandInWorker.refuse.has(op)) return this.onmessage?.({ data: { id, ok: false, error: { kind: "internal", inputs: [], message: `${op} refused` } } });
      const value = op === "body_build" ? this.next++ : op === "body_view" ? BOX_VIEW : null;
      this.onmessage?.({ data: { id, ok: true, value } });
    });
  }
  /** The body builds this worker was asked for, as their specs. */
  get builds(): BodySpec[] {
    return this.posted.filter((r) => r.op === "body_build").map((r) => r.args[0] as BodySpec);
  }
}

/** A design over the stand-in kernel, healed on every restart as workspace.ts does; `settled` waits for every build to end. */
function design(doc: DesignDocument) {
  StandInWorker.all = [];
  (globalThis as { Worker?: unknown }).Worker = StandInWorker;
  const kernel = new KernelClient({ floorMs: FLOOR_MS });
  const cache = new BodyCache(kernel);
  const slow = new SlowItems();
  const d = { doc, restarts: 0, last: null as TimelineBuild | null, kernel, cache, slow, builds: Promise.resolve() as Promise<unknown> };
  const build = () => {
    d.builds = d.builds.then(async () => {
      d.last = await rebuildTimeline(d.doc, cache, kernel, slow);
      return d.last;
    });
    return d.builds;
  };
  // As workspace.ts's heal, which stops after HEALS (3) restarts in a row: so a planted break here ends, failing.
  kernel.onRestart(() => {
    d.restarts++;
    cache.forget();
    if (d.restarts <= 4) void build();
  });
  return {
    d,
    build,
    /** Every build, the heals included, has ended. */
    async settled() {
      for (let seen = null as unknown; seen !== d.builds; ) {
        seen = d.builds;
        await d.builds;
        await new Promise((r) => setTimeout(r, FLOOR_MS * 3)); // a heal starts once a limit has passed, if one will
      }
      return d.last!;
    },
  };
}

const isCylinder = (s: BodySpec) => "cylinder" in s;
const statuses = (b: TimelineBuild) => b.order.map((id) => [id, b.results[id].status, (b.results[id] as { cause?: string }).cause ?? ""]);
const failure = (r: FeatureResult) => (r.status === "failed" ? r : assert.fail(`expected failed, got ${r.status}`));
/** Box 1 (feature-1, 40 × 30 × 20), Cylinder 1 (feature-2, 40 across, 20 high), Box 2 (feature-3, 10 × 10 × 10). */
const threeBodies = () => insertPreset(insertPreset(partDocument("box", 40, 30, 20), "cylinder", 40, 40, 20).doc, "box", 10, 10, 10).doc;
const withSize = (doc: DesignDocument, id: string, key: string, value: number): DesignDocument => ({
  ...doc,
  timeline: { ...doc.timeline, features: doc.timeline.features.map((f): Feature => (f.id === id ? { ...f, intent: { ...f.intent, parameters: { ...f.intent.parameters, [key]: value } } } : f)) },
});

test("by hand: the cylinder's build hangs; it alone fails with \"took too long\", the fresh kernel builds the two boxes once, and the cylinder is never asked of it", async () => {
  StandInWorker.hangs = isCylinder;
  const { d, build, settled } = design(threeBodies());
  await build();
  const b = await settled();
  // Worked by hand: one kernel stopped (the cylinder's build, the oldest call waiting past its limit), so one heal: 1 restart.
  assert.equal(d.restarts, 1);
  assert.equal(StandInWorker.all.length, 2, "the first kernel and one fresh one");
  assert.deepEqual(statuses(b), [
    ["feature-1", "built", ""],
    ["feature-2", "failed", "timed-out"],
    ["feature-3", "built", ""],
  ]);
  assert.equal(failure(b.results["feature-2"]).message, `Cylinder 1 took too long: ${KERNEL_TOOK_TOO_LONG} Retry on its row tries it again.`);
  // The fresh kernel built Box 1 and Box 2 only: 2 builds, no cylinder.
  const fresh = StandInWorker.all[1];
  assert.deepEqual(fresh.builds.map((s) => Object.keys(s)[0]), ["box", "box"]);
  assert.deepEqual(d.slow.ids, ["feature-2"]);
});

test("Retry tries it once more: still too long, it fails again after one more restart; answered, it builds", async () => {
  StandInWorker.hangs = isCylinder;
  const { d, build, settled } = design(threeBodies());
  await build();
  await settled();
  // A second rebuild (any edit elsewhere, an Undo) doesn't try it: still 1 restart, still failed.
  await build();
  assert.equal(failure((await settled()).results["feature-2"]).cause, "timed-out");
  assert.equal(d.restarts, 1);
  // Retry: asked again on the fresh kernel, too long again: 2 restarts, and it stays failed (the heal didn't ask a third time).
  assert.equal(d.slow.retry("feature-2"), true);
  assert.equal(d.slow.retry("feature-2"), false, "retried once: nothing more to forget");
  await build();
  let b = await settled();
  assert.equal(d.restarts, 2);
  assert.equal(StandInWorker.all.length, 3);
  assert.equal(StandInWorker.all[2].builds.filter(isCylinder).length, 0, "the newest kernel was never asked for it");
  assert.equal(failure(b.results["feature-2"]).cause, "timed-out");
  // The kernel is quick now (a faster device, say): Retry builds it.
  StandInWorker.hangs = () => false;
  d.slow.retry("feature-2");
  await build();
  b = await settled();
  assert.equal(d.restarts, 2);
  assert.deepEqual(statuses(b).map(([, s]) => s), ["built", "built", "built"]);
  assert.deepEqual(d.slow.ids, []);
});

test("an edit to the item, or to one before it, tries it again; an edit after it doesn't", async () => {
  StandInWorker.hangs = (s) => isCylinder(s) && (s as { cylinder: { height: number } }).cylinder.height === 20;
  const { d, build, settled } = design(threeBodies());
  await build();
  await settled();
  assert.equal(d.restarts, 1);
  // Box 2 (after it) made 12 wide: the cylinder is still not asked.
  d.doc = withSize(d.doc, "feature-3", "width", 12);
  await build();
  assert.equal(failure((await settled()).results["feature-2"]).cause, "timed-out");
  assert.equal(d.restarts, 1, "not asked, so no restart");
  // Box 1 (before it) made 45 wide: the cylinder is asked again, and hangs again: 2 restarts.
  d.doc = withSize(d.doc, "feature-1", "width", 45);
  await build();
  assert.equal(failure((await settled()).results["feature-2"]).cause, "timed-out");
  assert.equal(d.restarts, 2);
  // The cylinder itself made 25 high (no longer hangs): built at once, no restart.
  d.doc = withSize(d.doc, "feature-2", "height", 25);
  await build();
  assert.equal((await settled()).results["feature-2"].status, "built");
  assert.equal(d.restarts, 2);
});

test("a body asked ahead that runs too long while an item before it is still building fails as too long, not asked again of the fresh kernel", async () => {
  // Box 1, Move 1 (Box 1 10 mm along X), Box 2 (10 × 10 × 10, hangs). Box 1 and Box 2 are asked at once; the Move's moved
  // body is asked after them, so when Box 2's limit passes the loop is waiting on the Move, and reaches Box 2 after the restart.
  StandInWorker.hangs = (s) => "box" in s && (s as { box: { width: number } }).box.width === 10;
  const moved = insertMove(partDocument("box", 40, 30, 20), ["feature-1"], { ...NO_MOVE, x: 10 }).doc;
  const { d, build, settled } = design(insertPreset(moved, "box", 10, 10, 10).doc);
  await build();
  const b = await settled();
  assert.equal(d.restarts, 1, "one kernel stopped: Box 2 is not asked of the fresh one by the build that saw it stop");
  assert.equal(failure(b.results["feature-3"]).cause, "timed-out");
  assert.deepEqual(statuses(b).map(([, s]) => s), ["built", "built", "failed"]);
  assert.equal(StandInWorker.all[1].builds.filter(StandInWorker.hangs).length, 0);
});

test("the words: the item's own name, the client's words, and where Retry is", () => {
  assert.equal(tookTooLong("Extrude 2"), "Extrude 2 took too long: This took the geometry kernel too long, so it was stopped and started again. Retry on its row tries it again.");
});

test("SlowItems by hand: the same document is skipped, a document that differs before or at the item is not, after it is", () => {
  const doc = threeBodies();
  const slow = new SlowItems();
  const cyl = doc.timeline.features[1];
  assert.equal(slow.has(doc, cyl), false, "nothing noted");
  slow.note(doc, cyl);
  assert.equal(slow.has(doc, cyl), true);
  assert.equal(slow.has(withSize(doc, "feature-3", "depth", 11), cyl), true, "after it");
  assert.equal(slow.has(withSize(doc, "feature-1", "depth", 31), cyl), false, "before it");
  assert.equal(slow.has(withSize(doc, "feature-2", "diameter", 41), withSize(doc, "feature-2", "diameter", 41).timeline.features[1]), false, "it");
  // Suppressing an item before it changes what it is built from, so it is tried again once that is undone or kept.
  const suppressed = { ...doc, timeline: { ...doc.timeline, features: doc.timeline.features.map((f, i) => (i === 0 ? { ...f, suppressed: true } : f)) } };
  assert.equal(slow.has(suppressed, cyl), false);
  assert.equal(slow.retry("feature-2"), true);
  assert.equal(slow.has(doc, cyl), false, "retried");
});

test("showOnly by hand: the kernel is told to hide each kept body not on screen, once; a body looked at again is shown and hidden again; a refused hide stays shown", async () => {
  StandInWorker.hangs = () => false;
  StandInWorker.refuse.clear();
  const { d } = design(threeBodies());
  const { cache, kernel } = d;
  const [a, b, c] = [await cache.body({ box: { width: 1, depth: 1, height: 1 } }), await cache.body({ box: { width: 2, depth: 2, height: 2 } }), await cache.body({ box: { width: 3, depth: 3, height: 3 } })];
  await cache.keepOnly([a, b, c]);
  const w = StandInWorker.all[0];
  const hides = () => w.posted.filter((r) => r.op === "body_hide").length;
  assert.equal(cache.meshed, 3, "built with a mesh each");
  await cache.showOnly([b]);
  // Worked by hand: a and c are not on screen: two hides, one mesh left (b's).
  assert.equal(hides(), 2);
  assert.equal(cache.meshed, 1);
  await cache.showOnly([b]);
  assert.equal(hides(), 2, "already hidden: not told again");
  await cache.view(a);
  assert.equal(cache.meshed, 2, "looked at: body_view meshes it again");
  await cache.showOnly([b]);
  assert.equal(hides(), 3);
  assert.equal(cache.meshed, 1);
  // A view of a hidden body asks the kernel again: a was looked at before it was hidden, and its view was let go with its mesh.
  const views = w.posted.filter((r) => r.op === "body_view").length;
  await cache.view(a);
  assert.equal(w.posted.filter((r) => r.op === "body_view").length, views + 1);
  // The kernel refuses to hide: the body stays shown here, and is tried again next time.
  StandInWorker.refuse.add("body_hide");
  await cache.showOnly([b]);
  assert.equal(cache.meshed, 2);
  StandInWorker.refuse.clear();
  await cache.showOnly([b]);
  assert.equal(cache.meshed, 1);
  void kernel;
});

test("after a rebuild only the bodies drawn keep a mesh: a moved box's body before its Move and a body hidden by its eye are hidden in the kernel", async () => {
  StandInWorker.hangs = () => false;
  // Box 1 moved by Move 1, Box 2 hidden by its eye: drawn are Box 1 (moved) and nothing else.
  const moved = insertPreset(insertMove(partDocument("box", 40, 30, 20), ["feature-1"], { ...NO_MOVE, x: 10 }).doc, "box", 10, 10, 10).doc;
  const doc: DesignDocument = { ...moved, hidden: ["feature-3"] };
  const { d, build } = design(doc);
  await build();
  const b = d.last!;
  const drawn = await shownBodies(doc, b, d.cache);
  assert.deepEqual(drawn.map((s) => s.feature), ["feature-1"]);
  await d.cache.showOnly(drawn.map((s) => b.bodies[s.body].handle));
  // Worked by hand: three bodies kept (Box 1 as made, held by the Move; Box 1 moved; Box 2): one drawn, so two hidden.
  assert.equal(d.cache.size, 3);
  assert.equal(d.cache.meshed, 1);
  const hidden = StandInWorker.all[0].posted.filter((r) => r.op === "body_hide").map((r) => r.args[0]);
  assert.equal(hidden.length, 2);
  assert.ok(!hidden.includes(b.bodies["body:feature-1"].handle), "the moved box, drawn, keeps its mesh");
});

test("a body whose view takes too long (meshing it again) is not drawn: it goes to `slow` by its item; with no `slow` the error is thrown", async () => {
  StandInWorker.hangs = () => false;
  StandInWorker.hangsView = true;
  try {
    const doc = partDocument("box", 40, 30, 20);
    const { d, build } = design(doc);
    await build();
    const b = d.last!;
    const slowOnes: string[] = [];
    // Worked by hand: one body, its view hangs, so nothing drawn and Box 1 (feature-1) named once.
    assert.deepEqual(await shownBodies(doc, b, d.cache, (id) => slowOnes.push(id)), []);
    assert.deepEqual(slowOnes, ["feature-1"]);
    // On the fresh kernel the box is built again; its view hangs again, and with no `slow` that is the caller's error.
    d.cache.forget();
    const again = await rebuildTimeline(doc, d.cache, d.kernel);
    await assert.rejects(shownBodies(doc, again, d.cache), (e: Error & { kind?: string }) => e.kind === "timed-out");
  } finally {
    StandInWorker.hangsView = false;
  }
});

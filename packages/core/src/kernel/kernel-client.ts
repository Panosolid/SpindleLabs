// Main-thread side of the kernel worker: every kernel call is an async
// message, so a slow operation never freezes the UI.
import type { BodyHandle, BodySpec, BooleanOp, BooleanResult, BuildPlate, BodyView, KernelErrorKind, KernelFailure, KernelInput, NozzleType, Outline, P1sPrintFile, SketchArc, SketchCircle, SketchLine, SketchOutline, SlicedPrint, SliceProgress, SliceStage, StlFile, SupportStyle } from "./kernel-types.ts";
import { builtSize, callUnits, DEFAULT_UNIT_MS, facesSize, LIMIT_FLOOR_MS, limitMs, type BodySize } from "./time-limit.ts";

/** Every operation the worker supports, with its arguments and result. */
export interface KernelOps {
  kernel_version: { args: []; result: string };
  make_box: { args: [width: number, depth: number, height: number]; result: BodyView };
  make_cylinder: { args: [radius: number, height: number]; result: BodyView };
  make_sphere: { args: [radius: number]; result: BodyView };
  make_extrude: { args: [profile: Outline, distance: number]; result: BodyView };
  export_stl: { args: [spec: BodySpec, name: string]; result: StlFile };
  snap_to_grid: { args: [x: number, y: number, spacing: number]; result: [number, number] };
  place_freely: { args: [x: number, y: number, pixel: number]; result: [number, number] };
  sketch_outline: { args: [lines: SketchLine[], circles: SketchCircle[], arcs: SketchArc[]]; result: SketchOutline };
  /** The kernel's body store: build and keep a body, read it by handle, free it. */
  body_build: { args: [spec: BodySpec]; result: BodyHandle };
  body_view: { args: [body: BodyHandle]; result: BodyView };
  body_stl: { args: [body: BodyHandle, name: string]; result: StlFile };
  /** The body as a STEP AP214 file, placed where it is shown (step 29b3: the oracle reads the app's bodies with OpenCascade). */
  body_step: { args: [body: BodyHandle]; result: string };
  body_free: { args: [body: BodyHandle]; result: void };
  /** Hides a kept body: the kernel lets its display mesh go until body_view shows it again (step 35d2: bodies off screen, a timeline's earlier features, a boolean's inputs). */
  body_hide: { args: [body: BodyHandle]; result: void };
  /**
   * `op` on the kept body `target` with each of `tools` in turn (step 35d1):
   * every result kept (shown), the inputs left as they were, and where each
   * result face and edge came from, by input handle. A refusal keeps nothing.
   */
  body_boolean: { args: [target: BodyHandle, tools: BodyHandle[], op: BooleanOp]; result: BooleanResult };
  /** How many bodies the kernel keeps: tests check what they build they free. */
  body_count: { args: []; result: number };
  /** Slices one or more binary STL files (back to back, a body each) with the beginner's choices: layer height (mm), wall count, infill (%), and supports under overhangs (off, normal or tree). */
  slice_stl: { args: [stl: Uint8Array<ArrayBuffer>, layerHeight: number, wallCount: number, infillPercent: number, supports: SupportStyle]; result: SlicedPrint };
  /** The same slice as slice_stl, as a Bambu Lab P1S print file (.gcode.3mf) for the build plate and the nozzle fitted. */
  print_file_stl: { args: [stl: Uint8Array<ArrayBuffer>, layerHeight: number, wallCount: number, infillPercent: number, supports: SupportStyle, plate: BuildPlate, nozzle: NozzleType]; result: P1sPrintFile };
  /** The size of the kernel's WebAssembly memory in bytes (it only ever grows): the soak test checks it levels off. */
  wasm_bytes: { args: []; result: number };
}

export type KernelRequest = {
  [K in keyof KernelOps]: { id: number; op: K; args: KernelOps[K]["args"] };
}[keyof KernelOps];

/**
 * A failed reply's `stopped`: the call trapped (`isTrap`), so the worker's kernel can't be trusted with another call.
 * Its `missing`: the kernel's file never downloaded (KERNEL_NOT_DOWNLOADED, after the worker's own tries).
 */
export type KernelResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: KernelFailure; stopped?: true; missing?: true };

/**
 * What the worker says once, when its kernel has downloaded and started: from
 * then on each call is timed (time-limit.ts). `unitMs`: how long the
 * calibration boolean took on this device (kernel.worker.ts, `calibrate`);
 * missing when the worker couldn't time it, and DEFAULT_UNIT_MS is taken.
 */
export type KernelReady = { ready: true; unitMs?: number };

/** What the worker says while a slice (call `id`) works: how far it has got (SliceProgress), at most every PROGRESS_EVERY_MS but at every new stage. */
export type KernelProgress = { id: number; progress: SliceProgress };

/** The least time between two progress messages of one stage (ms): a bar needs no more, and each costs a message. */
export const PROGRESS_EVERY_MS = 100;

/** The engine's progress callback (its last argument to slice_stl and print_file_stl): fraction 0 to 1, stage, done of total. */
export type ProgressCallback = (fraction: number, stage: SliceStage, done: number, total: number) => void;

/**
 * Call `id`'s progress callback: the engine's reports to the client as KernelProgress messages, a stage's at most every
 * PROGRESS_EVERY_MS (each new stage, and the end, at once). The worker is busy in the call, but messages still go.
 */
export function progressPoster(id: number, post: (message: KernelProgress) => void, now: () => number): ProgressCallback {
  let last = -Infinity;
  let stage: SliceStage | null = null;
  return (fraction, newStage, done, total) => {
    const t = now();
    if (newStage === stage && fraction < 1 && t - last < PROGRESS_EVERY_MS) return;
    last = t;
    stage = newStage;
    post({ id, progress: { fraction, stage: newStage, done, total } });
  };
}


/**
 * Whether a kernel call stopped the WebAssembly itself (a trap: running out
 * of memory, or an internal fault) rather than refusing its input. After a
 * trap the module's memory is left part way through the call, and every
 * later call can fail the same way, even a 10 mm box (Ben's phone project,
 * 2026-10-28: every item red at once). Such a kernel is replaced, never
 * asked again.
 */
export const isTrap = (e: unknown): boolean => typeof WebAssembly !== "undefined" && e instanceof WebAssembly.RuntimeError;

/** What the call that stopped the kernel answers (and every call still waiting on it): the app then starts a fresh kernel and builds again. */
export const KERNEL_RESTARTED = "The geometry kernel ran out of memory or stopped on an internal error, so it was started again.";

/**
 * What a call answers when it ran past its time limit (time-limit.ts: a
 * kernel stuck in a loop, or a worker the browser closed, which says nothing
 * at all), as a KernelError of kind "timed-out": the app then starts a fresh
 * kernel and builds again, this call's feature failed (step 35d3).
 */
export const KERNEL_TOOK_TOO_LONG = "This took the geometry kernel too long, so it was stopped and started again.";

/** What every other call sent to that kernel answers: it was never done, and the app builds again on the fresh kernel. */
export const KERNEL_STOPPED_FOR_ANOTHER = "The geometry kernel was started again, because a call before this one took too long.";

/**
 * What every call answers when the kernel's own file (the .wasm) didn't
 * download or compile, in the words the app uses for a worker that didn't
 * load, never the browser's ("Failed to fetch", a 404's text): app sweep
 * 2026-10-28, finding 7.
 */
export const KERNEL_NOT_DOWNLOADED = "The geometry kernel didn't start (its file didn't download). Reload the page to try again.";

/** A watch that fires this much later than it was due means the device slept or the page was frozen. */
const LATE_TIMER_MS = 1000;

const KINDS: readonly KernelErrorKind[] = ["invalid-input", "invalid-result", "bad-request", "unknown-body", "too-many-bodies", "internal"];

/**
 * A failed kernel call: `message` to show the user, `kind` and `inputs` for
 * the app to decide by (never parse the message).
 */
export class KernelError extends Error {
  readonly kind: KernelErrorKind;
  readonly inputs: KernelInput[];
  constructor(failure: KernelFailure) {
    // Its name stays "Error", so String(e) reads as it always has.
    super(failure.message);
    this.kind = failure.kind;
    this.inputs = failure.inputs;
  }
}

/**
 * Anything a kernel call threw, as plain data: the WASM kernel throws an
 * Error carrying `kind` and `inputs`; anything else (a crash, a worker bug)
 * is "internal" with no inputs.
 */
export function kernelFailure(e: unknown): KernelFailure {
  const message = e instanceof Error ? e.message : String(e);
  const fields = (typeof e === "object" && e !== null ? e : {}) as { kind?: unknown; inputs?: unknown };
  const kind = KINDS.includes(fields.kind as KernelErrorKind) ? (fields.kind as KernelErrorKind) : "internal";
  const inputs = kind !== "internal" && Array.isArray(fields.inputs) ? (fields.inputs as KernelInput[]) : [];
  return { kind, inputs, message };
}

/** Anything that answers kernel calls: the worker client in the app, the WASM module directly in tests. */
export interface KernelCalls {
  call<K extends keyof KernelOps>(op: K, ...args: KernelOps[K]["args"]): Promise<KernelOps[K]["result"]>;
  /**
   * Calls `listener` each time the kernel was replaced by a fresh one (the
   * old one trapped): every body it kept is gone, its handles mean nothing
   * now, and what is shown is built again. Returns the way to stop listening.
   * The app's client has it; a kernel that is never replaced (tests) may not.
   */
  onRestart?(listener: () => void): () => void;
  /**
   * Calls `listener` when the kernel's files didn't download: its worker
   * script or its .wasm (a failing network, or a new build deployed since
   * this page loaded, whose old files are gone). Every call fails until
   * `retry` starts a kernel that does download. Returns the way to stop.
   */
  onMissing?(listener: () => void): () => void;
  /** Starts a fresh kernel in place of one that is missing or gone (the listeners of onRestart hear of it); does nothing to one that works. */
  retry?(): void;
  /**
   * Calls `listener` as a slice (slice_stl, print_file_stl) reports how far it has got (SliceProgress). Returns the way
   * to stop listening. The app's client has it; a kernel without a worker (tests) may not, and an engine from before
   * progress reports never calls it.
   */
  onProgress?(listener: (progress: SliceProgress) => void): () => void;
}

export class KernelClient implements KernelCalls {
  private progressListeners = new Set<(progress: SliceProgress) => void>();
  private worker!: Worker;
  private nextId = 1;
  /** The calls sent and not yet answered, in the order sent, which is the order the worker answers them; each with its size (time-limit.ts). */
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; units: number }>();
  /** Set once the worker is gone (its error event): every call fails with it. */
  private failed: KernelError | null = null;
  private restartListeners = new Set<() => void>();
  private missingListeners = new Set<() => void>();
  /** This worker's files didn't download (told once per worker). */
  private missing = false;
  /**
   * The handles this client gave out, each to the worker whose kernel holds
   * the body and that kernel's own number for it. A fresh kernel numbers its
   * bodies from 1 again, so the app never sees a kernel's numbers: a handle
   * from a kernel that was replaced must never reach the new one, where the
   * same number is another body (real-use hunt E1, 2026-10-28: an old
   * preview's free removed a body the healed design held). Handles count
   * on across kernels and are never reused.
   */
  private bodies = new Map<BodyHandle, { worker: Worker; body: BodyHandle }>();
  private nextBody = 1;
  /** Handles whose kernel was replaced: their bodies are gone, so freeing one is done at once (once), and nothing else is asked of them. */
  private retired = new Set<BodyHandle>();
  /** Each live handle's size, for the time limits of the calls that read it (time-limit.ts). */
  private sizes = new Map<BodyHandle, BodySize>();
  /**
   * Step 35d3 (blind spots B2b before it): each call has a time limit from
   * its size and this device's calibration (time-limit.ts), and a call past
   * it is failed alone (KERNEL_TOOK_TOO_LONG) and its kernel let go, as a
   * trapped one is. The worker does one call at a time, in the order sent,
   * so the call timed is the oldest waiting, from when the one before it was
   * answered (or from when it was sent, if none waited): how long the calls
   * take together never counts, and a call sent while the time runs never
   * puts it back. The download and calibration before the worker's `ready`
   * are never timed (a slow phone network).
   */
  private readonly floorMs: number;
  private unitMs = DEFAULT_UNIT_MS;
  private started = false;
  private watch: ReturnType<typeof setTimeout> | null = null;
  /** The id of the call being timed. */
  private timed: number | null = null;
  /** When the watch is due (Date.now), to see a timer that fired late. */
  private dueAt = 0;
  /** The page was hidden or frozen while the call was timed: the worker may have had no CPU time. */
  private sawHidden = false;

  /** `floorMs`: the shortest limit (LIMIT_FLOOR_MS; the browser checks shorten it). */
  constructor(options: { floorMs?: number } = {}) {
    this.floorMs = options.floorMs ?? LIMIT_FLOOR_MS;
    // A phone that backgrounds the tab, or a laptop that sleeps, stops the
    // worker as well as the page: that time must not count against a call.
    const doc = (globalThis as { document?: { hidden?: boolean; addEventListener?(type: string, fn: () => void): void } }).document;
    if (doc?.addEventListener) {
      doc.addEventListener("visibilitychange", () => {
        if (doc.hidden) this.sawHidden = true;
      });
      doc.addEventListener("freeze", () => (this.sawHidden = true));
    }
    this.start();
  }

  /** Times the oldest call waiting on a started kernel, from now if it wasn't timed already; stops when none waits. */
  private watchHead() {
    const head = this.started ? this.pending.entries().next().value : undefined;
    if (head && head[0] === this.timed) return;
    if (this.watch !== null) clearTimeout(this.watch);
    this.watch = null;
    this.timed = null;
    if (!head) return;
    const [id, call] = head;
    this.timed = id;
    this.sawHidden = false;
    this.arm(id, limitMs(call.units, this.unitMs, this.floorMs));
  }

  /**
   * Sets the watch for `ms`. When it fires, a page that was hidden or frozen
   * meanwhile (or a timer more than a second late: the device slept) tells
   * nothing about the kernel, whose worker got no CPU time either, so the call
   * is given its whole limit again from now instead of the healthy kernel being
   * let go. A kernel that is really stuck is still caught: the first time the
   * limit passes with the page awake and on time.
   */
  private arm(id: number, ms: number) {
    this.dueAt = Date.now() + ms;
    this.watch = setTimeout(() => {
      this.watch = null;
      const late = Date.now() - this.dueAt;
      const doc = (globalThis as { document?: { hidden?: boolean } }).document;
      if (this.sawHidden || doc?.hidden || late > LATE_TIMER_MS) {
        this.sawHidden = false;
        return this.arm(id, ms);
      }
      this.restart(KERNEL_STOPPED_FOR_ANOTHER, id);
    }, ms);
  }

  private start() {
    const worker = new Worker(new URL("./kernel.worker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    this.started = false;
    this.watchHead();
    worker.onmessage = (event: MessageEvent<KernelResponse | KernelReady | KernelProgress>) => {
      if (worker !== this.worker) return; // a kernel already replaced
      if ("progress" in event.data) {
        // Only for a call still waiting (a late one, after its answer, says nothing).
        if (this.pending.has(event.data.id)) for (const listener of this.progressListeners) listener(event.data.progress);
        return;
      }
      if ("ready" in event.data) {
        const unitMs = event.data.unitMs;
        this.unitMs = typeof unitMs === "number" && Number.isFinite(unitMs) && unitMs > 0 ? unitMs : DEFAULT_UNIT_MS;
        this.started = true;
        return this.watchHead();
      }
      const reply = event.data;
      if (!reply.ok && reply.stopped) return this.restart();
      if (!reply.ok && reply.missing) this.lost();
      const p = this.pending.get(reply.id);
      if (!p) return;
      this.pending.delete(reply.id);
      this.watchHead();
      if (reply.ok) p.resolve(reply.value);
      else p.reject(new KernelError(reply.error));
    };
    // The worker answers every call, a failing one too (kernel.worker.ts), so
    // an error event means its script didn't load or threw while it started:
    // the worker is gone. Every call waiting and every later one fails with
    // the same words, never waits for an answer that can't come, and the
    // event is taken as handled (the app says it, not the browser's console).
    // A kernel that had started and then crashes (an uncaught error in the
    // middle of a call) is started again instead, as a trapped one is: a
    // fresh one works (B2b), and one that fails as it starts never loops.
    worker.onerror = (event) => {
      event.preventDefault();
      if (worker !== this.worker) return;
      if (this.started && event.message) return this.restart();
      const why = event.message ? `stopped (kernel worker crashed: ${event.message})` : "didn't start (its worker didn't load)";
      this.failed = new KernelError({ kind: "internal", inputs: [], message: `The geometry kernel ${why}. Reload the page to try again.` });
      this.pending.forEach((p) => p.reject(this.failed!));
      this.pending.clear();
      this.watchHead();
      if (!event.message) this.lost();
    };
  }

  /**
   * A call trapped (or the started kernel crashed, or call `slow` ran past
   * its time limit: `message` then KERNEL_STOPPED_FOR_ANOTHER): that kernel
   * is let go and a fresh one started. Every call sent to the old kernel
   * fails with `message` (none of them can be trusted, and the old kernel
   * never answers again), except `slow`, which fails alone with
   * KERNEL_TOOK_TOO_LONG ("timed-out"); then the listeners hear of it, so
   * the bodies the old one kept are forgotten and the design is built again
   * on the new one.
   */
  private restart(message = KERNEL_RESTARTED, slow?: number) {
    this.worker.terminate();
    const stopped = new KernelError({ kind: "internal", inputs: [], message });
    const tooLong = new KernelError({ kind: "timed-out", inputs: [], message: KERNEL_TOOK_TOO_LONG });
    const waiting = [...this.pending];
    this.pending.clear();
    this.retire();
    this.start();
    waiting.forEach(([id, p]) => p.reject(id === slow ? tooLong : stopped));
    this.restartListeners.forEach((listener) => listener());
  }

  /** The kernel's files didn't download: the listeners hear of it once for this worker. */
  private lost() {
    if (this.missing) return;
    this.missing = true;
    this.missingListeners.forEach((listener) => listener());
  }

  retry(): void {
    if (!this.missing && !this.failed) return;
    this.worker.terminate();
    const waiting = [...this.pending.values()];
    this.pending.clear();
    this.failed = null;
    this.missing = false;
    this.retire();
    this.start();
    // A missing kernel answers every call at once, so none is normally left waiting; one that is fails as before.
    waiting.forEach((p) => p.reject(new KernelError({ kind: "internal", inputs: [], message: KERNEL_NOT_DOWNLOADED })));
    this.restartListeners.forEach((listener) => listener());
  }

  /** The kernel is being replaced: every handle it held now names a body that is gone. */
  private retire() {
    for (const handle of this.bodies.keys()) this.retired.add(handle);
    this.bodies.clear();
    this.sizes.clear();
  }

  onMissing(listener: () => void): () => void {
    this.missingListeners.add(listener);
    return () => void this.missingListeners.delete(listener);
  }

  onRestart(listener: () => void): () => void {
    this.restartListeners.add(listener);
    return () => void this.restartListeners.delete(listener);
  }

  onProgress(listener: (progress: SliceProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => void this.progressListeners.delete(listener);
  }

  call<K extends keyof KernelOps>(op: K, ...args: KernelOps[K]["args"]): Promise<KernelOps[K]["result"]> {
    if (this.failed) return Promise.reject(this.failed);
    const units = callUnits(op, args, (h) => this.sizes.get(h));
    if (op === "body_build") {
      const worker = this.worker;
      return this.send(op, args, units).then((body) => {
        const handle = this.nextBody++;
        // Built by a kernel replaced while it was on its way: the body went with it.
        if (worker === this.worker) {
          this.bodies.set(handle, { worker, body: body as BodyHandle });
          this.sizes.set(handle, builtSize(args[0] as BodySpec));
        } else this.retired.add(handle);
        return handle as KernelOps[K]["result"];
      });
    }
    if (op === "body_boolean") return this.boolean(...(args as KernelOps["body_boolean"]["args"]), units) as Promise<KernelOps[K]["result"]>;
    if (op === "body_view" || op === "body_stl" || op === "body_step" || op === "body_free" || op === "body_hide") {
      const handle = args[0] as BodyHandle;
      const held = this.bodies.get(handle);
      if (!held) {
        // A body that went with its kernel is gone already: freeing it is done. Anything else asked of it is refused, in the kernel's words.
        if (op === "body_free" && this.retired.delete(handle)) return Promise.resolve() as Promise<KernelOps[K]["result"]>;
        return Promise.reject(new KernelError({ kind: "unknown-body", inputs: [], message: `body ${handle} is not in the kernel (it was freed, or never made)` }));
      }
      const sent = this.send(op, [held.body, ...args.slice(1)] as KernelOps[K]["args"], units);
      if (op === "body_free") void sent.then(() => this.bodies.get(handle) === held && this.bodies.delete(handle) && this.sizes.delete(handle), () => {});
      // A view counts the body's faces exactly.
      if (op === "body_view")
        void sent.then(
          (view) => {
            const size = this.sizes.get(handle);
            if (size && this.bodies.get(handle) === held) this.sizes.set(handle, { ...size, faces: (view as BodyView).faces });
          },
          () => {},
        );
      return sent as Promise<KernelOps[K]["result"]>;
    }
    return this.send(op, args, units) as Promise<KernelOps[K]["result"]>;
  }

  /**
   * body_boolean with the app's handles: the inputs' kernel numbers sent,
   * the results given handles of their own (sized by their faces), and the
   * history's input bodies named by the app's handles again.
   */
  private boolean(target: BodyHandle, tools: BodyHandle[], op: BooleanOp, units: number): Promise<BooleanResult> {
    const inputs = [target, ...tools];
    const held = inputs.map((handle) => this.bodies.get(handle));
    const unknown = inputs.find((_, k) => !held[k]);
    if (unknown !== undefined) return Promise.reject(new KernelError({ kind: "unknown-body", inputs: [], message: `body ${unknown} is not in the kernel (it was freed, or never made)` }));
    const worker = this.worker;
    const app = new Map(held.map((h, k) => [h!.body, inputs[k]]));
    return this.send("body_boolean", [held[0]!.body, held.slice(1).map((h) => h!.body), op], units).then((reply) => {
      const { bodies, history } = reply as BooleanResult;
      const handles = bodies.map((body, k) => {
        const handle = this.nextBody++;
        if (worker === this.worker) {
          this.bodies.set(handle, { worker, body });
          this.sizes.set(handle, facesSize(history[k].faces.length));
        } else this.retired.add(handle);
        return handle;
      });
      const named = (body: BodyHandle) => app.get(body) ?? body;
      return {
        bodies: handles,
        history: history.map(({ faces, edges }) => ({
          faces: faces.map((f) => ({ ...f, body: named(f.body) })),
          edges: edges.map((e) => ({ along: e.along.map((a) => ({ ...a, body: named(a.body) })), crossing: e.crossing.map(([p, q]) => [{ ...p, body: named(p.body) }, { ...q, body: named(q.body) }] as [typeof p, typeof q]) })),
        })),
      };
    });
  }

  private send<K extends keyof KernelOps>(op: K, args: KernelOps[K]["args"], units: number): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, units });
      this.watchHead();
      this.worker.postMessage({ id, op, args } as KernelRequest);
    });
  }
}

/**
 * Wraps an async function so only the result of the most recent call is
 * used: replies to older calls that arrive late are dropped.
 */
export function latestOnly<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  let latest = 0;
  return async (...args: A): Promise<{ current: boolean; value: R }> => {
    const ticket = ++latest;
    const value = await fn(...args);
    return { current: ticket === latest, value };
  };
}

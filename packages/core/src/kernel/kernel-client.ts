// Main-thread side of the kernel worker: every kernel call is an async
// message, so a slow operation never freezes the UI.
import type { BodyHandle, BodySpec, BodyView, KernelErrorKind, KernelFailure, KernelInput, Outline, SketchArc, SketchCircle, SketchLine, SketchOutline, StlFile } from "./kernel-types.ts";

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
  /** The body store (kernel/src/store.rs): build and keep a body, read it by handle, free it. */
  body_build: { args: [spec: BodySpec]; result: BodyHandle };
  body_view: { args: [body: BodyHandle]; result: BodyView };
  body_stl: { args: [body: BodyHandle, name: string]; result: StlFile };
  /** The body as a STEP AP214 file, placed where it is shown (step 29b3: the oracle reads the app's bodies with OpenCascade). */
  body_step: { args: [body: BodyHandle]; result: string };
  body_free: { args: [body: BodyHandle]; result: void };
  /** How many bodies the kernel keeps: tests check what they build they free. */
  body_count: { args: []; result: number };
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
 * What every call answers when the kernel's own file (the .wasm) didn't
 * download or compile, in the words the app uses for a worker that didn't
 * load, never the browser's ("Failed to fetch", a 404's text): app sweep
 * 2026-10-28, finding 7.
 */
export const KERNEL_NOT_DOWNLOADED = "The geometry kernel didn't start (its file didn't download). Reload the page to try again.";

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
}

export class KernelClient implements KernelCalls {
  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
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

  constructor() {
    this.start();
  }

  private start() {
    const worker = new Worker(new URL("./kernel.worker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<KernelResponse>) => {
      if (worker !== this.worker) return; // a kernel already replaced
      const reply = event.data;
      if (!reply.ok && reply.stopped) return this.restart();
      if (!reply.ok && reply.missing) this.lost();
      const p = this.pending.get(reply.id);
      if (!p) return;
      this.pending.delete(reply.id);
      if (reply.ok) p.resolve(reply.value);
      else p.reject(new KernelError(reply.error));
    };
    // The worker answers every call, a failing one too (kernel.worker.ts), so
    // an error event means its script didn't load or threw while it started:
    // the worker is gone. Every call waiting and every later one fails with
    // the same words, never waits for an answer that can't come, and the
    // event is taken as handled (the app says it, not the browser's console).
    worker.onerror = (event) => {
      event.preventDefault();
      if (worker !== this.worker) return;
      const why = event.message ? `stopped (kernel worker crashed: ${event.message})` : "didn't start (its worker didn't load)";
      this.failed = new KernelError({ kind: "internal", inputs: [], message: `The geometry kernel ${why}. Reload the page to try again.` });
      this.pending.forEach((p) => p.reject(this.failed!));
      this.pending.clear();
      if (!event.message) this.lost();
    };
  }

  /**
   * A call trapped: that kernel is let go and a fresh one started. The call
   * and every other one sent to the old kernel fail with KERNEL_RESTARTED
   * (none of them can be trusted, and the old kernel never answers again);
   * then the listeners hear of it, so the bodies the old one kept are
   * forgotten and the design is built again on the new one.
   */
  private restart() {
    this.worker.terminate();
    const stopped = new KernelError({ kind: "internal", inputs: [], message: KERNEL_RESTARTED });
    const waiting = [...this.pending.values()];
    this.pending.clear();
    this.retire();
    this.start();
    waiting.forEach((p) => p.reject(stopped));
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
  }

  onMissing(listener: () => void): () => void {
    this.missingListeners.add(listener);
    return () => void this.missingListeners.delete(listener);
  }

  onRestart(listener: () => void): () => void {
    this.restartListeners.add(listener);
    return () => void this.restartListeners.delete(listener);
  }

  call<K extends keyof KernelOps>(op: K, ...args: KernelOps[K]["args"]): Promise<KernelOps[K]["result"]> {
    if (this.failed) return Promise.reject(this.failed);
    if (op === "body_build") {
      const worker = this.worker;
      return this.send(op, args).then((body) => {
        const handle = this.nextBody++;
        // Built by a kernel replaced while it was on its way: the body went with it.
        if (worker === this.worker) this.bodies.set(handle, { worker, body: body as BodyHandle });
        else this.retired.add(handle);
        return handle as KernelOps[K]["result"];
      });
    }
    if (op === "body_view" || op === "body_stl" || op === "body_step" || op === "body_free") {
      const handle = args[0] as BodyHandle;
      const held = this.bodies.get(handle);
      if (!held) {
        // A body that went with its kernel is gone already: freeing it is done. Anything else asked of it is refused, in the kernel's words.
        if (op === "body_free" && this.retired.delete(handle)) return Promise.resolve() as Promise<KernelOps[K]["result"]>;
        return Promise.reject(new KernelError({ kind: "unknown-body", inputs: [], message: `body ${handle} is not in the kernel (it was freed, or never made)` }));
      }
      const sent = this.send(op, [held.body, ...args.slice(1)] as KernelOps[K]["args"]);
      if (op === "body_free") void sent.then(() => this.bodies.get(handle) === held && this.bodies.delete(handle), () => {});
      return sent as Promise<KernelOps[K]["result"]>;
    }
    return this.send(op, args) as Promise<KernelOps[K]["result"]>;
  }

  private send<K extends keyof KernelOps>(op: K, args: KernelOps[K]["args"]): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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

// The WASM kernel in Node, for the journey tests: the same module the app
// runs in its Web Worker, answering the same KernelCalls interface, loaded
// directly instead of through a worker, from the committed kernel build
// (packages/core/src/kernel/wasm/).
// Node-only, like the tests, so the type check (browser types) skips it.

import { readFileSync } from "node:fs";
import { KernelError, kernelFailure, type KernelCalls, type KernelOps } from "@fission/core";
import { startKernel } from "../../core/src/kernel/handshake.ts";
import { entry } from "../../core/src/kernel/entry-points.ts";
import * as wasm from "../../core/src/kernel/wasm/fission_kernel.js";

let loaded: ReturnType<typeof wasm.initSync> | null = null;

/** Loads and starts the kernel once (with the app's key, kernel-key.ts); its WebAssembly exports, for memory readings. */
export function loadKernel(): ReturnType<typeof wasm.initSync> {
  if (!loaded) {
    const exports = wasm.initSync({ module: readFileSync(new URL("../../core/src/kernel/wasm/fission_kernel_bg.wasm", import.meta.url)) });
    startKernel(entry.begin, JSON.parse(readFileSync(new URL("../../core/src/kernel/wasm/kernel.json", import.meta.url), "utf8")));
    loaded = exports;
  }
  return loaded;
}

export function nodeKernel(): KernelCalls {
  loadKernel();
  const ops: { [K in keyof KernelOps]: (...a: KernelOps[K]["args"]) => KernelOps[K]["result"] } = {
    kernel_version: () => entry.kernel_version(),
    make_box: (w, d, h) => entry.make_box(w, d, h),
    make_cylinder: (r, h) => entry.make_cylinder(r, h),
    make_sphere: (r) => entry.make_sphere(r),
    make_extrude: (p, d) => entry.make_extrude(p, d),
    export_stl: (spec, name) => entry.export_stl(spec, name),
    snap_to_grid: (x, y, s) => entry.snap_to_grid(x, y, s),
    place_freely: (x, y, pixel) => entry.place_freely(x, y, pixel),
    sketch_outline: (lines, circles, arcs) => entry.sketch_outline(lines, circles, arcs),
    body_build: (spec) => entry.body_build(spec),
    body_view: (body) => entry.body_view(body),
    body_stl: (body, name) => entry.body_stl(body, name),
    body_step: (body) => entry.body_step(body),
    body_free: (body) => entry.body_free(body),
    body_count: () => entry.body_count(),
    wasm_bytes: () => loaded!.memory.buffer.byteLength,
  };
  return {
    // Async like the worker, and errors become KernelError rejections as
    // the app's client gives them (through the same plain-data form).
    call: (async (op: keyof KernelOps, ...args: unknown[]) => {
      try {
        return (ops[op] as (...a: unknown[]) => unknown)(...args);
      } catch (e) {
        throw new KernelError(kernelFailure(e));
      }
    }) as KernelCalls["call"],
  };
}

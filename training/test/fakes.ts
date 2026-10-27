// A stand-in kernel for the fast tests: it builds nothing and accepts
// everything unless told otherwise, and records what it was asked. The
// real kernel checks the same examples in journeys/kernel.journey.ts.

import type { KernelCalls } from "@fission/core";

export interface FakeKernel extends KernelCalls {
  calls: { op: string; args: unknown[] }[];
}

export function fakeKernel(answer: (op: string, args: unknown[]) => unknown = () => undefined): FakeKernel {
  const calls: FakeKernel["calls"] = [];
  return {
    calls,
    call: (async (op: string, ...args: unknown[]) => {
      calls.push({ op, args });
      const given = answer(op, args);
      if (given !== undefined) return given;
      // A binary STL with one triangle: 80-byte header, a count, 50 bytes.
      // A sketch always makes one closed outline (the real kernel is asked in journeys/kernel.journey.ts).
      if (op === "sketch_outline") return { closed: { segments: [] } };
      return op === "export_stl" ? { bytes: new Uint8Array(134), rounding: 0, warning: null } : { errors: [], volume: 1 };
    }) as KernelCalls["call"],
  };
}

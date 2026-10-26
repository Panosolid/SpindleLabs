// Stand-ins for the network, used by the provider tests: nothing in the
// tests talks to a real model or sends anything anywhere.

import type { Fetch } from "../src/index.ts";

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that answers from `handler` and records every request. A handler that throws acts like a network failure. */
export function fakeServer(handler: (call: Call) => { status?: number; json?: unknown; text?: string }) {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const r = handler(call);
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  };
  return { fetch, calls };
}

/** Small seeded generator (mulberry32): same seed, same numbers. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)], int: (n: number) => Math.floor(next() * n) };
}

/** The seed for random tests: FISSION_SEED (decimal) or a fixed default, printed on failure by the caller. */
export const SEED = Number(process.env.FISSION_SEED ?? 20261017);

/**
 * A fetch whose replies arrive in pieces, as a streamed answer does
 * (AI5c2): each string in `chunks` is sent as its own piece of the body,
 * split exactly where given (a byte array can cut a character in half).
 * `stall` keeps the body open after the last piece until the request is
 * aborted, as a model that stops answering would.
 */
export function streamServer(handler: (call: Call) => { status?: number; chunks: (string | Uint8Array)[]; stall?: boolean }) {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const r = handler(call);
    const bytes = r.chunks.map((c) => (typeof c === "string" ? new TextEncoder().encode(c) : c));
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const b of bytes) {
          await new Promise((done) => setTimeout(done, 0));
          controller.enqueue(b);
        }
        if (!r.stall) controller.close();
        else init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    });
    return new Response(body, { status: r.status ?? 200 });
  };
  return { fetch, calls };
}

/** `text` cut into pieces of 1 to `most` characters, chosen by `random` (a seeded generator). */
export function cut(text: string, random: { int(n: number): number }, most = 7): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; ) {
    const n = 1 + random.int(most);
    out.push(text.slice(i, i + n));
    i += n;
  }
  return out;
}

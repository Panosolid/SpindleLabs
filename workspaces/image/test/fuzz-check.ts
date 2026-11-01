// What every fuzzed input must satisfy (shared by fuzz.test.ts and regressions.test.ts).

import { ImageError } from "../src/errors.ts";
import { MAX_PIXELS, MAX_SIDE, checkMmPerPixel } from "../src/limits.ts";
import { readPhysicalSize } from "../src/physical-size.ts";
import { readOrientation } from "../src/orientation.ts";

/** The orientation reader on any bytes: never throws, gives 1–8, and the bytes it hands the decoder read as upright and are the same length. */
export function checkOrientation(input: Uint8Array): string | null {
  for (const format of ["png", "jpeg"] as const) {
    try {
      const r = readOrientation(input, format);
      if (!(Number.isInteger(r.orientation) && r.orientation >= 1 && r.orientation <= 8)) return `orientation ${r.orientation}`;
      if (r.asStored.length !== input.length) return "the decoder's bytes changed length";
      if (readOrientation(r.asStored, format).orientation !== 1) return "the decoder's bytes still carry an orientation";
    } catch (e) {
      return `readOrientation threw ${(e as Error)?.name}: ${(e as Error)?.message}`;
    }
  }
  return null;
}

/** Checks one input; returns a description of what went wrong, or null. */
export function checkOne(input: Uint8Array): string | null {
  const turned = checkOrientation(input);
  if (turned) return turned;
  try {
    const s = readPhysicalSize(input);
    if (s.width < 1 || s.height < 1 || s.width > MAX_SIDE || s.height > MAX_SIDE || s.width * s.height > MAX_PIXELS) return `size outside the limits: ${s.width} × ${s.height}`;
    checkMmPerPixel(s.mmPerPixel, s.width, s.height);
    if ((s.source === "file") !== (s.note === null)) return "a note must be given exactly when the size is assumed";
    return null;
  } catch (e) {
    return e instanceof ImageError ? null : `threw ${(e as Error)?.name}: ${(e as Error)?.message}`;
  }
}

/** mulberry32: a small, well-known seeded generator. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mutate(bytes: Uint8Array, rnd: () => number): Uint8Array {
  const pick = (n: number) => Math.floor(rnd() * n);
  const b = new Uint8Array(bytes);
  switch (pick(4)) {
    case 0: // cut off anywhere
      return b.slice(0, pick(b.length + 1));
    case 1: // flip a few bits, mostly in the headers
      for (let k = 1 + pick(4); k > 0; k--) {
        const i = pick(Math.min(b.length, rnd() < 0.8 ? 64 : b.length));
        b[i] ^= 1 << pick(8);
      }
      return b;
    case 2: // overwrite a byte with an extreme value
      b[pick(Math.min(b.length, 64))] = [0, 0xff, 0x7f, 0x80][pick(4)];
      return b;
    default: { // splice: repeat or drop a stretch
      const i = pick(b.length);
      const j = Math.min(b.length, i + 1 + pick(16));
      return rnd() < 0.5 ? new Uint8Array([...b.slice(0, j), ...b.slice(i)]) : new Uint8Array([...b.slice(0, i), ...b.slice(j)]);
    }
  }
}

// A phone's tight memory, for the kernel, in any browser engine: the
// kernel's .wasm declares a memory with no upper limit, so `capWasmMemory`
// writes one into the file (the memory section's limits), and the kernel's
// memory then can't grow past it, in Chromium, Firefox and WebKit alike
// (Chromium's own --wasm-max-mem-pages switch works in Chromium only).
// `cappedSite` serves a copy of the built app (dist/) whose kernel is capped.
// Tested by kernel-cap.test.mjs; used by kernel-restart.mjs.
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

/** One WebAssembly page, 64 KiB. */
export const PAGE = 65536;

/** Reads an unsigned LEB128 number at `at`: [value, the offset after it]. */
function leb(bytes, at) {
  let value = 0;
  let shift = 0;
  for (;;) {
    const b = bytes[at++];
    if (b === undefined) throw new Error("the .wasm ends inside a number");
    value += (b & 0x7f) * 2 ** shift;
    shift += 7;
    if (b < 0x80) return [value, at];
  }
}

/** `n` as unsigned LEB128 bytes. */
function toLeb(n) {
  const out = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}

/**
 * `wasm` with its first memory's maximum set to `pages` (a defined memory,
 * in its memory section, id 5). Refuses a module with no memory section
 * (its memory imported), a shared or 64-bit memory, or one whose minimum
 * is already above `pages`. A maximum it has is replaced.
 */
export function capWasmMemory(wasm, pages) {
  const bytes = Uint8Array.from(wasm);
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) throw new Error("not a .wasm file");
  let at = 8;
  while (at < bytes.length) {
    const id = bytes[at];
    const [size, body] = leb(bytes, at + 1);
    const end = body + size;
    if (id === 5) {
      const [count, first] = leb(bytes, body);
      if (count < 1) throw new Error("the memory section holds no memory");
      const flags = bytes[first];
      if (flags > 1) throw new Error(`the memory is shared or 64-bit (flags ${flags}), not capped here`);
      const [min, afterMin] = leb(bytes, first + 1);
      if (min > pages) throw new Error(`the memory starts at ${min} pages, above the cap of ${pages}`);
      const afterLimits = flags === 1 ? leb(bytes, afterMin)[1] : afterMin;
      const content = [...bytes.slice(body, first), 1, ...toLeb(min), ...toLeb(pages), ...bytes.slice(afterLimits, end)];
      return Uint8Array.from([...bytes.slice(0, at), 5, ...toLeb(content.length), ...content, ...bytes.slice(end)]);
    }
    at = end;
  }
  throw new Error("the .wasm has no memory section (its memory is imported)");
}

/**
 * Serves a copy of dist/ on `port` with the kernel's memory capped at `mib`
 * MiB: { url, close }. The copy goes in a fresh temporary folder.
 */
export async function cappedSite(mib, port) {
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  const copy = mkdtempSync(join(tmpdir(), "kernel-cap-"));
  cpSync(dist, copy, { recursive: true });
  const assets = join(copy, "assets");
  const kernels = readdirSync(assets).filter((f) => f.endsWith(".wasm"));
  if (kernels.length !== 1) throw new Error(`expected one .wasm in dist/assets, found ${kernels.length} (build the app first)`);
  const file = join(assets, kernels[0]);
  writeFileSync(file, capWasmMemory(readFileSync(file), (mib * 1024 * 1024) / PAGE));
  const server = await preview({ build: { outDir: copy }, preview: { port, strictPort: true }, logLevel: "error" });
  return { url: `http://localhost:${port}/`, close: () => server.close() };
}

// The soak test's verdict (soak.mjs): every cycle ends on an empty design,
// so once the warm-up is over (caches filled, shaders compiled, the undo
// history at its limit), nothing the page holds may keep growing.
// Counts (bodies, DOM nodes, listeners, geometries…) may not go above their
// highest reading during the warm-up. The JavaScript heap is noisy even
// after a forced collection, so it is judged by its growth per cycle
// between the means of the first and last thirds of the later readings;
// the kernel's WebAssembly memory only ever grows, so it may not grow at all
// in the second half of the readings.

/** Counts that must level off exactly. */
export const COUNTS = ["bodies", "nodes", "listeners", "documents", "geometries", "textures", "programs", "objects"];
/** How much of the run is warm-up: the readings up to this fraction of the last cycle. */
export const WARM_UP = 0.25;
/** Heap growth allowed per cycle once warm, in bytes (a real leak of one project copy per cycle is ~50 KB). */
export const HEAP_PER_CYCLE = 20_000;

/** Problems in `readings` (each { cycle, heap, wasm, …COUNTS }, cycle 0 first), in words; none means it levelled off. */
export function judgeSoak(readings) {
  const last = readings.at(-1).cycle;
  const warm = readings.filter((r) => r.cycle <= last * WARM_UP);
  const later = readings.filter((r) => r.cycle > last * WARM_UP);
  if (later.length < 3) return [`too few readings after the warm-up to judge (${later.length}; at least 3)`];
  const problems = [];
  for (const key of COUNTS) {
    const ceiling = Math.max(...warm.map((r) => r[key]));
    const over = later.find((r) => r[key] > ceiling);
    if (over) problems.push(`${key} keeps growing: ${ceiling} by cycle ${warm.at(-1).cycle}, ${over[key]} at cycle ${over.cycle}, ${later.at(-1)[key]} at cycle ${later.at(-1).cycle}`);
  }
  const third = Math.max(1, Math.floor(later.length / 3));
  const mean = (rs, key) => rs.reduce((s, r) => s + r[key], 0) / rs.length;
  const [first, end] = [later.slice(0, third), later.slice(-third)];
  const cycles = mean(end, "cycle") - mean(first, "cycle");
  const perCycle = (mean(end, "heap") - mean(first, "heap")) / cycles;
  if (perCycle > HEAP_PER_CYCLE) problems.push(`the JavaScript heap keeps growing: ${Math.round(perCycle).toLocaleString("en")} bytes a cycle (at most ${HEAP_PER_CYCLE.toLocaleString("en")})`);
  const half = readings[Math.floor(readings.length / 2)];
  if (readings.at(-1).wasm > half.wasm) problems.push(`the kernel's WebAssembly memory keeps growing: ${half.wasm} bytes at cycle ${half.cycle}, ${readings.at(-1).wasm} at cycle ${last}`);
  return problems;
}

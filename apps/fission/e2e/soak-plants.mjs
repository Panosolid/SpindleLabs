// Proof that the soak test (soak.mjs) catches what it says it does: each
// plant below is a deliberate mistake in the real app's code, at least one
// for each kind of check (memory: a listener and a DOM node kept on every
// use; the design: against the model, after Undo and Redo, after the file
// is opened again). For each, this edits the source in place, builds the
// app into a folder of its own (vite only; the kernel's WASM is already
// built), puts the file back, runs a short soak on that build and prints
// which check caught it. A plant nothing catches is reported as missed,
// and the run fails.
// `soak-plants.test.mjs` (in `npm test`) checks every plant still applies:
// each text it replaces is in its file exactly once.
//
// Run after `npm run build`, from apps/fission:
//   node e2e/soak-plants.mjs [plant…]
// SOAK_PLANT_CYCLES (default 8) sets each soak's length; it reads every 2
// cycles, so the memory verdict has its 3 readings after the warm-up.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** What each plant breaks, text the soak's FAIL line for it contains, and any settings of its own for the soak. */
export const SOAK_PLANTS = {
  "move-listener-kept": {
    what: "every Move panel opened adds a key listener to the page and never takes it off",
    expect: "listeners keeps growing",
    edits: [{ file: "workspaces/design/src/move-panel.ts", find: "      editing = m.id;\n      open = true;", replace: '      editing = m.id;\n      open = true;\n      document.addEventListener("keydown", () => {});' }],
  },
  "workspace-node-kept": {
    what: "every workspace put to sleep keeps a removed element alive",
    expect: "nodes keeps growing",
    // Wide screens only, so the phone-width panel leak (fixed in #49) can't be what grows.
    env: { SOAK_SCREEN: "wide" },
    edits: [{ file: "apps/fission/src/main.ts", find: "    view.sleep?.();\n", replace: '    view.sleep?.();\n    { const d = document.createElement("div"); document.body.append(d); d.remove(); (window as any).plantedNodes = [...((window as any).plantedNodes ?? []), d]; }\n' }],
  },
  "extrude-ignores-typed": {
    what: "Extrude's OK builds 10 mm whatever distance was typed (the timeline still says the typed one)",
    expect: "built",
    edits: [{ file: "workspaces/design/src/workspace.ts", find: "      made = extrudeSketch(source.doc, source.sketch, Math.abs(distance), distance < 0);", replace: "      made = extrudeSketch(source.doc, source.sketch, 10, distance < 0);" }],
  },
  "redo-does-nothing": {
    what: "Redo says it redid the step but puts nothing back",
    expect: "Undos and",
    edits: [{ file: "packages/core/src/model/history.ts", find: "      go(index + 1);", replace: "      index++;" }],
  },
  "open-drops-move-height": {
    what: "opening a file reads every Move as lifting 0 (the Move's words still say how far)",
    expect: "opened again",
    edits: [{ file: "workspaces/design/src/document.ts", find: '    if (typeof f.suppressed !== "boolean") throw new Error(`Design feature ${f.id}: suppressed must be true or false, not ${shown(f.suppressed)}`);\n', replace: '    if (typeof f.suppressed !== "boolean") throw new Error(`Design feature ${f.id}: suppressed must be true or false, not ${shown(f.suppressed)}`);\n    if (intent.type === "move") (intent.parameters as Record<string, unknown>).z = 0;\n' }],
  },
};

const root = new URL("../../../", import.meta.url);
const app = new URL("..", import.meta.url).pathname;

/** Applies `edits`, each text exactly once; returns the files as they were. */
export function plant(edits) {
  const before = new Map();
  for (const e of edits) {
    const path = new URL(e.file, root);
    if (!before.has(e.file)) before.set(e.file, readFileSync(path, "utf8"));
    const text = readFileSync(path, "utf8");
    if (text.split(e.find).length !== 2) throw new Error(`${e.file}: the plant's text is not there exactly once: ${e.find}`);
    writeFileSync(path, text.replace(e.find, () => e.replace));
  }
  return before;
}
function restore(before) {
  for (const [file, text] of before) writeFileSync(new URL(file, root), text);
}
/** Builds the app as it is into `outDir` (vite only). */
const build = (outDir) => execFileSync("npx", ["vite", "build", "--logLevel", "error", "--emptyOutDir", "--outDir", outDir], { cwd: app, stdio: "inherit" });
/** A short soak on the build in `outDir`: its FAIL lines (none when it passed). */
function soak(outDir, port, extra = {}) {
  return new Promise((done) => {
    const env = { ...process.env, SOAK_DIST: outDir, SOAK_PORT: String(port), SOAK_CYCLES: process.env.SOAK_PLANT_CYCLES || "8", SOAK_EVERY: "2", SOAK_SEED: "1", ...extra };
    let out = "";
    const child = spawn("node", ["e2e/soak.mjs"], { cwd: app, env });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", () => done(out.split("\n").filter((l) => l.startsWith("FAIL ") && !l.startsWith("FAIL soak:"))));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SOAK_PLANTS);
  const base = mkdtempSync(join(tmpdir(), "soak-plants-"));
  let missed = 0;
  try {
    for (const [n, name] of names.entries()) {
      const p = SOAK_PLANTS[name];
      if (!p) throw new Error(`no plant ${name} (${Object.keys(SOAK_PLANTS).join(", ")})`);
      const before = plant(p.edits);
      try {
        build(join(base, name));
      } finally {
        restore(before);
      }
      const fails = await soak(join(base, name), 4300 + n, p.env);
      const hit = fails.find((l) => l.includes(p.expect));
      if (hit) console.log(`caught ${name} (${p.what}):\n  ${hit.slice(0, 300)}`);
      else {
        missed++;
        console.log(`MISSED ${name} (${p.what}): ${fails.length ? `it failed otherwise:\n  ${fails.slice(0, 3).join("\n  ")}` : "the soak passed"}`);
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  console.log(`${missed ? "FAIL" : "PASS"} soak plants: ${names.length - missed} of ${names.length} caught`);
  process.exit(missed ? 1 : 0);
}

import { nodeKernel, loadKernel } from "./src/node-kernel.ts";
import { entry } from "../core/src/kernel/entry-points.ts";
import { calibrate, sliceUnits, limitMs } from "../core/src/kernel/time-limit.ts";
loadKernel();
const unitMs = calibrate({ build: (s) => entry.body_build(s), boolean: (t, tl, op) => entry.body_boolean(t, tl, op), free: (b) => entry.body_free(b), now: () => performance.now() });
const k = nodeKernel();
const R = Number(process.env.R ?? 30), H = Number(process.env.H ?? 40);
const hex: [number, number][] = [...Array(6)].map((_, i) => [R * Math.cos((Math.PI / 3) * i), R * Math.sin((Math.PI / 3) * i)]);
const specs: any[] = [
  { extrude: { profile: { outer: { path: { corners: hex.flat(), bulges: hex.map(() => 0) } }, holes: [] }, distance: H } },
  { moved: { body: { cylinder: { radius: 8, height: 40 } }, moves: [{ turn: { pivot: [0, 0, 0], axis: [1, 0, 0], angle: Math.PI / 2 } }, { move: [0, -20, 8] }] } },
  { moved: { body: { box: { width: 4, depth: 25, height: 20 } }, moves: [{ move: [-12, -50, 0] }] } },
  { moved: { body: { box: { width: 4, depth: 25, height: 20 } }, moves: [{ move: [8, -50, 0] }] } },
];
const files = [];
for (const s of specs) files.push(await k.call("export_stl", s, "b"));
const total = files.reduce((n, f) => n + f.bytes.length, 0);
const stl = new Uint8Array(total); let at = 0; for (const f of files) { stl.set(f.bytes, at); at += f.bytes.length; }
const units = sliceUnits(stl, 0.2, 15);
console.log("tris", (total - 84 * files.length) / 50, "unitMs", unitMs.toFixed(3), "units", units.toFixed(0), "limit", limitMs(units, unitMs).toFixed(0));
const t = performance.now();
try { const r = await k.call("print_file_stl", stl, 0.2, 2, 15, "normal", "textured", "standard"); console.log("ok", r.layers, (performance.now() - t).toFixed(0), "ms"); }
catch (e) { console.log("err", (performance.now() - t).toFixed(0), String(e).slice(0, 300)); }

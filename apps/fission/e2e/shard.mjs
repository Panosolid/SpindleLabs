// Splits `npm run e2e` across CI's parallel e2e jobs: `node e2e/shard.mjs 2 3`
// runs the second of three shares. package.json's "e2e" script stays the one
// list of browser checks; this reads it, so a check added there runs in some
// shard without touching CI. Each share runs every one of its checks, even
// after a failure, and fails if any did.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Seconds each check took on CI (one merge queue run's three shares, 2026-10-29: 2,500 s in all), to even out the shares; a check not listed counts as `UNKNOWN`.
 * Only the balance depends on them: a wrong or missing entry makes one share slower, never skips a check. */
export const SECONDS = {
  "smoke.mjs": 112,
  "storage.mjs": 2,
  "reopen.mjs": 57,
  "kernel-restart.mjs": 17,
  "restart-panels.mjs": 12,
  "image.mjs": 29,
  "styles.mjs": 1,
  "files.mjs": 20,
  "copy-svg.mjs": 8,
  "switching.mjs": 24,
  "closed-views.mjs": 64,
  "shortcuts.mjs": 8,
  "undo.mjs": 38,
  "sketch.mjs": 13,
  "sketch-tool.mjs": 72,
  "snap.mjs": 11,
  "snap-control.mjs": 11,
  "sketch-session.mjs": 111,
  "sketch-pixels.mjs": 8,
  "hidden-edges.mjs": 70,
  "edge-lines.mjs": 79,
  "free-placement.mjs": 14,
  "sketch-view.mjs": 19,
  "navigation.mjs": 22,
  "sketch-toolbar.mjs": 30,
  "centre-arc.mjs": 23,
  "extrude.mjs": 82,
  "extrude-drag.mjs": 26,
  "face-sketch.mjs": 53,
  "face-edges.mjs": 52,
  "projection.mjs": 15,
  "projection-hunt.mjs": 24,
  "face-hunt.mjs": 27,
  "bodies.mjs": 53,
  "move.mjs": 21,
  "move-drag.mjs": 37,
  "move-face-sketch.mjs": 30,
  "timeline.mjs": 288,
  "sketch-shell.mjs": 18,
  "assistant.mjs": 109,
  "guide.mjs": 236,
  "layout.mjs": 17,
  "phone-short.mjs": 8,
  "phone-sheet.mjs": 59,
  "phone-widths.mjs": 10,
  "phone-start.mjs": 9,
  "insert.mjs": 18,
  "toolbar.mjs": 11,
  "app-bar.mjs": 28,
  "save-name.mjs": 14,
  "motion.mjs": 5,
  "rename.mjs": 46,
  "typed-entry.mjs": 45,
  "journeys.mjs": 190,
  "framing.mjs": 10,
  "offline.mjs": 0,
  "offline-off.mjs": 4,
  "leave-save.mjs": 33,
  "monkey.mjs": 89,
};
export const UNKNOWN = 30;

/** The commands of an "a && b && c" script, refusing any other shape so no check can be lost in the split. */
export function commands(script) {
  if (/\|\||;|(^|[^&])&([^&]|$)|\|/.test(script)) throw new Error(`the e2e script must be a plain "a && b" chain: ${script}`);
  const parts = script.split("&&").map((s) => s.trim());
  for (const p of parts) {
    if (!/^node( --[a-z-]+)* e2e\/[a-z0-9-]+\.mjs$/.test(p)) throw new Error(`not a browser check: "${p}"`);
  }
  return parts;
}

/** The file a command runs, e.g. "smoke.mjs". */
export const fileOf = (command) => command.slice(command.lastIndexOf("/") + 1);

/** `cmds` dealt into `n` shares, longest first onto the lightest share; every command lands in exactly one, in its original order. */
export function shares(cmds, n, seconds = SECONDS) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`shard count must be a whole number from 1: ${n}`);
  const cost = (c) => seconds[fileOf(c)] ?? UNKNOWN;
  const order = cmds.map((c, i) => i).sort((a, b) => cost(cmds[b]) - cost(cmds[a]) || a - b);
  const load = Array(n).fill(0);
  const owner = [];
  for (const i of order) {
    let k = 0;
    for (let j = 1; j < n; j++) if (load[j] < load[k]) k = j;
    owner[i] = k;
    load[k] += cost(cmds[i]);
  }
  return load.map((_, k) => cmds.filter((_, i) => owner[i] === k));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [k, n] = process.argv.slice(2).map(Number);
  const script = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts.e2e;
  const all = shares(commands(script), n);
  if (!Number.isInteger(k) || k < 1 || k > n) throw new Error(`usage: node e2e/shard.mjs <1..n> <n>, got ${k} ${n}`);
  const mine = all[k - 1];
  console.log(`e2e share ${k} of ${n}: ${mine.map(fileOf).join(", ")}`);
  const failed = [];
  const took = [];
  for (const c of mine) {
    console.log(`\n=== ${c}`);
    const start = Date.now();
    const r = spawnSync(c, { shell: true, stdio: "inherit" });
    took.push(`${fileOf(c)} ${Math.round((Date.now() - start) / 1000)} s`);
    if (r.status !== 0) failed.push(fileOf(c));
  }
  console.log(`\n${took.join(", ")}`);
  if (failed.length) {
    console.log(`FAILED: ${failed.join(", ")}`);
    process.exit(1);
  }
}

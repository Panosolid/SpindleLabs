// Offline mode: writes the service worker (sw.js beside this file) into the
// built app with the build's version and the files it keeps. vite.config.ts
// runs `offlinePlugin()`; `writeServiceWorker(dir)` does the same to any
// built folder (the update test makes a second version with it).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { OFFLINE_MODE } from "./offline.config.mjs";

const TEMPLATE = fileURLToPath(new URL("./sw.js", import.meta.url));
const KILL_SWITCH = fileURLToPath(new URL("./sw-off.js", import.meta.url));
/** The name of the list of on-demand chunks the build leaves beside the app (read here, never served as a page). */
export const ON_DEMAND = "on-demand.json";

/** Every file under `dir`, as forward-slash paths relative to it, sorted. */
export function filesIn(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * The build's version and the files to keep. `files` maps each path to
 * its bytes; sw.js itself and the on-demand list are never part of it.
 * The version is the first 16 hex digits of SHA-256 over one line per
 * file (path, a NUL, the SHA-256 of its bytes), sorted by path, so it
 * changes when any byte, name, added or removed file does, and only then.
 */
export function buildInfo(files, onDemand = []) {
  const paths = Object.keys(files)
    .filter((p) => p !== "sw.js" && p !== ON_DEMAND)
    .sort();
  const lines = paths.map((p) => `${p}\0${createHash("sha256").update(files[p]).digest("hex")}\n`).join("");
  const version = createHash("sha256").update(lines).digest("hex").slice(0, 16);
  const lazy = new Set(onDemand);
  return { version, precache: paths.filter((p) => !lazy.has(p)) };
}

/** The service worker's source for `info`. */
export function serviceWorkerSource(info) {
  return `self.__SPINDLELABS_BUILD__ = ${JSON.stringify(info)};\n${readFileSync(TEMPLATE, "utf8")}`;
}

/** Writes the clean-up worker (sw-off.js) as sw.js, for when offline mode is off. */
export function writeKillSwitch(dir) {
  writeFileSync(join(dir, "sw.js"), readFileSync(KILL_SWITCH, "utf8"));
}

/** Writes sw.js into the built folder `dir`; returns its build info. */
export function writeServiceWorker(dir) {
  const files = {};
  for (const p of filesIn(dir)) files[p] = readFileSync(join(dir, p));
  const onDemand = files[ON_DEMAND] ? JSON.parse(files[ON_DEMAND].toString("utf8")) : [];
  const info = buildInfo(files, onDemand);
  writeFileSync(join(dir, "sw.js"), serviceWorkerSource(info));
  return info;
}

/**
 * The chunks only loaded on demand (by import(), never statically), so
 * not kept at install: the in-browser AI's library is 6 MB, and it fetches
 * its model from the network anyway. Kept the first time they load.
 */
export function onDemandChunks(bundle) {
  const chunks = Object.values(bundle).filter((c) => c.type === "chunk");
  const statically = new Set(chunks.flatMap((c) => c.imports));
  return chunks.filter((c) => c.isDynamicEntry && !c.isEntry && !statically.has(c.fileName)).map((c) => c.fileName);
}

/**
 * The Vite plugin. With offline mode on: the manifest link in index.html,
 * the on-demand chunks listed, and sw.js written once the whole build
 * (workers too) is on disk. Off: the app is not installable, and sw.js is
 * the clean-up worker that removes an earlier install.
 */
export function offlinePlugin(enabled = OFFLINE_MODE) {
  let outDir = "";
  return {
    name: "spindlelabs-offline",
    apply: "build",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    transformIndexHtml() {
      return enabled ? [{ tag: "link", attrs: { rel: "manifest", href: "./manifest.webmanifest" }, injectTo: "head" }] : [];
    },
    generateBundle(_options, bundle) {
      if (!enabled) return;
      this.emitFile({ type: "asset", fileName: ON_DEMAND, source: JSON.stringify(onDemandChunks(bundle)) });
    },
    closeBundle() {
      if (enabled) writeServiceWorker(outDir);
      else writeKillSwitch(outDir);
    },
  };
}

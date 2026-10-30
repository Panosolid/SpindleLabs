// A copy of the built app (dist/) served the way GitHub Pages serves the
// live site, with the moments the app's checks otherwise never see:
// `deploy()` ships a new build while pages are open (every hashed file in
// assets/ gets a new name, and every reference to it changes, so the old
// names answer 404, as on the live site after a deploy); `dropKernel(n)`
// cuts the connection on the next `n` requests for the kernel's .wasm (a
// phone's network failing; Infinity, until `dropKernel(0)`). `capMib` caps
// the kernel's memory (kernel-cap.mjs). Files are read from disk on every
// request, so a deploy shows at once. `browserCache()` is what a browser
// kept of the build served now (a phone opening the app from before a
// deploy). Used by app-updated.mjs.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { capWasmMemory, PAGE } from "./kernel-cap.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};
const TEXT = new Set([".html", ".js", ".css"]);

/** Serves a copy of dist/ on `port`: { url, deploy, browserCache, dropKernel, kernelRequests, close }. */
export async function liveSite(port, { capMib } = {}) {
  const dist = process.env.E2E_DIST || fileURLToPath(new URL("../dist/", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "live-site-"));
  cpSync(dist, root, { recursive: true });
  const assets = join(root, "assets");
  const wasmName = () => readdirSync(assets).find((f) => f.endsWith(".wasm"));
  if (!wasmName()) throw new Error("no .wasm in dist/assets (build the app first)");
  if (capMib) {
    const file = join(assets, wasmName());
    writeFileSync(file, capWasmMemory(readFileSync(file), (capMib * 1024 * 1024) / PAGE));
  }
  let drops = 0;
  let kernelRequests = 0;
  let deploys = 0;

  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith(".wasm")) {
      kernelRequests++;
      if (drops > 0) {
        drops--;
        // A gateway's failure, not a dropped connection: a browser tries a dropped GET again by itself, unseen.
        res.writeHead(503, { "content-type": "text/plain" }).end("unavailable");
        return;
      }
    }
    const file = normalize(join(root, path.endsWith("/") ? `${path}index.html` : path));
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { "content-type": "text/html" }).end("<h1>404</h1>");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  /** A new build goes live: each assets/ file renamed (its hash changed), every reference to it updated, the old names gone. */
  function deploy() {
    deploys++;
    const renames = readdirSync(assets).map((f) => {
      const dot = f.lastIndexOf(".");
      return [f, `${f.slice(0, dot)}v${deploys}${f.slice(dot)}`];
    });
    for (const [from, to] of renames) renameSync(join(assets, from), join(assets, to));
    const texts = [join(root, "index.html"), ...readdirSync(assets).filter((f) => TEXT.has(extname(f))).map((f) => join(assets, f))];
    for (const file of texts) {
      let body = readFileSync(file, "utf8");
      for (const [from, to] of renames) body = body.split(from).join(to);
      writeFileSync(file, body);
    }
  }

  /**
   * The build served now as a browser keeps it: url path -> { contentType,
   * body }, the page at "/" and every assets/ file; the kernel's .wasm
   * only with `wasm` (a browser need not keep a file that big).
   */
  function browserCache({ wasm = false } = {}) {
    const kept = new Map([["/", { contentType: TYPES[".html"], body: readFileSync(join(root, "index.html")) }]]);
    for (const f of readdirSync(assets)) {
      if (f.endsWith(".wasm") && !wasm) continue;
      kept.set(`/assets/${f}`, { contentType: TYPES[extname(f)] ?? "application/octet-stream", body: readFileSync(join(assets, f)) });
    }
    return kept;
  }

  return {
    url: `http://127.0.0.1:${port}/`,
    deploy,
    browserCache,
    dropKernel: (n) => void (drops = n),
    kernelRequests: () => kernelRequests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

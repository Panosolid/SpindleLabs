// The one launcher every browser test uses: Chromium by default, or the
// engine E2E_BROWSER names (chromium, firefox or webkit), so CI runs the
// same tests in all three (testing catch-up TC4). In this sandbox Chromium
// comes from /opt/pw-browsers; elsewhere Playwright's own builds are used
// (`npx playwright install --with-deps chromium firefox webkit`).
import { existsSync } from "node:fs";
import { chromium, firefox, webkit } from "playwright";

const ENGINES = { chromium, firefox, webkit };
export const browserName = process.env.E2E_BROWSER || "chromium";
if (!(browserName in ENGINES)) throw new Error(`E2E_BROWSER must be chromium, firefox or webkit, not ${browserName}`);

/**
 * Waits until the kernel holds `n` bodies (`window.fissionTest.bodyCount()`,
 * `?test-hooks`), polling from here: Playwright's waitForFunction takes the
 * Promise an async predicate returns as true at once, so it never waited
 * on a count. Fails naming the count it saw last.
 */
export async function untilBodies(page, n, what = `${n} bodies in the kernel`, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const count = await page.evaluate(() => window.fissionTest?.bodyCount() ?? null);
    if (count === n) return;
    if (Date.now() > end) throw new Error(`${what}: the kernel holds ${count} bodies, not ${n}`);
    await page.waitForTimeout(50);
  }
}

/** Launches the chosen browser; `args`, command-line switches for Chromium (e2e/kernel-restart.mjs caps WebAssembly memory). */
export function launch(args = []) {
  // E2E_CHROMIUM runs the Chromium checks on another build, for example CI's
  // (Playwright's own, "Chrome for Testing", a newer Chrome than a sandbox
  // may have); otherwise a sandbox's preinstalled Chromium, else Playwright's.
  const sandboxChromium = process.env.E2E_CHROMIUM || "/opt/pw-browsers/chromium";
  const options = browserName === "chromium" && existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {};
  // Headless Firefox on a CI machine with no graphics card refuses WebGL
  // ("AllowWebgl2:false restricts context creation"), so nothing would be
  // drawn; these let it use its software renderer, as Chromium does.
  // Headless, it still found no GL driver ("Exhausted GL driver options"),
  // so CI runs it with a window on a virtual screen (xvfb-run, E2E_HEADED=1)
  // and Mesa's software GL.
  if (browserName === "firefox") options.firefoxUserPrefs = { "webgl.force-enabled": true, "webgl.disabled": false, "webgl.enable-webgl2": true };
  if (process.env.E2E_HEADED) options.headless = false;
  if (browserName === "chromium" && args.length) options.args = args;
  return ENGINES[browserName].launch(options).then(underTestCSP);
}

/**
 * The app's Content Security Policy (index.html, audit S10) refuses strings
 * run as script, and Playwright's waitForFunction polls by evaluating one in
 * the page, so every context these tests open bypasses the policy unless it
 * passes `bypassCSP: false`. e2e/framing.mjs does, and checks the app under
 * the real policy there (the kernel's WebAssembly, what it refuses).
 * WebKit's bypassCSP ignores a policy given in a <meta> tag, so there the
 * app's page is served with that tag taken out instead.
 *
 * They block the app's service worker too (offline mode) unless given
 * `serviceWorkers: "allow"`: requests it answers never reach page.route,
 * which many checks use. e2e/offline.mjs allows it and checks it.
 */
function underTestCSP(browser) {
  const newContext = browser.newContext.bind(browser);
  const newPage = browser.newPage.bind(browser);
  browser.newContext = async (options = {}) => {
    const context = await newContext({ bypassCSP: true, serviceWorkers: "block", ...options });
    if (context && options.bypassCSP !== false && STRIP_META_CSP) await stripMetaCSP(context);
    if (context) await slowKernel(context);
    return context;
  };
  browser.newPage = async (options = {}) => {
    const page = await newPage({ bypassCSP: true, serviceWorkers: "block", ...options });
    if (options.bypassCSP !== false && STRIP_META_CSP) await stripMetaCSP(page.context());
    await slowKernel(page.context());
    return page;
  };
  return browser;
}

const STRIP_META_CSP = browserName === "webkit";
const META_CSP = /<meta http-equiv="Content-Security-Policy"[^>]*>/;

/** Serves the app's HTML pages to `context` without the CSP <meta> tag. */
function stripMetaCSP(context) {
  return context.route(
    (url) => url.protocol.startsWith("http") && (url.pathname.endsWith("/") || url.pathname.endsWith(".html")),
    async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({ response, body: body.replace(META_CSP, "") });
    },
  );
}

/**
 * E2E_KERNEL_DELAY=ms holds each kernel worker answer back a random 0 to ms
 * milliseconds (seeded by E2E_KERNEL_SEED, in order: never overtaking the
 * one before), so the app's rebuilds land at the moments a slow CI runner
 * sees. Checks must pass under it: a check that reads the page while a
 * rebuild is still on its way and passes only when it lands first has a race.
 */
const KERNEL_DELAY = Number(process.env.E2E_KERNEL_DELAY || 0);
const KERNEL_SEED = Number(process.env.E2E_KERNEL_SEED || 1);
const delayed = new WeakSet();
async function slowKernel(context) {
  if (!(KERNEL_DELAY > 0) || delayed.has(context)) return;
  delayed.add(context);
  await context.addInitScript(([max, seed]) => {
    let s = seed >>> 0 || 1;
    const random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const Real = window.Worker;
    window.Worker = class extends Real {
      constructor(...args) {
        super(...args);
        let last = 0;
        let handler = null;
        super.onmessage = (event) => {
          const at = Math.max(last, performance.now() + random() * max);
          last = at;
          setTimeout(() => handler?.call(this, event), at - performance.now());
        };
        Object.defineProperty(this, "onmessage", { get: () => handler, set: (f) => (handler = f) });
      }
    };
  }, [KERNEL_DELAY, KERNEL_SEED]);
}

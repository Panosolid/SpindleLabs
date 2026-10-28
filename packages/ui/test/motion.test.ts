import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The motion tokens (styles/motion.css) keep every animation short and
// switch-off-able; these checks read the file so a slow or hover-only motion
// is caught before a browser sees it.
const css = readFileSync(resolve(import.meta.dirname, "../src/styles/motion.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Milliseconds of a token such as "--motion-slow: 220ms" (hand-read from the file's :root block). */
export function tokenMs(source: string, name: string): number {
  const m = new RegExp(`${name}:\\s*([0-9.]+)ms`).exec(source);
  assert.ok(m, `${name} is defined`);
  return Number(m[1]);
}

test("no motion token runs longer than 220 ms (hand-worked: the slowest, slow, is 220)", () => {
  for (const n of ["--motion-fast", "--motion-base", "--motion-slow"]) assert.ok(tokenMs(css, n) <= 220, n);
  assert.equal(tokenMs(css, "--motion-slow"), 220);
  // The check can fail: a 221 ms token is over the cap.
  assert.ok(tokenMs("--motion-slow: 221ms", "--motion-slow") > 220);
});

test("hover effects sit inside (hover: hover); outside it only :active and colour changes appear", () => {
  // Every (hover: hover) block removed, braces counted (hand-worked: "a{b}@media (hover: hover){c{d}}e{f}" leaves "a{b}e{f}").
  const strip = (src: string): string => {
    let out = src;
    for (let at = out.indexOf("@media (hover: hover)"); at >= 0; at = out.indexOf("@media (hover: hover)")) {
      let depth = 0;
      let end = out.indexOf("{", at);
      for (; end < out.length; end++) {
        if (out[end] === "{") depth++;
        if (out[end] === "}" && --depth === 0) break;
      }
      out = out.slice(0, at) + out.slice(end + 1);
    }
    return out;
  };
  assert.equal(strip("a{b}@media (hover: hover){c{d}}e{f}"), "a{b}e{f}");
  const outside = strip(css);
  assert.ok(css.includes("@media (hover: hover)"));
  assert.ok(!/:hover[^{]*\{[^}]*transform/.test(outside), "a hover transform is outside (hover: hover)");
});

test("prefers-reduced-motion zeroes the durations and removes the animations", () => {
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion"));
  for (const n of ["--motion-fast", "--motion-base", "--motion-slow"]) assert.ok(tokenMs(reduced, n) < 1, n);
  assert.match(reduced, /animation: none/);
});

test("every animation and transition uses a token, never a bare duration", () => {
  for (const m of css.matchAll(/(?:animation|transition):[^;]*;/g)) assert.match(m[0], /var\(--motion-|animation: none/, m[0]);
});

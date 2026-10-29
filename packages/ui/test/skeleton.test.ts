import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { adoptSkeleton, holdSkeleton, leaveAfter, skeleton, whileLoading, SKELETON_DELAY_MS, SKELETON_FADE_MS } from "../src/skeleton.ts";

const { Window } = await import("happy-dom");
const css = readFileSync(fileURLToPath(new URL("../src/styles/skeleton.css", import.meta.url)), "utf8");
const page = () => new Window().document as unknown as Document;
/** A clock the test moves by hand. */
const clock = (t = 0) => ({ now: () => t, at: (ms: number) => void (t = ms) });

test("hand-worked: a skeleton done before 200 ms goes at once, one done after fades for 160 ms", () => {
  // Put up at 0 and done at 150 ms: 150 < 200, so it never became visible and goes now (0 ms).
  assert.equal(leaveAfter(150), 0);
  // Done at 500 ms: 500 ≥ 200, it showed, so it fades out over the 160 ms fade.
  assert.equal(leaveAfter(500), 160);
  // Boundaries of the 200 ms wait: 0.9× (180 ms) still unseen, 1.1× (220 ms) seen and faded.
  assert.equal(leaveAfter(0.9 * SKELETON_DELAY_MS), 0);
  assert.equal(leaveAfter(1.1 * SKELETON_DELAY_MS), SKELETON_FADE_MS);
  // Exactly at 200 ms the fade-in starts, so it fades out.
  assert.equal(leaveAfter(200), 160);
});

test("the CSS waits and fades for the same times as the code", () => {
  // .skeleton: animation skeleton-in <fade> … <delay> forwards; .skeleton-leaving: skeleton-out <fade>.
  const into = css.match(/\.skeleton \{[^}]*animation: skeleton-in (\d+)ms \S+(?: \S+)*? (\d+)ms forwards/);
  assert.ok(into, "the skeleton fades in after a wait");
  assert.equal(Number(into[2]), SKELETON_DELAY_MS);
  assert.equal(Number(into[1]), SKELETON_FADE_MS);
  const out = css.match(/\.skeleton\.skeleton-leaving \{[^}]*animation: skeleton-out (\d+)ms/);
  assert.equal(Number(out?.[1]), SKELETON_FADE_MS);
  // It starts invisible and never takes a click.
  assert.match(css, /\.skeleton \{[^}]*opacity: 0;[^}]*pointer-events: none;/);
  // Reduced motion: no sweep, no fade.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^]*\.skeleton \.skeleton-bone \{ animation: none; background-image: none; \}/);
});

test("every selector starts with .skeleton (a feature's own file)", () => {
  const selectors = css.replace(/\/\*[^]*?\*\//g, "").replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, "").match(/[^{}@]+(?=\{)/g) ?? [];
  const bad = selectors.map((s) => s.trim()).filter((s) => s && !s.startsWith("(") && !s.startsWith("media") && s.split(",").some((part) => !part.trim().startsWith(".skeleton")));
  assert.deepEqual(bad, []);
});

test("the shapes: three lines, a view, and the whole app", () => {
  const doc = page();
  const lines = skeleton(doc, "lines", "Waiting");
  assert.equal(lines.className, "skeleton skeleton-lines");
  assert.equal(lines.getAttribute("role"), "status");
  assert.equal(lines.getAttribute("aria-label"), "Waiting");
  assert.equal(lines.querySelectorAll(".skeleton-line").length, 3);
  assert.equal(lines.querySelectorAll(".skeleton-short").length, 1);
  const view = skeleton(doc, "view");
  assert.deepEqual([...view.children].map((c) => c.className), ["skeleton-bone skeleton-cube", "skeleton-bone skeleton-card", "skeleton-bone skeleton-pill"]);
  assert.equal(view.getAttribute("aria-label"), "Loading…");
  const app = skeleton(doc, "app");
  assert.equal(app.querySelectorAll(".skeleton-tool-group").length, 3);
  assert.equal(app.querySelectorAll(".skeleton-tool").length, 9);
  assert.equal(app.querySelectorAll(".skeleton-row").length, 5);
  assert.equal(app.querySelectorAll(".skeleton-view > .skeleton-bone").length, 3);
});

test("index.html's skeleton, there before any script, is the app shape the code builds", () => {
  const html = readFileSync(fileURLToPath(new URL("../../../apps/fission/index.html", import.meta.url)), "utf8");
  const doc = page();
  doc.body.innerHTML = html.match(/<main id="workspace"[^>]*>([^]*)<\/main>/)![1];
  const there = doc.getElementById("app-skeleton")!;
  assert.ok(there, "index.html has #app-skeleton");
  const built = skeleton(doc, "app", there.getAttribute("aria-label")!);
  assert.equal(there.innerHTML, built.innerHTML);
  for (const name of ["class", "role", "aria-label"]) assert.equal(there.getAttribute(name), built.getAttribute(name), name);
  // Its parent is the workspace, marked busy until the app has started.
  assert.match(html, /<main id="workspace" aria-busy="true">/);
});

test("held: the host is busy while it stays; done before 200 ms removes it at once", async () => {
  const doc = page();
  const host = doc.createElement("div");
  const c = clock(1000);
  const held = holdSkeleton(host, "view", "Opening", c.now);
  assert.equal(host.getAttribute("aria-busy"), "true");
  assert.equal(host.querySelector(".skeleton-view"), held.element);
  c.at(1000 + 0.9 * SKELETON_DELAY_MS);
  await held.done();
  assert.equal(host.querySelector(".skeleton"), null);
  assert.equal(host.hasAttribute("aria-busy"), false);
  assert.equal(held.element.classList.contains("skeleton-leaving"), false, "never seen, so never faded");
});

test("held: done after 200 ms fades it out first, then removes it; done twice is the same once", async () => {
  const doc = page();
  const host = doc.createElement("div");
  const c = clock(0);
  const held = holdSkeleton(host, "lines", undefined, c.now);
  c.at(1.1 * SKELETON_DELAY_MS);
  const gone = held.done();
  assert.equal(held.done(), gone);
  assert.ok(held.element.classList.contains("skeleton-leaving"));
  assert.ok(host.contains(held.element), "still there while it fades");
  await gone;
  assert.equal(host.contains(held.element), false);
  assert.equal(host.hasAttribute("aria-busy"), false);
});

test("two skeletons in one host: it stays busy until the last goes", async () => {
  const doc = page();
  const host = doc.createElement("div");
  const c = clock(0);
  const a = holdSkeleton(host, "view", undefined, c.now);
  const b = holdSkeleton(host, "lines", undefined, c.now);
  await a.done();
  assert.equal(host.getAttribute("aria-busy"), "true");
  await b.done();
  assert.equal(host.hasAttribute("aria-busy"), false);
});

test("adopt: a skeleton already in the page, timed from the page's start", async () => {
  const doc = page();
  const host = doc.createElement("main");
  const el = skeleton(doc, "app");
  host.append(el);
  const c = clock(5000);
  const held = adoptSkeleton(el, 0, c.now);
  assert.equal(host.getAttribute("aria-busy"), "true");
  await held.done(); // 5 s after the page started: it showed, so it fades
  assert.equal(host.contains(el), false);
});

test("whileLoading gives back the work's result, and its failure, and the skeleton goes either way", async () => {
  const doc = page();
  const host = doc.createElement("div");
  assert.equal(await whileLoading(host, "view", Promise.resolve(42)), 42);
  await new Promise((r) => setTimeout(r, SKELETON_FADE_MS + 20));
  assert.equal(host.querySelector(".skeleton"), null);
  await assert.rejects(whileLoading(host, "view", Promise.reject(new Error("bad file"))), /bad file/);
  await new Promise((r) => setTimeout(r, SKELETON_FADE_MS + 20));
  assert.equal(host.querySelector(".skeleton"), null);
});

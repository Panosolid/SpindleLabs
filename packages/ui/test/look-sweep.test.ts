import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// UX2c: the sketch toolbar, the guide and the AI panel use the clean look's
// shared values (theme.css :root) instead of their own colours: floating
// boxes take the card, edge and shadow values, and the bright blue fill
// belongs to a place's one main action.

const read = (rel: string, base = import.meta.url): string => readFileSync(fileURLToPath(new URL(rel, base)), "utf8");
const sources = {
  sketchbar: read("../../../workspaces/design/src/styles/sketchbar.css"),
  guide: read("../src/styles/guide.css"),
  assistant: read("../src/styles/assistant.css"),
};

/** The declarations of every rule whose selector (comments dropped) ends with `selector`, joined. */
function rule(css: string, selector: string): string {
  let out = "";
  for (const m of css.replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(",").some((part) => part.trim().endsWith(selector))) out += m[2];
  return out;
}

/** What is wrong with these three files, one line each (empty when the look is kept). */
function problems(s: typeof sources): string[] {
  const out: string[] = [];
  const finish = rule(s.sketchbar, "#finish-sketch:not(#none)");
  if (!finish.includes("var(--look-primary-fill)")) out.push("Finish Sketch is not the bright blue fill");
  if (/#1f5f3f|#3ddc97/i.test(s.sketchbar)) out.push("the sketch toolbar still has its old green");
  if (!rule(s.sketchbar, ".sketchbar .sketchbar-menu").includes("var(--look-shadow-2)")) out.push("the Create menu has no shared shadow");
  if (!rule(s.guide, ".guide .guide-card").includes("var(--look-float)")) out.push("the guide card is not the shared card");
  if (!rule(s.guide, ".guide .guide-bar button").includes("var(--look-radius-pill)")) out.push("the guide buttons are not pills");
  if (!rule(s.guide, ".guide .guide-progress i").includes("var(--look-accent)")) out.push("the guide progress is not the accent");
  if (!rule(s.assistant, ".assistant .ai-preview").includes("var(--look-shadow-1)")) out.push("the AI preview is not a shared card");
  if (!rule(s.assistant, 'button[id="ai-accept"]:not(#none)').includes("var(--look-primary-fill)")) out.push("Accept is not the bright blue fill");
  if (!rule(s.assistant, ".assistant:not(#none)").includes("var(--look-float)")) out.push("the AI panel is not the shared card colour");
  return out;
}

test("the sketch toolbar, guide and AI panel use the shared look values", () => {
  assert.deepEqual(problems(sources), []);
});

test("the check fails on the old green Finish Sketch, plain guide card and unstyled AI panel", () => {
  const old = {
    sketchbar: sources.sketchbar.replace("var(--look-primary-fill)", "#1f5f3f"),
    guide: sources.guide.replace(".guide .guide-card { position: sticky; top: 13vh; width: min(430px, 36vw); padding: 20px 22px; font-size: 15px; border-radius: var(--look-radius-l); background: var(--look-float);", ".guide .guide-card { position: sticky; top: 13vh; width: min(430px, 36vw); padding: 20px 22px; font-size: 15px; border-radius: 18px; background: rgba(8, 12, 36, 0.5);"),
    assistant: sources.assistant.replace(".assistant:not(#none) {", ".assistant-gone:not(#none) {"),
  };
  assert.deepEqual(problems(old), [
    "Finish Sketch is not the bright blue fill",
    "the sketch toolbar still has its old green",
    "the guide card is not the shared card",
    "the AI panel is not the shared card colour",
  ]);
});

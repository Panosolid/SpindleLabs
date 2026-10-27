// The greyed "Coming soon" tools (Ben, 2026-10-26): the menu items are off,
// say what each tool will do and do nothing; every one waits on a step
// still to do, so a placeholder never outlives its tool. The toolbar itself
// (Modify ▾ and Construct ▾ greyed, the items in each menu, nothing
// happening on a click or tap) is checked in apps/fission/e2e/toolbar.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMING_NOTE, COMING_SOON, comingItems, type ComingTool } from "../src/coming-soon.ts";

const repo = new URL("../../../", import.meta.url);
const roadmap = readFileSync(new URL("docs/roadmap.md", repo), "utf8");
const booleans = readFileSync(new URL("docs/progress/booleans.md", repo), "utf8");

/** Why `tool` should no longer be a placeholder: its step ticked done, or no such step; null while it is still to do. */
function stale(tool: ComingTool): string | null {
  // "- [ ] 45. Fillet…", or a substep "- [x] 30d (4/4). …".
  const line = new RegExp(`^\\s*- \\[( |x)\\] ${tool.step}(?:\\.| \\()`, "m");
  const found = (/^\d+$/.test(tool.step) ? roadmap : booleans).match(line);
  if (!found) return `${tool.label}: step ${tool.step} is in neither docs/roadmap.md nor docs/progress/booleans.md`;
  if (found[1] === "x") return `${tool.label}: step ${tool.step} is done, so switch the tool on and take its line out of COMING_SOON`;
  return null;
}

test("hand-checked: Modify ▾ lists Move/Rotate, Duplicate, Mirror, Combine, Chamfer, Fillet, Shell and Draft, each off, saying what it will do", () => {
  const items = comingItems("Modify");
  assert.deepEqual(items.map((i) => i.label), ["Move/Rotate", "Duplicate body", "Mirror body", "Combine", "Chamfer", "Fillet", "Shell", "Draft"]);
  const fillet = items.find((i) => i.id === "coming-fillet")!;
  assert.equal(fillet.off, "Fillet is coming soon: it will round the edges you pick.");
  assert.equal(fillet.note, "Coming soon");
  assert.deepEqual(fillet.data, { step: "45" });
  assert.deepEqual(comingItems("Construct").map((i) => i.label), ["Construction plane", "Construction axis", "Construction point"]);
  assert.deepEqual(comingItems("Inspect").map((i) => i.label), ["Measure", "Section view"]);
  assert.deepEqual(comingItems("Create").map((i) => i.label), ["Revolve", "Hole", "Pattern", "Sweep", "Loft"]);
});

test("every coming tool is off with the note, its tooltip a sentence naming it, and choosing it does nothing", () => {
  for (const group of ["Create", "Modify", "Construct", "Inspect"] as const)
    for (const item of comingItems(group)) {
      assert.equal(item.note, COMING_NOTE, item.id);
      assert.match(item.off ?? "", new RegExp(`^${item.label.replace(/[/]/g, "\\/")} is coming soon: it will [a-z][^.]*\\.$`), item.id);
      assert.equal(item.run(), undefined, item.id);
      assert.equal(item.key, undefined, `${item.id}: no key for a tool that isn't there`);
    }
  const ids = COMING_SOON.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  const labels = COMING_SOON.map((t) => t.label);
  assert.equal(new Set(labels).size, labels.length, "labels are unique");
  for (const real of ["Create sketch", "Extrude", "Body facts"]) assert.ok(!labels.includes(real), `${real} works today: never a placeholder`);
});

test("every coming tool waits on a step still to do (none outlives its tool)", () => {
  assert.deepEqual(COMING_SOON.map(stale).filter((s) => s !== null), []);
});

test("the step check can fail: a step done, an unknown step, a done substep", () => {
  const tool = (step: string): ComingTool => ({ id: "x", label: "Box", group: "Create", step, does: "make a box" });
  // Step 7 (box primitive in the viewer) is ticked in docs/roadmap.md.
  assert.equal(stale(tool("7")), "Box: step 7 is done, so switch the tool on and take its line out of COMING_SOON");
  assert.equal(stale(tool("999")), "Box: step 999 is in neither docs/roadmap.md nor docs/progress/booleans.md");
  // 30d is ticked in docs/progress/booleans.md.
  assert.match(stale(tool("30d")) ?? "", /step 30d is done/);
  assert.equal(stale(tool("35f")), null, "Combine's step is still to do");
});

// Every example says what its command does: an independent reading of the
// words (reader.ts) must give the same commands, over thousands of seeded
// examples. Then each way a recipe could mislabel its words is put in on
// purpose, and the check must catch it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DESIGN_COMMANDS } from "@fission/design";
import { commandsMatch } from "@fission/testing";
import type { Command } from "@fission/core";
import { DESIGN_RECIPES, DESIGN_RULES, generate, type Example, type Recipe } from "../src/index.ts";
import { CANNOT } from "../src/working.ts";
import { fakeKernel } from "./fakes.ts";
import { read } from "./reader.ts";

const same = (a: Command[], b: Command[]) => a.length === b.length && commandsMatch(a, b) && commandsMatch(b, a);

/** Examples whose words read as something else, with what they read as. */
function disagreements(examples: readonly Example[]): string[] {
  const out: string[] = [];
  for (const e of examples) {
    const reading = read(e.prompt, e.setup);
    if (!reading || !same(reading, e.commands)) out.push(`${e.recipe}: "${e.prompt}" on ${JSON.stringify(e.setup)}: the command says ${JSON.stringify(e.commands)}, the words read as ${JSON.stringify(reading)}`);
  }
  return out;
}

const run = async (seed: bigint, recipes: readonly Recipe[] = DESIGN_RECIPES, count = 3_000) => {
  const g = await generate({ seed, count, specs: DESIGN_COMMANDS, rules: DESIGN_RULES, recipes, kernel: fakeKernel(), heldOut: [] });
  assert.ok(g.ok);
  return g;
};

test("3 seeds × 3,000 examples: the words and the command always agree", async () => {
  for (const seed of [1n, 2n, 0x5eedn]) {
    const g = await run(seed);
    assert.equal(g.examples.length, 3_000);
    assert.deepEqual(g.conflicts, [], `seed ${seed}`);
    const bad = disagreements(g.examples);
    assert.deepEqual(bad.slice(0, 5), [], `seed ${seed}: ${bad.length} disagree`);
    // Every recipe and every shape is reached, so the agreement covers them all.
    assert.deepEqual(new Set(g.examples.map((e) => e.recipe)), new Set(DESIGN_RECIPES.map((r) => r.id)));
    assert.equal(new Set(g.examples.flatMap((e) => e.commands.map((c) => c.shape)).filter(Boolean)).size, 7);
  }
});

const sayOf = (c: Command) => DESIGN_RULES.find((r) => r.op === c.op)!.says(c);

/**
 * A recipe made wrong on purpose: each of its drafts passes through
 * `spoil`. Its working out is spoiled to match (the result it states is
 * the spoiled command's), as a recipe that misread its words would write
 * it, so the generator's own checks pass it and only the reader can tell.
 */
const spoiled = (spoil: (e: { prompt: string; commands: Command[] }) => Command[] | null): Recipe[] =>
  DESIGN_RECIPES.map((r) => ({
    ...r,
    sample(rand) {
      const d = r.sample(rand);
      const commands = d && spoil(d);
      if (!d || !commands) return d;
      // A refusal turned into a part (a stand-in) claims to make it, as a create.
      if (d.commands.length === 0) return { ...d, task: "create", commands, explanation: `So the new ${commands.map(sayOf).join(". ")}.` };
      const explanation = d.commands.reduce((text, c, i) => (commands[i] ? text.replace(sayOf(c), sayOf(commands[i])) : text), d.explanation);
      return { ...d, commands, explanation };
    },
  }));
const setPart = (cs: Command[], change: (c: Command) => Command) => cs.map((c) => (c.op === "set_part" ? change(c) : c));

test("deliberate breaks: each mislabelling is caught", async () => {
  const breaks: [string, (e: { prompt: string; commands: Command[] }) => Command[] | null][] = [
    // A radius written as the diameter (the A10 models' own mistake).
    ["radius as diameter", (e) => (/radius/.test(e.prompt) ? setPart(e.commands, (c) => ({ ...c, width: (c.width as number) / 2 })) : null)],
    // Centimetres not converted.
    ["cm not converted", (e) => (/\d ?(cm|centimet)/.test(e.prompt) ? setPart(e.commands, (c) => ({ ...c, width: (c.width as number) / 10 })) : null)],
    // Inches taken as 25 mm.
    ["inch as 25 mm", (e) => (/\d ?(in\b|inch|")/.test(e.prompt) ? setPart(e.commands, (c) => ({ ...c, height: ((c.height as number) / 25.4) * 25 })) : null)],
    // "Wider" made narrower.
    ["sign flipped", (e) => (/wider/.test(e.prompt) ? setPart(e.commands, (c) => ({ ...c, width: (c.width as number) - 2 })) : null)],
    // Width and depth swapped.
    ["width and depth swapped", (e) => (e.commands[0]?.depth !== e.commands[0]?.width ? setPart(e.commands, (c) => ({ ...c, width: c.depth, depth: c.width })) : null)],
    // An edit forgets a size it should keep.
    ["kept size changed", (e) => (/twice as tall/.test(e.prompt) ? setPart(e.commands, (c) => ({ ...c, width: (c.width as number) + 1 })) : null)],
    // The wrong shape.
    ["wrong shape", (e) => (/\bball\b/.test(e.prompt) ? setPart(e.commands, (c) => ({ ...c, shape: "cylinder" })) : null)],
    // The export forgotten.
    ["export dropped", (e) => (/\bstl\b/i.test(e.prompt) && e.commands.length === 2 ? e.commands.slice(0, 1) : null)],
    // A sketch started on the wrong plane: the front (XZ) taken as the top (AI7a).
    ["front as top", (e) => (/\bfront\b/.test(e.prompt) && e.commands[0]?.op === "create_sketch" ? [{ op: "create_sketch", on: "XY" }] : null)],
    // AI7b: a circle's radius taken as its diameter, and a rectangle's sides swapped.
    ["circle radius as diameter", (e) => (/radius/.test(e.prompt) && e.commands[1]?.op === "draw_circle" ? [e.commands[0], { ...e.commands[1], diameter: (e.commands[1].diameter as number) / 2 }] : null)],
    ["rectangle sides swapped", (e) => (e.commands[1]?.op === "draw_rectangle" && e.commands[1].width !== e.commands[1].height ? [e.commands[0], { ...e.commands[1], width: e.commands[1].height, height: e.commands[1].width }] : null)],
    // AI7c: "the other way" read as straight on, a distance doubled, and the extrude forgotten.
    ["extrude other way as straight on", (e) => (e.commands[2]?.op === "extrude_sketch" && (e.commands[2].distance as number) < 0 ? [...e.commands.slice(0, 2), { ...e.commands[2], distance: -(e.commands[2].distance as number) }] : null)],
    ["extrude distance doubled", (e) => (e.commands[2]?.op === "extrude_sketch" ? [...e.commands.slice(0, 2), { ...e.commands[2], distance: (e.commands[2].distance as number) * 2 }] : null)],
    ["extrude dropped", (e) => (e.commands[2]?.op === "extrude_sketch" ? e.commands.slice(0, 2) : null)],
    // AI7d: the wrong sketch renamed (the next one along), the name changed, the item named when the sketch is the one just made, the item left out when it is not, and the rename forgotten.
    ["rename of the wrong sketch", (e) => (e.commands[0]?.op === "rename_item" && e.commands[0].item !== undefined ? [{ ...e.commands[0], item: `Sketch ${Number(String(e.commands[0].item).slice(7)) + 1}` }] : null)],
    ["rename with another name", (e) => (e.commands.at(-1)?.op === "rename_item" ? [...e.commands.slice(0, -1), { ...e.commands.at(-1)!, name: `${String(e.commands.at(-1)!.name)} 2` }] : null)],
    ["new sketch renamed by a name that is not its own", (e) => (e.commands[1]?.op === "rename_item" ? [e.commands[0], { ...e.commands[1], item: "Sketch 1" }] : null)],
    ["existing sketch renamed with no item", (e) => (e.commands[0]?.op === "rename_item" && e.commands[0].item !== undefined ? [{ op: "rename_item", name: e.commands[0].name }] : null)],
    ["rename dropped", (e) => (e.commands[1]?.op === "rename_item" ? e.commands.slice(0, 1) : null)],
    // A sketch request answered with a thin stand-in part (Ben's circle, 2026-10-26).
    ["a stand-in for a sketch", (e) => (e.commands.length === 0 && /sketch/i.test(e.prompt) ? [{ op: "set_part", shape: "cylinder", width: 20, depth: 20, height: 0.01 }] : null)],
  ];
  for (const [name, spoil] of breaks) {
    const g = await run(7n, spoiled(spoil), 1_500);
    assert.ok(disagreements(g.examples).length > 0, `${name} was not caught`);
  }
});

test("a cannot example has no commands, about every kind of request Design can't do, and its working out says so", async () => {
  const g = await run(11n, DESIGN_RECIPES, 2_000);
  const cannot = g.examples.filter((e) => e.task === "cannot");
  // About 1 recipe in 13 (13 recipes): 154 expected of 2,000 (seed 11 is fixed); over 150 shows the recipe runs.
  assert.ok(cannot.length > 150, `${cannot.length}`);
  for (const e of cannot) {
    assert.deepEqual(e.commands, [], e.prompt);
    assert.ok(e.explanation.includes(CANNOT), e.explanation);
    // It names what is missing, and never a size it made up: the only numbers are none at all.
    assert.doesNotMatch(e.explanation, /\d/, e.explanation);
  }
  const needs = new Set(cannot.map((e) => e.explanation.match(/There is no command for (.+?) yet/)?.[1]));
  assert.deepEqual([...needs].sort(), ["a chamfer", "a hole", "copies or patterns", "drawing arcs", "hollowing a part out (a shell)", "rounding edges (a fillet)", "text"]);
  // And no other example asks for any of these: the words decide which kind a request is.
  for (const e of g.examples.filter((x) => x.task !== "cannot")) assert.deepEqual(read(e.prompt, e.setup)?.length === 0, false, e.prompt);
});

test("every working out states the part its commands make, and every size it reads in another unit is converted", async () => {
  const g = await run(12n, DESIGN_RECIPES, 2_000);
  for (const e of g.examples) {
    for (const c of e.commands) assert.ok(e.explanation.includes(sayOf(c)), `${e.prompt}: ${e.explanation}`);
    // A prompt in cm, m or inches has its conversion written out (every unit but mm and a bare number).
    // (A name in quotes, AI7d, is not a length: "Sketch 1 "base"" has no inch mark.)
    const lengthsOnly = /^design\.(rename|sketch-name)$/.test(e.recipe) ? e.prompt.replace(/"[^"]*"/g, "") : e.prompt;
    if (e.task !== "cannot" && /\d ?(cm|centimet|m\b|met|in\b|inch|")/.test(lengthsOnly)) assert.match(e.explanation, / is [\d.]+ mm/, `${e.prompt}: ${e.explanation}`);
  }
});

test("deliberate breaks of the working out: each is caught and the draft dropped", async () => {
  const spoilWorking = (spoil: (text: string) => string): Recipe[] => DESIGN_RECIPES.map((r) => ({ ...r, sample: (rand) => ((d) => (d ? { ...d, explanation: spoil(d.explanation) } : d))(r.sample(rand)) }));
  const breaks: [string, (text: string) => string, string][] = [
    // Centimetres converted by 100, not 10.
    ["cm by 100", (t) => t.replace(/(\d+(?:\.\d+)?) cm is [\d.]+ mm/, (_, n) => `${n} cm is ${Number(n) * 100} mm`), "working out converts wrongly"],
    // A radius doubled one too many.
    ["radius sum off by one", (t) => t.replace(/2 × ([\d.]+) = ([\d.]+)/, (_, r, w) => `2 × ${r} = ${Number(w) + 1}`), "working out sums wrongly"],
    // The result states the size before the change.
    ["stale result", (t) => t.replace(/So the part is (.+?): width [\d.]+ mm/, "So the part is $1: width 999999 mm"), "working out doesn't say what command 1 makes"],
    // The refusal loses its reason.
    ["refusal without a reason", (t) => t.replace(/can't/g, "cannot"), "working out of an answer with no commands"],
  ];
  for (const [name, spoil, why] of breaks) {
    const g = await run(13n, spoilWorking(spoil), 1_500);
    const caught = Object.entries(g.dropped).filter(([k]) => k.startsWith(why)).reduce((n, [, v]) => n + v, 0);
    assert.ok(caught > 0, `${name} was not caught: ${JSON.stringify(g.dropped)}`);
  }
});

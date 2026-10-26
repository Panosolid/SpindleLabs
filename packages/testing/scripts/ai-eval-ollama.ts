// The A10 check (AI3): scores small free models, through Ollama, on the
// evaluation suite with the one command the assistant offers (set_part),
// the same prompt and the same constrained output the app uses. It scores
// the original cases and the held-out ones (AI4) separately, so a prompt
// change can be judged on cases it was never written against. Writes a
// table per set (Markdown) and the full results (JSON). A measurement: it
// exits 0 whatever the scores, and 1 only if it couldn't run.
//
//   node --experimental-strip-types packages/testing/scripts/ai-eval-ollama.ts <out.json> <model> [model…]
//
// OLLAMA_URL (default http://localhost:11434) says where Ollama listens.
// VARIANTS (default "app") names the prompt variants to score, separated
// by spaces: "app" is exactly what the app sends; the others change one
// thing each (VARIANTS below), so a run can show which rule helps or hurts
// small untrained models (AI5c: the working out and the refusal rule).

import { writeFileSync } from "node:fs";
import { CANNOT_RULE, createProvider, EXPLAIN_RULE, systemPrompt, type AIProvider, type AIRequest } from "@fission/ai";
import { DESIGN_COMMANDS } from "@fission/design";
import { EVAL_CASES, HELD_OUT_CASES, runEval, successRates, type EvalCase, type EvalResult } from "../src/ai-eval.ts";

const [out, ...models] = process.argv.slice(2);
if (!out || models.length === 0) {
  console.error("usage: ai-eval-ollama.ts <out.json> <model> [model…]");
  process.exit(1);
}
const specs = DESIGN_COMMANDS.filter((c) => c.op === "set_part");
const SETS: { name: string; cases: readonly EvalCase[] }[] = [
  { name: "original", cases: EVAL_CASES },
  { name: "held-out", cases: HELD_OUT_CASES },
];
/** The working out after the commands: the line that takes EXPLAIN_RULE's place when the schema puts commands first. */
const EXPLAIN_AFTER = 'After the commands, write in "explanation" one short sentence saying what they make.';
/** `drops` are the rules the variant takes out of the prompt (checked below: a rule that isn't there stops the run rather than score the app's prompt under another name). */
type Variant = { drops: string[]; commandsFirst: boolean };
const VARIANTS: Record<string, Variant> = {
  app: { drops: [], commandsFirst: false },
  "no-cannot": { drops: [CANNOT_RULE], commandsFirst: false },
  "commands-first": { drops: [EXPLAIN_RULE, CANNOT_RULE], commandsFirst: true },
  "commands-first-cannot": { drops: [EXPLAIN_RULE], commandsFirst: true },
};
const variants = (process.env.VARIANTS ?? "app").split(/\s+/).filter(Boolean);
const sample = systemPrompt([], specs);
for (const v of variants) {
  if (!VARIANTS[v]) {
    console.error(`unknown variant ${v}: one of ${Object.keys(VARIANTS).join(", ")}`);
    process.exit(1);
  }
  const missing = VARIANTS[v].drops.find((rule) => !sample.includes(`${rule}\n`));
  if (missing) {
    console.error(`variant ${v}: the prompt has no line "${missing.slice(0, 40)}…" to take out`);
    process.exit(1);
  }
}

/** The provider with one variant's changes made to every request it is sent. */
function withVariant(provider: AIProvider, v: Variant): AIProvider {
  const change = (r: AIRequest): AIRequest => {
    const schema = r.jsonSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
    const reordered =
      v.commandsFirst && schema?.properties
        ? { ...schema, properties: { commands: schema.properties.commands, explanation: schema.properties.explanation }, required: ["commands", "explanation"] }
        : schema;
    let system = r.system;
    for (const rule of v.drops) {
      system = system.replace(`${rule}\n`, rule === EXPLAIN_RULE ? `${EXPLAIN_AFTER}\n` : "");
    }
    return { ...r, system, jsonSchema: reordered };
  };
  return { kind: provider.kind, structuredOutput: provider.structuredOutput, check: () => provider.check(), complete: (r) => provider.complete(change(r)) };
}

type Score = { model: string; seconds: number; rates: ReturnType<typeof successRates>; passed: number; firstTry: number; results: EvalResult[] };
const report: Record<string, Score[]> = Object.fromEntries(SETS.map((s) => [s.name, []]));

for (const model of models) {
  const plain = createProvider({ kind: "ollama", model, endpoint: process.env.OLLAMA_URL });
  const check = await plain.check();
  if (!check.ok) {
    console.error(`${model}: ${check.reason}`);
    process.exit(1);
  }
  for (const variant of variants) {
    const provider = withVariant(plain, VARIANTS[variant]);
    const name = variants.length === 1 && variant === "app" ? model : `${model} (${variant})`;
    for (const set of SETS) {
      const started = performance.now();
      const results = await runEval(provider, set.cases, specs);
      const seconds = (performance.now() - started) / 1000;
      report[set.name].push({ model: name, seconds, rates: successRates(results), passed: results.filter((r) => r.passed).length, firstTry: results.filter((r) => r.attempts === 1).length, results });
      for (const r of results) console.log(`${name}  ${set.name}  ${r.passed ? "PASS" : "FAIL"}  ${r.id}  ${r.detail}${r.explanation ? `  (${r.explanation})` : ""}`);
    }
  }
}

const pct = (x: number | undefined) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const lines = SETS.flatMap((set) => {
  const n = set.cases.filter((c) => !c.waitsFor).length;
  return [
    `### A10 check, ${set.name} cases: ${n}, set_part only`,
    "",
    "| Model | Right | Create | Edit | Can't | Usable first try | Time |",
    "|---|---|---|---|---|---|---|",
    ...report[set.name].map((r) => `| ${r.model} | ${r.passed}/${n} | ${pct(r.rates.create)} | ${pct(r.rates["edit-parameter"])} | ${pct(r.rates.cannot)} | ${r.firstTry}/${n} | ${r.seconds.toFixed(0)} s |`),
    "",
    "Wrong answers:",
    ...report[set.name].flatMap((r) => r.results.filter((x) => !x.passed).map((x) => `- ${r.model}, ${x.id}: ${x.detail}${x.explanation ? ` (its working out: ${x.explanation})` : ""}`)),
    "",
  ];
});
console.log(lines.join("\n"));
writeFileSync(out, JSON.stringify(Object.fromEntries(SETS.map((s) => [s.name, { cases: s.cases.filter((c) => !c.waitsFor).map((c) => c.id), report: report[s.name] }])), null, 2));
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", { flag: "a" });

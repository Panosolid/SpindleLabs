// What the model is told before the user's words: its job, the commands it
// may use (with what each parameter means), the rules for sizes, and the
// part as the commands that make it. The assistant panel and the
// evaluation suite (packages/testing ai-eval.ts) use this one text, so the
// scores measure what users get.
//
// The command list is written out here because constrained output (Ollama's
// `format`) holds the answer to the schema without showing the model the
// schema's descriptions: without it, a model never learns that a
// cylinder's width is its diameter (AI4).

import type { Command, CommandSpec, ParamSpec } from "@fission/core";

/** Sizes in words are turned into millimetres with these (exact, by definition of each unit). */
export const UNIT_RULE = "Every length in a command is in millimetres. Convert other units first: 1 cm = 10 mm, 1 m = 1000 mm, 1 inch = 25.4 mm.";
export const RADIUS_RULE = 'A diameter is twice the radius: when the user gives a radius, use twice it wherever a diameter is asked for. A size "across" is a diameter.';
export const CUBE_RULE = "A cube is a box whose width, depth and height are all the same.";
/** The working out comes first (docs/ai.md, "Full working out"); the schema puts it before the commands. */
export const EXPLAIN_RULE =
  'Write your working out in "explanation" before the commands, in a few plain sentences: what the part is now, how you read each size (converted to millimetres, with the sum shown, as in "a radius of 1.5 cm is 15 mm, so the diameter is 2 × 15 = 30 mm"), and the sizes the part ends up with.';
/** An honest "can't do that yet" beats a wrong part: a circle sketch is not a 0.01 mm thick cylinder. */
export const CANNOT_RULE =
  "Use a command only for what it really makes. If the request needs something none of the commands can do (drawing a sketch, say, or a hole, a fillet or a feature the list doesn't have), send no commands and say plainly in the explanation what can't be done yet. Never stand in for it with another shape or a tiny size.";

function describe(name: string, p: ParamSpec): string {
  const kind = p.type === "length" ? "millimetres, more than 0" : p.type === "choice" ? `one of: ${p.values.join(", ")}` : "";
  const notes = [kind, p.optional ? "optional" : ""].filter(Boolean).join("; ");
  return `  ${name}: ${p.description}${notes ? ` (${notes})` : ""}`;
}

/**
 * The instructions for one request about a project made by `setup` (empty:
 * a new project), offering `specs`. `notes` are the workspace's own lines
 * about what is open (`AIView.notes`: Design's timeline, 25c3); with notes
 * and no setup, no command makes what is open (an extruded sketch).
 */
export function systemPrompt(setup: readonly Command[], specs: readonly CommandSpec[], notes: readonly string[] = []): string {
  return [
    "You edit a CAD part in SpindleLabs by answering with commands.",
    "The commands you can use:",
    ...specs.flatMap((s) => [`- ${s.op}: ${s.summary}`, ...Object.entries(s.params).map(([name, p]) => describe(name, p))]),
    setup.length === 0 && notes.length > 0 ? "No command you can use makes the part as it is now." : `The part now is made by these commands: ${JSON.stringify(setup)}`,
    ...notes,
    UNIT_RULE,
    RADIUS_RULE,
    CUBE_RULE,
    EXPLAIN_RULE,
    CANNOT_RULE,
    "Answer with the commands that make what the user asks for. Keep every size the user doesn't mention as it is now.",
  ].join("\n");
}

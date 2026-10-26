import { test } from "node:test";
import assert from "node:assert/strict";
import type { CommandSpec } from "@fission/core";
import { askForCommands, saysCannot, type AIProvider, type AIRequest } from "../src/index.ts";

const specs: CommandSpec[] = [{ op: "set_part", summary: "s", params: { width: { type: "length", description: "w" } } }];
const good = JSON.stringify({ commands: [{ op: "set_part", width: 40 }] });

/** A provider stand-in that answers from a script and records what it was asked. */
function scripted(answers: (string | Error)[], structuredOutput = false) {
  const asked: AIRequest[] = [];
  const provider: AIProvider = {
    kind: "ollama",
    structuredOutput,
    check: async () => ({ ok: true }),
    complete: async (r) => {
      asked.push(r);
      const a = answers.shift()!;
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return { provider, asked };
}

const request = { system: "You edit a CAD part.", messages: [{ role: "user" as const, content: "make it 40 wide" }] };

test("a good answer is used as is", async () => {
  const { provider } = scripted([good]);
  assert.deepEqual(await askForCommands(provider, request, specs), { ok: true, commands: [{ op: "set_part", width: 40 }], explanation: "", attempts: 1 });
});

test("providers with structured output get the schema; others get it in the instructions", async () => {
  const a = scripted([good], true);
  await askForCommands(a.provider, request, specs);
  assert.ok(a.asked[0].jsonSchema);
  const b = scripted([good], false);
  await askForCommands(b.provider, request, specs);
  assert.equal(b.asked[0].jsonSchema, undefined);
  assert.match(b.asked[0].system, /Answer only with JSON matching this schema/);
});

test("a bad answer is retried once, telling the model what was wrong", async () => {
  const { provider, asked } = scripted(['{"commands":[{"op":"set_part","width":-1}]}', good]);
  const r = await askForCommands(provider, request, specs);
  assert.deepEqual(r, { ok: true, commands: [{ op: "set_part", width: 40 }], explanation: "", attempts: 2 });
  assert.match(asked[1].messages.at(-1)!.content, /width must be a length in mm greater than 0, got -1/);
});

test("two bad answers fail clearly and change nothing", async () => {
  const { provider, asked } = scripted(["no", "still no", good]);
  assert.deepEqual(await askForCommands(provider, request, specs), {
    ok: false,
    error: "The AI's answer couldn't be used, even after one retry: the answer is not JSON. Nothing was changed.",
  });
  assert.equal(asked.length, 2, "only one retry");
});

test("a provider error is reported, not thrown", async () => {
  const { provider } = scripted([new Error("connection refused")]);
  assert.deepEqual(await askForCommands(provider, request, specs), { ok: false, error: "the AI provider failed: connection refused" });
});

test("the working out comes back with the commands, as the model wrote it", async () => {
  const said = "The box is 30 mm wide now; 40 mm wide is 30 + 10 = 40 mm.";
  const { provider } = scripted([JSON.stringify({ explanation: said, commands: [{ op: "set_part", width: 40 }] })]);
  assert.deepEqual(await askForCommands(provider, request, specs), { ok: true, commands: [{ op: "set_part", width: 40 }], explanation: said, attempts: 1 });
});

test("no commands with a reason is an honest answer; no commands and no reason is retried", async () => {
  const why = "No command can draw a sketch yet, so nothing was made.";
  const honest = scripted([JSON.stringify({ explanation: why, commands: [] })]);
  assert.deepEqual(await askForCommands(honest.provider, request, specs), { ok: true, commands: [], explanation: why, attempts: 1 });
  // Blank, or only spaces, says nothing.
  for (const blank of ["", "   "]) {
    const { provider, asked } = scripted([JSON.stringify({ explanation: blank, commands: [] }), good]);
    assert.deepEqual(await askForCommands(provider, request, specs), { ok: true, commands: [{ op: "set_part", width: 40 }], explanation: "", attempts: 2 });
    assert.match(asked[1].messages.at(-1)!.content, /That answer can't be used: it has no commands and doesn't say why\./);
  }
  const twice = scripted(['{"commands":[]}', '{"explanation":"","commands":[]}']);
  assert.deepEqual(await askForCommands(twice.provider, request, specs), {
    ok: false,
    error: "The AI's answer couldn't be used, even after one retry: it has no commands and doesn't say why. Nothing was changed.",
  });
});

test("no commands with a working out that only describes a part is retried, saying so (AI5c's first evaluation run)", async () => {
  // llama3.2 wrote this for "Make a box 40 by 30 by 20 mm." and then closed an empty list.
  const described = "The width, depth and height are 40 mm, 30 mm and 20 mm. The part will be a box with these dimensions.";
  const { provider, asked } = scripted([JSON.stringify({ explanation: described, commands: [] }), good]);
  assert.deepEqual(await askForCommands(provider, request, specs), { ok: true, commands: [{ op: "set_part", width: 40 }], explanation: "", attempts: 2 });
  assert.match(asked[1].messages.at(-1)!.content, /it has no commands, but the explanation doesn't say the request can't be done\. If the commands can do it, send them/);
});

test("what counts as saying it can't be done (worked by hand)", () => {
  for (const yes of ["I can't draw sketches yet.", "This cannot be done.", "There is no command for a hole.", "Fillets are not supported yet.", "I CAN NOT do that", "It cant be done", "That isn’t possible with these commands."])
    assert.equal(saysCannot(yes), true, yes);
  // Words that only look alike: "canteen", "scant", "cannon"; and a plain description of a part.
  for (const no of ["", "The part will be a box 40 mm wide.", "A canteen-shaped part, scant 2 mm walls.", "A cannon barrel 30 mm across.", "Commands: set the width to 50 mm."])
    assert.equal(saysCannot(no), false, no);
});

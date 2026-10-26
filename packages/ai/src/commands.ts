// The AI's only output: its working out in plain words, then commands
// from the public command API, checked before anything is built. Never
// geometry, never coordinates it guessed.

import { commandListSchema, parseCommandList, type Command, type CommandSpec } from "@fission/core";
import type { AIProvider, AIRequest } from "./providers.ts";

/**
 * `explanation` is the model's working out in plain words (docs/ai.md,
 * "Full working out"), or "" when it gave none. No commands with an
 * explanation is an honest "can't do that": the explanation says why.
 */
export type AskResult = { ok: true; commands: Command[]; explanation: string; attempts: 1 | 2 } | { ok: false; error: string };

/**
 * Asks the provider for commands. With structured output it is held to
 * the generated schema; either way the answer is checked, and a bad one
 * is retried once with the problem explained. A second bad answer fails
 * clearly. Never throws for a bad answer; a provider error is reported too.
 * An answer with no commands must say why (it can't be done with the
 * commands offered); with neither, it is a bad answer.
 */
export async function askForCommands(provider: AIProvider, request: Omit<AIRequest, "jsonSchema">, specs: readonly CommandSpec[]): Promise<AskResult> {
  const schema = commandListSchema(specs);
  let req: AIRequest = { ...request, jsonSchema: provider.structuredOutput ? schema : undefined };
  if (!provider.structuredOutput) req = { ...req, system: `${req.system}\n\nAnswer only with JSON matching this schema:\n${JSON.stringify(schema)}` };
  let lastError = "";
  for (const attempt of [1, 2] as const) {
    let text: string;
    try {
      text = await provider.complete(req);
    } catch (e) {
      return { ok: false, error: `the AI provider failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    const parsed = parseCommandList(text, specs);
    if (parsed.ok && (parsed.commands.length > 0 || parsed.explanation !== "")) return { ok: true, commands: parsed.commands, explanation: parsed.explanation, attempts: attempt };
    lastError = parsed.ok ? "it has no commands and doesn't say why" : parsed.error;
    req = {
      ...req,
      messages: [...req.messages, { role: "assistant", content: text }, { role: "user", content: `That answer can't be used: ${lastError}. Answer again with valid JSON only.` }],
    };
  }
  return { ok: false, error: `The AI's answer couldn't be used, even after one retry: ${lastError}. Nothing was changed.` };
}

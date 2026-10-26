// The AI's only output: its working out in plain words, then commands
// from the public command API, checked before anything is built. Never
// geometry, never coordinates it guessed.

import { commandListSchema, parseCommandList, type Command, type CommandSpec } from "@fission/core";
import { progressOf, waiting, type Progress } from "./progress.ts";
import type { AIProvider, AIRequest } from "./providers.ts";

/**
 * `explanation` is the model's working out in plain words (docs/ai.md,
 * "Full working out"), or "" when it gave none. No commands with an
 * explanation is an honest "can't do that": the explanation says why.
 */
export type AskResult = { ok: true; commands: Command[]; explanation: string; attempts: 1 | 2 } | { ok: false; error: string };

/**
 * Whether a working out says the request can't be done: the one reason an
 * answer may send no commands. Plain words a refusal uses ("can't",
 * "cannot", "no command", "not supported"); an answer that only describes
 * a part ("The part will be a box 40 mm wide.") is not one.
 */
export function saysCannot(explanation: string): boolean {
  return /\b(can['’]?t|cannot|can not|unable|not able|not possible|isn['’]t possible|no command|not supported|isn['’]t supported|not available|isn['’]t available)\b/i.test(explanation);
}

/**
 * Asks the provider for commands. With structured output it is held to
 * the generated schema; either way the answer is checked, and a bad one
 * is retried once with the problem explained. A second bad answer fails
 * clearly. Never throws for a bad answer; a provider error is reported too.
 * An answer with no commands must say that the request can't be done
 * (`saysCannot`); otherwise it is a bad answer: small models write a right
 * working out and then close an empty list (AI5c's first evaluation run).
 * With `onProgress`, the answer is streamed and its progress reported
 * (AI5c2): asking, then each piece as it is written, then checking, for
 * each attempt.
 */
export async function askForCommands(
  provider: AIProvider,
  request: Omit<AIRequest, "jsonSchema" | "onText">,
  specs: readonly CommandSpec[],
  onProgress?: (p: Progress) => void,
): Promise<AskResult> {
  const schema = commandListSchema(specs);
  let req: AIRequest = { ...request, jsonSchema: provider.structuredOutput ? schema : undefined };
  if (!provider.structuredOutput) req = { ...req, system: `${req.system}\n\nAnswer only with JSON matching this schema:\n${JSON.stringify(schema)}` };
  let lastError = "";
  for (const attempt of [1, 2] as const) {
    let text: string;
    onProgress?.(waiting("asking", attempt));
    try {
      text = await provider.complete(onProgress ? { ...req, onText: (soFar) => onProgress(progressOf(soFar, attempt)) } : req);
    } catch (e) {
      return { ok: false, error: `the AI provider failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    onProgress?.(waiting("checking", attempt));
    const parsed = parseCommandList(text, specs);
    if (parsed.ok && (parsed.commands.length > 0 || saysCannot(parsed.explanation))) return { ok: true, commands: parsed.commands, explanation: parsed.explanation, attempts: attempt };
    lastError = !parsed.ok
      ? parsed.error
      : parsed.explanation === ""
        ? "it has no commands and doesn't say why"
        : "it has no commands, but the explanation doesn't say the request can't be done. If the commands can do it, send them; if not, say plainly what can't be done";
    req = {
      ...req,
      messages: [...req.messages, { role: "assistant", content: text }, { role: "user", content: `That answer can't be used: ${lastError}. Answer again with valid JSON only.` }],
    };
  }
  return { ok: false, error: `The AI's answer couldn't be used, even after one retry: ${lastError}. Nothing was changed.` };
}

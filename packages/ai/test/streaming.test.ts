// AI5c2: answers streamed as they are written, and the progress they
// report. Every provider is driven by a stand-in that sends its answer in
// pieces, the way the real one does; nothing here talks to a real model.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CommandSpec } from "@fission/core";
import {
  ASKING,
  askForCommands,
  CHECKING,
  createProvider,
  memoryKeyStore,
  partialString,
  progressOf,
  streamLines,
  TYPICAL_ANSWER,
  type BuiltInModelLike,
  type Progress,
  type WebLLMChunk,
  type WebLLMLike,
} from "../src/index.ts";
import { cut, fakeServer, rng, SEED, streamServer } from "./fakes.ts";

const specs: CommandSpec[] = [{ op: "set_part", summary: "s", params: { width: { type: "length", description: "w" } } }];
const ANSWER = '{"commands":[{"op":"set_part","width":50}],"explanation":"The part is 50 mm wide: 5 cm is 50 mm."}';
const request = { system: "S", messages: [{ role: "user" as const, content: "Make it 5 cm wide." }] };
const KEY = "sk-test-0123456789";

// ---------- streamLines (http.ts) ----------

test("lines come out whole however the bytes are cut, a character split across pieces included", async () => {
  // "ø" is two bytes in UTF-8 (C3 B8): sending them in separate pieces must still give "ø", not two broken characters.
  const bytes = new TextEncoder().encode("a ø\r\nsecond\n\nlast");
  const at = bytes.indexOf(0xb8);
  const { fetch } = streamServer(() => ({ chunks: [bytes.slice(0, at), bytes.slice(at, at + 3), bytes.slice(at + 3)] }));
  const lines: string[] = [];
  await streamLines({ fetch, url: "http://x.test", body: {}, timeoutMs: 1000, who: "X" }, (l) => lines.push(l));
  // Worked by hand: CRLF and LF both end a line, an empty line is still a line, and the last one needs no line ending.
  assert.deepEqual(lines, ["a ø", "second", "", "last"]);
});

test("a stream that stops part way is given up after the time limit, in plain words", async () => {
  const { fetch } = streamServer(() => ({ chunks: ['{"message":{"content":"{"}}\n'], stall: true }));
  const lines: string[] = [];
  await assert.rejects(streamLines({ fetch, url: "http://x.test", body: {}, timeoutMs: 30, who: "Ollama at http://x.test" }, (l) => lines.push(l)), /^Error: Ollama at http:\/\/x\.test didn't answer within 0 s$/);
  assert.equal(lines.length, 1, "what came before the stall was read");
});

test("a refused streamed request says why in the provider's words; an error while reading never shows the key", async () => {
  const refused = streamServer(() => ({ status: 401, chunks: ['{"error":{"message":"bad key ' + KEY + '"}}'] }));
  await assert.rejects(streamLines({ fetch: refused.fetch, url: "https://a.test", body: {}, timeoutMs: 1000, who: "A", secret: KEY }, () => {}), (e: Error) => {
    assert.equal(e.message, "A refused the request (HTTP 401): bad key [your key]");
    return true;
  });
  const echo = streamServer(() => ({ chunks: ["data: x\n"] }));
  await assert.rejects(
    streamLines({ fetch: echo.fetch, url: "https://a.test", body: {}, timeoutMs: 1000, who: "A", secret: KEY }, () => {
      throw new Error(`the line repeats ${KEY}`);
    }),
    { message: "the line repeats [your key]" },
  );
});

// ---------- each provider ----------

/** Asks with onText and returns the answer and every text onText was given. */
async function streamed(p: ReturnType<typeof createProvider>) {
  const seen: string[] = [];
  const answer = await p.complete({ ...request, jsonSchema: { type: "object" }, onText: (t) => seen.push(t) });
  return { answer, seen };
}

/** Each text onText gets is the one before with more on the end, and the last is the whole answer. */
function growsTo(seen: readonly string[], answer: string) {
  assert.ok(seen.length > 1, "more than one piece");
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i].startsWith(seen[i - 1]) && seen[i].length > seen[i - 1].length, `piece ${i} adds to piece ${i - 1}`);
  assert.equal(seen.at(-1), answer);
}

test("Ollama streams when asked (stream: true), piece by piece, and not otherwise", async () => {
  const random = rng(SEED);
  const pieces = cut(ANSWER, random);
  const lines = [...pieces.map((c) => JSON.stringify({ message: { role: "assistant", content: c }, done: false }) + "\n"), '{"message":{"role":"assistant","content":""},"done":true}\n'];
  // The lines themselves are cut at random too: a line may arrive in several pieces of the body.
  const { fetch, calls } = streamServer(() => ({ chunks: cut(lines.join(""), random, 40) }));
  const p = createProvider({ kind: "ollama", model: "m" }, { fetch });
  const { answer, seen } = await streamed(p);
  assert.equal(answer, ANSWER, `seed ${SEED}`);
  growsTo(seen, ANSWER);
  assert.equal((calls[0].body as { stream: boolean }).stream, true);
  const whole = fakeServer(() => ({ json: { message: { content: ANSWER } } }));
  assert.equal(await createProvider({ kind: "ollama", model: "m" }, { fetch: whole.fetch }).complete(request), ANSWER);
  assert.equal((whole.calls[0].body as { stream: boolean }).stream, false);
});

test("Ollama: an error part way through a stream is reported, and a line that isn't JSON is refused", async () => {
  const failing = streamServer(() => ({ chunks: ['{"message":{"content":"{\\"com"}}\n', '{"error":"model ran out of memory"}\n'] }));
  await assert.rejects(streamed(createProvider({ kind: "ollama", model: "m" }, { fetch: failing.fetch })), /^Error: Ollama at http:\/\/localhost:11434: model ran out of memory$/);
  const garbled = streamServer(() => ({ chunks: ["<html>\n"] }));
  await assert.rejects(streamed(createProvider({ kind: "ollama", model: "m" }, { fetch: garbled.fetch })), /sent a line that isn't JSON: <html>/);
});

/** Anthropic's events for a forced-tool answer, the tool's input cut into pieces of JSON. */
function anthropicEvents(input: string, random: { int(n: number): number }): string {
  const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  return [
    event("message_start", { message: { id: "m", content: [] } }),
    event("content_block_start", { index: 0, content_block: { type: "tool_use", id: "t", name: "answer", input: {} } }),
    event("ping", {}),
    ...cut(input, random).map((piece) => event("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: piece } })),
    event("content_block_stop", { index: 0 }),
    event("message_delta", { delta: { stop_reason: "tool_use" } }),
    event("message_stop", {}),
  ].join("");
}

test("Anthropic streams the tool's input piece by piece; the answer is that input, as the whole reply gives it", async () => {
  const keys = memoryKeyStore();
  keys.set("https://api.anthropic.com", KEY);
  const random = rng(SEED + 1);
  const { fetch, calls } = streamServer(() => ({ chunks: cut(anthropicEvents(ANSWER, random), random, 60) }));
  const { answer, seen } = await streamed(createProvider({ kind: "api-key", vendor: "anthropic" }, { fetch, keys }));
  assert.equal(answer, ANSWER);
  growsTo(seen, ANSWER);
  const body = calls[0].body as { stream: boolean; tool_choice: unknown };
  assert.equal(body.stream, true);
  assert.deepEqual(body.tool_choice, { type: "tool", name: "answer" }, "still held to the schema");
  // Words written before the tool (a text block first) are not the answer: once the tool's input starts, it is what is shown and returned.
  const text = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Sure."}}\n\n';
  const chatty = streamServer(() => ({ chunks: [text, anthropicEvents(ANSWER, random)] }));
  const second = await streamed(createProvider({ kind: "api-key", vendor: "anthropic" }, { fetch: chatty.fetch, keys }));
  assert.equal(second.answer, ANSWER);
  assert.equal(second.seen[0], "Sure.");
  assert.equal(second.seen.at(-1), ANSWER);
});

test("Anthropic: an error event part way through is reported with who sent it; an answer that came whole is read whole", async () => {
  const keys = memoryKeyStore();
  keys.set("https://api.anthropic.com", KEY);
  const events = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{"}}\n\nevent: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
  const { fetch } = streamServer(() => ({ chunks: [events] }));
  await assert.rejects(streamed(createProvider({ kind: "api-key", vendor: "anthropic" }, { fetch, keys })), { message: "Anthropic's API: Overloaded" });
  const whole = streamServer(() => ({ chunks: [JSON.stringify({ content: [{ type: "tool_use", name: "answer", input: JSON.parse(ANSWER) }] })] }));
  assert.equal((await streamed(createProvider({ kind: "api-key", vendor: "anthropic" }, { fetch: whole.fetch, keys }))).answer, ANSWER, "an answer that came whole is read whole");
  const nothing = streamServer(() => ({ chunks: ['event: message_stop\ndata: {"type":"message_stop"}\n\n'] }));
  await assert.rejects(streamed(createProvider({ kind: "api-key", vendor: "anthropic" }, { fetch: nothing.fetch, keys })), { message: "Anthropic's API: the reply has no answer in it" });
});

test("OpenAI streams its answer piece by piece and ends with [DONE]", async () => {
  const keys = memoryKeyStore();
  keys.set("https://api.openai.com", KEY);
  const random = rng(SEED + 2);
  const events = [
    `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" } }] })}\n\n`,
    ...cut(ANSWER, random).map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const { fetch, calls } = streamServer(() => ({ chunks: cut(events.join(""), random, 50) }));
  const { answer, seen } = await streamed(createProvider({ kind: "api-key", vendor: "openai" }, { fetch, keys }));
  assert.equal(answer, ANSWER);
  growsTo(seen, ANSWER);
  assert.equal((calls[0].body as { stream: boolean }).stream, true);
});

test("an OpenAI-compatible server that ignores stream and answers whole is still read; a reply that is neither is refused", async () => {
  const keys = memoryKeyStore();
  keys.set("https://llm.example", KEY);
  const { fetch } = streamServer(() => ({ chunks: [JSON.stringify({ choices: [{ message: { content: ANSWER } }] }, null, 2)] }));
  const seen: string[] = [];
  const p = createProvider({ kind: "api-key", vendor: "other", endpoint: "https://llm.example/v1", model: "m" }, { fetch, keys });
  assert.equal(await p.complete({ ...request, onText: (t) => seen.push(t) }), ANSWER);
  assert.deepEqual(seen, [ANSWER], "the whole answer, once");
  const html = streamServer(() => ({ chunks: ["<html>busy</html>"] }));
  const q = createProvider({ kind: "api-key", vendor: "other", endpoint: "https://llm.example/v1", model: "m" }, { fetch: html.fetch, keys });
  await assert.rejects(q.complete({ ...request, onText: () => {} }), { message: "https://llm.example: the reply is neither a stream nor JSON" });
});

test("in the browser: WebLLM streams when asked, and answers whole when not", async () => {
  const requests: Record<string, unknown>[] = [];
  const pieces = cut(ANSWER, rng(SEED + 3));
  const webllm: WebLLMLike = {
    prebuiltAppConfig: { model_list: [{ model_id: "Small-q4f16_1-MLC", model: "https://models.test/Small", low_resource_required: true }] },
    async CreateMLCEngine() {
      return {
        chat: {
          completions: {
            async create(r: object) {
              requests.push(r as Record<string, unknown>);
              if (!(r as { stream?: boolean }).stream) return { choices: [{ message: { content: ANSWER } }] };
              return (async function* (): AsyncGenerator<WebLLMChunk> {
                yield { choices: [{ delta: { content: "" } }] };
                for (const content of pieces) yield { choices: [{ delta: { content } }] };
                yield { choices: [] };
              })();
            },
          },
        },
      };
    },
  };
  const gpu = { requestAdapter: async () => ({ features: new Set(["shader-f16"]), limits: { maxStorageBufferBindingSize: 2 ** 30 } }) };
  const p = createProvider({ kind: "in-browser", model: "Small-q4f16_1-MLC" }, { gpu, loadWebLLM: async () => webllm });
  const { answer, seen } = await streamed(p);
  assert.equal(answer, ANSWER);
  growsTo(seen, ANSWER);
  assert.equal(requests[0].stream, true);
  assert.equal(await p.complete(request), ANSWER);
  assert.equal("stream" in requests[1], false);
});

test("the browser's built-in model streams with promptStreaming where it has it, and uses prompt where it doesn't", async () => {
  const pieces = cut(ANSWER, rng(SEED + 4));
  const api = (streaming: boolean): BuiltInModelLike => ({
    availability: async () => "available",
    create: async () => ({
      prompt: async () => ANSWER,
      ...(streaming
        ? {
            async *promptStreaming() {
              yield* pieces;
            },
          }
        : {}),
      destroy() {},
    }),
  });
  const { answer, seen } = await streamed(createProvider({ kind: "browser-built-in" }, { builtIn: api(true) }));
  assert.equal(answer, ANSWER);
  growsTo(seen, ANSWER);
  const old = await streamed(createProvider({ kind: "browser-built-in" }, { builtIn: api(false) })).catch((e) => e);
  assert.deepEqual(old, { answer: ANSWER, seen: [] }, "no stream: the whole answer, with nothing shown on the way");
});

// ---------- progress.ts ----------

test("progress, worked by hand: where the bar stands for a few lengths of answer", () => {
  // The bar moves from ASKING (0.05) towards CHECKING (0.9) as 0.05 + 0.85 × (1 − e^(−2n/190)) for n characters.
  assert.deepEqual(progressOf("", 1), { stage: "asking", attempt: 1, fraction: ASKING, working: "", commands: 0 });
  // n = 95, half a typical answer: 1 − e^(−1) = 0.632121, so 0.05 + 0.85 × 0.632121 = 0.587303.
  assert.ok(Math.abs(progressOf("x".repeat(TYPICAL_ANSWER / 2), 1).fraction - 0.587303) < 1e-6);
  // n = 190, a typical answer: 1 − e^(−2) = 0.864665, so 0.05 + 0.85 × 0.864665 = 0.784965.
  assert.ok(Math.abs(progressOf("x".repeat(TYPICAL_ANSWER), 1).fraction - 0.784965) < 1e-6);
  // n = 10,000, far longer than usual: e^(−105) is about 2.5e-46, far below a double's step at 0.9, so the bar
  // reaches CHECKING's place at most and never passes it before the answer is checked.
  assert.ok(progressOf("x".repeat(10_000), 1).fraction <= CHECKING);
});

test("progress follows the answer as it is written: commands, then the working out, the bar never going back", () => {
  const random = rng(SEED + 5);
  for (const answer of [ANSWER, '{"explanation":"A 50 mm box.","commands":[{"op":"set_part","width":50},{"op":"set_part","width":60}]}']) {
    let soFar = "";
    let last = 0;
    const stages: string[] = [];
    for (const piece of cut(answer, random)) {
      soFar += piece;
      const p = progressOf(soFar, 1);
      assert.ok(p.fraction > last && p.fraction < CHECKING, `seed ${SEED + 5}: ${soFar}`);
      last = p.fraction;
      if (stages.at(-1) !== p.stage) stages.push(p.stage);
    }
    const end = progressOf(answer, 1);
    if (answer === ANSWER) {
      assert.deepEqual(stages, ["commands", "working"]);
      assert.equal(end.working, "The part is 50 mm wide: 5 cm is 50 mm.");
      assert.equal(end.commands, 1);
    } else {
      // The other order (a model not held to the schema): the stage follows whichever key it is writing now.
      assert.deepEqual(stages, ["commands", "working", "commands"]);
      assert.equal(end.working, "A 50 mm box.");
      assert.equal(end.commands, 2);
    }
  }
});

test("the working out so far is read as text: escapes decoded, one cut off at the end left out until it arrives", () => {
  const at = (s: string) => partialString(s, s.indexOf('"explanation"') + '"explanation"'.length);
  assert.equal(at('{"explanation" : "say \\"hi\\"\\nthen 2 \\u00d7 3'), 'say "hi"\nthen 2 × 3');
  assert.equal(at('{"explanation":"cut \\'), "cut ");
  assert.equal(at('{"explanation":"cut \\u00d'), "cut ");
  assert.equal(at('{"explanation":"done", "commands"'), "done");
  assert.equal(at('{"explanation"'), "", "no value started yet");
  assert.equal(at('{"explanation": 5'), "", "not a string");
});

test("askForCommands reports asking, the answer as it is written, then checking, for each try", async () => {
  const answers = ['{"commands":[],"explanation":"A box."}', ANSWER];
  const { fetch } = streamServer(() => ({ chunks: [answers.shift()!].flatMap((a) => cut(a, rng(SEED + 6)).map((c) => JSON.stringify({ message: { content: c } }) + "\n")) }));
  const seen: Progress[] = [];
  const r = await askForCommands(createProvider({ kind: "ollama", model: "m" }, { fetch }), request, specs, (p) => seen.push(p));
  assert.deepEqual(r, { ok: true, commands: [{ op: "set_part", width: 50 }], explanation: "The part is 50 mm wide: 5 cm is 50 mm.", attempts: 2 });
  // The first answer has no commands and doesn't say it can't be done, so it is asked again.
  const marks = seen.map((p) => `${p.attempt}:${p.stage}`).filter((m, i, all) => m !== all[i - 1]);
  assert.deepEqual(marks, ["1:asking", "1:commands", "1:working", "1:checking", "2:asking", "2:commands", "2:working", "2:checking"]);
  assert.equal(seen.filter((p) => p.stage === "working").at(-1)!.working, "The part is 50 mm wide: 5 cm is 50 mm.");
});

test("without onProgress nothing is streamed: the request carries no onText", async () => {
  const got: object[] = [];
  const provider = { kind: "ollama" as const, structuredOutput: true, check: async () => ({ ok: true as const }), complete: async (r: object) => (got.push(r), ANSWER) };
  await askForCommands(provider, request, specs);
  assert.equal("onText" in got[0], false);
});

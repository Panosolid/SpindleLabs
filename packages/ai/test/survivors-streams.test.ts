// More tests written to kill mutants StrykerJS found surviving in the AI
// assistant's streaming code (hosted.ts, http.ts, local.ts, ollama.ts,
// commands.ts). Each test names the change to the code it catches. Mutants
// no caller can tell apart are listed, with the reason, in
// packages/testing/stryker/explained.json. Nothing here talks to a network:
// every reply comes from a stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { saysCannot } from "../src/commands.ts";
import { anthropicStream, openaiStream } from "../src/hosted.ts";
import { streamLines, type PostOptions } from "../src/http.ts";
import { builtInProvider, inBrowserProvider, type BuiltInModelLike, type GpuLike, type WebLLMLike } from "../src/local.ts";
import { ollamaProvider } from "../src/ollama.ts";
import { streamServer } from "./fakes.ts";

const post = (chunks: string[]): PostOptions => ({ fetch: streamServer(() => ({ chunks })).fetch, url: "https://api.test/v1", body: {}, timeoutMs: 1000, who: "Test API" });
const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
const delta = (d: object) => ({ type: "content_block_delta", index: 0, delta: d });
const textDelta = (text: unknown) => delta({ type: "text_delta", text });
const jsonDelta = (partial_json: unknown) => delta({ type: "input_json_delta", partial_json });
const chunk = (content: unknown) => ({ choices: [{ delta: { content } }] });

// ---------- commands.ts ----------

test("a refusal written as isn't supported / isn't available is recognised, straight or curly apostrophe", () => {
  // Kills the regex changes isn['’]t => isn[^'’]t in "isn't supported" and "isn't available".
  // Neither sentence holds another refusal word ("not supported" needs "not", but these say "isn't").
  for (const q of ["'", "’"]) {
    assert.equal(saysCannot(`Rotating a part isn${q}t supported yet.`), true);
    assert.equal(saysCannot(`That tool isn${q}t available here.`), true);
  }
  assert.equal(saysCannot("The part will be a box 40 mm wide."), false);
});

// ---------- http.ts: streamLines ----------

test("a carriage return only ends a line when it is the last character before the line feed", async () => {
  // Kills /\r$/ => /\r/ (twice: complete lines and the unfinished last one).
  // "a\rb" keeps its inner \r; "c\r\n" loses only its \r; the last, unfinished "d\re\r" loses only the final \r.
  const lines: string[] = [];
  await streamLines(post(["a\rb\nc\r\nd\re\r"]), (l) => lines.push(l));
  assert.deepEqual(lines, ["a\rb", "c", "d\re"]);
});

test("a body that ends with a line ending sends no extra empty line", async () => {
  // Kills `rest !== ""` => true and its "" => "Stryker was here!" (the last line would be given as "").
  const lines: string[] = [];
  await streamLines(post(["one\ntwo\n"]), (l) => lines.push(l));
  assert.deepEqual(lines, ["one", "two"]);
});

test("a reply with no readable body is read whole and split the same way", async () => {
  // Kills `!response.body` => false (the code would call getReader on nothing).
  const fetch = async () => ({ ok: true, status: 200, body: null, text: async () => "x\r\ny\nz" }) as unknown as Response;
  const lines: string[] = [];
  await streamLines({ fetch, url: "https://api.test", body: {}, timeoutMs: 1000, who: "T" }, (l) => lines.push(l));
  assert.deepEqual(lines, ["x", "y", "z"]);
});

// ---------- hosted.ts: Anthropic ----------

test("Anthropic stream: CRLF lines, event names, comments and blank data lines are skipped; pieces join", async () => {
  // Kills `data === ""` => false / "Stryker" (a bare "data:" line must be ignored, not parsed) and `!e` => false
  // (a "[DONE]" line has no JSON and must be ignored). Worked by hand: "Hel" + "lo" = "Hello", seen as "Hel" then "Hello".
  const body = "event: content_block_delta\r\n" + `data: ${JSON.stringify(textDelta("Hel"))}\r\n\r\n` + ": a comment\r\ndata:\r\ndata: [DONE]\r\n" + `data: ${JSON.stringify(textDelta("lo"))}\r\n`;
  const seen: string[] = [];
  assert.equal(await anthropicStream(post([body]), (s) => seen.push(s)), "Hello");
  assert.deepEqual(seen, ["Hel", "Hello"]);
});

test("Anthropic stream: a line that isn't JSON fails with the first 80 characters of it", async () => {
  // Kills the empty catch block, the message => `` and data.slice(0, 80) => data.
  const bad = "x".repeat(100);
  await assert.rejects(anthropicStream(post([`data: ${bad}\n`]), () => {}), { message: `the stream has a line that isn't JSON: ${"x".repeat(80)}` });
});

test("Anthropic stream: an error event gives the provider's message, or a plain one when it sent none", async () => {
  // Kills `typeof error.message === "string"` => true and the fallback message => "".
  await assert.rejects(anthropicStream(post([sse({ type: "error", error: { message: "overloaded" } })]), () => {}), { message: "overloaded" });
  await assert.rejects(anthropicStream(post([sse({ type: "error", error: { message: 7 } })]), () => {}), { message: "the stream reported an error" });
});

test("Anthropic stream: only content_block_delta events carry the answer, and a piece must be a string", async () => {
  // Kills `e.type === "content_block_delta"` => true (a text_delta inside another event is not answer),
  // `typeof delta.partial_json === "string"` => true and `typeof delta.text === "string"` => true
  // (a number would be glued on as "5" or "undefined").
  const events = [{ type: "message_delta", delta: { type: "text_delta", text: "WRONG" } }, jsonDelta(5), textDelta(6), textDelta("ok")];
  const seen: string[] = [];
  assert.equal(await anthropicStream(post([sse(...events)]), (s) => seen.push(s)), "ok");
  assert.deepEqual(seen, ["ok"]);
  // The same with a tool's JSON: pieces '{"a":' + '1}' join, a null piece is ignored.
  assert.equal(await anthropicStream(post([sse(jsonDelta('{"a":'), jsonDelta(null), jsonDelta("1}"))]), () => {}), '{"a":1}');
});

test("Anthropic stream: a text-only answer is returned, and an answer with no text fails in plain words", async () => {
  // Kills `text === ""` => true (a text answer with no tool would be refused) and the message => "".
  assert.equal(await anthropicStream(post([sse(textDelta("just text"))]), () => {}), "just text");
  await assert.rejects(anthropicStream(post([sse({ type: "ping" })]), () => {}), { message: "the reply has no answer in it" });
});

test("Anthropic: a whole JSON reply, even with an event line before it, is read whole; anything else is refused", async () => {
  // Kills `!line.startsWith("event:")` => true and startsWith => endsWith (the event line would be glued onto the JSON).
  const reply = JSON.stringify({ content: [{ type: "text", text: "whole" }] });
  const seen: string[] = [];
  assert.equal(await anthropicStream(post([`event: x\n${reply}\n`]), (s) => seen.push(s)), "whole");
  assert.deepEqual(seen, ["whole"]);
  // Kills `"\n"` => "" in the join: a line break inside a JSON string is not allowed, and removing it would hide that.
  await assert.rejects(anthropicStream(post(['{"content":[{"type":"text","text":"a\nb"}]}']), () => {}), { message: "the reply is neither a stream nor JSON" });
  // Kills the catch block => {} and its message => "".
  await assert.rejects(anthropicStream(post(["hello"]), () => {}), { message: "the reply is neither a stream nor JSON" });
});

// ---------- hosted.ts: OpenAI-style ----------

test("OpenAI stream: chunks with no choices, no delta or no content are skipped, and empty pieces are not reported", async () => {
  // Kills the three ?. removals in choices?.[0]?.delta?.content, `more !== ""` => true and its "" => "Stryker".
  // Worked by hand: "Hi" + " there" = "Hi there"; reported as "Hi" then "Hi there", never an extra "Hi".
  const body = sse({ id: "usage-only" }, { choices: [] }, { choices: [{}] }, chunk(null), chunk(""), chunk("Hi"), chunk(""), chunk(" there")) + "data: [DONE]\n\n";
  const seen: string[] = [];
  assert.equal(await openaiStream(post([body]), (s) => seen.push(s)), "Hi there");
  assert.deepEqual(seen, ["Hi", "Hi there"]);
});

test("OpenAI stream: events without any text fail in plain words; an error event gives the provider's message", async () => {
  // Kills `text === ""` => false, its "" => "Stryker" and the message => "".
  await assert.rejects(openaiStream(post([sse(chunk("")) + "data: [DONE]\n"]), () => {}), { message: "the reply has no answer in it" });
  await assert.rejects(openaiStream(post([sse({ error: { message: "rate limited" } })]), () => {}), { message: "rate limited" });
});

test("OpenAI: a whole JSON reply is read whole; a raw line break inside a string or plain words are refused", async () => {
  // Kills `"\n"` => "" in the join and the neither-stream-nor-JSON block, message => "".
  const seen: string[] = [];
  assert.equal(await openaiStream(post(['{"choices":[\n{"message":{"content":"whole"}}]}\n']), (s) => seen.push(s)), "whole");
  assert.deepEqual(seen, ["whole"]);
  await assert.rejects(openaiStream(post(['{"choices":[{"message":{"content":"a\nb"}}]}']), () => {}), { message: "the reply is neither a stream nor JSON" });
  await assert.rejects(openaiStream(post(["hello"]), () => {}), { message: "the reply is neither a stream nor JSON" });
});

// ---------- local.ts ----------

const gpu = {
  requestAdapter: async () => ({ features: new Set(["shader-f16"]), limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 31 } }),
} as unknown as GpuLike;
const model = { model_id: "Small-q4f16_1-MLC", model: "https://models.test/Small/", model_lib: "https://models.test/Small.wasm", vram_required_MB: 100, low_resource_required: true };
const engineReplying = (reply: unknown): WebLLMLike => ({
  prebuiltAppConfig: { model_list: [model] },
  async CreateMLCEngine() {
    return { chat: { completions: { create: async () => reply as never } } };
  },
});
const asyncChunks = (...contents: unknown[]) => ({
  async *[Symbol.asyncIterator]() {
    for (const content of contents) yield { choices: [{ delta: { content } }] };
  },
});
const inBrowser = (webllm: WebLLMLike) => inBrowserProvider({ model: model.model_id, gpu, loadWebLLM: async () => webllm } as never);
const ask = { system: "S", messages: [{ role: "user" as const, content: "hi" }] };

test("in the browser: a streamed answer is reported piece by piece, skipping empty pieces and chunks without a delta", async () => {
  // Kills `delta?.content` => `delta.content`, `more !== ""` => true and its "" => "Stryker".
  // Worked by hand: "ab" + "c" = "abc", reported as "ab" then "abc".
  const reply = {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{}] };
      yield { choices: [{ delta: { content: "" } }] };
      yield { choices: [{ delta: { content: "ab" } }] };
      yield { choices: [{ delta: { content: "c" } }] };
    },
  };
  const seen: string[] = [];
  assert.equal(await inBrowser(engineReplying(reply)).complete({ ...ask, onText: (s) => seen.push(s) }), "abc");
  assert.deepEqual(seen, ["ab", "abc"]);
});

test("in the browser: a stream with no text in it fails in plain words", async () => {
  // Kills `text === ""` => false and its message => "".
  await assert.rejects(inBrowser(engineReplying(asyncChunks("", null))).complete({ ...ask, onText: () => {} }), { message: "the in-browser model gave no answer" });
});

test("in the browser: a streamed reply nobody asked for is refused; a whole reply is used even when text was asked for", async () => {
  // Kills `onText && ...` => `onText || ...`, `Symbol.asyncIterator in reply` => false and the message => "".
  await assert.rejects(inBrowser(engineReplying(asyncChunks("x"))).complete(ask), { message: "the in-browser model streamed an answer nobody asked to stream" });
  const whole = { choices: [{ message: { content: "whole" } }] };
  assert.equal(await inBrowser(engineReplying(whole)).complete({ ...ask, onText: () => assert.fail("nothing was streamed") }), "whole");
});

test("the browser's built-in model: empty pieces are not reported", async () => {
  // Kills `more !== ""` => true and its "" => "Stryker" (reported as an extra, unchanged "ab").
  const api: BuiltInModelLike = {
    availability: async () => "available",
    create: async () => ({
      prompt: async () => assert.fail("streaming was asked for"),
      async *promptStreaming() {
        yield "";
        yield "ab";
        yield "";
        yield "c";
      },
      destroy() {},
    }),
  };
  const seen: string[] = [];
  assert.equal(await builtInProvider({ api }).complete({ ...ask, onText: (s) => seen.push(s) }), "abc");
  assert.deepEqual(seen, ["ab", "abc"]);
});

// ---------- ollama.ts ----------

const ollama = (chunks: string[]) => ollamaProvider({ model: "m", endpoint: "http://localhost:11434", fetch: streamServer(() => ({ chunks })).fetch });
const line = (o: object) => JSON.stringify(o) + "\n";

test("Ollama stream: blank and whitespace-only lines are skipped; a final line with no message is skipped", async () => {
  // Kills `line.trim() === ""` => false, `line.trim()` => `line`, "" => "Stryker" (a blank line would be parsed as JSON and fail),
  // `piece.message?.content` => `piece.message.content` and `typeof more === "string"` => true (undefined would be glued on as "undefined").
  const body = "\n   \n" + line({ message: { content: "ab" } }) + "\t\r\n" + line({ message: { role: "assistant" } }) + line({ message: { content: "c" } }) + line({ done: true });
  const seen: string[] = [];
  assert.equal(await ollama([body]).complete({ ...ask, onText: (s) => seen.push(s) }), "abc");
  assert.deepEqual(seen, ["ab", "abc"]);
});

test("Ollama stream: a line that isn't JSON fails naming Ollama and the first 80 characters of it", async () => {
  // Kills `line.slice(0, 80)` => `line`.
  await assert.rejects(ollama(["y".repeat(100) + "\n"]).complete({ ...ask, onText: () => {} }), { message: `Ollama at http://localhost:11434 sent a line that isn't JSON: ${"y".repeat(80)}` });
});

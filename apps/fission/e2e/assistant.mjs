// Browser check of the AI assistant (AI2): a request becomes Design's own
// set_part command, shown as a preview that changes nothing; Accept is one
// "AI: …" undo step, Reject and a stale preview change nothing; a remote
// provider is shown exactly what it will be sent before the first request,
// and the key goes only to its own provider. No model is used: the
// browser's requests to Ollama and to the API are answered here
// (page.route), so the real provider code runs and nothing leaves this
// machine. Volumes are worked out by hand from V = width · depth · height.
// AI6: opening the panel picks an AI that runs on this computer (the
// browser's built-in model first, then a running Ollama), greys out what
// can't run, asks Ollama nothing until the user looks for it and lists it
// only once it answers, recognises a pasted key
// and lists the models it can use. WebGPU is taken away in every page so
// the in-browser model is never found, whatever the machine running this,
// and so is the browser's own built-in model (Chrome 156 has one, #238),
// unless a check gives the page a fake one.
// AI5c: the answer's working out shows above the preview as plain text,
// and a request no command can do shows the AI's reason with nothing to
// accept. AI5c2: answers are streamed, and a bar shows the stage, an
// estimate and the working out as it is written, never 100% before the
// preview (Ollama's stream is held piece by piece in the page, `held`).
// AI7a: the AI starts a sketch on an origin plane or a flat face it was
// told of, as Create sketch would, in one undo step. AI7b: it draws
// circles, rectangles and lines in the sketch it just started or the one
// open, in sketch mm, and is refused when no sketch is open. AI7c: it
// extrudes a sketch by a distance (the other way when negative) as the
// Extrude tool's OK does; the kernel is asked first, so a sketch that is
// not one closed outline is refused before any preview.
// Run with `npm run e2e` (after `npm run build`).
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";
import { clickPlane, TOP } from "./sketch-screen.mjs";
import { preview } from "vite";
import { pinProperties } from "./properties.mjs";
import { gridSnapOn, reloadEmpty, sheetsClearFor, startWithBox, switchTo } from "./start.mjs";

const server = await preview({ preview: { port: 4181, strictPort: true }, logLevel: "error" });
const url = "http://localhost:4181/";
const browser = await launch();
const errors = [];
const KEY = "sk-ant-test-e2e-0123456789";
const REMOTE_OLLAMA = "http://192.168.1.50:11434"; // another computer on the local network
const OPENAI_KEY = "sk-proj-test-e2e-0123456789";

/**
 * A fresh page with a fake Ollama and fake Anthropic and OpenAI APIs;
 * `answers` are what the model says, in order. `ollama: false` refuses
 * Ollama's address as if nothing listens there; `builtIn` gives the page a
 * built-in model that answers from `answers` too (`true`: one that is there;
 * an availability word such as "downloadable": one in that state). Model
 * lists asked for are recorded in `listed`, requests to a model in `asked`,
 * sessions made of the built-in model in `builtInCreated`. `held: true`
 * answers Ollama's chat requests in the page itself, one line at a time
 * as the check allows (window.heldLines, window.allowLines), so the bar
 * can be seen part way.
 */
async function fresh(answers = [], { ollama = true, builtIn = false, open = true, held = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(() => indexedDB.deleteDatabase("fission"));
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined, configurable: true }));
  const builtInAsked = [];
  const builtInCreated = [];
  if (builtIn) {
    await page.exposeFunction("builtInAnswer", (input) => (builtInAsked.push(input), answers.shift() ?? "{}"));
    await page.exposeFunction("builtInCreate", () => void builtInCreated.push(Date.now()));
    await page.addInitScript((availability) => {
      globalThis.LanguageModel = {
        availability: async () => availability,
        create: async () => (globalThis.builtInCreate(), { prompt: (input) => globalThis.builtInAnswer(input), destroy() {} }),
      };
    }, builtIn === true ? "available" : builtIn);
  } else {
    // The browser's own built-in model, where it has one, would be found first and chosen.
    await page.addInitScript(() => {
      delete globalThis.LanguageModel;
      if ("LanguageModel" in globalThis) Object.defineProperty(globalThis, "LanguageModel", { value: undefined, configurable: true });
    });
  }
  if (held) {
    await page.addInitScript(() => {
      const realFetch = globalThis.fetch;
      Object.assign(globalThis, { heldLines: [], allowLines: 0, heldAsked: [] });
      globalThis.fetch = async (input, init) => {
        if (!String(input).endsWith("/api/chat")) return realFetch(input, init);
        globalThis.heldAsked.push(JSON.parse(init.body));
        let sent = 0;
        const body = new ReadableStream({
          async pull(controller) {
            while (sent >= globalThis.allowLines && sent < globalThis.heldLines.length) await new Promise((r) => setTimeout(r, 20));
            if (sent >= globalThis.heldLines.length) return controller.close();
            controller.enqueue(new TextEncoder().encode(globalThis.heldLines[sent++]));
          },
        });
        return new Response(body, { headers: { "content-type": "application/x-ndjson" } });
      };
    });
  }
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // With no Ollama the browser logs the refused connection to it; that is the point of the check.
    if (m.type() === "error" && !(ollama === false && /Failed to load resource/.test(m.text()))) errors.push(m.text());
  });
  const asked = [];
  const listed = [];
  const ollamaHits = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "content-type": "application/json" };
  const fakeOllama = (hits) => async (route) => {
    const req = route.request();
    hits.push(req.url());
    if (!ollama) return route.abort("connectionrefused");
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.url().endsWith("/api/tags")) return route.fulfill({ headers: cors, body: JSON.stringify({ models: [{ name: "qwen2.5:1.5b" }] }) });
    asked.push({ url: req.url(), headers: req.headers(), body: req.postDataJSON() });
    return route.fulfill({ headers: cors, body: JSON.stringify({ message: { role: "assistant", content: answers.shift() ?? "{}" } }) });
  };
  await context.route("http://localhost:11434/**", fakeOllama(ollamaHits));
  await context.route("http://127.0.0.1:11434/**", fakeOllama(ollamaHits)); // the same Ollama by its address
  // Ollama on another computer on the local network (audit S3).
  const remoteHits = [];
  await context.route(`${REMOTE_OLLAMA}/**`, fakeOllama(remoteHits));
  await context.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.method() === "GET" && new URL(req.url()).pathname === "/v1/models") {
      listed.push({ url: req.url(), headers: req.headers() });
      return route.fulfill({ headers: cors, body: JSON.stringify({ data: [{ id: "claude-opus-5-5" }, { id: "claude-haiku-5-5" }], has_more: false }) });
    }
    asked.push({ url: req.url(), headers: req.headers(), body: req.postDataJSON() });
    const input = answers.shift() ?? "{}";
    if (!req.postDataJSON().stream) return route.fulfill({ headers: cors, body: JSON.stringify({ content: [{ type: "tool_use", name: "answer", input: JSON.parse(input) }] }) });
    // Streamed (AI5c2), as Anthropic sends it: the tool's input in pieces of JSON.
    const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const pieces = input.match(/.{1,9}/gs) ?? [];
    const sse = [event("content_block_start", { index: 0, content_block: { type: "tool_use", name: "answer", input: {} } }), ...pieces.map((partial_json) => event("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json } })), event("message_stop", {})];
    return route.fulfill({ headers: { ...cors, "content-type": "text/event-stream" }, body: sse.join("") });
  });
  await context.route("https://api.openai.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (req.method() === "GET" && new URL(req.url()).pathname === "/v1/models") {
      listed.push({ url: req.url(), headers: req.headers() });
      return route.fulfill({ headers: cors, body: JSON.stringify({ data: [{ id: "gpt-5-mini" }, { id: "whisper-1" }, { id: "gpt-5" }] }) });
    }
    asked.push({ url: req.url(), headers: req.headers(), body: req.postDataJSON() });
    return route.fulfill({ headers: cors, body: JSON.stringify({ choices: [{ message: { content: answers.shift() ?? "{}" } }] }) });
  });
  await page.goto(url + "#design");
  await startWithBox(page); // a new project starts empty (U0c): the 40 × 30 × 20 box, inserted
  await pinProperties(page); // the size boxes are in the panel, folded at the start on a wide screen (U0b)
  if (open) await page.click("#assistant-toggle");
  return { page: sheetsClearFor(page), asked, listed, builtInAsked, builtInCreated, ollamaHits, remoteHits };
}
const looked = (page) => page.waitForFunction(() => !/Looking/.test(document.querySelector("#ai-found").textContent) && document.querySelector("#ai-found").textContent !== "");
/** Pastes `text` into the key box the way a real paste arrives (an input event of type insertFromPaste). */
async function paste(page, selector, text) {
  await page.evaluate(
    ([sel, t]) => {
      const input = document.querySelector(sel);
      input.value = t;
      input.dispatchEvent(new InputEvent("input", { inputType: "insertFromPaste", data: t, bubbles: true }));
    },
    [selector, text],
  );
}
async function volume(page, text) {
  try {
    await page.waitForFunction((t) => document.querySelector("#volume")?.textContent === t, text, { timeout: 5000 });
  } catch {
    assert.fail(`volume: expected ${text}, saw ${await page.textContent("#volume")}`);
  }
}
const undoTitle = (page) => page.getAttribute("#undo", "title");
const setPart = (shape, width, depth, height) => JSON.stringify({ commands: [{ op: "set_part", shape, width, depth, height }] });
/** Look for Ollama: it is found running and, with nothing chosen yet, chosen with the model it has. */
async function useOllama(page) {
  await looked(page);
  await page.click("#ai-detect");
  await page.waitForFunction(() => document.querySelector("#assistant-toggle").textContent === "AI Ollama");
  await page.waitForFunction(() => document.querySelector("#ai-model-pick").value === "qwen2.5:1.5b");
}
async function ask(page, words) {
  await page.fill("#ai-prompt", words);
  await page.click("#ai-ask-button");
}

let failed = false;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name}\n  ${e.message.split("\n").join("\n  ")}`);
  }
}

try {
  await check("opening the panel asks Ollama nothing; Look for Ollama finds it and picks it with the model it has, asking the model nothing", async () => {
    const { page, asked, ollamaHits } = await fresh([], { open: false });
    try {
      assert.equal(await page.textContent("#assistant-toggle"), "AI off", "nothing is looked for before the panel opens");
      await page.click("#assistant-toggle");
      await looked(page);
      assert.deepEqual(ollamaHits, [], "no request to an address on this computer until the user asks");
      assert.equal(await page.$eval('#ai-provider option[value="ollama"]', (o) => o.hidden), true);
      await useOllama(page);
      await looked(page);
      assert.match(await page.textContent("#ai-found"), /Chose Ollama on your computer for you/);
      assert.equal(await page.isVisible("#ai-model"), false, "the model comes from the list, not a typed name");
      assert.equal(await page.isDisabled("#ai-ask-button"), false);
      assert.match(await page.textContent("#ai-status-detail"), /nothing leaves your machine/);
      await page.click("#ai-check");
      await page.waitForFunction(() => document.querySelector("#ai-check-result").textContent === "Ready.");
      assert.equal(asked.length, 0, "a check asks the model nothing");
    } finally {
      await page.close();
    }
  });

  await check("ask, preview (nothing changes), accept as one AI step, undo and redo it whole", async () => {
    const { page, asked } = await fresh([setPart("box", 50, 30, 20)]);
    try {
      await useOllama(page);
      await ask(page, "Make it 10 mm wider.");
      await page.waitForSelector("#ai-preview");
      // What was sent: the part as its command, the user's words, held to the schema.
      const body = asked[0].body;
      assert.equal(asked[0].url, "http://localhost:11434/api/chat");
      assert.match(body.messages[0].content, /"op":"set_part","shape":"box","width":40,"depth":30,"height":20/);
      assert.deepEqual(body.messages[1], { role: "user", content: "Make it 10 mm wider." });
      assert.deepEqual(body.format.properties.commands.items.oneOf.map((s) => s.properties.op.const), ["set_part", "create_sketch", "draw_circle", "draw_rectangle", "draw_line", "extrude_sketch"], "set_part, create_sketch (AI7a), the draws (AI7b) and extrude_sketch (AI7c), never export_stl: the AI can't download files");
      // The preview: only width moves, 40 → 50; the part is untouched.
      assert.equal(await page.textContent("#ai-preview .ai-label"), "AI: box 50 × 30 × 20 mm");
      assert.deepEqual(await page.$$eval("#ai-preview tr", (rows) => rows.map((r) => r.textContent)), ["width40→50"]);
      await volume(page, "24,000 mm³");
      assert.equal(await undoTitle(page), "Undo Insert Box (Ctrl+Z)"); // the box's insert (U0c) is the only step
      await page.screenshot({ path: "e2e/assistant-preview.png" });
      await page.click("#ai-accept");
      await volume(page, "30,000 mm³"); // 50 · 30 · 20
      assert.equal(await page.inputValue("#width"), "50");
      assert.equal(await undoTitle(page), "Undo AI: box 50 × 30 × 20 mm (Ctrl+Z)");
      await page.click("#undo");
      await volume(page, "24,000 mm³");
      assert.equal(await undoTitle(page), "Undo Insert Box (Ctrl+Z)", "one step, taken back whole");
      await page.click("#redo");
      await volume(page, "30,000 mm³");
    } finally {
      await page.close();
    }
  });

  await check("reject changes nothing and adds no step; a cylinder preview shows only the sizes it uses", async () => {
    const { page } = await fresh([setPart("cylinder", 25, 30, 60)]);
    try {
      await useOllama(page);
      await ask(page, "I need a cylinder 25 mm across and 60 mm tall.");
      await page.waitForSelector("#ai-preview");
      // A cylinder ignores depth: shape box → cylinder, width 40 → 25, height 20 → 60.
      assert.deepEqual(await page.$$eval("#ai-preview tr", (rows) => rows.map((r) => r.dataset.param)), ["shape", "width", "height"]);
      assert.equal(await page.textContent("#ai-preview .ai-label"), "AI: cylinder ⌀25 × 60 mm");
      await page.click("#ai-reject");
      assert.match(await page.textContent("#ai-result"), /Rejected: nothing was changed/);
      await volume(page, "24,000 mm³");
      assert.equal(await undoTitle(page), "Undo Insert Box (Ctrl+Z)"); // the box's insert (U0c) is the only step
    } finally {
      await page.close();
    }
  });

  await check("the working out shows above the preview, as plain text: markup in it is never run (AI5c, 1280 and 375 px)", async () => {
    // 40 + 10 = 50: the model's own sums, shown as it wrote them. The tag is text a model could write; it must stay text.
    const said = "The part now is a box 40 mm wide. 10 mm wider makes the width 40 + 10 = 50 mm; depth and height stay. <img src=x onerror=\"window.ranMarkup=1\">";
    for (const width of [1280, 375]) {
      const { page, asked } = await fresh([JSON.stringify({ explanation: said, commands: [{ op: "set_part", shape: "box", width: 50, depth: 30, height: 20 }] })], { open: false });
      try {
        if (width === 375) await page.setViewportSize({ width: 375, height: 800 });
        if (width === 375) await page.click("#menu-toggle");
        await page.click("#assistant-toggle");
        await useOllama(page);
        await ask(page, "Make it 10 mm wider.");
        await page.waitForSelector("#ai-preview");
        // The schema sent asks for the commands, then the working out, and requires both.
        const format = asked[0].body.format;
        assert.deepEqual(Object.keys(format.properties), ["commands", "explanation"]);
        assert.deepEqual(format.required, ["commands", "explanation"]);
        assert.match(asked[0].body.messages[0].content, /After the commands, write in "explanation"/);
        assert.equal(await page.textContent("#ai-preview .ai-working-text"), said);
        assert.equal(await page.$("#ai-preview img"), null, "the tag is shown, not made");
        assert.equal(await page.evaluate(() => window.ranMarkup), undefined);
        // Above what would change: the label, then the working out, then the table.
        const order = await page.$$eval("#ai-preview > *", (els) => els.map((e) => e.className || e.tagName.toLowerCase()));
        assert.deepEqual(order.slice(0, 3), ["ai-label", "ai-working", "table"]);
        const [w, t] = await Promise.all(["#ai-preview .ai-working", "#ai-preview table"].map((sel) => page.$eval(sel, (e) => e.getBoundingClientRect().toJSON())));
        assert.ok(w.bottom <= t.top, `working out ${JSON.stringify(w)} above the table ${JSON.stringify(t)}`);
        // It fits the panel: no sideways scroll at either width.
        assert.equal(await page.$eval("#ai-preview", (e) => e.scrollWidth <= e.clientWidth), true);
        await page.$eval("#ai-preview", (e) => e.scrollIntoView());
        await page.screenshot({ path: `e2e/assistant-working-${width}.png` });
        await page.click("#ai-accept");
        await volume(page, "30,000 mm³"); // 50 · 30 · 20
      } finally {
        await page.close();
      }
    }
  });

  await check("while the AI answers, a bar shows the stage, an estimate and the working out as it is written, never 100% before the preview (AI5c2, 1280 and 375 px)", async () => {
    // The answer arrives in five pieces. The bar is 0.05 + 0.85 × (1 − e^(−2n/190)) for n characters written:
    // after the first piece (24 characters) 0.05 + 0.85 × (1 − e^(−0.2526)) = 0.2398, shown as 24%;
    // after the fourth (116) 0.05 + 0.85 × (1 − e^(−1.2211)) = 0.6493, shown as 65%.
    const pieces = ['{"commands":[{"op":"set_', 'part","shape":"box","width":50,', '"depth":30,"height":20}],', '"explanation":"The box becomes 50 mm', ' wide; depth 30 mm and height 20 mm stay."}'];
    const lines = [...pieces.map((content) => JSON.stringify({ message: { role: "assistant", content }, done: false }) + "\n"), '{"message":{"role":"assistant","content":""},"done":true}\n'];
    const stage = (page) => page.textContent("#ai-progress .ai-progress-stage");
    const seen = (page, text) => page.waitForFunction((t) => document.querySelector("#ai-progress .ai-progress-stage")?.textContent === t, text, { timeout: 5000 }).catch(async () => assert.fail(`expected "${text}", saw "${await stage(page)}"`));
    for (const width of [1280, 375]) {
      const { page } = await fresh([], { open: false, held: true });
      try {
        if (width === 375) await page.setViewportSize({ width: 375, height: 800 });
        if (width === 375) await page.click("#menu-toggle");
        await page.click("#assistant-toggle");
        await useOllama(page);
        await page.evaluate((l) => (globalThis.heldLines = l), lines);
        await ask(page, "Make it 50 mm wide.");
        await seen(page, "Asking the AI… 5%");
        assert.equal(await page.getAttribute("#ai-progress", "aria-valuenow"), "5");
        assert.equal((await page.evaluate(() => globalThis.heldAsked[0])).stream, true, "Ollama is asked to stream");
        await page.evaluate(() => (globalThis.allowLines = 1));
        await seen(page, "Writing the commands (1 so far)… 24%");
        assert.equal(await page.$("#ai-progress .ai-working"), null, "no working out yet");
        await page.evaluate(() => (globalThis.allowLines = 4));
        await seen(page, "Writing its working out… 65%");
        assert.equal(await page.textContent("#ai-progress .ai-working-text"), "The box becomes 50 mm");
        const fill = await page.$eval("#ai-progress .ai-progress-fill", (e) => e.style.width);
        assert.equal(fill, "65%");
        assert.equal(await page.$eval("#ai-progress", (e) => e.scrollWidth <= e.clientWidth), true, "no sideways scroll");
        await page.$eval("#ai-progress", (e) => e.scrollIntoView());
        await page.waitForTimeout(300); // the bar's width eases in over 0.2 s
        await page.screenshot({ path: `e2e/assistant-progress-${width}.png` });
        await volume(page, "24,000 mm³"); // nothing changes while the AI answers
        await page.evaluate(() => (globalThis.allowLines = 6));
        await page.waitForSelector("#ai-preview");
        assert.equal(await page.$("#ai-progress"), null, "the bar gives way to the preview");
        assert.equal(await page.textContent("#ai-preview .ai-working-text"), "The box becomes 50 mm wide; depth 30 mm and height 20 mm stay.");
        await page.click("#ai-accept");
        await volume(page, "30,000 mm³"); // 50 · 30 · 20
      } finally {
        await page.close();
      }
    }
  });

  await check("a request no command can do: the AI's reason is shown, nothing to accept, nothing changed (AI5c, 1280 and 375 px)", async () => {
    // Ben's request (2026-10-26) once came back as a 20 × 0.01 mm cylinder; the honest answer is no commands and why.
    const why = "There is no command for drawing a sketch yet, so this can't be done and nothing was made. What can be done now is making or resizing a whole ready-made shape: a box, cylinder, sphere, plate, L bracket, slot or star.";
    for (const width of [1280, 375]) {
      const { page } = await fresh([JSON.stringify({ explanation: why, commands: [] })], { open: false });
      try {
        if (width === 375) await page.setViewportSize({ width: 375, height: 800 });
        if (width === 375) await page.click("#menu-toggle");
        await page.click("#assistant-toggle");
        await useOllama(page);
        await ask(page, "Draw a circle with radius 10mm as a sketch on the XY plane.");
        await page.waitForSelector("#ai-cannot");
        assert.equal(await page.textContent("#ai-cannot .ai-label"), "The AI can't do this yet.");
        assert.equal(await page.textContent("#ai-cannot .ai-working-text"), why);
        assert.equal(await page.textContent("#ai-cannot .ai-note"), "Nothing was changed.");
        assert.equal(await page.$("#ai-accept"), null, "nothing to accept");
        assert.equal(await page.$("#ai-preview"), null);
        await volume(page, "24,000 mm³");
        assert.equal(await undoTitle(page), "Undo Insert Box (Ctrl+Z)");
        assert.equal(await page.$eval("#ai-cannot", (e) => e.scrollWidth <= e.clientWidth), true);
        await page.$eval("#ai-cannot", (e) => e.scrollIntoView());
        await page.screenshot({ path: `e2e/assistant-cannot-${width}.png` });
      } finally {
        await page.close();
      }
    }
  });

  await check("no working out given: the panel says so; no commands and no reason is asked again", async () => {
    const { page, asked } = await fresh(['{"explanation":"","commands":[]}', setPart("box", 50, 30, 20)]);
    try {
      await useOllama(page);
      await ask(page, "Make it 10 mm wider.");
      await page.waitForSelector("#ai-preview");
      // The empty answer was refused and asked again, saying why.
      assert.equal(asked.length, 2);
      assert.match(asked[1].body.messages.at(-1).content, /That answer can't be used: it has no commands and doesn't say why\./);
      assert.match(await page.textContent("#ai-preview .ai-note"), /The first answer couldn't be used; this is the second\./);
      // The second answer had no working out: said plainly, not left blank.
      assert.equal(await page.textContent("#ai-preview .ai-working-text"), "The AI gave no working out for this answer.");
      assert.equal(await page.$eval("#ai-preview .ai-working-text", (e) => e.classList.contains("ai-working-none")), true);
    } finally {
      await page.close();
    }
  });

  await check("an answer that leaves sizes out keeps them: only the width changes, and a sphere needs no depth", async () => {
    const { page } = await fresh([
      JSON.stringify({ commands: [{ op: "set_part", shape: "box", width: 50 }] }),
      JSON.stringify({ commands: [{ op: "set_part", shape: "sphere", width: 30 }] }),
      JSON.stringify({ commands: [{ op: "set_part", shape: "box", width: 40 }] }),
    ]);
    try {
      await useOllama(page);
      await ask(page, "Make it 10 mm wider.");
      await page.waitForSelector("#ai-preview");
      // Only width is named, so only width changes: 40 → 50, depth 30 and height 20 kept.
      assert.deepEqual(await page.$$eval("#ai-preview tr", (rows) => rows.map((r) => r.dataset.param)), ["width"]);
      assert.equal(await page.textContent("#ai-preview .ai-label"), "AI: box 50 × 30 × 20 mm");
      await page.click("#ai-accept");
      await volume(page, "30,000 mm³"); // 50 · 30 · 20
      assert.equal(await page.inputValue("#depth"), "30");
      await ask(page, "Turn it into a ball 30 mm across.");
      await page.waitForSelector("#ai-preview");
      assert.equal(await page.textContent("#ai-preview .ai-label"), "AI: sphere ⌀30 mm");
      await page.click("#ai-accept");
      await page.waitForFunction(() => document.querySelector("#viewport").dataset.shape === "sphere");
      // Back to a box naming only its width (25c3): a sphere has no depth or height, so they come from the panel,
      // which still holds the box's 30 and 20. Before, the preview read "box 40 × undefined × undefined mm".
      await ask(page, "Make it a box 40 mm wide again.");
      await page.waitForSelector("#ai-preview");
      assert.equal(await page.textContent("#ai-preview .ai-label"), "AI: box 40 × 30 × 20 mm");
      assert.deepEqual(await page.$$eval("#ai-preview tr", (rows) => rows.map((r) => r.textContent)), ["shapesphere→box", "width30→40", "depth—→30", "height—→20"]);
      await page.click("#ai-reject");
      await page.click("#undo");
      await volume(page, "30,000 mm³");
    } finally {
      await page.close();
    }
  });

  await check("on an extruded sketch the AI is told the timeline, and the preview says Accept adds a body after it, with the panel's kept sizes (25c3, 1280 and 375 px)", async () => {
    for (const width of [1280, 375]) {
      // Sizes left out: the AI names only the shape and width.
      const { page, asked } = await fresh([JSON.stringify({ commands: [{ op: "set_part", shape: "box", width: 50 }] })], { open: false });
      try {
        if (width === 375) await page.setViewportSize({ width: 375, height: 800 });
        // Sketch 1: a 40 × 30 rectangle from (0, 0), extruded 10 mm (Extrude 1, item 3): the part is the extrude, 40 · 30 · 10 = 12,000 mm³.
        await page.click("#create-sketch");
        await page.click("#sketch-plane-XY");
        await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
        await gridSnapOn(page);
        await page.evaluate(() => (document.getElementById("workspace").scrollTop = 0)); // ticking it scrolled the panel into view at phone width
        await page.click("#sketch-tool-rectangle");
        for (const p of [[0, 0], [40, 30]]) await clickPlane(page, p, TOP);
        await page.waitForFunction(() => document.querySelector("#sketch-status")?.textContent === "4 lines, a closed outline.");
        await page.click("#sketch-extrude");
        await page.fill("#extrude-distance", "10");
        await page.press("#extrude-distance", "Enter");
        await volume(page, "12,000 mm³");
        const steps = await undoTitle(page);
        if (width === 375) await page.click("#menu-toggle"); // the header's buttons fold into Menu at phone width
        await page.click("#assistant-toggle");
        await useOllama(page);
        await ask(page, "Add a box 50 mm wide.");
        await page.waitForSelector("#ai-preview");
        // What the model was told: no command makes the part, the timeline item by item, where set_part puts a new body,
        // and the panel's sizes it keeps (width and depth the box's 40 and 30, height the extrude's distance 10).
        const prompt = asked[0].body.messages[0].content;
        assert.doesNotMatch(prompt, /made by these commands/, "not an empty project");
        for (const line of [
          "No command you can use makes the part as it is now.",
          "1. Box: 40 × 30 × 20 mm. Builds Body 1.",
          "2. Sketch 1 on the XY plane. A sketch: builds no body.",
          "3. Extrude Sketch 1 by 10 mm. Builds Body 2.",
          "The timeline marker is at the end: every item is built.",
          "The part (the last body) is 3. Extrude Sketch 1 by 10 mm, an extruded sketch, which no command you can use changes, so set_part adds a new body as item 4, after 3. Extrude Sketch 1 by 10 mm; nothing already in the timeline changes.",
          "A size set_part leaves out keeps the value it has now: width 40, depth 30, height 10.",
        ])
          assert.ok(prompt.split("\n").includes(line), `prompt lacks: ${line}\n${prompt}`);
        // The preview: a new box 50 × 30 × 10, every size from nothing, and where it goes; nothing changed yet.
        assert.equal(await page.textContent("#ai-preview .ai-label"), "AI: new box 50 × 30 × 10 mm");
        assert.deepEqual(await page.$$eval("#ai-preview tr", (rows) => rows.map((r) => r.textContent)), ["shape—→box", "width—→50", "depth—→30", "height—→10"]);
        assert.match(await page.textContent("#ai-preview .ai-note"), /^Nothing has changed yet\. Accept adds a new body as item 4, after 3\. Extrude Sketch 1 by 10 mm; nothing already in the timeline changes\.$/);
        await volume(page, "12,000 mm³");
        assert.equal(await undoTitle(page), steps);
        if (width === 375) await page.screenshot({ path: "e2e/assistant-adds-375.png" });
        await page.click("#ai-accept");
        // The new box is the part now: 50 · 30 · 10 = 15,000 mm³; Extrude 1 is still item 3.
        await volume(page, "15,000 mm³");
        assert.equal(await undoTitle(page), `Undo AI: new box 50 × 30 × 10 mm (Ctrl+Z)`);
        assert.equal(await page.$$eval("#timeline [data-item]", (items) => items.map((i) => i.dataset.item).join(" ")), "feature-1 sketch-2 feature-11 feature-12");
        await page.click("#undo");
        await volume(page, "12,000 mm³");
        assert.equal(await undoTitle(page), steps, "one step, taken back whole");
      } finally {
        await page.close();
      }
    }
  });

  await check("the AI starts a sketch on a plane and on the box's top face: told the faces, previewed, one undo step, opened to draw in; a face it wasn't offered is refused (AI7a, 1280 and 375 px)", async () => {
    for (const width of [1280, 375]) {
      const sketch = (on) => JSON.stringify({ commands: [{ op: "create_sketch", on }], explanation: "So there is a new empty sketch." });
      const answers = [sketch("XZ")];
      const { page, asked } = await fresh(answers, { open: false });
      try {
        if (width === 375) await page.setViewportSize({ width: 375, height: 800 });
        if (width === 375) await page.click("#menu-toggle");
        await page.click("#assistant-toggle");
        await useOllama(page);
        const steps = await undoTitle(page);
        await ask(page, "Start a sketch on the front plane.");
        await page.waitForSelector("#ai-preview");
        // What the model was told: where the sketch goes in the timeline, and the box's six flat faces by name, each
        // with the way it faces; the answer's schema lets it name only those or an origin plane.
        const prompt = asked[0].body.messages[0].content.split("\n");
        assert.ok(prompt.includes("create_sketch adds an empty Sketch 1 as item 2, after 1. Box: 40 × 30 × 20 mm, and opens it; nothing already in the timeline changes."), prompt.join("\n"));
        const faces = prompt.filter((l) => l.startsWith("- face:"));
        assert.equal(faces.length, 6, faces.join("\n"));
        const facing = faces.map((l) => l.match(/facing (.+?), centre/)[1]).sort();
        assert.deepEqual(facing, ["down (−Z, a bottom face)", "left (−X)", "right (+X)", "the back (+Y)", "the front (−Y)", "up (+Z, a top face)"].sort());
        // The box stands on the XY plane, 20 mm tall: its top face's centre is 20 mm up.
        const top = faces.find((l) => l.includes("facing up"));
        assert.match(top, /, centre \(-?[\d.]+, -?[\d.]+, 20\) mm, which is \(-?[\d.]+, -?[\d.]+\) in a sketch on it\.$/, top);
        const topName = top.match(/^- (face:[^:]+):/)[1];
        const schema = asked[0].body.format.properties.commands.items.oneOf.find((c) => c.properties.op.const === "create_sketch");
        assert.deepEqual(schema.properties.on.enum, ["XY", "XZ", "YZ", ...faces.map((l) => l.match(/^- (face:[^:]+):/)[1])]);
        // The preview names it; nothing changed yet.
        assert.equal(await page.textContent("#ai-preview .ai-label"), "AI: new sketch on the XZ plane");
        assert.deepEqual(await page.$$eval("#ai-preview tr", (rows) => rows.map((r) => r.textContent)), ["sketch—→new, on the XZ plane"]);
        assert.equal(await page.$$eval("#timeline [data-item]", (items) => items.length), 1);
        assert.equal(await undoTitle(page), steps);
        await page.click("#ai-accept");
        // Accepted: Sketch 1 on XZ is item 2, open to draw in, as Create sketch then XZ would leave it, in one AI step.
        await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
        assert.equal(await page.$$eval("#timeline [data-item]", (items) => items.map((i) => i.dataset.item).join(" ")), "feature-1 sketch-2");
        assert.equal(await undoTitle(page), "Undo AI: new sketch on the XZ plane (Ctrl+Z)");
        if (width === 375) await page.screenshot({ path: "e2e/assistant-sketch-375.png" });
        await page.click("#undo");
        await page.waitForFunction(() => document.querySelectorAll("#timeline [data-item]").length === 1);
        assert.equal(await undoTitle(page), steps, "one step, taken back whole");
        await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching !== "true");
        // On the top face, by the name the model was given.
        answers.push(sketch(topName));
        await ask(page, "Sketch on the top of the box.");
        await page.waitForSelector("#ai-preview");
        assert.equal(await page.textContent("#ai-preview .ai-label"), "AI: new sketch on a face of Body 1 (Box 1), facing up (+Z, a top face)");
        await page.click("#ai-accept");
        await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
        assert.equal(await page.$$eval("#timeline [data-item]", (items) => items.map((i) => i.dataset.item).join(" ")), "feature-1 sketch-2"); // Undo took the counter back too, so the id is reused (never two at once)
        assert.match(await page.getAttribute('#timeline [data-item="sketch-2"]', "title"), /Sketch 1 on a face of Box 1/);
        if (width === 1280) await page.screenshot({ path: "e2e/assistant-face-sketch-1280.png" });
        // A face the model wasn't offered (made up, twice): refused by the answer's check before any preview; nothing changes.
        answers.push(sketch("face:feature-9/end"), sketch("face:feature-9/end"));
        const before = await undoTitle(page);
        await ask(page, "Sketch on the other part's face.");
        await page.waitForSelector("#ai-result .ai-error");
        assert.match(await page.textContent("#ai-result"), /even after one retry.*Nothing was changed/s);
        assert.equal(await page.$("#ai-accept"), null);
        assert.equal(await undoTitle(page), before);
      } finally {
        await page.close();
      }
    }
  });

  await check("the AI draws Ben's circle in a new sketch, then a rectangle in the open one: told the sketch axes, previewed, one undo step each; with no sketch open it is refused (AI7b, 1280 and 375 px)", async () => {
    for (const width of [1280, 375]) {
      const answer = (commands, explanation) => JSON.stringify({ commands, explanation });
      // Ben's words (2026-10-26): radius 10 → diameter 2 × 10 = 20, centred on the origin as nothing else is said.
      const answers = [answer([{ op: "create_sketch", on: "XY" }, { op: "draw_circle", diameter: 20 }], "The diameter is twice the radius: 2 × 10 = 20 mm. So there is a new sketch on the XY plane, and in it a circle ⌀20 mm at (0, 0).")];
      const { page, asked } = await fresh(answers, { open: false });
      const points = (want) => page.waitForFunction((w) => document.querySelector("#viewport").dataset.sketchPoints === w, want, { timeout: 5000 }).catch(async () => assert.fail(`points ${want}, shown ${await page.getAttribute("#viewport", "data-sketch-points")}`));
      try {
        if (width === 375) await page.setViewportSize({ width: 375, height: 800 });
        if (width === 375) await page.click("#menu-toggle");
        await page.click("#assistant-toggle");
        await useOllama(page);
        const steps = await undoTitle(page);
        await ask(page, "Draw a circle with radius 10mm as a sketch on the XY plane.");
        await page.waitForSelector("#ai-preview");
        // What the model was told: no sketch is open, where a sketch's x and y are, and where each face's centre is in them.
        const prompt = asked[0].body.messages[0].content.split("\n");
        assert.ok(prompt.includes("No sketch is open: to draw, start one with create_sketch first in the same answer; the draw commands then draw in it."), prompt.join("\n"));
        assert.ok(prompt.some((l) => l.startsWith("In a sketch, x and y are in mm on its plane: on XY, x is X and y is Y; on XZ, x is X and y is Z;")), prompt.join("\n"));
        // The box's top face is 20 mm up; its own sketch's x and y are listed after its 3D centre.
        const top = prompt.find((l) => l.startsWith("- face:") && l.includes("facing up"));
        assert.match(top, /, centre \(-?[\d.]+, -?[\d.]+, 20\) mm, which is \(-?[\d.]+, -?[\d.]+\) in a sketch on it\.$/, top);
        const ops = asked[0].body.format.properties.commands.items.oneOf.map((c) => c.properties.op.const);
        assert.deepEqual(ops, ["set_part", "create_sketch", "draw_circle", "draw_rectangle", "draw_line", "extrude_sketch"]);
        // The preview: a row per command; nothing changed yet.
        assert.equal(await page.textContent("#ai-preview .ai-label"), "AI: new sketch on the XY plane, then circle ⌀20 mm at (0, 0)");
        assert.deepEqual(await page.$$eval("#ai-preview tr", (rows) => rows.map((r) => r.textContent)), ["sketch—→new, on the XY plane", "circle—→circle ⌀20 mm at (0, 0)"]);
        assert.equal(await page.$$eval("#timeline [data-item]", (items) => items.length), 1);
        assert.equal(await undoTitle(page), steps);
        await page.click("#ai-accept");
        // Accepted: Sketch 1 on XY, open, with the circle's centre at its origin, in one AI step.
        await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching === "true");
        assert.equal(await page.$$eval("#timeline [data-item]", (items) => items.map((i) => i.dataset.item).join(" ")), "feature-1 sketch-2");
        await points("0,0");
        await page.waitForFunction(() => document.querySelector("#sketch-status")?.textContent === "1 circle, a closed outline.");
        assert.equal(await undoTitle(page), "Undo AI: new sketch on the XY plane, then circle ⌀20 mm at (0, 0) (Ctrl+Z)");
        await page.screenshot({ path: `e2e/assistant-circle-${width}.png` });
        // In the open sketch: a 30 × 20 rectangle centred at (5, 5), so corners (5 ∓ 15, 5 ∓ 10) = (−10, −5) to (20, 15).
        answers.push(answer([{ op: "draw_rectangle", width: 30, height: 20, x: 5, y: 5 }], "So in it a rectangle 30 × 20 mm centred at (5, 5)."));
        await ask(page, "Add a 30 by 20 mm rectangle centred at (5, 5).");
        await page.waitForSelector("#ai-preview");
        const open = asked[1].body.messages[0].content.split("\n");
        assert.ok(open.some((l) => /^Sketch 1 is open \(.+\): the draw commands draw in it, unless create_sketch starts another first\.$/.test(l)), open.join("\n"));
        assert.deepEqual(await page.$$eval("#ai-preview tr", (rows) => rows.map((r) => r.textContent)), ["rectangle—→rectangle 30 × 20 mm centred at (5, 5)"]);
        await page.click("#ai-accept");
        await points("0,0 -10,-5 20,-5 20,15 -10,15");
        assert.equal(await undoTitle(page), "Undo AI: rectangle 30 × 20 mm centred at (5, 5) (Ctrl+Z)");
        await page.click("#undo");
        await points("0,0");
        assert.equal(await undoTitle(page), "Undo AI: new sketch on the XY plane, then circle ⌀20 mm at (0, 0) (Ctrl+Z)", "the rectangle alone was taken back");
        await page.click("#undo");
        await page.waitForFunction(() => document.querySelectorAll("#timeline [data-item]").length === 1);
        assert.equal(await undoTitle(page), steps, "the sketch and its circle, taken back whole");
        await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching !== "true");
        // No sketch open: a line alone has nowhere to go. Refused with the reason; nothing changes.
        answers.push(answer([{ op: "draw_line", x1: 0, y1: 0, x2: 10, y2: 5 }], "So a line from (0, 0) to (10, 5)."));
        await ask(page, "Draw a line from (0, 0) to (10, 5).");
        await page.waitForSelector("#ai-preview, #ai-result .ai-error");
        if (await page.$("#ai-accept")) await page.click("#ai-accept");
        await page.waitForSelector("#ai-result .ai-error");
        assert.match(await page.textContent("#ai-result"), /No sketch is open to draw in/);
        assert.equal(await undoTitle(page), steps);
        assert.equal(await page.$$eval("#timeline [data-item]", (items) => items.length), 1);
      } finally {
        await page.close();
      }
    }
  });

  await check("the AI extrudes a rectangle it just drew, then another sketch by name the other way; a sketch that is no closed outline is refused before the preview (AI7c, 1280 and 375 px)", async () => {
    for (const width of [1280, 375]) {
      const answer = (commands, explanation) => JSON.stringify({ commands, explanation });
      // A 30 × 20 rectangle at the origin extruded 10: 30 · 20 · 10 = 6,000 mm³ (the readout is the last body's: the new one).
      const answers = [answer([{ op: "create_sketch", on: "XY" }, { op: "draw_rectangle", width: 30, height: 20 }, { op: "extrude_sketch", distance: 10 }], "So there is a new sketch on the XY plane, and in it a rectangle 30 × 20 mm centred at (0, 0). Then extrude the sketch by 10 mm.")];
      const { page, asked } = await fresh(answers, { open: false });
      try {
        if (width === 375) await page.setViewportSize({ width: 375, height: 800 });
        if (width === 375) await page.click("#menu-toggle");
        await page.click("#assistant-toggle");
        await useOllama(page);
        const steps = await undoTitle(page);
        await ask(page, "Sketch a 30 by 20 mm rectangle on the XY plane, then extrude it 10 mm.");
        await page.waitForSelector("#ai-preview");
        // Told what the command does, and that no sketch is there yet to name (so no `sketch` choice).
        const prompt = asked[0].body.messages[0].content.split("\n");
        assert.ok(prompt.some((l) => l.startsWith("extrude_sketch makes a new body at the timeline marker from a sketch that makes one closed outline")), prompt.join("\n"));
        assert.ok(prompt.includes("No sketch can be extruded yet, so extrude_sketch only follows a create_sketch and its drawing in the same answer."), prompt.join("\n"));
        const spec = asked[0].body.format.properties.commands.items.oneOf.find((c) => c.properties.op.const === "extrude_sketch");
        assert.deepEqual(Object.keys(spec.properties), ["op", "distance"]);
        assert.equal(await page.textContent("#ai-preview .ai-label"), "AI: new sketch on the XY plane, then rectangle 30 × 20 mm centred at (0, 0), then extrude the sketch by 10 mm");
        assert.deepEqual(await page.$$eval("#ai-preview tr", (rows) => rows.map((r) => r.textContent)), ["sketch—→new, on the XY plane", "rectangle—→rectangle 30 × 20 mm centred at (0, 0)", "extrude—→the sketch by 10 mm"]);
        assert.equal(await undoTitle(page), steps);
        await page.click("#ai-accept");
        // The box, Sketch 1, and the extrude: the body is built from the sketch, the sketch left (nothing is open).
        await page.waitForFunction(() => document.querySelectorAll("#timeline [data-item]").length === 3, null, { timeout: 8000 });
        await page.waitForFunction(() => document.querySelector("#viewport").dataset.sketching !== "true");
        await volume(page, "6,000 mm³"); // 30 · 20 · 10
        assert.equal(await undoTitle(page), "Undo AI: new sketch on the XY plane, then rectangle 30 × 20 mm centred at (0, 0), then extrude the sketch by 10 mm (Ctrl+Z)");
        await page.screenshot({ path: `e2e/assistant-extrude-${width}.png` });
        // Sketch 1 exists now: it can be named, and 5 the other way is a flipped extrude of 5 mm (30 · 20 · 5 = 3,000 mm³).
        answers.push(answer([{ op: "extrude_sketch", distance: -5, sketch: "Sketch 1" }], "So extrude Sketch 1 by 5 mm the other way."));
        await ask(page, "Extrude the first sketch 5 mm the other way.");
        await page.waitForSelector("#ai-preview");
        const named = asked[1].body.messages[0].content.split("\n");
        assert.ok(named.includes("With no sketch named, extrude_sketch takes the sketch started earlier in the answer, else the newest sketch: Sketch 1."), named.join("\n"));
        const second = asked[1].body.format.properties.commands.items.oneOf.find((c) => c.properties.op.const === "extrude_sketch");
        assert.deepEqual(second.properties.sketch.enum, ["Sketch 1"]);
        assert.deepEqual(await page.$$eval("#ai-preview tr", (rows) => rows.map((r) => r.textContent)), ["extrude—→Sketch 1 by 5 mm the other way"]);
        await page.click("#ai-accept");
        await page.waitForFunction(() => document.querySelectorAll("#timeline [data-item]").length === 4, null, { timeout: 8000 });
        await volume(page, "3,000 mm³"); // 30 · 20 · 5
        assert.equal(await undoTitle(page), "Undo AI: extrude Sketch 1 by 5 mm the other way (Ctrl+Z)");
        await page.click("#undo");
        await volume(page, "6,000 mm³");
        // A sketch that is not one closed outline (a lone line): the kernel's reason, before any preview; nothing changed.
        answers.push(answer([{ op: "create_sketch", on: "XZ" }, { op: "draw_line", x1: 0, y1: 0, x2: 10, y2: 5 }, { op: "extrude_sketch", distance: 10 }], "So a line, extruded."));
        const before = await undoTitle(page);
        await ask(page, "Draw a line from (0, 0) to (10, 5) on the front plane and extrude it 10 mm.");
        await page.waitForSelector("#ai-result .ai-error");
        assert.equal(await page.$("#ai-preview"), null, "no preview of a change that cannot be made");
        assert.match(await page.textContent("#ai-result"), /That can't be done: .*closed outline.*Nothing was changed/s);
        assert.equal(await undoTitle(page), before);
        assert.equal(await page.$$eval("#timeline [data-item]", (items) => items.length), 3);
      } finally {
        await page.close();
      }
    }
  });

  await check("a preview made stale by the user's own edit is refused on Accept", async () => {
    const { page } = await fresh([setPart("box", 50, 30, 20)]);
    try {
      await useOllama(page);
      await ask(page, "Make it 10 mm wider.");
      await page.waitForSelector("#ai-preview");
      await page.fill("#depth", "10");
      await volume(page, "8,000 mm³"); // 40 · 10 · 20
      await page.click("#ai-accept");
      assert.match(await page.textContent("#ai-result"), /changed after this preview.*nothing was changed/s);
      await volume(page, "8,000 mm³");
      assert.equal(await undoTitle(page), "Undo Change depth (Ctrl+Z)");
    } finally {
      await page.close();
    }
  });

  await check("two unusable answers: a clear message, nothing changed", async () => {
    const { page, asked } = await fresh(["not json", setPart("box", -5, 30, 20)]);
    try {
      await useOllama(page);
      await ask(page, "Make it smaller.");
      await page.waitForSelector("#ai-result .ai-error");
      assert.match(await page.textContent("#ai-result"), /even after one retry.*Nothing was changed/s);
      assert.equal(asked.length, 2);
      await volume(page, "24,000 mm³");
      assert.equal(await undoTitle(page), "Undo Insert Box (Ctrl+Z)"); // the box's insert (U0c) is the only step
    } finally {
      await page.close();
    }
  });

  await check("own API key: shown exactly what will be sent first; Don't send sends nothing; the key goes only to its provider", async () => {
    const { page, asked, listed } = await fresh([JSON.stringify({ commands: [{ op: "set_part", shape: "sphere", width: 30, depth: 30, height: 20 }] })]);
    try {
      await useOllama(page);
      await page.selectOption("#ai-provider", "api-key");
      assert.match(await page.textContent("#ai-key-state"), /No key saved for https:\/\/api.anthropic.com. Saving one asks https:\/\/api.anthropic.com which models it can use; only the key is sent/);
      await page.fill("#ai-key", KEY);
      assert.match(await page.textContent("#ai-key-state"), /This is an Anthropic key: Save key to use it/, "a typed key waits for Save key");
      assert.equal(listed.length, 0);
      await page.click("#ai-key-save");
      await page.waitForFunction(() => document.querySelector("#ai-model-pick").value === "claude-haiku-5-5");
      assert.deepEqual(listed.map((l) => [l.url, l.headers["x-api-key"]]), [["https://api.anthropic.com/v1/models?limit=1000", KEY]]);
      assert.match(await page.textContent("#ai-key-state"), /A key is saved for https:\/\/api.anthropic.com, in this browser only/);
      assert.equal(await page.inputValue("#ai-key"), "", "the box is emptied once saved");
      assert.equal(await page.textContent("#assistant-toggle"), "AI API key");
      await ask(page, "A ball with a radius of 15 mm.");
      await page.waitForSelector("#ai-consent");
      const shown = await page.textContent("#ai-consent");
      assert.match(shown, /first request to https:\/\/api.anthropic.com/);
      assert.match(shown, /"content": "A ball with a radius of 15 mm."/);
      assert.match(shown, /x-api-key/);
      assert.equal(shown.includes(KEY), false, "the key itself is never shown");
      await page.click("#ai-cancel");
      await page.waitForSelector("#ai-result .ai-error");
      assert.match(await page.textContent("#ai-result"), /nothing was sent/);
      assert.equal(asked.length, 0);
      await ask(page, "A ball with a radius of 15 mm.");
      await page.click("#ai-send");
      await page.waitForSelector("#ai-preview");
      assert.equal(asked.length, 1);
      assert.equal(asked[0].url, "https://api.anthropic.com/v1/messages");
      assert.equal(asked[0].headers["x-api-key"], KEY);
      assert.equal(asked[0].body.model, "claude-haiku-5-5", "the model chosen from the list");
      assert.equal(asked[0].body.stream, true, "streamed (AI5c2): the fake sends the tool's input in pieces, as Anthropic does");
      assert.equal(JSON.stringify(asked[0].body).includes(KEY), false);
      // A sphere uses only its diameter: 15 mm radius → width 30.
      assert.equal(await page.textContent("#ai-preview .ai-label"), "AI: sphere ⌀30 mm");
      await page.click("#ai-accept");
      await page.waitForFunction(() => document.querySelector("#viewport").dataset.shape === "sphere");
      // The key is only in its own storage slot, never in the project or the page.
      const stored = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
      assert.deepEqual(Object.entries(stored).filter(([, v]) => v.includes(KEY)).map(([k]) => k), ["fission.ai.key:https://api.anthropic.com"]);
      assert.equal((await page.content()).includes(KEY), false);
      // The second request needs no new confirmation (the first one was agreed to).
      await page.click("#undo");
      await volume(page, "24,000 mm³");
    } finally {
      await page.close();
    }
  });

  await check("Ollama at another computer's address: said so, its check asks nothing, the first question is shown before it is sent", async () => {
    const { page, asked, remoteHits } = await fresh([setPart("box", 50, 30, 20), setPart("box", 60, 30, 20)]);
    try {
      await useOllama(page);
      await page.fill("#ai-endpoint", REMOTE_OLLAMA);
      await page.press("#ai-endpoint", "Tab"); // a change event, as leaving the box gives
      await page.waitForFunction(() => document.querySelector("#ai-model-pick").value === "qwen2.5:1.5b");
      assert.equal(
        await page.textContent("#ai-status-detail"),
        `Using Ollama at ${REMOTE_OLLAMA}, which is not this computer: your requests go there, and the first one is shown to you before it is sent.`,
      );
      assert.match(await page.getAttribute("#assistant-toggle", "title"), /sends requests to the provider/);
      // The check only asks it which models it has (GET /api/tags, nothing of the user's), so no box.
      await page.click("#ai-check");
      await page.waitForFunction(() => document.querySelector("#ai-check-result").textContent === "Ready.");
      assert.equal(await page.isVisible("#ai-consent"), false);
      assert.deepEqual(remoteHits.filter((u) => !u.endsWith("/api/tags")), [], "only model lists so far");
      // The first question: shown exactly, no key mentioned, and Don't send sends nothing.
      await ask(page, "Make it 10 mm wider.");
      await page.waitForSelector("#ai-consent");
      const shown = await page.textContent("#ai-consent");
      assert.match(shown, new RegExp(`first request to ${REMOTE_OLLAMA}\\. Exactly this will be sent to ${REMOTE_OLLAMA}/api/chat \\(headers: content-type\\)`));
      assert.match(shown, /"content": "Make it 10 mm wider."/);
      assert.equal(shown.includes("your key"), false, "no key goes to Ollama, so none is mentioned");
      await page.click("#ai-cancel");
      await page.waitForSelector("#ai-result .ai-error");
      assert.match(await page.textContent("#ai-result"), /nothing was sent/);
      assert.equal(asked.length, 0);
      // Asked again and sent: it goes to that address only; the next question needs no box.
      await ask(page, "Make it 10 mm wider.");
      await page.click("#ai-send");
      await page.waitForSelector("#ai-preview");
      assert.deepEqual(asked.map((a) => a.url), [`${REMOTE_OLLAMA}/api/chat`]);
      await page.click("#ai-reject");
      await ask(page, "Make it 20 mm wider.");
      await page.waitForSelector("#ai-preview");
      assert.equal(await page.isVisible("#ai-consent"), false);
      assert.deepEqual(asked.map((a) => a.url), [`${REMOTE_OLLAMA}/api/chat`, `${REMOTE_OLLAMA}/api/chat`]);
      if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/remote-ollama.png` });
      // Back to this computer: said so again.
      await page.fill("#ai-endpoint", "http://127.0.0.1:11434");
      await page.press("#ai-endpoint", "Tab"); // a change event, as leaving the box gives
      assert.match(await page.textContent("#ai-status-detail"), /nothing leaves your machine/);
    } finally {
      await page.close();
    }
  });

  await check("settings survive a reload; outside Design there is nothing to ask yet", async () => {
    const { page } = await fresh();
    try {
      await useOllama(page);
      await reloadEmpty(page); // each load is a new, empty project here (U0c)
      assert.equal(await page.textContent("#assistant-toggle"), "AI Ollama");
      await page.click("#assistant-toggle");
      await page.waitForFunction(() => document.querySelector("#ai-model-pick").value === "qwen2.5:1.5b");
      await switchTo(page, "laser");
      assert.equal(await page.isDisabled("#ai-ask-button"), true);
      assert.match(await page.textContent("#ai-ask-note"), /can change Design's part/);
      assert.match(await page.textContent("#assistant"), /Planned in Laser.*finger-joint boxes/s);
    } finally {
      await page.close();
    }
  });

  await check("without a usable graphics card the in-browser option is greyed out with the reason and another way", async () => {
    const { page } = await fresh();
    try {
      await looked(page);
      const option = await page.$eval('#ai-provider option[value="in-browser"]', (o) => ({ disabled: o.disabled, text: o.textContent }));
      assert.deepEqual(option, { disabled: true, text: "In your browser (can't run here)" });
      assert.match(await page.textContent("#ai-found"), /In your browser can't run here: this browser has no WebGPU/);
      assert.match(await page.textContent("#ai-found"), /Ollama on your computer, or an API key, will work instead/);
    } finally {
      await page.close();
    }
  });

  await check("nothing local found: stays off and says what would work; Ollama isn't listed even when looked for; the API key still is", async () => {
    const { page, asked, ollamaHits } = await fresh([], { ollama: false });
    try {
      await looked(page);
      assert.equal(ollamaHits.length, 0);
      assert.doesNotMatch(await page.textContent("#ai-found"), /OLLAMA_ORIGINS/, "no Ollama set-up talk until the user looks for it");
      await page.click("#ai-detect");
      await page.waitForFunction(() => /OLLAMA_ORIGINS/.test(document.querySelector("#ai-found").textContent));
      assert.equal(ollamaHits.length, 1);
      assert.equal(await page.textContent("#assistant-toggle"), "AI off");
      assert.equal(await page.isDisabled("#ai-ask-button"), true);
      assert.match(await page.textContent("#ai-ask-note"), /Choose a provider/);
      assert.match(await page.textContent("#ai-found"), /No AI that runs on this computer was found/);
      assert.equal(await page.$eval('#ai-provider option[value="ollama"]', (o) => o.hidden && o.disabled), true, "Ollama is listed only while it runs");
      assert.equal(await page.$eval('#ai-provider option[value="api-key"]', (o) => o.disabled || o.hidden), false);
      assert.equal(asked.length, 0);
    } finally {
      await page.close();
    }
  });

  await check("the browser's built-in model is picked first, and asking it works with nothing sent anywhere", async () => {
    const { page, asked, builtInAsked } = await fresh([setPart("box", 50, 30, 20)], { builtIn: true });
    try {
      await page.waitForFunction(() => document.querySelector("#assistant-toggle").textContent === "AI built-in");
      assert.match(await page.textContent("#ai-found"), /Chose Your browser's built-in AI for you/);
      assert.equal(await page.isVisible("#ai-model-pick"), false, "the built-in model has no model to choose");
      await ask(page, "Make it 50 wide.");
      await page.waitForSelector("#ai-preview");
      await page.click("#ai-accept");
      await volume(page, "30,000 mm³"); // 50 · 30 · 20
      assert.deepEqual(builtInAsked, ["Make it 50 wide."]);
      assert.equal(asked.length, 0, "nothing went to Ollama or an API");
    } finally {
      await page.close();
    }
  });

  // Found by CI's Chrome 156 (#238): its LanguageModel answers "downloadable"
  // on a machine with no model, the panel chose it, and every question hung
  // on a download that never came. A model that isn't there yet is not an AI
  // that runs on this computer.
  for (const state of ["downloadable", "downloading"]) {
    await check(`a built-in model the browser has yet to download ("${state}") is not picked: AI stays off, the panel says why, and no session (so no download) is started`, async () => {
      const { page, asked, builtInAsked, builtInCreated, ollamaHits } = await fresh([setPart("box", 50, 30, 20)], { builtIn: state, ollama: false });
      try {
        await looked(page);
        assert.equal(await page.textContent("#assistant-toggle"), "AI off");
        assert.match(await page.textContent("#ai-found"), /No AI that runs on this computer was found/);
        assert.match(await page.textContent("#ai-found"), state === "downloading" ? /Your browser's built-in AI can't run here: this browser is still downloading its built-in model/ : /Your browser's built-in AI can't run here: this browser hasn't downloaded its built-in model yet/);
        assert.equal(await page.$eval('#ai-provider option[value="browser-built-in"]', (o) => o.disabled && /can't run here/.test(o.textContent)), true, "the option is greyed out with the reason");
        assert.equal(await page.isDisabled("#ai-ask-button"), true);
        assert.deepEqual(builtInCreated, [], "no session was made of a model that is not there");
        assert.deepEqual(builtInAsked, []);
        assert.equal(asked.length, 0);
        assert.equal(ollamaHits.length, 0, "Ollama is still asked nothing until the user looks for it");
      } finally {
        await page.close();
      }
    });
  }

  await check("choosing Off is kept: the next visit doesn't pick for the user again", async () => {
    const { page } = await fresh();
    try {
      await useOllama(page);
      await page.selectOption("#ai-provider", "");
      assert.equal(await page.textContent("#assistant-toggle"), "AI off");
      await reloadEmpty(page); // each load is a new, empty project here (U0c)
      await page.click("#assistant-toggle");
      await looked(page);
      await page.click("#ai-detect");
      await page.waitForFunction(() => document.querySelector('#ai-provider option[value="ollama"]').hidden === false);
      assert.equal(await page.textContent("#assistant-toggle"), "AI off", "Ollama is offered, not chosen");
    } finally {
      await page.close();
    }
  });

  await check("a pasted OpenAI key switches to OpenAI, is saved at once and lists its chat models; a typed name still works", async () => {
    const { page, listed } = await fresh();
    try {
      await useOllama(page);
      await page.selectOption("#ai-provider", "api-key");
      assert.equal(await page.inputValue("#ai-vendor"), "anthropic");
      await paste(page, "#ai-key", OPENAI_KEY);
      await page.waitForFunction(() => document.querySelector("#ai-model-pick").value === "gpt-5-mini");
      assert.equal(await page.inputValue("#ai-vendor"), "openai");
      assert.match(await page.textContent("#ai-key-state"), /A key is saved for https:\/\/api.openai.com/);
      assert.equal(await page.inputValue("#ai-key"), "");
      // whisper-1 can't chat, so it is left out: gpt-5 and gpt-5-mini, sorted, then the typed choice.
      assert.deepEqual(await page.$$eval("#ai-model-pick option", (os) => os.map((o) => o.textContent)), ["gpt-5", "gpt-5-mini", "Another (type its name)"]);
      assert.deepEqual(listed.map((l) => [l.url, l.headers.authorization]), [["https://api.openai.com/v1/models", `Bearer ${OPENAI_KEY}`]]);
      await page.selectOption("#ai-model-pick", "");
      assert.equal(await page.isVisible("#ai-model"), true);
      await page.fill("#ai-model", "my-tuned-model");
      await page.dispatchEvent("#ai-model", "change");
      await reloadEmpty(page); // each load is a new, empty project here (U0c)
      await page.click("#assistant-toggle");
      await page.waitForFunction(() => document.querySelector("#ai-model").value === "my-tuned-model");
      assert.equal(await page.isVisible("#ai-model"), true, "a name not in the list stays a typed name");
    } finally {
      await page.close();
    }
  });

  await check("a key that can't be told apart isn't guessed: nothing is saved or sent until Save key", async () => {
    const { page, listed } = await fresh();
    try {
      await useOllama(page);
      await page.selectOption("#ai-provider", "api-key");
      await page.selectOption("#ai-vendor", "openai");
      await paste(page, "#ai-key", "sk-0123456789abcdef0123456789abcdef");
      assert.equal(await page.inputValue("#ai-vendor"), "openai", "the chosen provider is left as it is");
      assert.equal(await page.inputValue("#ai-key"), "sk-0123456789abcdef0123456789abcdef", "not saved by itself");
      assert.equal(listed.length, 0, "the key went nowhere");
    } finally {
      await page.close();
    }
  });

  assert.deepEqual(errors, [], "no page errors or console errors");
} catch (e) {
  failed = true;
  console.log(`FAIL ${e.message}`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
if (failed) process.exit(1);

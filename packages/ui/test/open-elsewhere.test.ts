// The question before a file takes you to another workspace (open-elsewhere.ts):
// its words worked out by hand, and the dialog in a real DOM (happy-dom):
// only the confirm button answers yes; Cancel, Escape and a newer question
// answer no; keys never reach the app's shortcuts. The real app in
// Chromium: apps/fission/e2e/open-elsewhere.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openElsewhere, openElsewhereWords } from "../src/open-elsewhere.ts";

const { Window } = await import("happy-dom");

test("hand-worked: the words for an image opened in Design", () => {
  assert.deepEqual(openElsewhereWords("car.png", "a PNG image", "Image", "Design"), {
    heading: "Open in Image?",
    words: "“car.png” is a PNG image, which opens in the Image workspace. Design stays as it is, and the workspace menu at the top takes you back.",
    confirm: "Open in Image",
  });
  // Nothing on screen to come back to: no second sentence.
  assert.equal(openElsewhereWords("a.jpg", "a JPEG image", "Image", null).words, "“a.jpg” is a JPEG image, which opens in the Image workspace.");
});

function page() {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const ask = openElsewhere(doc);
  const dialog = doc.getElementById("open-elsewhere") as HTMLDialogElement;
  const key = (k: string) => {
    const e = new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }) as unknown as Event;
    doc.activeElement!.dispatchEvent(e);
  };
  return { window, doc, ask, dialog, key };
}

test("the confirm button answers yes and closes; it has the focus", async () => {
  const { doc, ask, dialog } = page();
  const answer = ask.ask("car.png", "a PNG image", "Image", "Design");
  assert.equal(ask.open, true);
  assert.equal(doc.getElementById("open-elsewhere-heading")!.textContent, "Open in Image?");
  assert.equal(doc.activeElement?.id, "open-elsewhere-confirm");
  assert.equal(doc.getElementById("open-elsewhere-confirm")!.textContent, "Open in Image");
  (doc.getElementById("open-elsewhere-confirm") as HTMLButtonElement).click();
  assert.equal(await answer, true);
  assert.equal(dialog.open, false);
});

test("Cancel and Escape answer no; keys pressed in it never reach the document", async () => {
  const { doc, ask, key } = page();
  const first = ask.ask("car.png", "a PNG image", "Image", "Design");
  (doc.getElementById("open-elsewhere-cancel") as HTMLButtonElement).click();
  assert.equal(await first, false);
  assert.equal(ask.open, false);

  let heard = 0;
  doc.addEventListener("keydown", () => heard++);
  const second = ask.ask("car.png", "a PNG image", "Image", "Design");
  key("l"); // a sketch tool's key: kept in the dialog
  key("Escape");
  assert.equal(await second, false);
  assert.equal(heard, 0);
  assert.equal(ask.open, false);
});

test("a second question answers the first with no, and only the second can say yes", async () => {
  const { doc, ask } = page();
  const first = ask.ask("a.png", "a PNG image", "Image", "Design");
  const second = ask.ask("b.png", "a PNG image", "Image", "Design");
  assert.equal(await first, false);
  assert.match(doc.getElementById("open-elsewhere-words")!.textContent!, /^“b\.png”/);
  (doc.getElementById("open-elsewhere-confirm") as HTMLButtonElement).click();
  assert.equal(await second, true);
});

// The soak test's plants (soak-plants.mjs) still apply: each text a plant
// replaces is in its file exactly once, so a plant can't silently stop
// planting when the code moves on. Run by `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SOAK_PLANTS } from "./soak-plants.mjs";

const root = new URL("../../../", import.meta.url);

for (const [name, p] of Object.entries(SOAK_PLANTS)) {
  test(`plant ${name} applies`, () => {
    assert.ok(p.what && p.expect && p.edits.length > 0);
    for (const e of p.edits) assert.equal(readFileSync(new URL(e.file, root), "utf8").split(e.find).length, 2, `${e.file}: ${e.find}`);
  });
}

test("a plant whose text is gone is noticed", () => {
  const text = readFileSync(new URL(SOAK_PLANTS["redo-does-nothing"].edits[0].file, root), "utf8");
  assert.equal(text.split("      go(index + 2);").length, 1, "a text that is not there splits into one piece");
});

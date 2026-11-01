// Bug hunt (timeline helper, 2026-11-01): the "used by" question when the
// item deleted holds a body a Move moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { insertMove, insertPreset, NO_MOVE, partDocument, reorderItem, type MoveValues } from "@fission/design";
import { app } from "./design-app.ts";

const v = (o: Partial<MoveValues>): MoveValues => ({ ...NO_MOVE, ...o });

test("hunt: deleting Box 1, which Move 1 moves with Cylinder 1, asks in a Move's words and says Cylinder 1 is left where it was made", async () => {
  // Box 1 40 × 30 × 20, Cylinder 1 ⌀10 × 5, Move 1 shifts both 100 mm along X.
  const d = insertPreset(partDocument("box", 40, 30, 20), "cylinder", 10, 10, 5).doc;
  const m = insertMove(d, ["body:feature-1", "body:feature-2"], v({ x: 100 }));
  // The timeline's own words for this link (reorderItem, timeline-edits.ts link()): "a move of".
  const re = reorderItem(m.doc, m.id, 0);
  assert.ok("refused" in re && /is a move of Box 1/.test(re.message), JSON.stringify(re));
  const a = await app(m.doc);
  await a.menu("feature-1", "delete");
  const words = a.$("#delete-ask-words")!.textContent!;
  (a.$("#delete-ask-cancel") as HTMLButtonElement).click();
  await a.close();
  // Rule (written apart): a Move has no shape of its own (makesBody is false), so "has no shape to keep" is
  // wrong; what the user loses is the move of Cylinder 1 (all or none, rebuild.ts moveBodies), so it must be named.
  assert.doesNotMatch(words, /Move 1 is built from Box 1/, "a Move is not built from the body it moves");
  assert.doesNotMatch(words, /Move 1 has no shape to keep/, "a Move has no shape of its own");
  assert.match(words, /Cylinder 1/, "Cylinder 1, which Move 1 stops moving, is named");
});

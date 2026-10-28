// Hunt: Enter with a refused size in a box ("12,5", a comma decimal) must not place a point at the pointer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { partDocument } from "../../src/document.ts";
import { addSketch } from "../../src/sketch.ts";
import { clickAt, startTool } from "../../src/sketch-tool.ts";
import { aimOf, withLocks, type Locks } from "../../src/typed-entry.ts";
import { typedBoxes } from "../../src/typed-boxes.ts";
const { Window } = await import("happy-dom");

test("typing 12,5 and Enter draws nothing (the box says it isn't a length)", () => {
  const window = new Window();
  const doc = window.document as unknown as Document;
  const host = doc.createElement("div");
  doc.body.append(host);
  const s = addSketch(partDocument("box", 40, 30, 20));
  let design = s.doc;
  let tool: any = clickAt(design, startTool("line", s.id), [0, 0]).tool;
  const pointer: [number, number] = [37, 3]; // where the mouse happens to rest
  let locks: Locks = {};
  let drew = false;
  // What workspace.ts placeTyped does on the boxes' enter(): aimOf with the locks it has, then clickAt there.
  const b = typedBoxes(host, {
    locks: (l) => (locks = l),
    enter: () => { const aim = aimOf(design, tool, pointer, locks); if (aim) { const o = clickAt(design, withLocks(tool, locks, pointer), aim); drew = o.drew; design = o.doc; } },
    escape: () => {},
  });
  b.show(["length", "angle"], { length: 37.1, angle: 4.6 }, 0, 0);
  b.start("1");
  const input = doc.getElementById("typed-length") as HTMLInputElement;
  input.value = "12,5";
  input.dispatchEvent(new window.Event("input") as unknown as Event);
  assert.equal(input.getAttribute("aria-invalid"), "true", "the box shows 12,5 is refused");
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }) as unknown as Event);
  // By hand: the user meant a 12.5 mm line; the box refused the text, so nothing should be drawn.
  // A line to the pointer (37, 3), length √(37² + 3²) ≈ 37.12 mm, is not what was typed.
  assert.equal(drew, false, `drew a line to the pointer: ${JSON.stringify(design.sketches.find((x: any) => x.id === s.id)!.points.map((p: any) => [p.x, p.y]))}`);
});

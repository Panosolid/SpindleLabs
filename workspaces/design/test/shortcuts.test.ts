import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChord, type Selected } from "@fission/core";
import { DESIGN_SHORTCUTS, designShortcut } from "../src/shortcuts.ts";

const profile: Selected = { kind: "outline", id: "outline:feature-1/profile-1" };
const face: Selected = { kind: "face", id: "face:feature-1/1" };

test("Design's keys: Escape clears (also in a size field), Enter is Extrude's OK, M is Move, Shift+R is Rotate, Copy is Mod+C, L, R, C, A, T and P choose sketch tools, all but Escape only in the page", () => {
  assert.deepEqual(DESIGN_SHORTCUTS.map((s) => [s.id, parseChord(s.keys), s.inText ?? false]), [
    ["clear-selection", "Escape", true],
    // UX1b: in the distance box Enter is the box's own OK; never twice.
    ["extrude-ok", "Enter", false],
    // 35e2b: Move, Fusion's key, outside a sketch.
    ["move-tool", "M", false],
    // Ben, 2026-10-29: Rotate its own tool; R is the sketch's Rectangle, so Shift+R.
    ["rotate-tool", "Shift+R", false],
    // Ben's keys (10-29), Fusion's: E Extrude, S the command search box. T is kept for Trim (step 52): no key yet.
    ["extrude-tool", "E", false],
    ["command-search", "S", false],
    ["copy-svg", "Mod+C", false],
    ["sketch-line", "L", false],
    ["sketch-rectangle", "R", false],
    ["sketch-circle", "C", false],
    ["sketch-arc", "A", false],
    // 27d: Project, Fusion's key.
    ["sketch-project", "P", false],
    // SF4: the keys that start typing a size, never inside a text box (there they type).
    ...[..."0123456789.-"].map((k) => [`type-size-${k}`, k, false]),
  ]);
});

test("hand-worked: Copy runs Copy as SVG only with exactly one profile selected; otherwise the browser copies", () => {
  assert.equal(designShortcut("copy-svg", [profile]), "copy");
  assert.equal(designShortcut("copy-svg", []), null, "nothing selected");
  assert.equal(designShortcut("copy-svg", [face]), null, "a face has no SVG");
  assert.equal(designShortcut("copy-svg", [profile, profile]), null, "two profiles: which one?");
  assert.equal(designShortcut("clear-selection", []), "clear", "Escape with nothing selected is harmless");
  assert.equal(designShortcut("clear-selection", [face]), "clear");
  assert.equal(designShortcut("unknown", [profile]), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, type CommandSpec } from "@fission/core";
import { DESIGN_COMMANDS, SHAPES } from "../src/commands.ts";
import { ICON_NAMES } from "@fission/ui";
import { SHAPE_LABELS, toolbarGroups } from "../src/toolbar.ts";
import { TOOL_ICONS } from "../src/sketch-toolbar.ts";
import { SKETCH_TOOLS } from "../src/sketch-tool.ts";
import { insertSections } from "../src/insert.ts";

test("the toolbar has Export with STL and no shape buttons (U0d: the shapes are in Insert ▾ and the panel's Shape choice)", () => {
  // Written out by hand: set_part makes no button any more; export_stl is the one export.
  assert.deepEqual(
    toolbarGroups().map((g) => [g.name, g.buttons.map((b) => b.label)]),
    [["Export", ["STL"]]],
  );
});

test("every button issues a real Design command, and every shape set_part offers has a name", () => {
  for (const b of toolbarGroups().flatMap((g) => g.buttons)) {
    const parsed = parseCommand(b.command, DESIGN_COMMANDS);
    assert.ok(parsed.ok, `${b.label}: ${JSON.stringify(parsed)}`);
  }
  const shape = DESIGN_COMMANDS.find((c) => c.op === "set_part")!.params.shape;
  assert.ok(shape.type === "choice");
  assert.deepEqual(shape.values, SHAPES);
  // Written out by hand from the roadmap's 16b: Box, Cylinder, Sphere, then the four extruded outlines of profiles.ts.
  assert.deepEqual(SHAPES.map((k) => SHAPE_LABELS[k]), ["Box", "Cylinder", "Sphere", "L-bracket", "Plate", "Slot", "Star"]);
});

test("the toolbar follows the commands: a set_part makes no button, an unknown command none, an export its own", () => {
  const specs: CommandSpec[] = [
    { op: "set_part", summary: "s", params: { shape: { type: "choice", values: ["box", "torus"], description: "d" } } },
    { op: "hole", summary: "h", params: {} },
  ];
  assert.deepEqual(toolbarGroups(specs), []);
  assert.deepEqual(toolbarGroups([...specs, { op: "export_stl", summary: "e", params: {} }]).map((g) => [g.name, g.buttons.map((b) => [b.label, b.command, b.title])]), [["Export", [["STL", { op: "export_stl" }, "e"]]]]);
});

test("every toolbar command, sketch tool and preset has an icon from the set (U0f): a missing or unknown one fails", () => {
  const known = new Set<string>(ICON_NAMES);
  // Written out by hand: STL is the export icon.
  assert.deepEqual(toolbarGroups().flatMap((g) => g.buttons.map((b) => [b.label, b.icon])), [["STL", "export"]]);
  for (const t of SKETCH_TOOLS) assert.ok(known.has(TOOL_ICONS[t.kind]), `${t.label}: ${TOOL_ICONS[t.kind]}`);
  // Written out by hand: the arcs by how they are drawn, the rest by name.
  assert.deepEqual(SKETCH_TOOLS.map((t) => TOOL_ICONS[t.kind]), ["line", "rectangle", "circle", "arc", "centre-arc", "tangent-arc", "project"]);
  const items = insertSections(() => {}).flatMap((s) => s.items);
  assert.deepEqual(items.map((i) => i.icon), ["box", "cylinder", "sphere", "l-bracket", "plate", "slot", "star", "community"]);
  for (const i of items) assert.ok(known.has(i.icon!), i.id);
  // The check can fail: a name not in the set is caught.
  assert.equal(known.has("torus"), false);
});

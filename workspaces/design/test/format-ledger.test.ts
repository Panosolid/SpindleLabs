// A field of the saved Design data must never land without a version bump or a line in docs/project-format.md.
// Cold read 2026-10-31: step 35e2h added `face.body` (it changes what is built) to version 4 with neither, so a
// version 4 reader of an older build opened such a file and silently built the sketch in the wrong place.
//
// This test reads the saved types' property names from the source and holds them to a ledger for the current
// version. Adding a field fails it until its author (1) adds the name below, (2) writes it into
// docs/project-format.md, and (3) if an older reader would build something different without it, raises
// DesignDocument.version and writes the migration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const read = (p: string) => readFileSync(root(p), "utf8");

/** The property names of `export interface name { … }`, found by their indentation of two spaces. */
export function propertyNames(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`no interface ${name}`);
  const end = source.indexOf("\n}", start);
  const body = source.slice(start, end);
  return [...body.matchAll(/^ {2}([A-Za-z_]\w*)\??:/gm)].map((m) => m[1]);
}

// Design data version 7 (no new fields: the names of a ready-made profile's sides changed). Changing any list: see the top of this file.
const LEDGER_VERSION = 7;
const LEDGER: { file: string; type: string; names: string[] }[] = [
  { file: "workspaces/design/src/document.ts", type: "DesignDocument", names: ["version", "nextId", "profiles", "sketches", "timeline", "kept", "bodies", "nextBody", "hidden", "shownPlanes"] },
  { file: "workspaces/design/src/document.ts", type: "Sketch", names: ["id", "points", "curves", "constraints", "face", "pins", "projected"] },
  { file: "workspaces/design/src/document.ts", type: "KeptShape", names: ["points", "curves", "placement"] },
  { file: "workspaces/design/src/face-sketch.ts", type: "SketchFace", names: ["frame", "side", "held", "body"] },
];

test("the saved types' fields are exactly the ledger of the current data version", () => {
  const doc = read("workspaces/design/src/document.ts");
  assert.match(doc, new RegExp(`^ {2}version: ${LEDGER_VERSION};`, "m"), "DesignDocument.version changed: update LEDGER_VERSION and the ledger");
  for (const { file, type, names } of LEDGER) {
    assert.deepEqual(propertyNames(read(file), type), names, `${type} changed: add the field to the ledger, to docs/project-format.md, and bump the version if older readers would build it differently`);
  }
});

test("every ledger field is written in docs/project-format.md", () => {
  const format = read("docs/project-format.md");
  for (const { type, names } of LEDGER) {
    for (const n of names) assert.ok(new RegExp(`\`${n}\`|\\b${n}\\??:|"${n}"`).test(format), `docs/project-format.md never mentions ${type}.${n}`);
  }
});

test("the ledger can fail: an extra field, a missing one and an unknown interface are all seen", () => {
  const src = "export interface Thing {\n  a: number;\n  b?: string;\n  /** doc */\n  c: boolean;\n    nested: number;\n}\n";
  assert.deepEqual(propertyNames(src, "Thing"), ["a", "b", "c"], "nested (deeper indent) is not a field");
  assert.notDeepEqual(propertyNames(src.replace("  c: boolean;\n", "  c: boolean;\n  d: number;\n"), "Thing"), ["a", "b", "c"]);
  assert.throws(() => propertyNames(src, "Other"), /no interface Other/);
});

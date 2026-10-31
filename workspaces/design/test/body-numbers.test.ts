// Step 35e (35ea): every body has an id of its own and the number people
// read, "Body 3", given once when the body first appears and stored in the
// document (Design data version 5; docs/document-model.md, section 8,
// rule 1). Hand-worked cases (a reorder, a suppress, a delete, an old
// file), every saved project in the repo opening to the numbers it showed,
// the reader's refusals (each a valid file broken in exactly one way), and
// seeded edit sessions checked against a model written from the rule's
// words alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { emptyProject, projectFromJson, projectToJson } from "@fission/core";
import { bodyNumbers, insertPreset, makesBody, numberBodies, partDocument, readDesignDocument, type DesignDocument } from "../src/document.ts";
import { addSketch, drawRectangle } from "../src/sketch.ts";
import { extrudeSketch } from "../src/extrude.ts";
import { deleteItem, moveMarker, reorderItem, suppressItem } from "../src/timeline-edits.ts";
import { bodyFeatures, bodyRows } from "../src/browser.ts";
import { hiddenStlNote } from "../src/actions.ts";
import { hideBody } from "../src/timeline-edits.ts";

const DESIGN = [{ id: "design" as const, readData: readDesignDocument }];
const reopen = (d: DesignDocument) => projectFromJson(projectToJson({ ...emptyProject("Bodies"), workspaces: { design: d } }), DESIGN).workspaces.design as DesignDocument;
const labels = (d: DesignDocument) => bodyRows(d).map((r) => r.label);
const reordered = (d: DesignDocument, id: string, to: number) => {
  const r = reorderItem(d, id, to);
  if (!("doc" in r)) throw new Error(r.message);
  return r.doc;
};

/**
 * The box (feature-1, Body 1), Sketch 1 (sketch-2, a 40 × 30 rectangle:
 * points and lines 3 to 10), Extrude 1 of it (feature-11, Body 2) and a
 * cylinder (feature-12, Body 3).
 */
function three(): DesignDocument {
  const s = addSketch(partDocument("box", 40, 30, 20));
  const extruded = extrudeSketch(drawRectangle(s.doc, s.id, [0, 0], [40, 30]).doc, s.id, 10).doc;
  return insertPreset(extruded, "cylinder", 10, 10, 5).doc;
}

test("hand-worked: each new body takes the next number when it is made, and the document says so", () => {
  const d = three();
  // Made in order box, extrude, cylinder: 1, 2, 3, and the next body is 4.
  assert.deepEqual(d.bodies, [
    { id: "body:feature-1", number: 1 },
    { id: "body:feature-11", number: 2 },
    { id: "body:feature-12", number: 3 },
  ]);
  assert.equal(d.nextBody, 4);
  assert.deepEqual(labels(d), ["Body 1", "Body 2", "Body 3"]);
  // A sketch is no body: adding one gives no number.
  const sketched = addSketch(d).doc;
  assert.deepEqual(sketched.bodies, d.bodies);
  assert.equal(sketched.nextBody, 4);
  // Saved and opened again, the numbers are read, not worked out again.
  assert.deepEqual(reopen(d), d);
});

test("hand-worked (Ben's Fusion check): a body keeps its number after a reorder, a suppress or a rollback", () => {
  // The cylinder moved first: build order cylinder, box, sketch, extrude.
  // Before 35e the rows were numbered by place, Body 1 2 3 again; now the
  // cylinder keeps Body 3 and the rows read 3, 1, 2.
  const moved = reordered(three(), "feature-12", 0);
  assert.deepEqual(moved.timeline.features.map((f) => f.id), ["feature-12", "feature-1", "sketch-2", "feature-11"]);
  assert.deepEqual(labels(moved), ["Body 3", "Body 1", "Body 2"]);
  assert.deepEqual(labels(reopen(moved)), ["Body 3", "Body 1", "Body 2"]);
  // The box suppressed: its row goes, the others keep 2 and 3 (by place they were 1 and 2).
  assert.deepEqual(labels(suppressItem(three(), "feature-1", true)), ["Body 2", "Body 3"]);
  // Rolled back to after the extrude: Body 1 and 2 show; the cylinder keeps 3 for when it builds again.
  const rolled = moveMarker(three(), "feature-11");
  assert.deepEqual(labels(rolled), ["Body 1", "Body 2"]);
  assert.deepEqual(labels(moveMarker(rolled, null)), ["Body 1", "Body 2", "Body 3"]);
  // Row ids carry the number too, so a row stays the same row.
  assert.deepEqual(bodyRows(moved).map((r) => [r.id, r.feature.id]), [["body-3", "feature-12"], ["body-1", "feature-1"], ["body-2", "feature-11"]]);
});

test("hand-worked: a deleted body's number is never given again", () => {
  // Delete Extrude 1 (Body 2): Body 1 and Body 3 stay, and the next new
  // body is Body 4 (not 2, which named another body, nor 3).
  const gone = deleteItem(three(), "feature-11");
  assert.deepEqual(labels(gone), ["Body 1", "Body 3"]);
  assert.equal(gone.nextBody, 4);
  const sphere = insertPreset(gone, "sphere", 10, 10, 10);
  assert.equal(sphere.id, "feature-13");
  assert.deepEqual(labels(sphere.doc), ["Body 1", "Body 3", "Body 4"]);
  // Even when the deleted one was the newest: Body 3 deleted, the next is still Body 4.
  assert.equal(insertPreset(deleteItem(three(), "feature-12"), "box", 5, 5, 5).doc.bodies!.at(-1)!.number, 4);
  // The STL's word on hidden bodies names them by their own numbers, smallest first.
  const hidden = hideBody(hideBody(reordered(three(), "feature-12", 0), "body:feature-12", true), "body:feature-1", true);
  assert.equal(hiddenStlNote(hidden), "Bodies 1 and 3 are hidden, so they are not in the STL: show them with their eyes in the browser to include them.");
});

test("hand-worked: a version 4 file gets the numbers it showed: the bodies that build by place, then the others", () => {
  // Four boxes A (feature-1, suppressed), B, C, D, the marker on C. Version
  // 4 numbered the bodies that build by place: B is Body 1, C Body 2; A
  // (suppressed) and D (rolled back) showed no row. They follow: A Body 3,
  // D Body 4, so the next is 5, and the file shows what it showed.
  let d = partDocument("box", 10, 10, 10);
  for (let i = 0; i < 3; i++) d = insertPreset(d, "box", 10, 10, 10).doc;
  d = moveMarker(suppressItem(d, "feature-1", true), "feature-3");
  const { bodies: _, nextBody: __, ...v5 } = d;
  const v4 = JSON.parse(JSON.stringify({ ...v5, version: 4 }));
  const read = readDesignDocument(v4);
  assert.deepEqual(read.bodies, [
    { id: "body:feature-2", number: 1 },
    { id: "body:feature-3", number: 2 },
    { id: "body:feature-1", number: 3 },
    { id: "body:feature-4", number: 4 },
  ]);
  assert.equal(read.nextBody, 5);
  assert.deepEqual(labels(read), ["Body 1", "Body 2"]);
  assert.equal(read.version, 6);
  // Unsuppressed and rolled forward, A and D come back as Body 3 and Body 4.
  assert.deepEqual(labels(moveMarker(suppressItem(read, "feature-1", false), null)), ["Body 3", "Body 1", "Body 2", "Body 4"]);
});

/**
 * The repo's root: the nearest folder above this file with a `workspaces/design/` in it. Not a fixed "../../../":
 * mutation testing runs this file from a copy of workspaces/design two folders deeper (.stryker-tmp/sandbox-…/),
 * where that path missed the saved projects and the whole Design run stopped before its first mutant.
 */
const ROOT = (() => {
  for (let u = new URL("../", import.meta.url); u.pathname !== "/"; u = new URL("../", u)) if (existsSync(new URL("workspaces/design/", u))) return u;
  throw new Error(`no repo root above ${import.meta.url}`);
})();
const SAVED = ["tests/golden/", "packages/testing/old-files/", "packages/testing/test/regressions/", "workspaces/design/test/files/", "apps/fission/e2e/"];

function* walk(dir: URL): Generator<URL> {
  for (const name of readdirSync(dir).sort()) {
    const u = new URL(name, dir);
    if (statSync(u).isDirectory()) yield* walk(new URL(`${name}/`, dir));
    else if (/\.(json|spindle)$/.test(name)) yield u;
  }
}

test("every saved project in the repo opens with each body row named as before 35e", () => {
  // Before 35e a row's number was its body's place among the bodies that
  // build (`bodyFeatures`), counted from 1: worked out here from the file
  // alone and compared with what the stored numbers say.
  let files = 0;
  let rows = 0;
  for (const dir of SAVED)
    for (const u of walk(new URL(dir, ROOT))) {
      let doc: DesignDocument;
      let version: unknown;
      try {
        const text = readFileSync(u, "utf8");
        version = (JSON.parse(text) as { workspaces?: { design?: { version?: unknown } } }).workspaces?.design?.version;
        const data = projectFromJson(text, DESIGN).workspaces.design;
        if (data === undefined) continue;
        doc = data as DesignDocument;
      } catch {
        continue; // not a project, or one refused on purpose (the fuzz regressions)
      }
      const where = u.pathname.slice(ROOT.pathname.length);
      assert.ok(typeof version === "number" && version <= 4, `${where} is version ${version}: a saved file from before 35e`);
      assert.deepEqual(labels(doc), bodyFeatures(doc).map((_, i) => `Body ${i + 1}`), where);
      // Every body has a number, none twice, the counter above them all.
      const numbers = doc.bodies!.map((b) => b.number);
      assert.equal(new Set(numbers).size, numbers.length, where);
      assert.equal(doc.bodies!.length, doc.timeline.features.filter(makesBody).length, where);
      assert.ok(numbers.every((n) => n < doc.nextBody!), where);
      // Saved again it is version 5, and reads back the same.
      assert.deepEqual(reopen(doc), doc, where);
      files++;
      rows += labels(doc).length;
    }
  // The repo holds dozens of saved projects (golden models, old files, the e2e's); none skipped by a wrong path.
  assert.ok(files >= 20, `${files} files`);
  assert.ok(rows >= 30, `${rows} rows`);
});

test("the reader refuses bodies' numbers broken in each way, with a message naming what is wrong", () => {
  const good = JSON.parse(JSON.stringify(three()));
  const broken = (edit: (d: any) => void) => {
    const d = structuredClone(good);
    edit(d);
    return () => readDesignDocument(d);
  };
  assert.doesNotThrow(broken(() => {}));
  const cases: [(d: any) => void, RegExp][] = [
    [(d) => delete d.bodies, /^Error: Design data has no bodies list \(each body's id and number\)$/],
    [(d) => (d.bodies = {}), /^Error: Design data has no bodies list/],
    [(d) => delete d.nextBody, /^Error: Design data's nextBody undefined is not a counting number$/],
    [(d) => (d.nextBody = 0), /^Error: Design data's nextBody 0 is not a counting number$/],
    [(d) => (d.nextBody = 4.5), /^Error: Design data's nextBody 4.5 is not a counting number$/],
    [(d) => (d.bodies[0] = null), /^Error: Design body 1 has no id$/],
    [(d) => (d.bodies[0].id = 7), /^Error: Design body 1 has no id$/],
    [(d) => (d.bodies[0].id = "feature-1"), /^Error: Design body feature-1 is not "body:" and the id of an item that makes a body$/],
    [(d) => (d.bodies[0].id = "body:sketch-2"), /^Error: Design body body:sketch-2 is not "body:" and the id/],
    [(d) => (d.bodies[0].id = "body:feature-1/piece:1"), /^Error: Design body body:feature-1\/piece:1 is not "body:" and the id/],
    [(d) => (d.bodies[1].id = "body:feature-1"), /^Error: Design body body:feature-1 is listed twice$/],
    [(d) => (d.bodies[0].number = 0), /^Error: Design body body:feature-1's number 0 is not a counting number$/],
    [(d) => (d.bodies[0].number = "1"), /^Error: Design body body:feature-1's number "1" is not a counting number$/],
    [(d) => (d.bodies[0].number = 1.5), /^Error: Design body body:feature-1's number 1.5 is not a counting number$/],
    [(d) => (d.bodies[2].number = 1), /^Error: Design body number 1 is given twice$/],
    // At 3 the counter would give Body 3 again.
    [(d) => (d.nextBody = 3), /^Error: Design data's nextBody 3 is not above body body:feature-12's number 3, so a new body could repeat it$/],
    // Numbers in data saying an older version, which never had them.
    [(d) => (d.version = 4), /^Error: Design data says version 4 but has bodies' numbers, which version 5 brought$/],
    [(d) => ((d.version = 3), delete d.bodies), /^Error: Design data says version 3 but has bodies' numbers, which version 5 brought$/],
  ];
  for (const [edit, message] of cases) assert.throws(broken(edit), message, String(edit));
  // A file edited elsewhere is settled as an edit would settle it, every number it gives kept: a body whose item
  // is gone loses its number, and a body with none gets the next (the cylinder's 3 dropped, so it gets 4, then 5 is next).
  const gone = broken((d) => (d.bodies[0].id = "body:feature-99"))();
  assert.deepEqual(gone.bodies, [{ id: "body:feature-11", number: 2 }, { id: "body:feature-12", number: 3 }, { id: "body:feature-1", number: 4 }]);
  assert.equal(gone.nextBody, 5);
  const unnumbered = broken((d) => d.bodies.pop())();
  assert.deepEqual(unnumbered.bodies!.at(-1), { id: "body:feature-12", number: 4 });
  assert.equal(unnumbered.nextBody, 5);
  // Version 5 data leaving both out is numbered as version 4 data is (written by hand or by a test).
  const { bodies: _, nextBody: __, ...bare } = good;
  assert.deepEqual(readDesignDocument(bare), three());
  // More bodies than timeline items allow is refused before any is read.
  const many = structuredClone(good);
  many.bodies = Array.from({ length: 5001 }, (_, i) => ({ id: `body:feature-${i}`, number: i + 1 }));
  assert.throws(() => readDesignDocument(many), /Design data has .*bodies/);
});

test("numberBodies gives back the same document when every body has its number, and numbers once", () => {
  const d = three();
  assert.equal(numberBodies(d), d);
  assert.equal(numberBodies(numberBodies(d)), d);
  // A test's document without them is numbered as a file would be, and bodyNumbers reads the same.
  const { bodies: _, nextBody: __, ...bare } = d;
  assert.deepEqual(numberBodies(bare as DesignDocument), d);
  assert.deepEqual([...bodyNumbers(bare as DesignDocument)], [["body:feature-1", 1], ["body:feature-11", 2], ["body:feature-12", 3]]);
});

/** A seeded generator (xorshift64*), as the other session tests use. */
function rng(seed: bigint) {
  let s = seed || 1n;
  return (n: number) => {
    s ^= s >> 12n;
    s ^= (s << 25n) & 0xffffffffffffffffn;
    s ^= s >> 27n;
    return Number(((s * 0x2545f4914f6cdd1dn) & 0xffffffffffffffffn) >> 33n) % n;
  };
}

test("seeded sessions of edits agree with a model of the rule: given once when made, kept through anything, never reused", () => {
  // The model knows only the rule's words: a body made by an edit takes the
  // counter's number and the counter goes up; a delete takes its number away;
  // nothing else changes any number. It never looks at the document's numbers.
  let edits = 0;
  for (let seed = 1n; seed <= 40n; seed++) {
    const pick = rng(seed * 7919n);
    let doc = partDocument("box", 10, 10, 10);
    const model = new Map<string, number>([["feature-1", 1]]);
    const given = new Set<number>([1]);
    let counter = 2;
    for (let step = 0; step < 40; step++) {
      const items = doc.timeline.features;
      const solids = items.filter(makesBody);
      const what = pick(6);
      const before = doc;
      if (what === 0 || solids.length === 0) {
        const made = insertPreset(doc, (["box", "cylinder", "sphere", "slot"] as const)[pick(4)], 5 + pick(10), 5, 5);
        doc = made.doc;
        model.set(made.id, counter++);
      } else if (what === 1) {
        const s = addSketch(doc);
        const made = extrudeSketch(drawRectangle(s.doc, s.id, [0, 0], [5, 5]).doc, s.id, 3);
        doc = made.doc;
        model.set(made.id, counter++);
      } else if (what === 2) {
        const f = items[pick(items.length)];
        doc = deleteItem(doc, f.id);
        model.delete(f.id);
      } else if (what === 3) {
        const f = items[pick(items.length)];
        const r = reorderItem(doc, f.id, pick(items.length));
        if ("doc" in r) doc = r.doc;
      } else if (what === 4) {
        const f = items[pick(items.length)];
        doc = suppressItem(doc, f.id, !f.suppressed);
      } else {
        const at = pick(items.length + 1);
        doc = moveMarker(doc, at === items.length ? null : items[at].id);
      }
      edits++;
      const where = `seed ${seed}, step ${step}`;
      // Every body numbered by the edit itself (nothing left for later), as the model says.
      assert.equal(numberBodies(doc), doc, `${where}: an edit left a body unnumbered`);
      const now = new Map(doc.bodies!.map((b) => [b.id.slice("body:".length), b.number]));
      assert.deepEqual(new Map([...now].sort()), new Map([...model].sort()), where);
      assert.equal(doc.nextBody, counter, where);
      // A number newly given was never given before.
      for (const [id, n] of now) if (!before.bodies!.some((b) => b.id === `body:${id}`)) assert.ok(!given.has(n), `${where}: ${n} given again`);
      for (const n of now.values()) given.add(n);
    }
    // And the session's last design reads back as it is.
    assert.deepEqual(reopen(doc), doc, `seed ${seed}`);
  }
  assert.equal(edits, 1600);
});

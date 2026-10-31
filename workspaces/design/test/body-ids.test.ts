// Step 35eb: the rebuild holds every body it builds by its body id
// ("body:feature-1", `bodyIdOf`), and the eyes, the references and Move name
// bodies by that id; the file still lists each body's item id. Checked by
// hand (the round trip of ids and its refusals, a Move's result worked out),
// by seeded sessions of eye presses and Moves against a model that knows
// only which box is where, and by bugs planted in a copy of the source
// (their imports pointed back at src/, face-pick-planted's way), each of
// which the sessions must catch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BodySpec, KernelCalls } from "@fission/core";
import { bodyHidden, bodyIdOf, bodyItem, insertPreset, partDocument, type DesignDocument } from "../src/document.ts";
import * as Move from "../src/move.ts";
import * as Rebuild from "../src/rebuild.ts";
import * as Edits from "../src/timeline-edits.ts";

/** A seeded generator (mulberry32, as the other Design sessions use): the same seed, the same session. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return {
    next: () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** A kernel that hands out handles 1, 2, 3, … and frees nothing it is asked to keep. */
function fakeKernel() {
  let next = 1;
  const built: BodySpec[] = [];
  const kernel = {
    call: async (op: string, ...args: unknown[]) => {
      if (op === "body_build") return (built.push(args[0] as BodySpec), next++);
      if (op === "body_free") return;
      throw new Error(`the fake kernel doesn't do ${op}`);
    },
  } as unknown as KernelCalls;
  return { kernel, built };
}

/** Box 1 40 × 30 × 20 (feature-1), Box 2 10 × 10 × 10 (feature-2), Box 3 5 × 6 × 7 (feature-3). */
function threeBoxes(): DesignDocument {
  return insertPreset(insertPreset(partDocument("box", 40, 30, 20), "box", 10, 10, 10).doc, "box", 5, 6, 7).doc;
}
const SIZES: Record<string, [number, number, number]> = { "body:feature-1": [40, 30, 20], "body:feature-2": [10, 10, 10], "body:feature-3": [5, 6, 7] };

test("hand-worked: a body id names its item and back; anything bodyIdOf never makes is no body id", () => {
  assert.equal(bodyIdOf("feature-3"), "body:feature-3");
  assert.equal(bodyItem("body:feature-3"), "feature-3");
  for (const id of ["feature-1", "sketch-2", "move-9", "feature-1000"]) assert.equal(bodyItem(bodyIdOf(id)), id, id);
  // A bare item id (what a file lists), an empty item, a piece's id (35ec, not yet a body), a doubled prefix, another kind's id.
  for (const bad of ["feature-3", "", "body:", "body:feature-3/piece:1", "body:body:feature-3", "Body:feature-3", " body:feature-3", "face:feature-3/top"]) assert.equal(bodyItem(bad), null, bad);
  // The checks that use it refuse in words, rather than looking up nothing.
  const d = threeBoxes();
  assert.throws(() => bodyHidden(d, "feature-1"), { message: '"feature-1" is not a body id' });
  assert.throws(() => Edits.hideBody(d, "feature-1", true), { message: '"feature-1" is not a body id' });
  assert.throws(() => Move.insertMove(d, ["feature-1"], Move.NO_MOVE), { message: "feature-1 is not a body id" });
});

test("hand-worked: a Move's rebuild holds the moved box under the box's own body id, and the Move itself holds the box as it was", async () => {
  // Box 1 moved 10 mm along X by Move 1 (feature-4). The three boxes are built first, handles 1, 2 and 3; the moved
  // box is a new body, handle 4: the box's spec with one shift after it, nothing turned. Move 1 makes no body of its own,
  // so nothing is held under "body:feature-4", and it holds handle 1 (Box 1 as made) so the next rebuild finds it built.
  const { doc, id } = Move.insertMove(threeBoxes(), ["body:feature-1"], { ...Move.NO_MOVE, x: 10 });
  assert.equal(id, "feature-4");
  assert.deepEqual(doc.timeline.features.at(-1)!.dependsOn, ["feature-1"], "the file lists the box's item id, as before 35eb");
  assert.deepEqual(Move.movedBodies(doc.timeline.features.at(-1)!), ["body:feature-1"]);
  const { kernel } = fakeKernel();
  const build = await Rebuild.rebuildTimeline(doc, new Rebuild.BodyCache(kernel), kernel);
  assert.deepEqual(Object.keys(build.bodies), ["body:feature-1", "body:feature-2", "body:feature-3"]);
  assert.deepEqual(build.bodies["body:feature-1"], { feature: "feature-1", handle: 4, spec: { moved: { body: { box: { width: 40, depth: 30, height: 20 } }, moves: [{ move: [10, 0, 0] }] } } });
  assert.deepEqual(build.bodies["body:feature-2"], { feature: "feature-2", handle: 2, spec: { box: { width: 10, depth: 10, height: 10 } } });
  assert.deepEqual(build.results["feature-1"], { status: "built", bodies: ["body:feature-1"] });
  assert.deepEqual(build.results["feature-4"], { status: "built", holds: [1] });
  assert.equal(Rebuild.builtBody(build, "feature-4"), undefined, "a Move built no body");
  assert.equal(Rebuild.builtBody(build, "feature-1")!.handle, 4);
});

/** What the sessions call: the real functions, or the same with one planted in a copy. */
interface Subject {
  rebuildTimeline: typeof Rebuild.rebuildTimeline;
  BodyCache: typeof Rebuild.BodyCache;
  insertMove: typeof Move.insertMove;
  hideBody: typeof Edits.hideBody;
}
const REAL: Subject = { rebuildTimeline: Rebuild.rebuildTimeline, BodyCache: Rebuild.BodyCache, insertMove: Move.insertMove, hideBody: Edits.hideBody };

/**
 * One seeded session on the three boxes: 40 steps, each an eye pressed on a
 * random body or a Move of one or two random bodies by a whole-mm shift,
 * every step rebuilt and checked against the model: for each body, the
 * shifts made to it in order (so its spec is its box with them after it),
 * and whether its eye is shut. Throws, saying what differs, at the first
 * difference; returns how many steps of each kind it made.
 */
async function session(s: Subject, seed: number): Promise<{ eyes: number; moves: number; twos: number }> {
  const r = seeded(seed);
  const pick = (n: number) => Math.floor(r.next() * n);
  const ids = Object.keys(SIZES);
  const model = { shifts: new Map(ids.map((b) => [b, [] as [number, number, number][]])), hidden: new Set<string>() };
  let doc = threeBoxes();
  const { kernel } = fakeKernel();
  const cache = new s.BodyCache(kernel);
  const reached = { eyes: 0, moves: 0, twos: 0 };
  for (let step = 0; step < 40; step++) {
    const where = `seed ${seed} step ${step}`;
    if (pick(3) === 0) {
      const b = ids[pick(3)];
      const hide = !model.hidden.has(b);
      doc = s.hideBody(doc, b, hide);
      if (hide) model.hidden.add(b);
      else model.hidden.delete(b);
      reached.eyes++;
    } else {
      const first = ids[pick(3)];
      const second = pick(2) === 0 ? null : ids.filter((b) => b !== first)[pick(2)];
      const bodies = second === null ? [first] : [first, second];
      const shift: [number, number, number] = [pick(41) - 20, pick(41) - 20, 1 + pick(20)];
      doc = s.insertMove(doc, bodies, { ...Move.NO_MOVE, x: shift[0], y: shift[1], z: shift[2] }).doc;
      for (const b of bodies) model.shifts.get(b)!.push(shift);
      reached.moves++;
      if (second !== null) reached.twos++;
    }
    const build = await s.rebuildTimeline(doc, cache, kernel);
    // Only the boxes hold bodies: never a Move, never an id under another name.
    assert.deepEqual(Object.keys(build.bodies).sort(), [...ids].sort(), `${where}: the bodies held`);
    for (const b of ids) {
      const [width, depth, height] = SIZES[b];
      const box: BodySpec = { box: { width, depth, height } };
      const moves = model.shifts.get(b)!.map((m) => ({ move: m }));
      const want = moves.length === 0 ? box : { moved: { body: box, moves } };
      const got = build.bodies[b];
      assert.deepEqual(got?.spec, want, `${where}: ${b} differs from the model`);
      assert.equal(got.feature, bodyItem(b), `${where}: ${b} names its item`);
      assert.equal(bodyHidden(doc, b), model.hidden.has(b), `${where}: ${b}'s eye differs from the model`);
    }
    // Every Move built, holding each body it moves as it was before it: one handle a body.
    for (const f of doc.timeline.features.filter((x) => x.intent.type === "move")) {
      const res = build.results[f.id];
      assert.ok(res.status === "built" && res.holds?.length === f.dependsOn.length && res.bodies === undefined, `${where}: ${f.id} ${JSON.stringify(res)}`);
    }
  }
  await cache.close();
  return reached;
}

test("seeded: 30 sessions of eye presses and Moves on three boxes, by body id, each step against a model of where each box is and which eyes are shut", async () => {
  const total = { eyes: 0, moves: 0, twos: 0 };
  for (let seed = 1; seed <= 30; seed++) {
    const got = await session(REAL, 35_000 + seed);
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += got[k];
  }
  // Each kind reached often, so a bug in any of them meets a check.
  for (const [k, n] of Object.entries(total)) assert.ok(n >= 50, `${k} only ${n}: ${JSON.stringify(total)}`);
});

interface Plant {
  name: string;
  file: "rebuild" | "move" | "timeline-edits";
  find: string;
  replace: string;
  /** Text in the session's failure: which check caught it. */
  caught: string;
}

export const BODY_ID_PLANTS: Plant[] = [
  // A Move files the bodies it moved under its own id: the box stays where it was made, and the Move "makes" a body.
  { name: "moved-under-move-id", file: "rebuild", find: "  for (const [id, b] of moved) bodies[id] = b;", replace: "  for (const [, b] of moved) bodies[bodyIdOf(f.id)] = b;", caught: "the bodies held" },
  // A Move moves only the first body it holds.
  { name: "first-body-only", file: "rebuild", find: "  for (const [id, b] of moved) bodies[id] = b;", replace: "  for (const [id, b] of moved.slice(0, 1)) bodies[id] = b;", caught: "differs from the model" },
  // The new Move stores the picked body ids in the file instead of their items' ids: the rebuild finds nothing to move.
  { name: "file-holds-body-ids", file: "move", find: "    dependsOn: items.map((f) => f.id),", replace: "    dependsOn: [...bodies],", caught: "differs from the model" },
  // The eye shuts the body after the one asked (the next box, by its item's place).
  { name: "eye-on-next-body", file: "timeline-edits", find: "  const id = bodyItem(bodyId);\n", replace: '  const id = ((b) => b && (b === "feature-3" ? "feature-1" : `feature-${Number(b.slice(8)) + 1}`))(bodyItem(bodyId));\n', caught: "eye differs from the model" },
];

/** The subject with `plant` made in a copy of its file whose imports point back at src/ and the packages (the copy is outside the repo). */
async function plantedSubject(plant: Plant, dir: string): Promise<Subject> {
  const source = new URL(`../src/${plant.file}.ts`, import.meta.url);
  const text = readFileSync(source, "utf8");
  const at = text.indexOf(plant.find);
  assert.ok(at >= 0 && text.indexOf(plant.find, at + 1) < 0, `${plant.name}: the text to replace must be in ${plant.file}.ts exactly once`);
  const planted = (text.slice(0, at) + plant.replace + text.slice(at + plant.find.length)).replace(/from "\.\/([^"]+)"/g, (_, f) => `from "${new URL(f, source).href}"`).replace(/from "(@fission\/[a-z]+)"/g, (_, p) => `from "${import.meta.resolve(p)}"`);
  const file = join(dir, `${plant.file}-${plant.name}.ts`);
  writeFileSync(file, planted);
  const m = await import(pathToFileURL(file).href);
  return { ...REAL, ...m };
}

test("each bug planted in holding bodies by body id is caught by the seeded sessions, by the check that should catch it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "body-id-plants-"));
  try {
    for (const plant of BODY_ID_PLANTS) {
      const s = await plantedSubject(plant, dir);
      let caught: string | null = null;
      for (let seed = 1; seed <= 10 && caught === null; seed++) {
        try {
          await session(s, 35_000 + seed);
        } catch (e) {
          caught = e instanceof Error ? e.message : String(e);
        }
      }
      assert.ok(caught !== null, `${plant.name} was not caught`);
      assert.ok(caught.includes(plant.caught), `${plant.name} was caught by another check: ${caught}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

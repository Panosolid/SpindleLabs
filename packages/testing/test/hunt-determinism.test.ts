// Bug hunt (rebuild determinism): the same Design document must rebuild to exactly the same
// bodies (bit for bit, names and numbers) whenever it recurs: after undo, after save/open,
// in a subject whose kernel has built other things first, and from scratch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nodeKernel } from "../src/node-kernel.ts";
import { randomSession, runSession, type TimelineSubject } from "../src/timeline-session.ts";
import { designSubject } from "../src/timeline-design.ts";

const SEEDS = (process.env.HUNT_SEEDS ?? "9100-9105").split("-").map(BigInt);

/** Wraps a subject: every rebuild is snapshotted exactly and keyed by the saved file; a file seen again must rebuild identically. */
const recur = { n: 0 };
function watched(inner: ReturnType<typeof designSubject>, seen: Map<string, string>, log: string[]): TimelineSubject {
  const check = async (r: unknown) => {
    const file = await inner.save();
    const snap = JSON.stringify(r);
    const before = seen.get(file);
    recur.n++;
    if (before === undefined) seen.set(file, snap);
    else if (before !== snap) log.push(firstDiff(file, before, snap));
    return r;
  };
  return {
    initial: inner.initial,
    apply: (op) => inner.apply(op),
    rebuild: async () => (await check(await inner.rebuild())) as never,
    rebuildFromScratch: async () => (await check(await inner.rebuildFromScratch!())) as never,
    save: () => inner.save(),
    open: (t) => inner.open(t),
    resolve: (n) => inner.resolve(n),
    builds: inner.builds,
  };
}

function firstDiff(file: string, a: string, b: string): string {
  let k = 0;
  while (k < a.length && a[k] === b[k]) k++;
  return `file ${file.length} chars: first difference at ${k}: ...${a.slice(Math.max(0, k - 120), k + 60)}\n vs ...${b.slice(Math.max(0, k - 120), k + 60)}`;
}

for (let seed = SEEDS[0]; seed <= (SEEDS[1] ?? SEEDS[0]); seed++) {
  test(`hunt: seed ${seed}: a recurring document rebuilds bit for bit identically`, async () => {
    const kernel = nodeKernel();
    const seen = new Map<string, string>();
    const log: string[] = [];
    const inner = designSubject(kernel);
    try {
      await runSession(watched(inner, seen, log), randomSession(seed, 120), () => true);
    } catch (e) {
      // Model mismatches are other hunters' business; only exact determinism here.
      if (!(e instanceof Error) || !e.message) throw e;
      console.log(`seed ${seed} session stopped: ${e.message.slice(0, 150)}`);
    }
    // A second subject opening every file seen, on a kernel that already built everything above.
    const other = designSubject(kernel);
    for (const file of [...seen.keys()].slice(-20)) {
      await other.open(file);
      const snap = JSON.stringify(await other.rebuildFromScratch!());
      if (snap !== seen.get(file)) log.push("reopened: " + firstDiff(file, seen.get(file)!, snap));
    }
    console.log(`seed ${seed}: ${seen.size} documents, ${recur.n} rebuilds checked`);
    await inner.dispose();
    await other.dispose();
    assert.deepEqual(log.slice(0, 3), []);
  });
}

// Face sketches, pins and projections (the naming sessions): the same session run twice, the
// second time on a kernel and cache history that already built the first, must read identically.
import { namingDesignSubject } from "../src/naming-design.ts";
import { randomNamingSession, runNamingSession, type NamingSubject } from "../src/naming-session.ts";

async function namingLog(kernel: ReturnType<typeof nodeKernel>, seed: bigint): Promise<{ reads: string[]; end: string }> {
  const inner = namingDesignSubject(kernel);
  const reads: string[] = [];
  const reopenDiffs: string[] = [];
  const s: NamingSubject = {
    cuts: inner.cuts,
    apply: (op) => inner.apply(op),
    planDelete: (i) => inner.planDelete(i),
    read: async () => {
      const r = await inner.read();
      reads.push(JSON.stringify(r));
      return r;
    },
    saveOpen: async () => {
      const before = JSON.stringify(await inner.read());
      await inner.saveOpen!();
      const after = JSON.stringify(await inner.read());
      if (before !== after) reopenDiffs.push(firstDiff("", before, after));
    },
  };
  let end = "completed";
  try {
    await runNamingSession(s, randomNamingSession(seed, 120, false, "all"));
  } catch (e) {
    end = `stopped: ${(e as Error).message.slice(0, 100)}`;
  }
  await inner.dispose();
  return { reads, end: reopenDiffs.length ? `save/open differs: ${reopenDiffs[0]}` : end };
}

const NSEEDS = (process.env.HUNT_NSEEDS ?? "9200-9203").split("-").map(BigInt);
for (let seed = NSEEDS[0]; seed <= (NSEEDS[1] ?? NSEEDS[0]); seed++) {
  test(`hunt: naming seed ${seed}: the same session twice reads identically`, async () => {
    const kernel = nodeKernel();
    const a = await namingLog(kernel, seed);
    const b = await namingLog(kernel, seed);
    console.log(`naming seed ${seed}: ${a.reads.length} reads, ${a.end}`);
    assert.equal(b.end, a.end);
    assert.doesNotMatch(a.end, /save\/open differs/);
    const k = a.reads.findIndex((r, i) => r !== b.reads[i]);
    if (k >= 0) assert.fail(`read ${k}: ${firstDiff("", a.reads[k], b.reads[k] ?? "")}`);
  });
}

// The real workspace (happy-dom, real kernel): a document mounted, an item suppressed (or
// unsuppressed) from its menu, then undone, must show exactly the mesh it showed before.
const ASEEDS = (process.env.HUNT_ASEEDS ?? "9100-9101").split("-").map(BigInt);
for (let seed = ASEEDS[0]; seed <= (ASEEDS[1] ?? ASEEDS[0]); seed++) {
  test(`hunt: app seed ${seed}: suppress then undo shows exactly the mesh from before`, async () => {
    const { app } = await import("../journeys/design-app.ts");
    const { projectFromJson } = await import("@fission/core");
    const { readDesignDocument } = await import("@fission/design");
    const kernel = nodeKernel();
    const seen = new Map<string, string>();
    const log: string[] = [];
    const inner = designSubject(kernel);
    try {
      await runSession(watched(inner, seen, log), randomSession(seed, 80), () => true);
    } catch {}
    await inner.dispose();
    const files = [...seen.keys()].filter((_, k) => k % 4 === 0).slice(0, 12);
    const bad: string[] = [];
    let tried = 0;
    for (const file of files) {
      const doc = projectFromJson(file, [{ id: "design", readData: readDesignDocument }]).workspaces.design as never;
      const first = JSON.stringify((await app(doc)).mesh());
      const a = await app(doc);
      const mesh0 = JSON.stringify(a.mesh());
      const doc0 = JSON.stringify(a.doc());
      if (first !== mesh0) bad.push(`seed ${seed}: mounting the same file twice shows different meshes`);
      if (doc0 !== JSON.stringify(doc)) bad.push(`seed ${seed}: mounting changed the document: ${firstDiff("", JSON.stringify(doc), doc0).slice(0, 300)}`);

      for (const f of (a.doc() as { timeline: { features: { id: string; suppressed?: boolean }[] } }).timeline.features) {
        const r = await a.menu(f.id, f.suppressed ? "unsuppress" : "suppress");
        if (r !== null) continue;
        tried++;
        const meshOn = JSON.stringify(a.mesh());
        const docOn = JSON.stringify(a.doc());
        await a.undo();
        await a.redo();
        if (JSON.stringify(a.mesh()) !== meshOn) bad.push(`seed ${seed} ${f.id}: mesh after undo+redo differs`);
        if (JSON.stringify(a.doc()) !== docOn) bad.push(`seed ${seed} ${f.id}: document after undo+redo differs: ${firstDiff("", docOn, JSON.stringify(a.doc())).slice(0, 400)}`);
        await a.undo();
        const m = JSON.stringify(a.mesh());
        if (m !== mesh0) bad.push(`seed ${seed} ${f.id}: mesh after undo differs (${m.length} vs ${mesh0.length} chars) ${firstDiff("", mesh0, m).slice(0, 300)}`);
        if (JSON.stringify(a.doc()) !== doc0) bad.push(`seed ${seed} ${f.id}: document after undo differs: ${firstDiff("", doc0, JSON.stringify(a.doc())).slice(0, 400)}`);
        if (bad.length) break;
      }
      if (bad.length) {
        bad.push(`file: ${file}`);
        break;
      }
    }
    console.log(`app seed ${seed}: ${files.length} files, ${tried} suppress/undo`);
    assert.deepEqual(bad, []);
  });
}

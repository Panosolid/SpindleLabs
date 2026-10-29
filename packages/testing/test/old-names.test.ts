// Old names read into the new form (src/old-names.ts, step 34a4; rule 6 of
// docs/document-model.md, section 8), checked by hand: every reading and
// every find is worked out from the shape in the comment beside it, on
// views written out by hand (a box, a half disc) and on the boolean
// model's bar and slot. Each planted misreading must make one of these
// fail. journeys/old-names.journey.ts checks the same reader on the real
// kernel against every saved file.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyView } from "@fission/core";
import {
  findEdge,
  findFace,
  findOldEdgeAfterBooleans,
  findVertex,
  newNames,
  OLD_NAME_FAULTS,
  readOldEdge,
  readOldReference,
  readOldVertex,
  type EdgeQuery,
  type NewBody,
  type OldNameFault,
} from "../src/old-names.ts";
import { rebuildBooleans, type BlockFeature } from "../src/boolean-naming-model.ts";

type View = Pick<BodyView, "face_roles" | "edge_faces" | "edge_vertices" | "vertex_points">;

// A unit box by hand. Faces: 0 bottom (z 0), 1 top (z 1), 2 front (y 0), 3 back (y 1), 4 left (x 0), 5 right (x 1).
// Vertex v at (v & 1, v >> 1 & 1, v >> 2 & 1). Each edge joins the two faces both its ends lie on.
const BOX_ROLES = ["bottom", "top", "front", "back", "left", "right"];
const corner = (v: number): [number, number, number] => [v & 1, (v >> 1) & 1, (v >> 2) & 1];
const BOX_EDGES: [number, number][] = [];
for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) if ([1, 2, 4].includes(a ^ b)) BOX_EDGES.push([a, b]);
/** The faces a box vertex lies on: x 0 left / 1 right, y 0 front / 1 back, z 0 bottom / 1 top. */
const onFaces = (v: number) => {
  const [x, y, z] = corner(v);
  return [z ? 1 : 0, y ? 3 : 2, x ? 5 : 4];
};
const BOX_VIEW: View = {
  face_roles: BOX_ROLES.map((role) => ({ role })) as View["face_roles"],
  edge_vertices: BOX_EDGES,
  edge_faces: BOX_EDGES.map(([a, b]) => onFaces(a).filter((f) => onFaces(b).includes(f)) as [number, number]),
  vertex_points: [0, 1, 2, 3, 4, 5, 6, 7].map(corner),
};
const box = (): NewBody => newNames("feature-1", { faces: BOX_ROLES, shared: { faces: new Map() } }, BOX_VIEW);

// A half disc by hand (journeys/half-disc.journey.ts's, extruded 10): line-1 P (−5, 0) → Q (5, 0), then arc-2 from Q round
// back to P. Faces: 0 start (z 0), 1 end (z 10), 2 side:line-1, 3 side:arc-2. Vertices: 0 P, 1 Q, 2 P' and 3 Q' (z 10).
// Going round counter-clockwise seen from the end cap the line comes before the arc at Q and the arc before the line at P,
// so the kernel lists the upright at Q as (line, arc) and the one at P as (arc, line); at Q the line ends and the arc
// starts, at P the arc ends and the line starts (27b's corners).
const HALF_VIEW: View = {
  face_roles: [{ role: "start" }, { role: "end" }, { role: "side", piece: 0 }, { role: "side", piece: 1 }] as View["face_roles"],
  edge_faces: [[0, 2], [0, 3], [1, 2], [1, 3], [2, 3], [3, 2]],
  edge_vertices: [[0, 1], [1, 0], [2, 3], [3, 2], [1, 3], [0, 2]],
  vertex_points: [[-5, 0, 0], [5, 0, 0], [-5, 0, 10], [5, 0, 10]],
};
const HALF_FACES = ["start", "end", "side:line-1", "side:arc-2"];
const HALF_ENDS = [null, null, null, null, "side:arc-2@start+side:line-1@end", "side:arc-2@end+side:line-1@start"];
const half = (ends = true): NewBody => newNames("feature-3", { faces: HALF_FACES, shared: { faces: new Map() }, ...(ends ? { ends: HALF_ENDS } : {}) }, HALF_VIEW);

const F = "face:feature-3/";
/** An old edge reference read, for the finds (a reading gone wrong fails the find). */
const edgeRef = (id: string, fs: OldNameFault[] = []) => (readOldReference(id, fs) as { edge: EdgeQuery }).edge;

/** Every hand case, each a reading or a find with what it must give; the faults are planted into the reader and the finds. */
const CASES: { what: string; got: (fs: OldNameFault[]) => unknown; want: unknown }[] = [
  // Readings. A face name is unchanged; an edge's two parts become full names, sorted ("face:feature-7/side…" before
  // "face:feature-7/start": "si" < "st"), and rule 5's name is "edge:" and the two joined by "+".
  { what: "a face reference reads as itself", got: (fs) => readOldReference("face:feature-7/side:line-4", fs), want: { face: "face:feature-7/side:line-4" } },
  {
    what: "a reference's set name reads as its two faces, sorted",
    got: (fs) => readOldReference("edge:feature-7/start+side:line-4", fs),
    want: { edge: { name: "edge:face:feature-7/side:line-4+face:feature-7/start", faces: ["face:feature-7/side:line-4", "face:feature-7/start"], need: "pair" } },
  },
  {
    what: "an ordered name keeps its order beside its sorted faces",
    got: (fs) => readOldReference("edge:feature-7/side:line-4>side:arc-6", fs),
    want: { edge: { name: "edge:face:feature-7/side:arc-6+face:feature-7/side:line-4", faces: ["face:feature-7/side:arc-6", "face:feature-7/side:line-4"], need: "ordered", order: ["face:feature-7/side:line-4", "face:feature-7/side:arc-6"] } },
  },
  {
    what: "a corner name keeps its ends, sorted",
    got: (fs) => readOldEdge("feature-7", "side:line-4@end+side:arc-6@start", "part", fs),
    want: { name: "edge:face:feature-7/side:arc-6+face:feature-7/side:line-4", faces: ["face:feature-7/side:arc-6", "face:feature-7/side:line-4"], need: "corner", corner: "face:feature-7/side:arc-6@start,face:feature-7/side:line-4@end" },
  },
  { what: "a body reference is no old face or edge name", got: (fs) => readOldReference("body:feature-1", fs), want: null },
  { what: "a new-form edge name is never read as an old one", got: (fs) => readOldReference("edge:face:feature-1/end+face:feature-2/side:line-4", fs), want: null },
  { what: "a tagged face name is never read as an old one", got: (fs) => readOldReference("face:feature-1/end#face:feature-2/side:line-2", fs), want: null },
  { what: "an edge of one face is refused", got: (fs) => readOldReference("edge:feature-7/side:line-4", fs), want: null },
  { what: "a reference never holds a corner", got: (fs) => readOldReference("edge:feature-7/side:line-4@end+side:arc-6@start", fs), want: null },

  // The box: twelve edges, each between two faces that meet once, so rule 5 names each by its pair alone. Its corner
  // (1, 1, 1), vertex 7, is on back, right and top; v3-face-pin's pin "back+right&back+top&right+top" names it.
  { what: "a box edge by its set name", got: (fs) => findEdge(box(), edgeRef("edge:feature-1/right+top", fs), fs), want: { index: BOX_EDGES.findIndex(([a, b]) => a === 5 && b === 7) } },
  { what: "the box corner pinned in v3-face-pin", got: (fs) => findVertex(box(), readOldVertex("feature-1", "back+right&back+top&right+top", fs)!, fs), want: { index: 7 } },
  // Two of the corner's three edges: no vertex has exactly those two edges.
  { what: "a vertex is never found by some of its edges", got: (fs) => findVertex(box(), readOldVertex("feature-1", "back+top&right+top", fs)!, fs), want: "lost" },
  { what: "a face of another feature is lost", got: (fs) => findEdge(box(), edgeRef("edge:feature-2/right+top", fs), fs), want: "lost" },

  // The half disc. The uprights 4 (at Q) and 5 (at P) are both between the line and the arc, and both run from the start
  // cap to the end cap, so rule 5's ends tie and the corners tell them apart.
  { what: "the upright at Q by its ordered name", got: (fs) => findEdge(half(), edgeRef("edge:feature-3/side:line-1>side:arc-2", fs), fs), want: { index: 4 } },
  { what: "the upright at P by its ordered name", got: (fs) => findEdge(half(), edgeRef("edge:feature-3/side:arc-2>side:line-1", fs), fs), want: { index: 5 } },
  { what: "the upright at Q by its corner", got: (fs) => findEdge(half(), readOldEdge("feature-3", "side:arc-2@start+side:line-1@end", "part", fs)!, fs), want: { index: 4 } },
  { what: "the upright at P by its corner", got: (fs) => findEdge(half(), readOldEdge("feature-3", "side:arc-2@end+side:line-1@start", "part", fs)!, fs), want: { index: 5 } },
  // Naming.ts gave every edge between two sides an ordered name, so a set name between them names none; partName gave
  // "A+B" only where no corner is known, and here both are.
  { what: "a reference's set name between two sides finds none", got: (fs) => findEdge(half(), edgeRef("edge:feature-3/side:arc-2+side:line-1", fs), fs), want: "lost" },
  { what: "a projection's set name where corners are known finds none", got: (fs) => findEdge(half(), readOldEdge("feature-3", "side:arc-2+side:line-1", "part", fs)!, fs), want: "lost" },
  // A ready-made outline's sides carry no way round, so no corners: the set name fits both uprights, and is never guessed.
  { what: "a set name on two uprights with no corners is ambiguous", got: (fs) => findEdge(half(false), readOldEdge("feature-3", "side:arc-2+side:line-1", "part", fs)!, fs), want: "ambiguous" },
  { what: "the cap's edge along the line", got: (fs) => findEdge(half(), readOldEdge("feature-3", "end+side:line-1", "part", fs)!, fs), want: { index: 2 } },
  // Q' (vertex 3): the end cap's edges along the line and the arc, and the upright at Q.
  { what: "the corner Q' by its 27b name", got: (fs) => findVertex(half(), readOldVertex("feature-3", "end+side:arc-2&end+side:line-1&side:arc-2@start+side:line-1@end", fs)!, fs), want: { index: 3 } },
  // 0.26 named both top corners "end+side:arc-2&end+side:line-1&side:arc-2+side:line-1", one name for two vertices.
  { what: "a 0.26 name both top corners have is ambiguous", got: (fs) => findVertex(half(), readOldVertex("feature-3", "end+side:arc-2&end+side:line-1&side:arc-2+side:line-1", fs)!, fs), want: "ambiguous" },
];

test("34a4 by hand: each old name reads and finds what the working beside it says", () => {
  for (const c of CASES) assert.deepEqual(c.got([]), c.want, c.what);
});

test("34a4 by hand: rule 5's names on the box and the half disc", () => {
  // The box: of the 15 pairs of its six faces, the three opposite pairs never meet; the other 12 are its edges, one each.
  const names = box().edges.map((e) => e.name);
  const pairs: string[] = [];
  for (let a = 0; a < 6; a++)
    for (let b = a + 1; b < 6; b++) if (a >> 1 !== b >> 1) pairs.push(`edge:${[`face:feature-1/${BOX_ROLES[a]}`, `face:feature-1/${BOX_ROLES[b]}`].sort().join("+")}`);
  assert.deepEqual([...names].sort(), pairs.sort());
  // The half disc: the caps' edges by their pairs; the uprights tied on ends {start, end}, so by their corners.
  assert.deepEqual(
    half().edges.map((e) => e.name),
    [
      `edge:${F}side:line-1+${F}start`,
      `edge:${F}side:arc-2+${F}start`,
      `edge:${F}end+${F}side:line-1`,
      `edge:${F}end+${F}side:arc-2`,
      `edge:${F}side:arc-2+${F}side:line-1;corner:${F}side:arc-2@start,${F}side:line-1@end`,
      `edge:${F}side:arc-2+${F}side:line-1;corner:${F}side:arc-2@end,${F}side:line-1@start`,
    ],
  );
  // Without corners the uprights share their name: never guessed.
  assert.deepEqual(half(false).edges.slice(4).map((e) => e.name), [null, null]);
});

test("34a4 by hand: a shared face makes its names ambiguous, never guessed", () => {
  // Two faces would both be "side:line-1" (Design drops the name from both): its edges can't be told apart.
  const shared = newNames("feature-3", { faces: ["start", "end", null, "side:arc-2"], shared: { faces: new Map([["side:line-1", 2]]) } }, HALF_VIEW);
  assert.equal(findFace(shared, `${F}side:line-1`), "ambiguous");
  assert.equal(findEdge(shared, readOldEdge("feature-3", "end+side:line-1", "part")!), "ambiguous");
  assert.deepEqual(findFace(shared, `${F}side:arc-2`), { index: 3 });
  assert.equal(findFace(shared, `${F}side:line-9`), "lost");
});

test("34a4 by hand: old names on Ben's bar after the slot (the boolean model)", () => {
  // The bar 100 × 20 × 10 (lines 1–4: y 0, x 100, y 20, x 0) cut by a slot at x 30–40 (F1): the far piece keeps body:feature-1.
  const bar: BlockFeature = { kind: "block", id: "feature-1", rect: [0, 0, 100, 20], z: [0, 10], operation: "new" };
  const slot: BlockFeature = { kind: "block", id: "feature-2", rect: [30, -5, 40, 25], z: [-5, 15], operation: "cut", bodies: ["body:feature-1"] };
  const r = rebuildBooleans([bar, slot]);
  const old = (id: string) => findOldEdgeAfterBooleans(r, edgeRef(id));
  // The top's edge along x = 100 is on the far piece only. Its top piece is tagged with the faces only it borders, the
  // bar's x = 100 side and the slot's x = 40 wall; "end#…" sorts before "side…".
  const tag = "face:feature-1/side:line-2,face:feature-2/side:line-2";
  assert.deepEqual(old("edge:feature-1/end+side:line-2"), { body: "body:feature-1", name: `edge:face:feature-1/end#${tag}+face:feature-1/side:line-2` });
  // Along x = 0, the near piece: piece 1.
  assert.equal((old("edge:feature-1/end+side:line-4") as { body: string }).body, "body:feature-2/piece:1");
  // Along y = 0 the top's edge is now two, one on each piece: never guessed.
  assert.equal(old("edge:feature-1/end+side:line-1"), "ambiguous");
  // The slot's own top went with the cut: none.
  assert.equal(old("edge:feature-2/end+side:line-2"), "lost");
});

test("34a4: each planted misreading fails a hand case", () => {
  for (const fault of OLD_NAME_FAULTS) {
    const failed = CASES.filter((c) => {
      try {
        assert.deepEqual(c.got([fault]), c.want);
        return false;
      } catch {
        return true;
      }
    });
    assert.ok(failed.length > 0, `planted ${fault}: no hand case failed`);
  }
});

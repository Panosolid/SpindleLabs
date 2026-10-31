# The SpindleLabs project format

A SpindleLabs project is one JSON document. The format is open: anyone may read and write it, and this page describes it. The types it is checked against are in `packages/core/src/model/` (`project.ts`, `links.ts`, `feature.ts`, `material.ts`).

## Current version: 2

```json
{
  "formatVersion": 2,
  "name": "Bracket",
  "units": { "length": "mm" },
  "materials": [],
  "links": [],
  "workspaces": {
    "design": { "version": 3, "nextId": 2, "profiles": [], "sketches": [], "timeline": { "features": [] } }
  }
}
```

- `formatVersion`: the version of this outer layout. A reader refuses a file with a higher number than it knows, with a message saying a newer SpindleLabs saved it. It never half-reads one.
- `units.length`: the one units system for every workspace (`mm`, `cm`, `m` or `in`). Stored numbers are always millimetres; units only change what the user sees and types.
- `materials`: the one materials library (appearance, mechanical properties, process presets), shared by every workspace.
- `links`: live links and frozen copies between workspaces. A live link names its source by id (`{"kind": "object", "origin": {...}}`, or `"geometry"` with a stable face or edge id from step 24 on) and the representations the holder accepts. A frozen copy also carries the representation it froze. Nothing else in the file copies another workspace's data.
- `workspaces`: each workspace's own data under its id, with **its own** `version` inside. A workspace reads and upgrades its own part (`WorkspacePlugin.readData`), so workspaces can change their data without bumping the outer version.

### Design's data (version 1, before step 21b; opened and upgraded to version 2, then 3)

- `profiles`: ready-made outlines on a plane: `{ id, kind, width, depth, plane }`. Sketches join these from step 21.
- `timeline.features`: features in build order. Each feature is `{ id, intent, provenance, dependsOn, suppressed }`:
  - `intent`: `{ type, parameters, summary, purpose? }`. The body is built from the intent, so it is the source of truth, e.g. `{"type": "box", "parameters": {"width": 40, "depth": 30, "height": 20}, "summary": "Box: 40 × 30 × 20 mm"}`.
  - `provenance`: `{ self, from }`, each an origin `{ workspace, id, label }`, answering "where did I come from?".
  - `dependsOn`: the ids the feature reads. They feed the project's dependency graph.

Today a part is feature #1 of a one-step timeline. Step 24 adds features to the same list, so no migration is needed.

### Design's data version 6 (current, from step 35ec: bodies listed by body id; version 5 from step 35e had the same fields, listing bodies by their items' ids; version 4 from 2026-10-28 and version 3 from step 24d1 had the same fields without `bodies` and `nextBody`; version 2 from step 21b had them without the marker)

Sketches are timeline items of their own; the rules behind this shape are in docs/document-model.md. The extrude of a sketch in this example arrives at step 21d; from version 3 each solid feature is its own body, and until step 24d3 draws them all the app shows the last solid feature that builds.

```json
{
  "version": 6,
  "nextId": 6,
  "profiles": [],
  "sketches": [
    {
      "id": "sketch-1",
      "points": [{ "id": "point-2", "x": 0, "y": 0 }, { "id": "point-3", "x": 40, "y": 0 }],
      "curves": [{ "id": "line-4", "kind": "line", "start": "point-2", "end": "point-3" }],
      "constraints": []
    }
  ],
  "timeline": {
    "features": [
      { "id": "sketch-1", "intent": { "type": "sketch", "parameters": { "plane": "XY" }, "summary": "Sketch 1 on the XY plane" }, "dependsOn": [], "suppressed": false, "provenance": { "…": "…" } },
      { "id": "feature-5", "intent": { "type": "extrude", "parameters": { "sketch": "sketch-1", "distance": 10 }, "summary": "Extrude: Sketch 1 by 10 mm" }, "dependsOn": ["sketch-1"], "suppressed": false, "provenance": { "…": "…" } }
    ]
  },
  "bodies": [{ "id": "body:feature-5", "number": 1 }],
  "nextBody": 2
}
```

- `nextId`: the next number for a new id. Ids are never reused, even after a delete.
- `bodies` and `nextBody` (from version 5, step 35e; docs/document-model.md, section 8, rule 1): each body's own id, `body:<the item that first made it>`, and the number people read in "Body 3", given once, when the body first appears (an edit that makes it), and never worked out again, so a reorder, a suppress, a rollback or a body before it failing leaves it; `nextBody` is the next body's number, above every number given, even a deleted body's, so none is given twice. A deleted item's body loses its number. Opening refuses a list that is not one, an id that is not `body:` and an item's id or that names a sketch or a Move, an id or a number listed twice, a number that is not a counting number (text quoted), and a `nextBody` that is not one or not above every number. A file edited elsewhere is settled as an edit would settle it, every number it gives kept: a body whose item is gone loses its number, and a body with none gets the next one (those that build first, then the rest, in timeline order). Version 5 data leaving out both is numbered as version 4 data is.
- Migration from version 4: the bodies that build get the numbers the browser showed, by place in the timeline (Body 1, Body 2, …), then the suppressed and rolled-back ones, in timeline order. Version 4 (or older) data holding `bodies` or `nextBody` is refused.
- `sketches`: each sketch's points (mm, in the sketch plane's own 2D frame), curves naming point ids, and constraints (empty until step 47). The sketch's place in the build order is its timeline item with the same id.
- Curve kinds: a line `{ "id", "kind": "line", "start", "end" }` between two point ids; a circle `{ "id", "kind": "circle", "centre", "radius" }` round a point id, its radius in mm (step 22b). A circle's centre may be a point lines also use. An arc `{ "id", "kind": "arc", "start", "end", "centre" }` (step 23a) runs counter-clockwise round its centre from its start to its end, all three point ids, any of them shared with other curves; its centre must be within LINEAR (10 nm) of the line midway between its ends, so it is the same distance from both, its radius (the mean of those distances) within MIN_FEATURE to MAX_SIZE, and its ends at least MIN_FEATURE apart (the kernel checks these when it finds the outline).
- A sketch item's `plane` is a reference (`"XY"`, `"XZ"`, `"YZ"`, or from step 26c a face's stable name, `"face:feature-2/top"`, `"face:feature-7/end"`, `"face:feature-7/side:line-4"`), never coordinates. XZ's frame is x along world x and its normal −y (so sketch y is world z); YZ's is x along world y and its normal +x.
- A sketch on a face (26c) depends on the face's feature (`dependsOn`), which is a solid item before it or gone (deleted: the sketch is held with "plane lost"), and its content keeps `face: { frame, side, held?, body? }`: `frame` is the frame it was drawn with, `{ origin, xAxis, normal }` (world mm and unit vectors; the origin plane most nearly parallel to the face, turned onto it the shortest way, its origin where the world's origin meets the face's plane square on, so on a face parallel to an origin plane its coordinates are the world's); `side` is 1 when the sketch faces along that normal, −1 against it (a bottom or back face); `held`, only while the face's name finds no face (plane lost) or two (plane ambiguous), is the frame it stays at; `body` (from 35e2h), a frame too, is where the Moves before the sketch had put the body's own frame when it was drawn (the world's frame when none had). On every rebuild the frame is first carried by what the Moves did to the body since (from `body` to where they put it now; a sketch without `body`, from before 35e2h, is not carried), then the frame is worked out again from the face's plane on the built body, turned from `frame` the shortest way. An extrude of it goes along `side × normal`.
- A sketch's `pins` (optional, from 26f; left out when none): its points snapped to a body's edges, each `{ "point", "kind", "name", "feature"? }`: `point` one of the sketch's point ids (each pinned once), `kind` `"endpoint"` (a corner, `name` a vertex name, edge names joined by `&`), `"midpoint"` or `"centre"` (an edge's middle or a round edge's centre, `name` an edge name without `&`). `feature` (from 27c) is the solid item whose body the edge is on, any one before the sketch in the timeline or gone, and the sketch depends on it (`dependsOn`); it is left out only on a face sketch for the face's own feature (as in 0.26 files), so a sketch on an origin plane names it on every pin. On every rebuild each pinned point moves to where its named corner or middle is now, seen straight along the sketch's normal; when the name finds nothing (the feature deleted, suppressed, or the edge gone) the point stays where it is and the sketch warns "point lost".
- A sketch's `projected` (optional, from 27d; left out when none): edges of bodies taken into it with the Project tool, each `{ "id", "feature", "edge", "made" }`: `id` an id from the counter (`projection-N`), `feature` the solid item whose body the edge is on (one before the sketch in the timeline, or gone; the sketch depends on it), `edge` the edge's name on that body (the part after `edge:<feature>/`, as a pin's middle names it: by which ends of its two sides' curves meet there, else its two faces), and `made` what it made in the sketch: one of the sketch's curves (a line, a circle or an arc), or, for an edge seen end on, one of its points (a curve may be drawn from it: the sketch tool shares a point it lands on, as it does a projected line's ends). Each projection's points are its own, never another projection's and never pinned. On every rebuild each goes where its edge is now, seen straight along the sketch's normal (a circle's `radius` too); when the name finds nothing, finds two edges, or the edge is now seen as another kind of curve, it stays where it is and the sketch warns "projection lost". Projected curves join the outline only where they close it with the sketch's own curves (or, in a sketch with none of its own, by themselves).
- An extrude's `flip` (optional, from 26c; only `true`, left out otherwise): it goes the other way from its sketch's plane, its start cap still on the plane (Fusion's Flip).
- `timeline.marker` (optional, from version 3): `"start"` (nothing built) or the id of the last item built; absent means all. A new item goes in just after it and the marker moves onto it.
- `kept` (optional, from step 24d2; left out when empty): an extrude's last shape while its sketch is lost (the owner's rule), by the extrude's id: `{ "feature-11": { "points": [...], "curves": [...], "placement": { "plane": { "origin", "xAxis", "normal" }, "side": 1 } } }` (`placement` from 26c, only for a sketch that was not on XY: where it lay, so the kept shape stays there), the sketch's points and curves as they were just before the edit that deleted the sketch or left it with no outline. The extrude builds from it, by its distance now, with a warning, until the sketch makes an outline again, when it is dropped. Its ids are the sketch's old ones, so the counter stays above them; they may repeat ids still in the sketch. An extrude whose sketch is gone opens (built from `kept`, or failed naming the sketch without one).
- `hidden` (optional, from U0f3; left out when everything shows): what the browser's eyes hide, by id: bodies by their body ids (from version 6, `body:feature-11`, or a piece's `body:feature-5/piece:1` once the `bodies` list numbers it; version 5 listed a solid feature's item id, and opening a version 5 file turns each into its body's id) and (from 2026-10-29) sketches by their items' ids, in timeline order (each item's sketch, then its bodies), then the origin's axes (`origin-x`, `origin-y`, `origin-z`) and the folders whose eyes are shut (`folder-sketches`, `folder-bodies`, `folder-origin`), `["sketch-2", "body:feature-11", "origin-z"]`; any order opens. A hidden body is still built (what is built on it still is) and keeps its "Body n" number, but is not drawn, selected from its rows, offered a verb or put in the whole design's STL; a hidden sketch is built from as ever but not drawn (save while it is edited). Extruding a sketch in Design hides it, as Fusion does. A shut folder hides everything in it, whatever their own eyes say. Deleting an item takes its id out. Opening refuses an empty list or anything but a list, an id that is none of these (a Move, a profile, a plane, a missing id, a non-string), and an id listed twice.
- A Move (step 35e2, `"type": "move"`): its `parameters` are its numbers (`x`, `y`, `z` in mm, `turnX`, `turnY`, `turnZ` in degrees, `pivotX`, `pivotY`, `pivotZ` in mm) and, from version 6, `bodies`, the bodies it moves by body id in the order picked; its `dependsOn` lists the items that made them, each once, in that order. Opening a version 5 file gives each Move `bodies` from its `dependsOn`. Opening refuses a Move with no bodies, a body listed twice, one that is no body made before it (a body whose item was deleted since may stay: the Move fails naming it), and a `dependsOn` that is not exactly those items.
- `shownPlanes` (optional, from 2026-10-29; left out when none shows): the origin's planes shown by their eyes (`origin-xy`, `origin-xz`, `origin-yz`, in that order), hidden until then as in Fusion. Opening refuses an empty list or anything but a list, anything but those three, and one listed twice.
- Every solid feature is its own body from version 3 (in version 2 only the last solid feature was the part); presets are ordinary features with ids from `nextId` (a profile preset takes a second id for its profile).
- Nothing the kernel computes (bodies' shapes, outlines, profiles) is stored.
- Migration from version 1: `nextId` is one more than the largest number in any id, `sketches` is empty, the rest is unchanged. Version 1 data that already holds `nextId` or `sketches` is refused, never half-migrated.
- Migration from version 3: each preset named exactly as presets were before U0e, "Feature N (type)" from its id's number, gets its short name ("Box 1"), and the copies of that name in other items' provenance and descriptions follow. Only version 3 (and older) data is renamed: from version 4 a name of that form is one the user typed, and it is kept.
- Migration from version 2: every solid feature but the last becomes suppressed (version 2 showed only the last, so the design opens looking the same and nothing is lost); ids, sizes and the counter are unchanged. Version 2 data holding a timeline marker is refused.
- Opening refuses a marker that is not `"start"` or an item's id, a `suppressed` that is not true or false, and (until the app draws every body, step 24d3) a design in which no solid feature builds (all suppressed or after the marker).
- Opening refuses, each with its own message: an item without a `dependsOn` list of ids, without `provenance`, or whose provenance has no own name (`self`: a workspace, id and label) or no `from` list of such entries; a point without finite `x` and `y`; a curve that is not a line, a circle or an arc; a line whose `start` or `end` is not a point of the same sketch, or that starts and ends at one point; a circle whose `centre` is not a point of the same sketch, or whose `radius` is not a finite number above 0 (the kernel holds the size limits, MIN_FEATURE to MAX_SIZE / 2, when it finds the outline); an arc whose `start`, `end` or `centre` is not a point of the same sketch, that starts and ends at one point, or that is round one of its own ends; constraints (until step 47); a sketch without its timeline item or the other way round; a plane other than the three origin planes or a face's name Design makes; a face sketch without its `face`, with a frame that is not three triples of finite numbers or can't be squared up (a zero normal, an x along it), a side other than 1 or −1, a bad `held` or `body`, on an item that is a sketch or comes after it, or not depending on it; a sketch on an origin plane keeping a `face`; `pins` that are not a list of at least one, a pin not on one of the sketch's points or on a point pinned twice, of a kind other than the three, without a name (or a middle's or centre's name holding `&`), naming a feature that is not a string, not a solid item before the sketch, or one it does not depend on, or naming none on a sketch not on a face; `projected` that is not a list of at least one, a projection without an id, naming no feature, a feature that is not a solid item before the sketch or one it does not depend on, without an edge name (or one holding `/`), an edge projected twice, a `made` that is neither one of the sketch's curves nor one of its points, a curve or point made by two projections, or a projected point pinned too; an extrude's `flip` other than `true`; a kept `placement` that is not a frame and a side; an id used twice; a `nextId` that is not a counting number above every number in an id.

## Saving and opening

Save asks for a name and a place (the browser's save picker where it has one, otherwise a small name box and a download) and writes the project as `<name>.spindle`; Save again writes the same file without asking, Save As asks again (files saved under earlier names end in `.spindlelabs.json`, `.panosolid.json` or `.fission.json`, and those open too) (`projectToJson`): keys sorted at every level and two-space indents, so the same project always gives the same bytes. A number JSON can't hold (NaN, Infinity) is refused when saving instead of being written as `null`. Open (`projectFromJson`) parses the text, runs `readProject` (the migrations below), then hands each workspace its own part (`readData`); a part no workspace in this build reads is kept as it is. Bad JSON, a non-project, a newer format or a workspace refusing its part refuses the whole file with one message; the open project stays as it was.

## Planned: recipes, origin and remixes (a later version; nothing reads these yet)

A shared design is a complete recipe (docs/integration.md, principle 7). These fields are planned now so the format grows into them without a redesign. They arrive as one format bump with a migration (old files get an empty recipe and no origin), no earlier than step 19's save and load, and are used by sharing (C2–C4).

```json
{
  "recipe": {
    "contents": ["design", "slice", "laser", "render", "instructions"],
    "instructions": [{ "step": 1, "text": "Print the base", "uses": ["slice:plate-1"] }],
    "machineNeeds": [{ "kind": "printer", "bedAtLeastMm": [180, 180], "material": "PLA" }]
  },
  "origin": { "projectId": "…", "author": "…", "version": "…", "fetchedAt": "…" },
  "lineage": [{ "projectId": "…", "version": "…", "base": "…" }]
}
```

- `recipe.contents`: which workspaces' data the recipe carries, so a reader knows what it gets before opening it. The data itself stays under `workspaces`, as today.
- `recipe.machineNeeds`: what the recipe was made for, so "Make it for my machine" can swap in the user's own printers, lasers, materials and units, and say what it changed.
- `origin`: where a downloaded or remixed project came from. It never changes after download.
- `lineage`: the chain of remixes back to the original. Each entry keeps the `base` version it started from, so an "Update available from the author" can be brought in as a three-way merge: the author's changes since `base`, with the remixer's own changes kept on top. Because features store intent and ids, the merge works on timeline features and parameters, not on geometry.

## Migration rules

1. Any change a version-N reader can't read is a new version, N + 1.
2. Every bump adds `MIGRATIONS[N]` in `packages/core/src/model/project.ts`: a function from a version-N file to a version-N+1 file. Old entries are never edited, because files in those versions exist on people's machines.
3. Reading runs the migrations one after another, from the file's version up to the current one. A version-1 file therefore opens in every later SpindleLabs.
4. A workspace's own `version` follows the same rules inside `readData`.
5. Each migration has a test that turns a real old file into the new shape (`packages/core/test/project.test.ts`).

### History

- 1: the first format (name, units, materials, workspaces).
- 2: `links` added (live links, I9). Migration: old files get `"links": []`.

# Model integration: node #820, Discovery / Voyager A

Follows [the authored-model integration SOP](../model-integration-sop.md).

## Current result

SOP steps 1 to 4 are done. The voyager is drawn as Discovery / Voyager A,
installed after boot on the shared authored-hull path (courier, tug, now
voyager). **Owed before merge: the principal looks at it in the game and says
yes** (see "How to look at it"), and two rulings below (D1, D7).

- **Design:** PR #816, branch `design/discovery-codex` at `22f98a4`, merged into
  this branch first. Principal visual acceptance of the study 2026-10-09
  (*"looks good. Wrap up in a PR for another agent to finish"*). The study's
  judge score (7.98) is not the in-game yes. No visual iteration was done here.
- **Shipped asset:** `src/models/discovery-voyager.glb`, 21,767,436 bytes
  (20.76 MiB), sha256
  `55528ccc179845a8e759918433cec6018e1e470ac94661706ac8155eed9a2c97`
  (two runs wrote the same hash). The study export is 35.6 MB.
- **Code:** `src/voyager-hull.ts` (scale, nozzles, loader), the shared
  `src/authored-hull.ts` (gained `StudyNozzles.mounts`: the first hull whose
  drives are not a mirrored pair), `voyager` in `AUTHORED_HULL_MODELS` and
  `modelLoaders`, the workbench's loader list, and the hull row in
  `src/hull.ts`.

### Contract

| Item | Value | Source |
| --- | --- | --- |
| Hull row | `voyager`, role `expedition`, a capital: docks nowhere, sold nowhere, no price | `src/hull.ts`, `tests/hull-voyager.test.ts` |
| Variant | the study is `voyager/a` (the loft's `Odyssey`); the loft stays as the stand-in until the model installs, and `voyager/b`, `/c` stay procedural | `HULL_SPECS.voyager.variant` |
| Units, axes | metres; the study's nose is **+X** in the file, `prepare-flight-asset.mjs` turns it onto **+Z** (the rigid map `(x, y, z) -> (-z, y, x)`, exact); the install then half-turns it about Y (nose −z) | `tests/discovery-asset.test.ts` |
| Scale | **×1.349: the roster's 191 m, not 1:1** (D1) | `src/voyager-hull.ts` |
| Envelope | 191.0 × 32.9 × 36.1 m (L × B × H), the model's box rounded up 0.1 m; was 191 × 29.5 × 30.1 | `src/hull.ts`, `tests/hull.test.ts` |
| Envelope centre | unchanged (right 0, up 2 m, fore 2 m): the install centres the box on it, so the collision box and proxies keep their frame | `tests/voyager-hull.test.ts` |
| Display reach | 97.5 m, the farthest vertex (97.48 m) rounded up; was 100 m | `HULL_REACH_KM.voyager` |
| Mass, thrust, hold, integrity, shields, tank, charge | **unchanged** (380 t, 190 MN, 240 t, 303, 321, 16 LY, 40 AU). Density 1.68 t per 1000 m³ at the new box (was 2.24), inside the 1.2–2.4 band | D1; `tests/hull.test.ts` |
| Vents | placement re-measured and shares re-solved on the model by `measure-vent-placement.ts` and `measure-vent-shares.ts`; every other hull still reproduces its stored row. The ease-out cost is 0.0% on pitch, yaw and roll: the voyager's handling is not retuned | `src/hull.ts` |
| Drives | three bells (two above the axis, one below); three glows placed by measurement, 3 cm clear of every triangle; `ventThroats` finds three main-drive throats | `VOYAGER_NOZZLES_M`, `tests/voyager-hull.test.ts` |
| Collision owner | the hull envelope, as for every hull | `src/hull.ts` |
| Moving parts | none: 18 meshes batched by material, no animation; the dish is fixed geometry | study GLB |
| Resources | one GLB under `src/models/`, content-hashed (#834); review files stay in `spikes/discovery/` | SOP §2 |

### Decisions

- **D1 (mine, flagged for the principal): scale to the roster length, do not
  draw 1:1.** The node says a dimension move goes to the principal first; this
  keeps the one dimension the principal ratified (the length, 191 m, the film's
  proportion, #331) and moves only the beam and height, which the mesh
  measures, as the courier's do. The study's own handoff says its 141.6 m are
  "visual-study metres, not gameplay dimensions". **Rejected: 1:1 (the tug's
  way).** The box would be 141.7 × 24.4 × 26.8 m, 92.6k m³ against 226k, and the
  380 t would read 4.1 t per 1000 m³, outside the 1.2–2.4 band, so the mass,
  thrust, integrity, shield pool and the hull ceiling's reference would all be
  re-derived: a rebalance of a hull nobody flies, to save 26% of a length.
  **If the principal prefers 1:1:** set `kmPerM` in `voyager-hull.ts` to 0.001
  and re-derive the row as #813 did the Porter's. Either choice is one node's
  work; neither changes docking, because the model is longer than every berth
  (90 m) at any scale above ×0.64 of its own size
  (`tests/discovery-asset.test.ts`).
- **D2: after boot, the shared path** (map Constraints, #835). Not a blocking
  boot asset, so the node text's "behind the Retry panel before any Game is
  built" does not apply to it; the postcard and the ship workbench do wait for
  it behind their own panels (the workbench's list gained it; a postcard waits
  for the models its frame draws).
- **D3: paints as accepted, no #887 lift.** The principal accepted the look; the
  lift is the tug's #909 and is a decision about brightness in the game's rig.
  The shipped materials equal the study's (`tests/discovery-asset.test.ts`).
  Open: see D7.
- **D4: no resize, simplification or quantisation** of the accepted geometry or
  textures. Meshopt (NONE filter) and lossless WebP only, asserted exact.
- **D5: LOD policy: the courier's.** The full model inside `DETAIL_RADII.full`,
  two reduced copies beyond it (`authored-levels.ts`). Measured cost below.
- **D6: install stall accepted as the courier's and tug's are** (their own node,
  #907). The voyager's is longer, see below.
- **D7 (open, for the principal): the voyager is not flyable and not in
  Traffic.** `?hull=` takes purchasable hulls only, and nothing sells or spawns
  a capital, so the principal sees this hull in the `?fleet` review and the ship
  workbench (and any derelict or fleet roster that names one). "Flies it" in the
  node text can only mean flown past or viewed. Whether a way to fly it belongs
  to this node is not for an agent to add.

## Asset and geometry preflight

- **Run:** `node spikes/discovery/prepare-flight-asset.mjs`. It asserts the study
  has no node transforms (so the turn is the geometry's alone), turns the nose
  onto +Z, and asserts the bounds followed.
- **Encoding:** `dedup`, `reorder`, Meshopt with the lossless NONE filter,
  lossless WebP. The script asserts exact vertex attributes, the turned export's
  triangles (`spikes/longwall-miner/triangle-soup.mjs`, shared) and texture
  pixels.
- **Size:** 20.76 MiB against the host's 25 MiB per-asset limit: the largest hull
  model in the bundle (tug 16.7, courier 13.9, Porter 14.4). `npm run build`
  runs `scripts/check-dist-sizes.mjs`; the result is below.
- **Production loader:** `tests/discovery-asset.test.ts` decodes both files
  through `decodeShippedGlb`. 18 meshes, 541,843 triangles, every attribute of
  every corner equal to the turned study's, winding kept; materials equal the
  study's; three WebP textures.
- **Bounds (turned, study metres):** x ±12.17, y −12.17 to +14.59, z −79.06 to
  +62.57 (141.63 m long).
- **Berth fit:** none, by design. The model is longer than every berth of every
  role at its own size, and the selected variant's scaled box is refused by
  length in `tests/hull.test.ts` and `tests/aperture-fit.test.ts`.
- **Drive glows:** the recess ring that closes each bell stands at z −73.75 m
  (clear radius 0.99–1.10 m); behind it the flared wall runs from z −74.5 m
  (1.25 m clear in y) to the lip at −79.06 m (1.76 m). The glow bowl runs
  0.9 → 1.7 m between z −73.8 and −78.9. `tests/voyager-hull.test.ts` holds every
  glow 3 cm clear of every triangle of the model.

## Runtime and performance evidence

### Paths (SOP §3)

| Path | Result | Evidence |
| --- | --- | --- |
| Boot and cold download | Not in the boot set. The model queue fetches it when the flown hull, Traffic, a fleet or a derelict names a voyager (`systemModelIds`) | `src/model-catalog.ts`, `src/system-models.ts` |
| Background installation | The shared path; the stand-in loft is rebuilt once into the model. Main-thread cost below | `scripts/measure-hull-install-stall.mjs` |
| Interrupted or failed load | The shared `authoredHullLoader`: a refusal keeps every stand-in and clears the memo | unchanged code path; courier and tug rows in `probe-model-download` §6 |
| Postcard/export | Waits for the models the frame draws, behind the Retry panel | unchanged code path |
| Flight and traffic | Vents, muzzle, nav lights and throats are measured on the model; the one gun is forward on metal | `tests/voyager-hull.test.ts`, `tests/vent-placement.test.ts`, `tests/vents.test.ts` |
| Jump during install | The refresh walks the Game's current meshes when the install resolves; the builder is not owned by a system | `Game.refreshAuthoredHulls` |
| Repeated rebuild and teardown | A second rebuild is refused; a cached wreck is rebuilt dark through its own builder | `tests/voyager-hull.test.ts` |
| Cockpit fit | Not applicable to the model: the cockpit is the courier's one model, drawn in its own pass, and the hull is hidden in cockpit view | contract |
| Rotation and render layers | Not applicable: no moving parts | contract |

### Cost (SOP §4)

`HULL=voyager node scripts/measure-authored-hull-cost.mjs` and the same with
`HULL=courier`, 2026-10-19, same page and fixture: M1 Pro, ANGLE Metal,
1440 × 900 at device scale 2, chase, clock held, 12 blocks of 120 frames per
arm, order shuffled from seed 20261009. **Load average 11–16 from other
sessions** (`uptime`), so read the deltas, not the absolutes.

| Arm | Voyager − loft | Courier − loft |
| --- | --- | --- |
| alone, occlusion off | +0.61 ms (144/144) | +0.37 ms |
| alone, occlusion on | +0.77 ms (144/144) | +0.43 ms |
| +4 close (full model), off | +0.99 ms | +0.68 ms |
| +4 close, on | +1.60 ms | +1.17 ms |
| +4 far (reduced), off | +0.38 ms (121/144) | +0.38 ms |
| +4 far, on | +0.82 ms | +0.48 ms |

The authored voyager draws 21 meshes and 543k triangles at full detail against
the loft's 35 meshes and 12k; submitted triangles for one voyager, occlusion
off, are 1.05M against 0.51M for the bare frame. It costs about 1.5 times what
the courier's model does, and it is a hull that appears alone (a capital, in no
Traffic), so the `+4` rows are a ceiling and not a scene the game builds.

### Install stall

`RUNS=5 node scripts/measure-hull-install-stall.mjs`, same machine: the
voyager's install blocks the main thread **1.52 s** in one piece (parse 72 ms,
builder 738 ms, first build 159 ms, throats 608 ms), against 1.05 s for the
courier and 1.35 s for the tug in the same run. It has no live roots to
refresh, so the figure is the install alone. This is the stall #907 owns for
every after-boot hull; the voyager's is the longest because its builder
simplifies the most triangles and its three bells are measured by raycast.
Accepted as D6 accepted the tug's, and worth the principal's eye on #907's
priority.

## Verification

- **Headless:** `npm test` first run 6542 pass, 1 fail: `vent-plumes.test.ts`
  "a line that meets the hull" timed out at bun's 5 s default, because it raycasts
  every throat through every hull's whole mesh and the voyager's 543k triangles
  tipped it (8 s alone with `-t`). Given a 60 s timeout in this node; the final
  run, after that fix and the format fix: **6543 pass, 0 fail** across 382 files.
- **Model rows:** `tests/voyager-hull.test.ts` (16) and
  `tests/discovery-asset.test.ts` (5). Mutation check: raising the glow's lip
  radius from 1.7 to 2.1 m turned the 3 cm clearance row red; reverting it
  returned green.
- **Gates:** `npx tsc --noEmit` clean, `format:check` and `lint` clean,
  `check-launcher-wiring` exit 0, `npm run build` passes with
  `dist/assets/discovery-voyager-<hash>.glb` at 20.8 MB and no spike file in
  `dist/`.
- **Browser (selected, GPU lane, M1 Pro, not the full suite):**
  `probe-model-download`, `probe-model-queue`, `probe-ship-visuals`,
  `probe-production-boot`, `probe-postcard`, `probe-vent-display`: all green.
  `probe:select` against `origin/main` selects nearly every probe (main.ts,
  boot wiring), so the supervisor's `probe:pr` is the gate; these are the ones
  that cover what changed.
- **Review fleet:** in `?fleet`, `voyager/a` is authored and `/b`, `/c` are not.

## How to look at it

- **In the game:** `?fleet` boots a review fleet of every hull (the voyager's
  selected variant is the authored one); fly to the voyager row.
- **Ship workbench:** `?model-viewer=ship`.
- **Captures from this node:** `spikes/discovery/capture-game.mjs` boots the game
  on the GPU lane, makes the voyager the flown hull and frames it from five
  sides; the evidence is `spikes/discovery/evidence/game-*.png` and
  `game-report.json` (renderer Apple M1 Pro, no page errors, three glows named).

## Field Notes copy (proposed, not landed)

Per the node, copy is the principal's to approve before it goes into
`src/changelog.ts`. Whether this is a major change in the docblock's sense is
also the principal's call: the hull is not flyable or sold, so a pilot meets it
only in the review fleet, the workbench or a roster that names it. Proposed
entry if so, dated the day of the merge:

> The expedition ship Voyager has a new hull: a 191-metre ivory-and-steel
> homage to a long spine, a command sphere forward and three drive bells aft.

## Open

- **D1:** scale to roster length (done) or 1:1 (needs a row re-derivation).
- **D7:** how the principal flies it: nothing in the game puts a capital under a
  pilot.
- **#887 paint lift** for this hull (a #909-style node) if the in-game brightness
  disappoints: the study's alloy paint is 0.36 at metalness 0.86.
- **#907:** the install stall, now three hulls long.

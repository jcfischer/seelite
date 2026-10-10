# Node #843 — accepted station interiors in flight

Author: Codex, ranger implement worker, ivy-agent. Date: 2026-10-10.
Checkpoint: `station-interiors-integration`. This is implementation evidence;
the principal's production flight approval and the supervisor's delivery gates remain pending.

## Problem

Design PR #841 delivered accepted fitting geometry and four themes, but the live
game still drew procedural bays. Its review loader and metre-local camera were
not a production loading or LOD policy.

## Vision

Trade and shipyard bays draw the accepted civic, works, frontier and survey kit,
around the berths and corridor the game already owns.

## Out of Scope

Aesthetic redesign, gameplay dimensions, save migration, the general background
model queue in node #838, and Field Notes publication.

## Principles

Full fitting geometry remains the authority for clearance measurements. Rendering
detail selection cannot change the sim. Triangle savings do not imply FPS gains.

## Constraints

The assigned branch includes design head `2e533b56` through merge `f79167d6`.
No other branch is changed. Refinery and outpost pads retain their open decks.
The existing game near plane stays 0.01 km. No generated world or saved field changes.

## Goal

Commit a verified integration on the assigned worker branch. The supervisor owns
push, PR, Sage, full browser pass, principal flight acceptance, squash merge and
the graph close gate. Recommend superseding design PR #841 with the integration PR.

## Checkpoints

- C1: Accepted authored kit uses hashed assets and non-boot fallback loading.
- C2: Anti: authoritative dimensions, berths, axial lane and open decks do not change.
- C3: Instanced fitting LODs use the game camera, drawing-buffer resolution and hysteresis.
- C4: Production frame cost and draw calls are measured; focused checks pass.
- C5: Worker leaves a clean committed branch; Field Notes remains a proposal.
- Antecedent: production visual acceptance requires the principal flying it and saying yes.

## Test Strategy

Decode the shipped GLB, then measure its actual triangles against the authoritative
bay and clearance laws. Sweep both enclosed roles, all four themes and three LOD
levels. Test station-parent movement, kilometre scale and drawing resolution.
Hold/abort browser downloads to verify the loading boundaries. Compare shuffled
Full/Auto frames on the built bundle and the player's renderer.

## Features

- C1: One 28,356,108-byte `src/models/station-interiors.glb`, with all 46 fitting
  scenes, lossless Meshopt geometry and one shared lossless WebP paint. Literal
  `model-urls.ts` URL emits the existing immutable hashed `/assets/*.glb` route.
  No review GLBs move into `public/`.
  SHA-256: `34e49c2908c901dbb0baab5af6313e8184fe59e885b362d7487cc1ee711fdf73`;
  built asset: `assets/station-interiors-BSuE28nH.glb`.
- C2: `interior-kit.ts` consumes the actual form's `StationInterior`. One root
  converts metres to kilometres for every level. Only the mouth furniture is
  recessed; berths, end wall and traversal stay where the sim put them.
  The install retains root and painted nameplate identities.
  Berth identities follow actual pad instance slots, with packed-geometry tests
  pinning their world transforms; the docking probe reads those slots without
  requiring one scene object or draw per berth.
- C3: Layout, policy and bucket code now live in `src/`; spike imports share them.
  Buckets include station-parent transforms, near/far scale and drawing height.
  Entry is one device pixel; hysteresis retains a coarse level until 1.2 pixels.
  Four inset floods use the existing cabin-mirror seam, on High at full station
  detail; teardown releases the mirrors and per-station instance resources.
- C1/C4: The decoded bundle stays in memory. Every live bay installs once;
  a failed optional load warns once and retains its procedural stand-in.
  `__seelite.interiorModelsSettled` reports success or fallback completion.
  `?interiors-full` waits behind the existing progress/Retry view. Direct probe
  URLs and canonical captures use it; download probes explicitly opt out.
  Postcard export/view waits for the kit, including retry after a failed background load.

## Decisions

2026-10-10: Live node #838 was OPEN. Interiors therefore add no ordinary boot
model: the module and GLB load after `Game` construction. Existing cockpit,
Coriolis and Longwall boot behavior is retained; the general queue remains #838's.

Theme is `station.berthSeed % 4`, consuming no RNG and persisting no new state. This
keeps all four accepted appearances without inventing a new gameplay distinction.

Field Notes proposal for the integration PR, awaiting principal approval:
“Station bays now have distinct industrial interiors, with detail that follows
your distance from each fitting.” Do not put it in `src/changelog.ts` before approval.

## Changelog

The production asset preparer compares every decoded attribute and texture pixel,
plus source/packed triangle soup and winding. Position quantisation is deliberately
absent; Meshopt's lossless reorder/compression preserves gameplay measurement inputs.

An initial measurement fixture was still in the opening scene; those readings
were discarded. The final instrument explicitly skips the opening and requires
a docked bay, its expected theme, the game near plane and actual drawing size.

The cabin probe's compilation check caught a mid-measurement background install;
settled direct probe boots remove that race. Its AO row then counted filtered
silhouette-edge spill as world: all 456 observed pixels lay within two pixels of
the cabin, the footprint of the actual half-resolution AO target. It now derives
that sampling fringe from the target size and reports it separately, with the
original 4-code and 0.05% thresholds retained. The deliberate wrong-scene control
remains red: 41.902% beyond the two-pixel fringe, and incorrect AO scene identity.

The full-suite diagnostic run found the controls catalogue still expecting the
postcard key to open the panel directly. Its handler expectation now names the
model-wait helper; the download browser gate verifies the wait and actual opening.
The packed-geometry corpus is split by role and theme, retaining every seed and
level check while giving each case its own diagnostic and test-time allowance.

## Verification

Focused headless run: 169 pass, 0 fail across 11 files, including packed fitting
geometry, layout, LOD, nameplate/open-deck replacement, teardown, URLs and probe selection.
Strict typecheck, build, format and script lint passed during implementation.
After the catalogue correction, its focused run with the packed kit passed
33 tests across two files; final typecheck and format check passed.
Final `npm test`: 5,775 pass, 0 fail across 319 files, 9,054,175 assertions,
419.94 seconds. The final source was unchanged after this run.
The mandatory selector returns `all` for shared capture/URL changes. Worker runs
remain explicitly partial, as required by the task; the supervisor runs the full browser suite.

Production cost data: `spikes/interiors/evidence/production-codex.json`. Reprint:

```sh
npm run build
node scripts/measure-station-interior-kit.mjs
```

This serves the built Vite bundle through loopback preview using the existing
tree-declaration middleware and guarded, locked focused runner. Analytics is
fulfilled locally before it reaches the network. The measurement is Metal on
Apple M1 Pro, 1440×900, chase camera in trade's `port-deep` berth, opening disabled.
Eight shuffled blocks of eight serial render/readPixels frames per arm price
the whole composer. These are drained frame costs, not rAF cadence or timer-query GPU times.

The four production screenshots are regenerated under ignored
`probe-shots/interior-kit/`. They were inspected by the worker, not approved by
the principal. Canonical berth views now cover lever 843 and wait for the kit;
the supervisor still owes before/after sheets and the principal's flown yes.

| Theme | Full calls | Auto calls | Full triangles | Auto triangles | Full ms | Auto ms | Pairwise separation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| civic | 907 | 1143 | 11665026 | 10301346 | 15.288 | 15.219 | 42/64 (66%) |
| works | 1163 | 1307 | 10023870 | 8912766 | 15.794 | 16.094 | 33/64 (52%) |
| frontier | 1028 | 1214 | 10939424 | 9665504 | 14.344 | 14.394 | 27/64 (42%) |
| survey | 954 | 1175 | 10932674 | 9639170 | 14.288 | 14.225 | 23/64 (36%) |

Auto adds 144–236 calls while removing 11–12% of the whole frame’s triangles.
The shuffled timing arms overlap; no frame-rate improvement is established.
Counts cover the production composer and its passes, not just the kit.

Focused Metal gates passed: the new interior kit on the final production build,
plus cabin-pass, dock-arrival, model-download, occlusion, postcard, station-mouth
and station-visuals on the integration. These are partial runs, not a suite pass.

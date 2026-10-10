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
Procedural/Full/Auto/LOD2 frames on the built bundle and the player's renderer.

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
  Production defaults to per-fitting Auto after round 4: close fittings retain
  Full under the accepted projected-size policy. Forced Full/LOD1/LOD2 remain
  available in the study viewer and diagnostic controls. Mixed levels can
  populate multiple instanced draw sets per family; no Auto speedup is claimed.
  Four inset floods use the existing cabin-mirror seam, on High at full station
  detail; teardown releases the mirrors and per-station instance resources.
- C1/C4: The decoded bundle stays in memory. Every live bay installs once;
  a failed optional load warns once and retains its procedural stand-in.
  `__seelite.interiorModelsSettled` reports success or fallback completion.
  `?interiors-full` waits behind the existing progress/Retry view. Direct probe
  URLs and canonical captures use it; download probes explicitly opt out.
  Postcard export/view waits for the kit, including retry after a failed background load.

## Decisions

- 2026-10-10 10:45: The review viewer consumes `buildInteriorKit` with zero recess and metre units, including its single themed material factory. It retains stage-owned lighting, labels, ships and library controls. Production uses the unchanged kilometre conversion and light levels.

2026-10-10: Live node #838 was OPEN. Interiors therefore add no ordinary boot
model: the module and GLB load after `Game` construction. Existing cockpit,
Coriolis and Longwall boot behavior is retained; the general queue remains #838's.

Theme is `station.berthSeed % 4`, consuming no RNG and persisting no new state. This
keeps all four accepted appearances without inventing a new gameplay distinction.

Field Notes proposal for the integration PR, awaiting principal approval:
“Station bays now have four distinct industrial interiors, with fitted machinery
around their landing berths.” Do not put it in `src/changelog.ts` before approval.

## Changelog

- 2026-10-10 | conjectured: Full/Auto cost evidence was sufficient to assess installing the kit.
  refuted by: Sage round 1 identified the missing replaced-procedural-bay comparison.
  learned: Price the shipped presentation against its predecessor as well as against its own detail levels.
  criterion now: C4 includes a shuffled procedural fallback arm with matching camera and world-state readback.

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

### Initial implementation verification (`4bde5a2`)

Focused headless run: 169 pass, 0 fail across 11 files, including packed fitting
geometry, layout, LOD, nameplate/open-deck replacement, teardown, URLs and probe selection.
Strict typecheck, build, format and script lint passed during implementation.
After the catalogue correction, its focused run with the packed kit passed
33 tests across two files; final typecheck and format check passed.
Final `npm test`: 5,775 pass, 0 fail across 319 files, 9,054,175 assertions,
419.94 seconds. The initial implementation source was unchanged between this run and commit `4bde5a2`.
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

### Sage round 1 repair

The three important findings are addressed: CONTEXT names the authored assembly
and layout seam; the viewer no longer forks kit assembly or themed materials;
and the production cost instrument now includes the replaced procedural bay.
Re-registering a station without a kit also deletes the released handle, with a
browser check requiring each mirror to be released exactly once.

The archived design handoff's Sage deferral is now marked as historical. Node
#838 was checked again and remains OPEN; the loading decision above still applies.
Field Notes and production flight acceptance remain pending principal approval.

Production comparison: `spikes/interiors/evidence/production-review1-codex.json`.
The procedural arm aborts the optional interior GLB on a separate page, leaving
`buildStationInterior`'s procedural stand-in. That geometry builder is unchanged
from pre-integration parent `e1faa6f`: node #843 added only stand-in metadata and
the authored replacement seam to it. This prices the shipped kit, including its
lighting, against the presentation it replaces, rather than against a hidden kit.
Both pages boot once, reset flight to the same initial state, fly the same docking
fixture, stop the frame loop and hold the clock. The instrument refuses unless
ship position, game time, actual camera pose/projection, quality and drawing-buffer
size agree exactly. Both renderers are checked as hardware; four matching-state
checks passed. The calls below include the whole composer.

Apple M1 Pro / ANGLE Metal, High, 1440×900, production Vite bundle, trade
`port-deep` chase camera, 0.01 km near plane. Eight shuffled blocks × eight
serial render/readPixels frames per arm, seed 843. These are drained frame costs,
not delivered FPS. Raw block samples and all triangle counts are in the JSON.

| Theme | Procedural calls | Full calls | Auto calls | Procedural ms | Full ms | Auto ms | Full vs procedural | Auto vs procedural |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| civic | 569 | 907 | 1143 | 8.113 | 14.513 | 14.713 | 64/64 | 64/64 |
| works | 607 | 1163 | 1307 | 8.644 | 15.344 | 15.450 | 64/64 | 64/64 |
| frontier | 609 | 1032 | 1218 | 7.781 | 14.719 | 14.506 | 64/64 | 64/64 |
| survey | 614 | 958 | 1179 | 7.838 | 14.087 | 14.456 | 64/64 | 64/64 |

Each pairing counts the authored arm slower than procedural. Installing Full
adds 338–556 calls and 6.25–6.94 ms to the median; Auto adds 565–700 calls and
6.60–6.81 ms on this fixture and device. Full/Auto separation is only 27–43/64;
no Auto frame-time gain is established. The new readback-controlled reset changes
a few counts from the earlier capture; that original Full/Auto run remains
archived above. This is one device and an interior-facing view, not a claim about
a lower-end device, moving-camera selection cost or every station approach.

Round 1 deferred scheduling/allocation changes and kept the automatic default.
Round 2 supersedes that default with Full based on the extra Auto batches and
the absence of an established frame-time benefit. GLB
serialization consolidation and pixel-diff consolidation are independent study
maintenance. Historical asset identifiers, technical API names and approved
reference copy are retained rather than renamed for glossary substring matches.

Round-1 final verification (2026-10-10):

- C2/C3: tested — final focused run passed 14 tests across two files, including actual packed geometry, metre/kilometre bounds at each detail level and shared themed materials. The earlier four-file focused run passed 18 tests before the additional bounds check.
- C4: tested — `npm test` ran once: 5,778 pass, 0 fail, 9,054,208 assertions across 320 files, 407.92 seconds. No source changed after this run.
- C4: tested — game and strict standalone-viewer typechecks, production build, format, script lint and diff whitespace checks passed.
- C1/C3/C4: tested — the focused production Metal runner passed 1/1 gating probe in 56 seconds; 98/99 probes were not run. The added mirror-release row and four matching procedural-state rows passed. This remains partial browser coverage.
- C3/C4: tested — final shared-viewer Metal capture passed all 16 theme/view comparisons, forced levels, near/far transitions, role/seed rebuilds and the Fittings toggle across a replaced assembly. Zero browser errors and zero changed pixels in every full/full repeat; maximum Full/Auto changed fraction was 0.0298%. Frames were inspected by the worker, not approved by the principal.

### Sage round 2 repair

The performance finding is taken: `buildInteriorKit` selects Full before its
first render. Each fitting family therefore uses one populated geometry-level
bucket by default. All three levels, per-fitting Auto selection, drawing-buffer
scaling and hysteresis remain unchanged and available to the viewer/probes.
The study viewer explicitly applies its selector, so its Auto default remains
a review control. No geometry, material, dimension, loading or save changes.

The packed shipping-asset test was written first and failed on the old Auto
default. With the repair it verifies Full at a camera distance where Auto would
reduce fittings, across all four themes, then verifies that opt-in Auto still
reduces triangles without changing population. The focused kit/LOD run passed
15 tests, 0 failures, 25,003 assertions.

Repeated production evidence: `spikes/interiors/evidence/production-review2-codex.json`.
Same instrument and shuffled eight-block/eight-frame design as round 1; M1 Pro /
ANGLE Metal, High, 1440×900, real 0.01 km game near plane, trade `port-deep` chase
camera. All four untouched-default browser checks require Full mode, nonempty
full buckets, and identical submitted calls/triangles to forced Full. All four
procedural comparison pages again matched camera, world clock and quality.

| Theme | Procedural calls | Default / Full calls | Auto calls | Procedural ms | Full ms | Auto ms | Auto vs Full separation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| civic | 569 | 907 | 1143 | 14.794 | 24.025 | 24.250 | 39/64 (61%) |
| works | 607 | 1163 | 1307 | 14.425 | 24.431 | 24.575 | 38/64 (59%) |
| frontier | 609 | 1032 | 1218 | 14.300 | 24.831 | 24.725 | 26/64 (41%) |
| survey | 614 | 958 | 1179 | 12.363 | 23.856 | 22.375 | 35/64 (55%) |

Separation counts Auto block costs higher than Full across all block pairings.
Full removes 144–236 calls relative to Auto; neither timing arm separates
consistently. These are drained frame costs, not delivered FPS. This run's times
are higher than round 1's on the same device; no comparison of elapsed costs
between the two runs is claimed. Full still costs more than the procedural
stand-in: 338–556 extra calls, with Full/procedural separation at 64/64 for the
first three themes and 56/64 for survey. This repair removes the additional
mixed-LOD call cost; it does not establish a speedup over the procedural bay.

The focused production runner passed 1/1 gating probe in 69 seconds, peak load
7.6 on 10 cores; 98/99 probes were not run. Mandatory selection returned `all`
because the integration branch touches shared capture infrastructure. The worker
SOP limits this pass to affected probes; the supervisor owes the full suite.
All four Full screenshots were opened and inspected by the worker. Principal
production flight approval remains pending.

The four failed Sage lenses (CodeQuality, Architecture, Maintainability,
HonestOracle) produced no source finding to repair. They must be rerun by the
supervisor before merge; this commit does not claim those reviews passed.
The 21 optional glossary nits are declined: `spawn` is Node's child-process API,
`command` identifies an accepted control-room fitting rather than a consequence
model intervention, and the study reference title uses “Hangar” as quoted design
copy. Renaming historical assets, generated evidence or those technical names
would add unrelated churn. CONTEXT's scoped alias rule remains authoritative.

Round-2 final verification (2026-10-10):

- C3/C4: tested — `npm test` ran once: 5,779 pass, 0 fail, 9,054,236 assertions across 320 files, 429.57 seconds. No source changed after this run.
- C4: tested — production build (including game typecheck), format, script lint, launcher wiring and diff whitespace checks passed.
- C3/C4: tested — the production Metal focused gate passed 1/1 in 69 seconds; all four default/Full count checks, Auto controls and matching procedural-state checks passed. This remains partial browser coverage.

### Sage round 3 repair

The performance finding is taken. Round 2 removed mixed-level draw calls but
kept all full fitting triangles. Production now selects the accepted LOD2
uniformly before its first render. This removes small fasteners up to 0.24 m,
retaining the study's cladding, glazing, lights and major structure. Modules
without reduced geometry retain their sole full bucket. Each fitting family
still uses one populated bucket by default; no geometry is regenerated.
Full geometry remains the measurement authority. Full and per-fitting Auto,
including drawing-buffer scaling, instancing and hysteresis, remain review
controls. The shared viewer still applies its own Auto selection. No gameplay
dimension, layout, camera near plane, loading or save changes.

The packed-asset regression was changed first and failed on the previous Full
default. It now checks all four themes for LOD2, zero LOD1 population and at
least 40% fewer fitting triangles, then verifies that Full and Auto preserve
the fitting population. The focused kit/LOD run passed 15 tests, 0 failures,
25,023 assertions, including actual full/reduced geometry clearance and unit
conversion checks. The browser row independently requires untouched default
counts to equal forced LOD2, submit at least 35% fewer total frame triangles
than Full, and use no additional calls. Those floors cover fitting-only and
whole-frame counts respectively; they are regression guards, not timing claims.

Production evidence: `spikes/interiors/evidence/production-review3-codex.json`.
Vite production bundle; Apple M1 Pro / ANGLE Metal; High; 1440×900; real 0.01 km
near plane; trade `port-deep` chase camera. Eight shuffled blocks of eight serial
render-plus-readPixels frames per arm, including the new LOD2 arm. All four
procedural comparisons matched camera, world clock, quality and drawing buffer.

| Theme | Procedural calls | Default / Full calls | Full triangles | Default triangles | Reduction | Procedural ms | Full ms | Default ms | Default vs Full separation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| civic | 569 | 907 | 11,665,026 | 6,997,890 | 40.0% | 8.750 | 16.625 | 15.988 | 7/64 (11%) |
| works | 607 | 1163 | 10,023,870 | 6,123,198 | 38.9% | 9.081 | 16.700 | 16.237 | 12/64 (19%) |
| frontier | 609 | 1032 | 10,939,472 | 6,685,520 | 38.9% | 8.725 | 16.725 | 16.394 | 13/64 (20%) |
| survey | 614 | 958 | 10,932,722 | 6,581,234 | 39.8% | 9.137 | 16.719 | 16.031 | 5/64 (8%) |

Separation counts Default block costs higher than Full over all pairings.
The reduced triangle submission is substantial; the measured frame-cost
improvement is only 0.33–0.69 ms in these fixtures. All four default medians
are below 16.7 ms in this run, but these are drained frame costs, not delivered
FPS, and this does not establish a universal 60 fps budget. The kit remains
more expensive than procedural: 338–556 extra calls, Default/procedural
separation 64/64 in every theme. This run's elapsed costs differ from round 2
on the same device; compare arms within this run, not across runs.

Mandatory probe selection returned `all` because earlier integration changes
touch shared capture infrastructure. The worker SOP restricts this fix pass to
affected probes; the supervisor owes the full suite. The focused production
Metal gate passed 1/1 in 64 seconds, peak load 11.1 on 10 cores; 98/99 probes
were not run. All default-level, count, Auto, loading and matching-state rows
passed. Four LOD2 frames were opened and inspected by the worker, with stable
repeat frames and a nonempty fitting pixel contribution required by the probe.
Principal production flight approval remains pending. The sandboxed Chromium
launch was refused before measurement; the successful run used the authorized
outside-sandbox GPU lane.

The draw-count duplication nit is taken: both arms call one installed
`__countFrame` helper. Optional shell/collar/light extraction, paint-predicate
consolidation and redundant capture-flag cleanup are deferred to avoid widening
this performance repair. Glossary nits remain declined for the scoped technical
names and historical study provenance explained in round 2. No Field Notes
copy is published by this pass.

Round-3 final verification (2026-10-10):

- C3/C4: tested — `npm test` ran once: 5,779 pass, 0 fail, 9,054,256 assertions across 320 files, 406.75 seconds. No source changed after this run.
- C4: tested — production build (including game typecheck), format, script lint, launcher wiring and diff whitespace checks passed.
- C3/C4: tested — the production Metal focused gate passed 1/1 in 64 seconds, including all four untouched default/LOD2 count checks and matching procedural-state comparisons. This remains partial browser coverage.


### Sage round 4 repair

The close-detail finding is taken. Production again defaults to per-fitting Auto,
using the accepted removed-detail pixel bound and hysteresis. Nearby fittings
retain Full; Full/LOD1/LOD2 remain diagnostic controls. No geometry, material,
camera, gameplay dimension, loading policy or save changes. Live node #838 is
still OPEN, checked on 2026-10-10.

This supersedes the round-2 Full and round-3 uniform LOD2 defaults. Auto may
populate multiple instanced levels for a family. A single populated level per
family cannot represent independently selected near and distant fittings with
this renderer. Rather than replace the accepted selection policy or introduce a
new geometry/shader batching mechanism in a review repair, retain the existing
per-level instancing and explicitly price its additional calls. No frame-budget
or FPS benefit is claimed from the reduced triangle count.

The packed-asset regression was changed first and failed on the forced LOD2
mode. It now checks distant reductions, brings an actual berth to 15 m from
its nearest surface under the game near plane and 900-pixel display height,
and requires that same berth identity in the Full bucket. Returning to the
distant pose restores reduced population. All four themes are covered.
The focused run passed 16 tests across three files, 25,047 assertions.
The production browser row requires untouched defaults to match explicit Auto
in levels, calls and triangles, and retain more Full fittings than forced LOD2.
Default frame-cost columns now measure Auto; LOD2 has its own diagnostic column.
The saved four-theme production screenshots now show Auto.

Architecture and HonestOracle failed to produce reviews; they contain no source
finding to repair. The supervisor must rerun both before merge. The two optional
suggestions are deferred: postcard load-helper extraction changes an independent
loading path; sharing the small synthetic LOD fixture is separate test maintenance.
The 22 glossary nits remain declined for technical API names, accepted fitting
identifiers and historical study copy, for the scoped reasons recorded in round 2.
Principal production flight approval and Field Notes copy approval remain pending.

Production evidence: `spikes/interiors/evidence/production-review4-codex.json`.
Same shuffled eight-block/eight-frame instrument; Vite production bundle;
Apple M1 Pro / ANGLE Metal; High; 1440×900; real 0.01 km near plane;
trade `port-deep` chase camera. All four procedural comparison states agree
exactly on camera, world clock, quality and drawing-buffer dimensions.

| Theme | Procedural calls | Full calls | Default / Auto calls | Default levels (Full, LOD1, LOD2) | Procedural ms | Full ms | Default ms | Default vs Full separation |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| civic | 569 | 907 | 1143 | 881, 49, 30 | 8.594 | 15.206 | 15.125 | 29/64 (45%) |
| works | 607 | 1163 | 1307 | 906, 37, 19 | 8.850 | 15.256 | 15.519 | 36/64 (56%) |
| frontier | 609 | 1032 | 1218 | 1010, 60, 48 | 7.913 | 14.488 | 14.669 | 39/64 (61%) |
| survey | 614 | 958 | 1179 | 884, 52, 31 | 7.875 | 14.744 | 14.500 | 31/64 (48%) |

Level counts include shell fittings that have no reduced geometry. Subtracting
forced LOD2 Full counts leaves 103/182, 76/132, 128/236 and 106/189 removable
fittings at Full in these Auto frames (54–58%). Auto adds 144–236 calls relative
to Full while removing 11–12% of whole-frame submitted triangles. Its timing
arms overlap; no consistent Auto speedup is established. Default costs
6.53–6.76 ms more than procedural in this run, with 64/64 separation for each
theme. These are drained composer frame costs, not delivered FPS, and do not
establish a universal 60 fps budget or a lower-end-device cost. Compare arms
within this run only.

Mandatory selection returned `all` due to shared capture infrastructure in the
integration branch; the worker contract limits this pass to affected probes.
The focused production Metal gate passed 1/1 in 60 seconds, peak load 5.1 on
10 cores; 98/99 probes were not run. All default/Auto equality and close-retention
rows, forced-level population rows, stable pixel controls, visible geometry,
loading and matching procedural-state rows passed. The four default Auto frames
were opened and inspected by the worker. Principal approval is still pending.
The initial sandboxed Chromium launch failed before measuring; the successful
run used the authorized outside-sandbox GPU lane.

Round-4 final verification (2026-10-10):

- C3/C4: tested — final focused run passed 16 tests, 0 failures, 25,051 assertions across three files, including a nonempty inspected berth identity before its Full-retention assertion.
- C3/C4: tested — `npm test` ran once: 5,779 pass, 0 fail, 9,054,272 assertions across 320 files, 403.53 seconds. No source changed after this run.
- C4: tested — production build, strict typecheck, format, script lint, launcher wiring and diff whitespace checks passed.
- C3/C4: tested — the production Metal focused gate passed 1/1 in 60 seconds; all four untouched default/Auto checks and matching procedural-state comparisons passed. This remains partial browser coverage.

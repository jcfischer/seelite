# Longwall B implementation handoff — Codex

> **Design head only, down to "Required integration work and gates";
> superseded for production by node #815.** Those sections are the design
> PR's (#807) handoff as written, kept as the record of what was asked. What
> was built, and what still waits on the principal before merge, is
> **Integration result (node #815)** at the end of this file.

## Approved design

On 2026-10-08 the principal approved the visual prototype and requested: “Prepare PR for final implementation by another agent.” Earlier corrections are binding: sealed ore cassettes (no open lorries), articulated asteroid anchors and extending rotating cutter, approximately **84 m hull retained**, compact human-scale **closed** cockpit. Independent Dream Loop score reached **7.1/10 overall prototype fidelity** and the loop stopped as requested. Exact pixel/reference reproduction was separately judged about 6.1/10.

The current branch is `spike/longwall-mining-803`, worktree `.worktrees/seelite-803`, tracked prototype `spikes/longwall-miner/`, graph node [Prototype Longwall B with articulated asteroid mining equipment](https://github.com/jcfischer/seelite/issues/803). The node remains open for the next agent; do not close it through a PR keyword. This PR is a design handoff, not production-ready integration.

## Start here

1. Read repository `CLAUDE.md` and graph map 1 using `soma graph node 1 --repo jcfischer/seelite`. Recheck node 803 and neighboring ship integration work before editing. Coordinate with the approved Courier, Porter and Bollard studies rather than introducing another asset-loading or articulation convention.
2. Run the viewer at port 5213 as described in README. Inspect travel and mining poses, all preset views, and the smaller closed bridge. Final screenshots, independent review and hardware metrics are in `evidence/`.
3. `build_model.py` is the editable source. `longwall-miner.blend` is packed; GLB embeds paint and preserves named groups. No third-party model was downloaded. Asset provenance is in `assets.md`.
4. `kinematics.ts` owns the study's metre-scale anchor endpoints, elbows, cutter feed and inclined rock contact surface. `viewer.ts` maps these onto named groups. `model.test.ts` checks actual export hierarchy, geometry/material sanity and watertight combined bridge shell/glazing. Keep that closure test when modifying the cockpit.

## What is implemented

- Three sealed inline ore cassettes, industrial spine, twin outboard aft drives and underslung rotary cutter with enclosed transfer duct.
- Four articulated shoulder/elbow/foot assemblies with telescopic housings and sliding rods. Feet adapt to the fixture's inclined surface. Independent anchor deployment, cutter extension and rotor controls; stow/mining presets.
- Compact two-seat pressure bridge with continuous shell/glazing boundary. It replaces the earlier open, oversized glazing.
- Isolated browser inspection, full orbit, PNG export, reference modal, lit asteroid fixture, capture script, editable assets and reproduction commands.

## Decisions still needed before integration

- **Asset pipeline:** map 1 retains procedural production assets; authored model exceptions here are for isolated studies. Verify any newer principal-approved shared ship pipeline before promoting GLB/textures into production. This approval does not silently amend that policy.
- **Cargo/scale:** exported skip shells total 3,141.66 m³ gross. A volume-only estimate using 60–70% usable volume and assumed 1.5–2 t/m³ bulk density gives 2,827–4,398 t. Production `HULL_SPECS.miner.holdT` is 40 t. Principal chose 84 m and smaller cockpit, not new economic or handling statistics. Resolve scale/capacity deliberately; do not silently change the economy or price curve.
- **Mining scope:** this is a kinematic visual rig, not extraction gameplay. No rock strength, breakage, resource accounting, attachment constraints, spin matching, recoil, collision-safe unfolding, capacity limits or failure handling exist. Clarify/graph any gameplay scope before implementing it.
- **Performance/representation:** model has 283,528 triangles and 107 meshes, 455 reported draw calls across passes in the study. Not suitable evidence for thousands of live traffic ships. Establish shared LOD/instancing/material batching and when articulation animates. Preserve visible silhouette and anchor/cutter roles.
- **Fit/units:** prototype uses metres, +Z forward, Y up. Production uses kilometres and established orientation/berth envelopes. Reconcile static and deployed bounds, attachment points, vent positions, collision proxy and docking clearance. Do not globally rescale production units.

## Required integration work and gates

Adopt the approved design into the shared ship builder/loader convention, preserving the production Longwall B identity. Keep distinct stowed and mining envelopes; bind independent mechanism transforms to an explicit state model. The design viewer intentionally permits arbitrary combinations for inspection and must not become the gameplay state machine.

Add headless tests for arithmetic/state changes and browser checks for rendered/animated behavior. Run the mandatory probe selector against the real integration diff before browser probes, use the canonical runner, and satisfy the full delivery gates before merge. Current study controls, topology and capture evidence do not verify flight gameplay or production performance. Run Sage against the final implementation head. Seek any additional principal decision required by changed behavior or policy, then verify exact-head CI/review before merge.

Make every node transition through `soma graph`; PR references use `Refs #803`. The principal's visual approval covers this design study, not an unknown future implementation.

## Integration result (node #815): for the principal

Built on this branch: `miner/b` is Longwall B in the game, flown and drawn
from `src/models/longwall-miner.glb` (`README.md`, "In the game"). Refs
#803; design PR #807 is superseded by node #815's.

**The boot-set breach is waived until #838 lands.** Map #1's Constraint
(#830, #835, 2026-10-09) lets only the cockpit and the home station's
exterior load before a `Game` is built; this branch also loads the miner
model on every path that builds a `Game` except the postcard, as node
#815's body prescribed before the Constraint was amended, so every game boot
waits on about 11.13 MiB more (D4). The principal waived that on node #838
(2026-10-09,
[comment](https://github.com/jcfischer/seelite/issues/838#issuecomment-6080935296)):
the miner may block boot until #838 lands, and #838 inherits moving it out
of the boot set and giving `miner/b` a stand-in.

**The merge still waits on your yes after flying it (third tier, below);
nothing here claims it has been given.**

What moved, and what is yours to decide:

- **D1, mass, not changed and owed a ruling.** 215 t in the new 84.5 x 34.1
  x 18.8 m envelope (declared over the 84.4 x 34.0 x 18.8 m model; README's
  Fit line says where each 0.1 m comes from) is 3.97 t per 1000 m³ against the roster's 1.2–2.4 band (about
  65–130 t for this box). `tests/hull.test.ts` holds the miner as a pinned
  exemption, red the day either figure moves. Thrust, hold (40 t), integrity,
  price, tank and charge are untouched, so is the 2.8–4.4 kt cargo question.
- **D2, handling moved; the rates by #181's length law, the flown figures
  by three inputs nothing separates.** Re-deriving vents off a new mesh is
  the repo's rule (#619, #636), and it changed two things: the length and
  box the law reads, and the vent placement measured on the new mesh (every
  family's row moved in `src/hull.ts`: the roll pair z 0.75 → 0.925 and
  port/starboard 0.9975 → 0.97, pitch aft 0.9975 → 0.905, yaw y 0.125 → 0,
  retro x 0.4225 → 0.5, strafe z 0.22 → 0.25, as fractions of the box). The
  composed rates below follow the law by construction, because the shares
  are re-solved to it against the new arms; the longer hull turns slower.
  Before → after: angular authority 1.103 → 1.021; pitch/yaw cap
  19.0 → 17.5 °/s; roll cap 29.5 → 27.3 °/s; damping 0.76 → 0.82 s; NPC
  avoidance horizon 22.3 → 23.1 s (the 3,000 km scan covers it at up to
  129 km/s; `tests/combat-enemy-avoidance.test.ts` holds it at 100 km/s,
  against a fastest body of 86.7). Linear acceleration is unchanged. The docking computer's first
  roll-tracking failure is 7.0 rpm (was 5.5); the miner is still the worst
  hull, now 2.17x the fastest station
  (`evidence/hull-docking-round8.txt` is the run that prints both, at a
  clean committed head; `-round5.txt` was taken on an uncommitted tree and
  every row of it reprints unchanged). Three Traffic launch-aperture touches,
  all miners, are gone from system 0's pinned corpus row. Those last two are
  flown figures, and the length, the box and the moved vents all changed
  under them at once: nothing here attributes either to one of the three.
- **D3, wrecks.** A derelict miner is dark and untorn: #735's tear cuts a
  loft's grid and this model has none.
- **D4, cost, a detail band, a hull batch and two distance LODs.** Every game boot
  downloads 11.13 MiB more: the three required models are about 20.5 MiB
  before play, up from about 9.4: **until node #838 lands, the miner model
  blocks boot.** Map #1's Constraint (#830, #835, 2026-10-09) puts only the
  cockpit and the home station's exterior in the boot set and installs every
  other model after boot behind a procedural stand-in; that mechanism is
  #838's (open, blocked by #831), and you waived the breach until it lands
  (above). The gap #838 inherits: `miner/b` has no
  procedural stand-in today — `buildShipMesh` throws without the model,
  because the envelope, vents and muzzles are measured off it. The levels
  are made from the model too, so they cannot stand in before it loads.
  `evidence/game-report.json` measured one miner at 111 draw calls and
  283,590 triangles a frame up close; it was captured at 644bb13, before the
  batch below, and not retaken. Counted as meshes rather than draws, the
  miner was 109 then and is 44 now, against the loft's 38 meshes and 12,028
  triangles (`miner/b` at main bd09ae5, `evidence/loft-baseline.txt`); no
  draw figure was taken for the loft. The batch moved no triangle: the
  report's 283,576 mesh triangles are today's `full`. Traffic miners share one template's buffers but not its draws.
  The template now merges the static hull's opaque, unlit meshes into one
  per material (19 hull meshes to 10), and each stowed anchor's 19 painted
  meshes into one per paint (sage round 8: 20 meshes an anchor to 6, its lamp
  kept, its six part groups still named for a node that poses them), so a
  miner is 44 meshes where it was 109. The detail band switches the model
  the way it switches node #812's courier: `src/authored-levels.ts` makes two
  reduced copies at install with meshoptimizer, and the band draws one level
  at a time. Since #828 merged, one band mechanism serves both hulls; the
  miner's own mechanism shedding, its box outline and its hull-only
  simplifier are gone. `tests/longwall-mesh.test.ts` holds each figure:

  | Level | Drawn for | Meshes | Triangles |
  |---|---|---:|---:|
  | full | your own miner inside 40 radii (about 1.7 km) | 44 | 283,576 |
  | `reduced`, medium | every other miner inside 400 radii, however near; your own from 40 | 44 | 22,778 |
  | `outline` | every miner past 400 radii (about 17 km) | 10 | 592 |

  Each row counts the two drive glows; those are mesh counts, not measured
  draws. **A Traffic miner is the medium level even beside a berth**, by your
  ruling of 2026-10-09: sage round 9 found every Traffic miner at a berth
  drew the full model. Your own hull passes `own` to `updateShipVisuals` and
  draws the model near. The medium level is made to half a device pixel at
  10 miner reaches (0.135 m, `LONGWALL_MEDIUM_RADII`), the outline to half a
  pixel at 400 radii (5.4 m). That is meshoptimizer's own metric, not a
  bound, so it was measured in space (sampled on every triangle, pinned):
  the medium surface lies within 0.23 m of the model's, and the model's
  furthest point from it is **0.99 m**, 7.3 times the target. 83,855 of the
  model's 482,918 vertices lie further than 0.135 m. For a bay neighbour
  100 m off, 2.4 reaches, the target is about 1.2 px and that worst point
  about 9 px; how it reads there is yours to judge in flight. Every lamp is
  kept whole in every level (528 triangles), because an emissive reads far
  beyond its size. The miner's levels collapse edges across seams
  (`permissive`): without it the painted hull barely reduced (`pale-steel-0`
  kept all 32,860 triangles). A level takes no ray and every measurement
  skips it, so the envelope, vents and muzzles are measured on the model.
  Levels are made in the browser rather than shipped as LOD GLBs (#829's
  way), so the download does not grow; the price is CPU at every boot,
  inside `installLongwallModel`. The whole install, decode included, took
  613 ms under bun, never measured in a browser. `meshoptimizer` (MIT) ships
  in the game bundle since #828. A level casts a shadow only where the
  occlusion marking sets it, as the courier's do; only the flown hull and
  the fleet review are marked, so a Traffic miner casts none. No frame was
  captured at the medium or outline level, so nobody has looked at either.
- **D5, owed their own nodes:** mining state and behaviour, the deployed
  envelope, articulating the anchors and the cutter (the game draws the
  stowed export, static), and D1–D4's follow-ups.
- **D6, the asset policy: the file is allowed, its place in the boot set is
  not.** Map #1's Constraints were amended on 2026-10-09 (#830, #835), and
  the amendment says two things. Authored models are same-origin bundle
  files, so shipping `src/models/longwall-miner.glb` is within it;
  earlier rounds of this handoff quoted "Procedural everything: no
  downloaded assets" as standing, and it no longer is. And only the boot set
  blocks a start, which this branch does not meet: the miner is awaited on
  every path that builds a `Game` except the postcard, whose wait the
  Constraint allows (D4, and the ruling at the top of this section).
- **Stale text outside this branch:** map #1's Constraints still read
  "(5.5, the miner, since #619 …)"; `docs/specs/docking.md` §4 is updated.
- **Fit.** The ship's origin is now the box's centre (the export's was 4.8 m
  forward). Berth fit is the loft's: every trade, shipyard and refinery berth,
  no outpost berth. The miner no longer overhangs a slot berth cell.
- **Third tier.** No canonical view frames a miner, so the sheet cannot judge
  this hull. `evidence/game-astern.png`, `-quarter`, `-beam` and `-bow` are
  the frames to review before flying it; the yes is yours. They were
  captured at 644bb13, before sage round 1, with `game-report.json` beside
  them; later rounds changed the template, the batch among them, and none
  was retaken. All four are close range, at `full`: no frame shows a miner
  in either far band.
- **Probes.** The selector chose all 97 (a measurement script counts as shared
  infrastructure). Twelve were run alone on the GPU lane and passed: boot,
  model-viewer, ship-visuals, postcard, derelict, shipyard, vent-display,
  station-route-traffic, traffic-continuity, docking-traffic, carrier-scan,
  state-gallery. Those twelve runs left no committed transcript;
  `evidence/pr-probes.txt` is the design head's run, not this branch's. After sage round 1's detail band, ship-visuals, model-viewer,
  boot, traffic-continuity and derelict were run alone on the GPU lane and
  passed; `evidence/integration-probes.txt` is that transcript. None of the
  five asserts the miner's band (`probe-ship-visuals` does not name the
  miner); `tests/longwall-mesh.test.ts` does, headless. Round 2's hull batch
  had no browser run of its own until sage round 4: after round 4's outline
  stand-in (head 2825677, the batch under it) the same five were run alone
  again on the GPU lane and passed, under a peak load of 41–64 on 10 cores
  from outside work; `evidence/integration-probes-round4.txt` is that
  transcript. None of the five frames a miner past 400 radii either, so the
  stand-in is held headless too. After sage round 5's simplified hull and
  shadow shedding (head 72e9dcf) the same five and `probe-occlusion` were
  run alone on the GPU lane and passed (`evidence/integration-probes-round5.txt`);
  none frames a miner between 40 and 400 radii, so the reduced hull is held
  headless as well. After sage round 8's anchor batch and atomic install
  (head a670cad) the same six were run alone on the GPU lane and passed, under a
  peak load of 45–89 on 10 cores from outside work
  (`evidence/integration-probes-round8.txt`); the selector chose the whole
  suite, because the round moved two helpers into `scripts/lib/`. The full
  run is the supervisor's.

**Field Notes (major: a rebuilt ship a returning player sees), approved by
the principal on 2026-10-09 with the flight, and in `src/changelog.ts`:**

> The miner has a new hull: the Longwall, an 84-metre mining ship with three
> sealed ore cassettes, a two-seat bridge, four folded asteroid anchors and a
> cutter on an extending boom.

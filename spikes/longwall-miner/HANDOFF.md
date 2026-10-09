# Longwall B implementation handoff — Codex

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

Keep graph lifecycle through `soma graph`; PR references use `Refs #803`. The principal's visual approval covers this design study, not an unknown future implementation.

## Integration result (node #815): for the principal

Built on this branch: `miner/b` is Longwall B in the game, flown and drawn
from `public/models/longwall-miner.glb` (`README.md`, "In the game"). Refs
#803; design PR #807 is superseded by node #815's. What moved, and what is
yours to decide:

- **D1, mass, not changed and owed a ruling.** 215 t in the new 84.5 x 34.1
  x 18.8 m box is 3.97 t per 1000 m³ against the roster's 1.2–2.4 band (about
  65–130 t for this box). `tests/hull.test.ts` holds the miner as a pinned
  exemption, red the day either figure moves. Thrust, hold (40 t), integrity,
  price, tank and charge are untouched, so is the 2.8–4.4 kt cargo question.
- **D2, handling moved, by #181's length law and nothing else.** Re-deriving
  vents off a new mesh is the repo's rule (#619, #636); the longer hull turns
  slower. Before → after: angular authority 1.103 → 1.021; pitch/yaw cap
  19.0 → 17.5 °/s; roll cap 29.5 → 27.3 °/s; damping 0.76 → 0.82 s; NPC
  avoidance horizon 22.3 → 23.1 s (the 3,000 km scan still covers it at
  130 km/s). Linear acceleration is unchanged. The docking computer's first
  roll-tracking failure is 7.0 rpm (was 5.5); the miner is still the worst
  hull, now 2.17x the fastest station. Three Traffic launch-aperture touches,
  all miners, are gone from system 0's pinned corpus row.
- **D3, wrecks.** A derelict miner is dark and untorn: #735's tear cuts a
  loft's grid and this model has none.
- **D4, cost, no LOD.** Every game boot downloads 11.13 MiB more: the three
  required models are about 20.5 MiB before play, up from about 9.4. One miner
  draws 111 calls and 283,590 triangles a frame, against 38 meshes and about
  12k triangles for the loft; Traffic miners share one template's buffers but
  not its draws. A shared LOD or batching pass is owed its own node; the named
  mechanism groups are kept for articulation, which is what stops a cheap
  merge.
- **D5, owed their own nodes:** mining state and behaviour, the deployed
  envelope, articulating the anchors and the cutter (the game draws the
  stowed export, static), and D1–D4's follow-ups.
- **Stale text outside this branch:** map #1's Constraints still read
  "(5.5, the miner, since #619 …)"; `docs/specs/docking.md` §4 is updated.
- **Fit.** The ship's origin is now the box's centre (the export's was 4.8 m
  forward). Berth fit is the loft's: every trade, shipyard and refinery berth,
  no outpost berth. The miner no longer overhangs a slot berth cell.
- **Third tier.** No canonical view frames a miner, so the sheet cannot judge
  this hull. `evidence/game-astern.png`, `-quarter`, `-beam` and `-bow` are
  the frames to review before flying it; the yes is yours.
- **Probes.** The selector chose all 97 (a measurement script counts as shared
  infrastructure). Twelve were run alone on the GPU lane and passed: boot,
  model-viewer, ship-visuals, postcard, derelict, shipyard, vent-display,
  station-route-traffic, traffic-continuity, docking-traffic, carrier-scan,
  state-gallery. The full run is the supervisor's.

**Field Notes, proposed copy (major: a rebuilt ship a returning player
sees), for your approval before it lands in `src/changelog.ts`:**

> Mining ships are rebuilt: a long ore hauler with three sealed cassettes on
> its spine, a compact two-seat bridge, folded asteroid anchors and a rotary
> cutter under the bow.

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
from `public/models/longwall-miner.glb` (`README.md`, "In the game"). Refs
#803; design PR #807 is superseded by node #815's.

**Before merge, a ruling only you can give: as built, this branch breaches
map #1's boot-set Constraint.** That Constraint (#830, #835, 2026-10-09)
lets only the cockpit and the home station's exterior load before a `Game`
is built; every other model installs after boot behind a procedural
stand-in. This branch also loads the miner model on every path that builds
a `Game` except the postcard, whose wait the Constraint allows, as node
#815's body prescribed before the Constraint was amended, so every game boot
waits on about 11.13 MiB more (D4). The stand-in and the after-boot install
are node #838's mechanism (open, blocked by #831), and `miner/b` has none
today. There are two ways out, and neither is this branch's to take:

1. **Waive the Constraint for the miner until #838 lands**, recorded on node
   #815 or #838, and #838 takes `miner/b`'s stand-in into its queue; or
2. **Hold this merge until #838 has landed**, and rebase this branch onto
   its queue so the miner installs after boot.

**The merge also waits on your yes after flying it (third tier, below);
nothing here claims either has been given.**

What moved, and what is yours to decide:

- **D1, mass, not changed and owed a ruling.** 215 t in the new 84.5 x 34.1
  x 18.8 m box is 3.97 t per 1000 m³ against the roster's 1.2–2.4 band (about
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
  avoidance horizon 22.3 → 23.1 s (the 3,000 km scan still covers it at
  130 km/s). Linear acceleration is unchanged. The docking computer's first
  roll-tracking failure is 7.0 rpm (was 5.5); the miner is still the worst
  hull, now 2.17x the fastest station. Three Traffic launch-aperture touches,
  all miners, are gone from system 0's pinned corpus row. Those last two are
  flown figures, and the length, the box and the moved vents all changed
  under them at once: nothing here attributes either to one of the three.
- **D3, wrecks.** A derelict miner is dark and untorn: #735's tear cuts a
  loft's grid and this model has none.
- **D4, cost, a detail band and a hull batch but no LOD.** Every game boot
  downloads 11.13 MiB more: the three required models are about 20.5 MiB
  before play, up from about 9.4: **until node #838 lands, the miner model
  blocks boot.** Map #1's Constraint (#830, #835, 2026-10-09) puts only the
  cockpit and the home station's exterior in the boot set and installs every
  other model after boot behind a procedural stand-in; that mechanism is
  #838's (open, blocked by #831), so sage rounds 2 to 4's background-load
  finding is escalated to you rather than fixed here (the ruling above). The gap #838 inherits: `miner/b` has no
  procedural stand-in today — `buildShipMesh` throws without the model,
  because the envelope, vents and muzzles are measured off it. Round 4's
  far-range boxes are measured off the model too, so they cannot stand in
  before it loads.
  `evidence/game-report.json` measured one miner at 111 draw calls and
  283,590 triangles a frame up close, against 38 meshes and about 12k
  triangles for the loft; that capture predates the batch below and was not
  retaken. Traffic miners share one template's buffers but not its draws.
  The template now merges the static hull's opaque, unlit meshes into one
  per material (19 hull meshes to 10), so a miner is 100 meshes where it was
  109; the anchors are 80 of those and keep their separate parts. The shared
  detail band sheds the mechanism by distance, never by quality: past 40
  radii (about 1.7 km) the anchors' metal, leaving 24 meshes and 261,768
  triangles; past 400 (about 17 km, where the hull is 3.9 px) the cutter's
  too, and the hull's metal gives way to one mesh of 17 boxes, one per part
  it drew, built the first time a miner gets that far (sage round 4),
  leaving 10 meshes and 780 triangles. Every lamp stays
  (`tests/longwall-mesh.test.ts` holds each figure). Those are mesh counts:
  draw calls also count shadow and other passes, and no draw figure was
  measured with the band or the batch. Inside 400 radii the hull's own ~250k
  triangles still draw; a real LOD between the bands is what a shared LOD
  node owes, as is a lighter boot download. The anchors going at
  40 radii is a visible change, 9.4 x 3.3 px on a 39 px hull at the band's
  edge, and yours to judge with the rest. So is the swap at 400 radii: the
  hull there is flat-faced boxes in one paint (`dark-structure`, the metal
  on most of it) where it was the model's own shape in all its paints, on a
  hull about 4 px long. No frame was captured at that range, so nobody has
  looked at it.
- **D5, owed their own nodes:** mining state and behaviour, the deployed
  envelope, articulating the anchors and the cutter (the game draws the
  stowed export, static), and D1–D4's follow-ups.
- **D6, the asset policy: the file is allowed, its place in the boot set is
  not.** Map #1's Constraints were amended on 2026-10-09 (#830, #835), and
  the amendment says two things. Authored models are same-origin bundle
  files, so shipping `public/models/longwall-miner.glb` is within it;
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
  the frames to review before flying it; the yes is yours.
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
  stand-in is held headless too. The full run is the supervisor's.

**Field Notes, proposed copy (major: a rebuilt ship a returning player
sees), for your approval before it lands in `src/changelog.ts`:**

> Mining ships are rebuilt: a long ore hauler with three sealed cassettes on
> its spine, a compact two-seat bridge, folded asteroid anchors and a rotary
> cutter under the bow.

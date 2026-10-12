---
task: Three approved industrial shipyard model studies
project: Seelite shipyard visual prototype
effort: E3
phase: complete
progress: 11/11
---

## Problem
Three approved image designs need editable geometry and real browser inspection. Earlier images had side-facing docking ports relative to the capsule rotation axis.

## Vision
A coherent family of weathered working shipyards: exposed gantry assembly line, enclosed twin-hall foundry, open crescent slipway. Capsules visibly rotate around the approach axis.

## Out of Scope
Production replacement, simulation integration, collision proxies, deployment and merge. Fidelity work stops at independent 7/10 for each model; principal retains visual acceptance.

## Constraints
New branch and isolated worktree; preserve unrelated primary-checkout changes. Authored Blender and generated textures follow the approved earlier visual studies. Each capsule rotates independently; entrance, drum and rear bearing are coaxial. Runtime remains an isolated viewer.

## Goal
Three editable textured models, an interactive browser viewer, live evidence and independent fidelity scores of at least 7/10 each.

## Checkpoints
- [x] C1: O1 Gantry receives independent score >=7/10 against target-o1.png.
- [x] C2: O2 Hangar receives independent score >=7/10 against target-o2.png.
- [x] C3: O3 Slipway receives independent score >=7/10 against target-o3.png.
- [x] C4: Rotating capsule docking centres stay fixed and axial throat rays remain unobstructed.
- [x] C5: Viewer selection, orbit, zoom, presets, rotation, target and export pass hardware browser exercise.
- [x] C6: Anti: Changes remain isolated to this prototype and branch; production game entry points remain unchanged.
- [x] C7: Antecedent: Every model has editable source, generated textured surfaces and live multi-angle evidence.
- [x] C8: Gantry and Hangar tools use rigid guided manipulators and positive ship restraints, with no gravity-dependent hanging hoists.
- [x] C9: Every capsule has a continuous enclosed access spine from the main station to its rear axial rotary connection.

- [x] C10: Slipway capsule sits above the arc apex, faces upward and rotates around the vertical docking axis.
- [x] C11: All three stations expose a tooling animation toggle with attached articulated arms, bounded carriage travel and stationary hull restraints.

## Features
P1 shared Blender detail kit and axial capsule -> C4/C6/C7. P2 three yard assemblies with independent review iterations -> C1/C2/C3. P3 inspection viewer and capture/verification instrument -> C4/C5/C7.

## Test Strategy
Exported GLB hierarchy and geometry tests first. Browser raycasts through docking throat and full-spin centre checks. Guarded GPU capture, browser control exercises and measured cadence. Independent judge uses composition /3, lighting /3, materials /3, detail /1. No agent substitutes for principal visual approval.

## Decisions
User approved all v2 image targets and stopped fidelity work at 7/10. Blender installed; Fal credentials absent. Initial Bollard texture was replaced by a cleaner generated paint albedo following visual review; geometry is newly authored. Shared capsule kit, distinct work structures.

Principal correction during live viewing: zero gravity invalidates hanging crane hoists. Use guided robotic tooling and clamped workpieces. Truss-only hub supports do not provide worker access; each needs an enclosed pressure spine and central rotary passage. These mechanical corrections supersede literal matching of those features in the generated targets.

Principal additionally requested Slipway docking above or below the arc apex, facing up or down; implemented above, facing up. Latest request adds slow articulated tool and rail-carriage animation controlled separately from capsule spin.

## Changelog
Initial isolated prototype scaffold. Completeness checked: all E3 sections, stable C1-C7, anti-criterion and experiential antecedent present.

## Verification
C1: independent round7 O1 score 7.1/10. C2: independent round8 O2 score 7.0/10. C3: independent round7 O3 score 7.0/10. Stopped further visual polish on each passing model.

C4/C9/C10: exported hierarchy and axis tests, throat raycasts at five roll angles, static geometry sampled against the complete capsule sweep, and multi-angle access-spine captures. No clearance violations; maximum centre drift under 0.000004 viewer units (export precision). Upward Slipway port and rear enclosed spine verified.

C5/C11: GPU browser exercises passed model selection, orbit, zoom, seven presets, tooling motion and pause on each station, capsule rotation, work lights, target dialog and PNG export. Three unit tests / 150 assertions pass; strict viewer TypeScript passes. Final warm capture FPS about 50/56/60 on Apple M1 Pro. These are prototype measurements, not a production performance budget or collision-planned robot simulation.

C6: branch spike/shipyard-models-800, isolated .worktrees/seelite-800. Only spikes/shipyards, VSA.md and scoped ignore/LFS metadata changed; no production game integration, merge or deployment.

C7/C8: editable Blender scenes, GLBs, generated albedo, authored tooling rig and provenance present. Final seven-view captures, exact independent reviews, geometry/control metrics and artifact hashes are in spikes/shipyards/evidence.

Principal visual acceptance remains separate from the independent score. On 2026-10-08 the principal approved the final Coriolis-style models and requested a committed PR with an integration handoff; see spikes/shipyards/HANDOFF.md. Production integration remains outside this prototype.

## Follow-up: capital ship scale
Principal replaced the enlarged illustrative Porter with a current capital ship. The viewer now builds Carrier A from the unchanged current game source at 100 view units/km, consistently across all three stations. Browser-measured dimensions are 379.6 m long, 176.4 m wide and 144.915 m high, matching its catalogue envelope within 0.1 m. Round `carrier-scale` passed all three dimension checks, docking geometry, tooling motion/pause and viewer controls; no browser errors. Strict TypeScript passed. The earlier visual scores remain the station-design checkpoint before this explicit vessel substitution.

## Follow-up: Coriolis visual family
Principal requested Coriolis textures and shape language. Reused its approved original gritty albedo and material parameters from 30781f3, made larger flatter armor districts within dark edges, added service channels and three-tier docking surrounds, and changed cold fixtures to restrained warm lights. Layouts, actual Carrier A dimensions, axial hubs, enclosed routes and articulated tools remain. Independent review scored O1 8.2, O2 8.1, O3 8.0 and explicitly recommended stopping; no further visual changes. All 150 model assertions, hardware geometry/scale/animation/control checks and strict viewer TypeScript pass. The new Style reference control opens the actual Coriolis hero image. Evidence is in spikes/shipyards/evidence/coriolis-style; reference images and provenance are in references/.

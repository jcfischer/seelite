---
task: Four approved refinery model studies
effort: E3
phase: verify
progress: 9/9
---

## Problem
Four approved images have no editable refinery counterparts. Existing procedural forms establish identity but not the approved detail level.

## Vision
Each refinery reads as a worked asteroid carrying believable industrial equipment. The viewer makes their distinct form, docking approach and machinery easy to inspect.

## Out of Scope
- Production replacement, collision/berth certification and flight integration.
- Merge, deployment and a general asset policy change.
- Refinement beyond the requested independent 7/10 threshold.

## Constraints
- New branch spike/refinery-models-804 and isolated worktree seelite-804.
- O1 excludes the digger. Approved O2–O4 remain the design targets.
- Editable Blender source, generated textures and same-origin GLB viewer.

## Goal
All four models reach independently judged 7/10 visual fidelity. Stop at this visual checkpoint with inspectable assets and verification evidence.

## Checkpoints
- [x] ISC-1: O1 independent visual score >=7.
- [x] ISC-2: O2 independent visual score >=7.
- [x] ISC-3: O3 independent visual score >=7.
- [x] ISC-4: O4 independent visual score >=7.
- [x] ISC-5: Four editable Blender and textured GLB exports exist.
- [x] ISC-6: Exported geometry approach-ray tests pass.
- [x] ISC-7: Hardware viewer controls pass.
- [x] ISC-8: Anti: production game modules unchanged; O1 has no digger.
- [x] ISC-9: Antecedent: each model is compared to its copied approved image.

## Test Strategy
Fresh independent judge compares matching live and target images with the dream-loop 3/3/3/1 rubric. Exported triangle tests examine actual approach clearance; hardware capture checks orbit, zoom, presets, target, lighting, rotation and PNG export.

## Features
- Shared authored material and plant vocabulary: ISC-5,6.
- Four rock-dominant compositions: ISC-1,2,3,4,8,9.
- Isolated inspection viewer and capture: ISC-7.

## Decisions
2026-10-08: Principal requested all four with 7/10 stop. Blender/model/texture prototype follows the explicitly invoked dream-loop and existing authored-model pipeline.
Fal credentials absent; use Blender and generated surface texture. Nine criteria are intentionally below the E3 soft floor: four independent visual gates and five artifact/control/scope gates cover this bounded prototype without redundant checks.

## Verification
Final: Warren round 6, Collar round 3b, Spar and Works round 5 each scored 7/10
independently and were frozen. See evidence/review-round-3.md, -5.md and -6.md.
Four geometry tests pass with 210 assertions. Hardware controls pass across all
four models with no browser errors; observed viewer cadence 47–59 FPS.
Production build passed. Selected repository browser run passed 8/8 in 127 seconds,
partial coverage only.

Principal visually approved all four on 2026-10-09: "looks good". Graph node 804
stays open for the receiving agent to finish delivery. Deliberate
prototype limitations include simplified machinery, rock treatment and docking
details, documented in each independent review. No production integration.

2026-10-09 handoff: principal requested a PR for another agent to finish and
explicitly requested no tests or Sage during wrap-up. Existing verification above
predates this handoff; no fresh verification or Sage approval is claimed.

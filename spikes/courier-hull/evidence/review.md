# Courier O4 refinement — Codex, 2026-10-08

The principal liked the direction and requested one more round, specifically reporting see-through hulls from the rear.

## Repair

The nacelles had no aft caps. The main body's decorative plates were separated by seams without a continuous backing; its isolated rear cap did not form a closed, consistently oriented volume. The body and both nacelles now have independent closed backing meshes. The body backing includes a depressed well below the canopy so the closure does not cover the cockpit equipment.

The stern now has armoured access panels, a central louvred heat outlet, amber service lamps and pipework. Each engine nozzle has a machined annular lip, recessed throat, radial ribs and an opaque back. The nose chamfer is bounded by local hull depth to prevent crossed faces at the narrow tip. Panel bevels, the more consistent slate finish and softer reflections continue the selected O4 direction. <!-- glossary-ignore: throat -->

During this round the principal identified floating dorsal housings and clarified that they should lie flush, angled with the hull. The four raised blocks and navigation blister were replaced by shallow access covers sampled along the deck's longitudinal pitch and transverse crown. Seams, latch bars, fasteners and small service lamps remain; no mounting pedestals were retained.

## Verification

- `bun test spikes/courier-hull/model.test.ts`: 2 tests, 3473 assertions passed. The exported GLB's three backing meshes have exactly two oppositely directed uses of every edge and positive signed volume. Every access-cover vertex raycasts onto the hull below it, with vertical clearance below 0.25 m. Texture, dimensions and triangle budget also pass.
- Strict standalone viewer TypeScript check passed.
- Production build passed; prototype remains outside production build entries.
- Repository selector at geometry commit `0856987` selected chase-orbit, model-viewer and pointer-lock. Canonical `probe:pr` passed all 3 on hardware in 72 seconds. This is a selected partial run, not the full 96-probe suite. Selection and runner receipts are preserved alongside this review.
- `blender-rear-round7.png`: CPU Blender inspection, not a browser screenshot. Independent review confirms opaque rear surfaces on both nacelles and the central hull, with no visible background leak. The spaces below/outside the engine supports are intentional exterior gaps.
- Hardware browser captures: ANGLE Metal / Apple M1 Pro, 1586×992 at DPR 1. No browser errors. Orbit, presets, target dialog, work lights, rotation and PNG export passed. Short observed cadence 59.66 FPS, 314,292 model triangles, 18 meshes. This is a vsync-limited inspection sample, not a production flight benchmark.
- `hero.png`, `rear.png`, `rear-level.png`, `rear-low.png`, `top.png`, `detail.png` and `viewer.png` are live browser captures of the final flush-cover revision. `metrics.json` is the capture receipt.

Independent live review: **6.0/10**, up from 5.5. Composition 2.4/3, lighting 1.3/3, materials 1.7/3, detail 0.6/1. Both requested defects pass visually: opaque backs on the two nacelles and main body, and deck-conforming covers without floating blocks. Nose-side triangular artifacts seen in the earlier CPU preview are absent. The original approximate 6.5 target is not claimed achieved; this delivers the principal's requested additional round and subsequent flush-cover correction.

Remaining fidelity gaps: harsh white shoulder highlights, broad flat plating and boxy engine supports, sparse cockpit equipment, and nacelles less curved than the target. Principal visual acceptance of this pass remains pending.

## Scope

This is a visual prototype, not a production hull replacement. The cockpit remains simplified. Gameplay dimensions, interior fit, collisions, LOD and flight performance are not established by these images or the topology test.

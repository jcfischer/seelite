# Node #1057 — Assembly authored blocks, Phase 1 rework

## Current result

**Ready for the supervisor to submit as `ranger:needs-eye`.** Phase 2 has not
started; the principal's new visual yes is required. The worker commits only.
The supervisor posts renders, sets the label, uploads LFS and pushes.
No graph operation, PR, Sage review, close checkpoint or merge is claimed.

[Four-seed comparison sheet](../../spikes/stations/assembly-kit/evidence/index.html):
40 hardware frames, procedural/authored pairs. Click through for 1440 × 900.
Each joint row names its pair and records both cells and camera coordinates.

## Contract, provenance and scope

Read docs/model-integration-sop.md first. The principal approved the first
spike's joints on 2026-10-20 and rejected its primitive, untextured look.
The rework follows the approved station pipeline in build_model.py,
final_shapes.py and geometry.py, with assembly.blend and target-assembly.png
as the visual reference.

HUB, NODE and TUBE are authored in Blender with industrial-surface.png,
individually seated plates, edge wear, fasteners, service trunks, vents,
machinery recesses and bounded warm lamps. TUBE rotates 90° for TUBE_Y.
HUB_STATIC is the separate bearing member. The single editable kit source,
blocks.blend, packs the texture. build_kit.py is Blender's authoring entry
point, explicitly requested; it adds no Python game or test dependency.

The Assembly builder, WFC vocabulary, placements, seed derivation, cell pitch,
station geometry, aperture and berth catalogue are unchanged. The existing
spike seam and capture harness are retained, with corrected joint selection.
All production files stay unchanged. Trusses, radiators, tanks, dishes,
interior and aperture fittings still come from the actual procedural Assembly.
This study does not meet src/changelog.ts's major player-visible change rule.

## Asset and geometry preflight

Authoring uses the reference pipeline's 10 m units, exporting kilometres;
+Z is the docking axis. Cells stay at (dx × 0.2, dy × 0.2, 0).
Tube/junction ends stay at ±100 m. Export snaps their known socket datum to
float32 ±0.1 km: Blender otherwise undershoots by about 6 micrometres, enough
to miss the exact-plane ray. The two collar rings retain the approved centre
radii and 2 m minor radius. Unused NODE sockets remain closed.

The hub retains its 204 m body radius and aperture at z = 428 m. The cell is
its placement pitch, not a new envelope. Face detailing is recessed behind
the mouth; the rectangular opening includes its corner rays. Only the hub
spins, with static bearings and neighbours, as in the inherited spike.

blocks.glb: **13,808,236 bytes**, SHA-256
17431602723f3caf6a5eb0c50d1e8a9696c4133ac1f5a8591e4c20e5ef16d611.
blocks.blend SHA-256: e599190181a7fefe62fa21a84d82a60903def767e250d834e1ee02a3ee8ac906.

No simplifier, Draco or quantization is applied. Blender exports float32
geometry; no source-to-export losslessness or byte-identical rebuild is
claimed. asset.json pins the measured export and source. The embedded image
hashes identically to industrial-surface.png. Emissives stay below
EMISSIVE_CEILING. Every study binary stays in Git LFS; no exemption added.
The study does not enter the production bundle.

## Reproduction and test seam

    bun spikes/stations/assembly-kit/prepare.ts
    bun test tests/assembly-kit-spike.test.ts spikes/stations/assembly-kit/model.test.ts
    npx tsc --noEmit --project spikes/stations/assembly-kit/tsconfig.json
    SEELITE_PROBE_RENDERER=hardware node spikes/stations/assembly-kit/capture.mjs

Set BLENDER to override the macOS executable. Preparation runs Blender in the
foreground, makes Python exceptions fail, exports the packed source and GLB,
and checks the node's 25,000,000-byte bound.

The seven asset-backed rows live beside the study and run explicitly on a
host with hydrated LFS objects. They read the Blender export instead of
regenerating the rejected TypeScript primitives. For headless GLTFLoader,
only material texture links are removed; a separate row first checks the
unmodified embedded image and emissives. Geometry is never changed by tests.

Rows retain NODE–TUBE rays on both axes at 98/100/102 m, seeded plan equality,
separate spinner/static bearings, instance transforms, ≤1 km vertex reach,
and aperture/corridor checks at 0°, 45° and 90°. They assert 28 authored
instance batches across all four seeds. Two normal-suite rows check actual
neighbour selection and refusal of unspecified capture seeds without requiring
CI to hydrate study assets. No asset row silently skips or widens a threshold.

## Hardware render evidence

Headed ANGLE Metal, Apple M1 Pro, 1440 × 900, pixel ratio 1. Studio rig unchanged:
ACES 1.12, room environment 0.36, key 4.5, fill 1.1, rim 1.0. No bloom, shadows
or game backdrop. The foreground harness owns its Vite server, checks the tree,
holds the probe lock, verifies hardware and closes browser/server. Chromium
initially failed in the restricted sandbox; the authorized host run succeeded.

| Seed | Joint row |
|---|---|
| 0 | NODE–TUBE_X |
| 1 | HUB–TUBE_X |
| 47 | NODE–TRUSS_Y (authored–procedural) |
| 1234 | NODE–TUBE_Y |

Opened all four authored joint PNGs, an overview and the quarter-turn hub at
full resolution. Collars meet and the truss reaches its junction socket;
texture, wear and machinery are visible. This is not the principal's approval.

[metrics.json](../../spikes/stations/assembly-kit/evidence/metrics.json) holds
time, base revision, authoring/harness checksums, asset/source hashes, plans,
instance cells, phases, camera poses and renderer counters. Current evidence
supersedes the directory's first-spike images, preserved at commit 8cbf221.

Whole-scene overview submissions from renderer.info.render:

| Seed | Procedural calls | Spike calls | Procedural triangles | Spike triangles |
|---|---:|---:|---:|---:|
| 0 | 258 | 252 | 77,496 | 361,456 |
| 1 | 243 | 250 | 61,672 | 247,064 |
| 47 | 260 | 253 | 99,864 | 383,680 |
| 1234 | 257 | 251 | 78,744 | 416,192 |

This is a detailed study, not a production performance policy. Authored parts
are instanced per block/material; the remaining scene is procedural. Detail
increases triangles and can increase calls. No frame-time or speedup claim.
Full-kit batching, LOD, loading/failure, fitted proxies, lifecycle and production
cost remain Phase 2 work.

## Delivery checks

Scoped checks: seven asset rows plus two camera rows pass, 168 assertions.
Root and spike typechecks, build and check-dist-sizes.mjs dist pass.
Once-only final host npm test: **6,762 pass, 0 fail**, 397 files,
10,615,634 assertions, 949.79 seconds; exit 0. RTK printed a failure heading
for a passing failureKind row containing the word FAIL; Bun reported zero failures.

The mandatory selector was inspected before capture. The inherited spike
paths lack a production dependency owner, selecting all 112 probes. The worker
contract explicitly forbids the full browser suite here: only the affected
spike capture ran; the supervisor owns the final browser gate. No probe:pr or
full browser pass is claimed. Canonical in-game before/after, principal flight
yes and cp-trade-d-authored-kit remain Phase 2/close gates. This deliverable
is solely the reworked Phase 1 look/joint submission.

## Historical first spike — 2026-10-20, superseded

Commit 8cbf221 used Three.js primitives, flat materials and no texture.
Its 1,451,156-byte GLB hash was
b079b3b41711206bb3cc2ccb980ed891df135c9292abf397a433a06b50e9b320.
Six tests / 119 assertions passed, with 20 authored instance batches.
For seeds 0/1/47/1234, overview calls were 244/242/245/243 and triangles
114,188/82,892/136,412/125,132. The camera picked the same NODE each seed.
The principal approved joints and rejected the bland appearance. The former
receipt's preference for a cleaner finish is superseded by this rework.

The first spike recorded one full host run: 6,766 pass, 0 fail, 397 files,
10,615,735 assertions in 1,157.83 seconds. That is historical evidence, not
the rework run.

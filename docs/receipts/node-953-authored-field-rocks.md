# Authored field rocks: prototype receipt

## Current result

Sixteen Blender-authored rock archetypes, each with three levels, share baked albedo and normal maps. The representative model, both material candidates and its LODs were accepted by the principal in the interactive viewer on 2026-10-13. The principal requested the cheaper material and a slightly lower viewer exposure: Lambert diffuse and exposure 0.85 are selected. Station rocks are excluded.

The source and viewer live in `spikes/asteroid-rocks-953/`. The prototype extends the existing geometry/LOD fixtures from nodes 948 and 950. It does not register generated fields or models in production. The final field appearance, arrangement and bidirectional transition gallery remain node 952's approval.

## Asset and geometry preflight

- Rebuild: `Blender -b --python spikes/asteroid-rocks-953/build_model.py -- --count 16`.
- Runtime: one GLB, **19,567,976 bytes**; shared 2048 × 2048 albedo and tangent-normal maps. Source PNGs and the editable Blender file are review/source artifacts, not imported by the production bundle.
- GLB SHA-256: `0622d06b78601aae32b7d6f414d0c1eebfb29e2a79a200e370529008f084cd1c`.
- Unit bounding radius, with all three levels of an archetype normalized together. Runtime instances multiply by `radiusKm`; no station dimensions or collision proxies are changed.
- `assets.test.ts` decodes the shipping GLB with NodeIO and checks all 48 meshes, the exact manifest triangle counts, normal lengths, finite/repeating UVs, one material with both maps, radius bounds and the repository's 25 MiB file-size guard threshold.
- The export contains one UV set. A regression check rejects the old unused UV layer and checks the intended repeated coverage. This caught the initial texture-stretching export defect.
- The Blender source is validated before saving; image paths are relative. The exporter no longer reports invalid meshes.
- No geometry compression or quantization claim. Shader normals use Three's stock batching/tangent-normal path. The old per-fragment procedural rock surface is absent from the authored arm.

## Runtime and performance evidence

Fixture: real Game near scene, fingerprint world `0x5ee11e`, galaxy 0, system 173, field-00, 210 moving rocks; 1440 × 900 at device scale 2, chase camera, held world clock. Field motion advances for every measured frame. Renderer asserted as ANGLE Metal, Apple M1 Pro.

The node-950 method is retained: 12 shuffled blocks × 120 frames, drained readback, medians and pairwise separation, shadow/AO both off and on, high and low quality. Each view is compared with no field and the procedural K=16 arm. Added safety: the machine-wide GPU lock, start/end load reporting and disabled development hot reload.

Two complete runs (`measure-run1.txt`, shuffle 20261013; `measure-run2.txt`, shuffle 7):

| View | High worst delta, run 1 / 2 | Low worst delta, run 1 / 2 |
| --- | ---: | ---: |
| Close | +0.279 / +0.292 ms | +0.275 / +0.397 ms |
| Inside | +0.275 / +0.170 ms | +0.191 / +0.188 ms |
| Edge | +0.279 / +0.250 ms | +0.180 / +0.161 ms |
| Far | +0.120 / +0.126 ms | +0.147 / +0.121 ms |

These are maxima over the two occlusion settings, not totals or FPS. Both runs pass the ruled limits of +1.0 ms high and +0.4 ms low. Draw-call increments are at most 5 high and 3 low. Low's worst measured result has only 0.003 ms margin; these samples do not establish reliable headroom under arbitrary host load.

The same-asset Standard material comparison (`measure-standard-material.txt`, close view, 6 blocks × 60 frames) measured +0.486 / +0.454 ms high with occlusion off/on, versus Lambert's worst close result of +0.292 ms across the complete runs. Low measured +0.185 / +0.273 ms and overlaps Lambert's range. This supports choosing Lambert for its lower measured high-quality cost; it does not establish a uniform advantage in every setting.

The initial full-set run was stopped after observing host load 111.20 / 79.06 / 67.11. Its apparent close/shadow overrun did not reproduce in the close-only repeat or the first complete rerun. `measure-loaded-partial.txt` is explicitly inconclusive; `measure-close-repeat.txt` preserves the narrower repeat. The successful complete run also occurred under elevated host load (recorded in the log), so it is evidence for those recorded conditions, not an unloaded hardware guarantee.

The study loader runs after boot and reports fetch, decode and geometry preparation separately. In `measure-cold-install.txt`, local fetch took 67.5 ms, decode 110.4 ms and geometry preparation 8.6 ms. Batch creation took 5.3 ms high / 3.3 ms low. The first visible frame, including upload, shader compilation and drawing, took 70 ms; the next two took 14.9 and 15.4 ms. This separate cold measurement is not a steady-state budget result and shows that production integration must stage installation away from a visible gameplay frame. Local fetch timing is not a deployed-network measurement.

## Integration boundary

The production field slice still owes procedural fallback during background install, failed-load behavior, jump-safe ownership, postcard settlement and disposal/rebuild checks through the current shared loader. This prototype proves asset geometry and the two-batch render path in the real scene; it does not claim those production lifecycle paths.

## Delivery evidence

- Target and representative/LOD approval: live principal exchange, recorded on the graph node. This does not substitute for node 952's field-gallery approval.
- Viewer: sixteen entries, near/far switching and renderer exposure 0.85 verified in headed Chromium.
- Asset checks (277,984 assertions), standalone TypeScript check and production build passed. The build initially lacked the worktree-local ONNX dependency path; linking the existing installed package resolved it without source changes. No production source or Vite entry changes.
- PR, Sage, repository-selected browser gate, production integration and deployment: pending. No full-suite pass is claimed.

# Coriolis spike — constraint review

Authority: live machine map jcfischer/seelite#1, read 2026-10-08. Prototype tracked as #790 under the earlier station-form prototype #56; root #1 refused a further direct child (100-child limit). Source worktree begins at 53be4f7.

- Browser Three.js static rendering; same-origin files only.
- Cuboctahedral Coriolis identity; production core radius 0.6 km, display envelope 0.62 km.
- Production trade aperture is 0.12 x 0.07 km at +Z=0.428 km. The opening must be cut through the hull. No surface may obstruct it or the forward approach.
- Fixtures must physically meet the surface, including triangle faces. No floating kit.
- Existing map normally requires procedural assets/textures, no paid services, no Python. Principal explicitly allows Blender authoring for this spike; authored model and generated textures were subsequently explicitly authorized for this spike.
- Visual acceptance remains the principal's decision. A Dream Loop judge score is additional evidence, not acceptance of a production default.

Baseline: view-set/finishes/coriolis-baseline, recorded with ANGLE Metal / Apple M1 Pro.

Principal clarification, 2026-10-08: "Yes—allow model and texture files for this spike." This authorizes the local Blender GLB and generated image material maps for #790; it does not amend the production map's asset policy.

Principal scope expansion, 2026-10-08: "actually - I want a PR where the new model replaces the current coriolis model". This authorizes the reviewed authored model and embedded texture as the default trade-A Coriolis in the proposed PR, including game, postcards and model viewer. It supersedes the earlier spike-only boundary for this asset; other station forms and the general procedural policy remain as before. Merge remains a separate decision.

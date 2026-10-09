# Approved courier hull: integration handoff — Codex

## Approval and scope

On 2026-10-08 the principal approved the final flagship study: “Approved. Commit and prepare PR for handoff to agent that will actually integrate and deploy”. The approved visual checkpoint is commit `720c928`, with captures and the 7.3/10 independent comparison in [flagship-pass-19](evidence/flagship-pass-19/review.md). Subsequent handoff commits do not change the model. This is principal visual acceptance of the study, not evidence that gameplay integration or deployment has passed.

> **Superseded by node #812.** This handoff was written for the design PR (#805), which preserved the approved assets and review tools under `spikes/courier-hull/` and changed nothing in production. Node #812's integration merges that branch and does change production: the courier's hull (`src/courier-hull.ts`, `src/ship-mesh.ts`), its declared envelope, vent placement and vent shares (`src/hull.ts`), and every boot path that builds a Game (`src/main.ts`). What it did, and what it measured, is [the node #812 receipt](../../docs/receipts/node-812-courier-hull.md). The text below is the handoff as written.

The design PR preserved the approved assets and review tools under `spikes/courier-hull/`. It changed no production rendering entry, save data, hull gameplay specification or deployment configuration, and had no player-visible changelog entry. Integration and deployment belonged to the receiving agent; merge readiness was not to be inferred from this approval. Track progress through [node 795](https://github.com/jcfischer/seelite/issues/795) and the repository SOP.

## Start here

- [README](README.md): viewer, rebuild and inspection commands.
- [assets.md](assets.md): O4 target prompt, generated-texture provenance and original cockpit snapshot hash.
- [build_model.py](build_model.py), [adapt_cockpit.py](adapt_cockpit.py): authoritative authoring and cockpit adaptation. Keep the unchanged source cockpit snapshot for reproducibility.
- [courier-hull.blend](courier-hull.blend) and [courier-hull.glb](courier-hull.glb): approved editable and exported geometry. The GLB is 30,766,660 bytes, 353,954 triangles and 36 meshes; it is a study export, not an optimized shipping asset.
- [model.test.ts](model.test.ts): closure/winding, canopy envelope, pilot bounds, textures and overall envelope checks. It is outside the default `npm test` path; run it explicitly.
- [capture.mjs](capture.mjs): hardware capture, served-worktree check and shared GPU lock. Final images and browser metrics are under [flagship-pass-19](evidence/flagship-pass-19/). Earlier evidence directories are historical.

The local review URL is `http://127.0.0.1:5197/spikes/courier-hull/`. Use Overview, Cockpit and Interior, then inspect rear/underside and both sides. This server is local session state, not a published preview.

## Preserve the principal's decisions

O4 combines the long tapered O3 hull with O2 industrial detailing. Preserve the accepted silhouette, closed stern/body/nacelles, seated but slightly raised handled hatches, all six cockpit-side and two aft grilles aligned to their local skins, visible seated pilot, and simplified interior derived from the real courier cockpit. Deck ducts, valve guards and vent rails have supports. Do not reintroduce floating blocks or see-through backing shells when optimizing.

## Integration seams and unresolved work

1. **Coordinate and size contract.** This study is metres, Y up, **+Z forward**, exported with `export_yup=False`. Production `src/ship-mesh.ts` is kilometres, **-Z forward**. A Y half-turn plus metre-to-kilometre conversion is the starting transform, not a completed fit. Full study bounds are about 55.520 × 10.110 × 60.953 m. Resolve anchor, intended courier variant, cockpit eye, muzzle/thrust mounts and berth/collision envelope against the current production authorities. Do not silently change gameplay dimensions, capacity or flight performance to make the visual fit.
2. **The live cabin already exists.** Main includes [PR 794](https://github.com/jcfischer/seelite/pull/794), which supersedes the paused cockpit PR 793. Inspect `src/cockpit-model.ts`, `src/cabin-pass.ts`, `src/cockpit-surface.ts` and live screen mounting in `src/main.ts`. The cabin uses its own scaled camera-relative pass and pilot frame. This exterior's fitted interior is a reduced derivative, not a drop-in replacement for that first-person system. Its nonuniform equipment fit and seat fit are in `adapt_cockpit.py`; do not reuse its coordinates blindly for the flight camera.
3. **Static screens are fixtures.** `cockpit-instruments.ts` draws four static study displays. Exported faces are named `interior-screen-*`; the original cockpit names are `screen-*`. Do not ship fixture navigation/flight values as live instruments. Reconcile exterior visibility, live cockpit screens and first-person pilot visibility without rendering two overlapping cabins. Production currently leaves its systems screen unpowered because there is no live source.
4. **Prepare a shipping asset.** Follow the current authored-model load/retry and shared GPU teardown patterns. `spikes/courier-cockpit/prepare-game-asset.mjs` is an existing Meshopt preparation example, not an instruction to copy its settings without measuring. Preserve material tints (already patched into this GLB), UVs, named screen faces and `KHR_materials_specular` for the canopy. Measure draw calls, memory, download size, LOD/instancing and startup/failure behavior for player and NPC use. Keep Blender sources, targets and historical captures out of `public/`; PR 796 established that boundary for Coriolis.
5. **Lighting is part of the approved appearance.** `viewer.ts` includes its own area/key/fill lights, environment, local practicals, SSAO and bloom. They are not baked into the GLB. Integrate with the game's light/exposure/quality policy and verify the resulting appearance in flight; copying study light intensities across metre/kilometre frames is not valid. The isolated viewer's short 43 FPS capture is not a production performance budget.
6. **Verify all consuming views.** Reconcile chase/outside orbit, model viewer, postcards, NPC hulls, docking/berth selection, gun and engine attachments, first-person cabin and quality tiers. Use headless geometric/transform tests plus hardware browser probes and the canonical view set. The study checks prove backing shell closure and a canopy envelope, not full equipment collision, ergonomics, berth clearance or flight correctness.
7. **Complete production delivery.** Read the live machine map and CLAUDE.md; claim the appropriate integration node, select affected probes before running them, finish required browser coverage and Sage review sequentially, obtain in-game visual approval and approved changelog copy as required, then follow merge/deployment gates and verify the deployed asset and behavior. This handoff does not claim those gates passed.

## Verification state at handoff

The final model's exported-geometry checks and hardware viewer controls passed. Exact results and limitations are in [the final visual receipt](evidence/flagship-pass-19/review.md). Main at `30781f3` was merged into this handoff branch cleanly after approval; that brought the live cockpit integration and review-asset deployment cleanup into the branch without modifying this model. See the PR for refreshed handoff checks, CI status and pending production review gates.

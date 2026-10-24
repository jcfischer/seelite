# Integration handoff — seven accepted ships

Lance production integration follows [node #1034's receipt](../../docs/receipts/node-1034-lance-interceptor.md).
Its current loading, shipping and level policy supersedes the corresponding
historical handoff steps below for the interceptor only.

Author: Codex. Updated 2026-10-09. Design [PR #829](https://github.com/jcfischer/seelite/pull/829), branch `design/seven-ships-codex`, study [node #827](https://github.com/jcfischer/seelite/issues/827). Verified implementation checkpoint: `e96d393`.

## Start here

The principal accepted all seven designs, requested only that Bastion's open stern be closed, and asked for two distance LODs per ship. Those changes are complete. The latest instruction is to hand this PR to another agent for game integration. **Do not resume aesthetic redesign.** Bastion's forward bay intentionally remains open; its aft bulkhead is now closed.

These are isolated studies, not production replacements. Start an integration branch/worktree against current main and bring this design branch into it so the editable artifacts follow. Use a separate integration PR referencing this draft; if it supersedes the draft, say so explicitly and avoid merging the studies twice. Follow the repository's squash-merge convention and obtain approval before merging.

Read `CLAUDE.md`, machine map #1, the integration node and live loader contracts first. Previous ship/station integrations provide the production pattern. The requested courier LOD example is [node #812](https://github.com/jcfischer/seelite/issues/812) / [PR #828](https://github.com/jcfischer/seelite/pull/828), inspected at `74f21128f0d5cfdf56a85edace8ade7844cc9e13`. [Node #838](https://github.com/jcfischer/seelite/issues/838) is the separate background model queue, not a PR; on 2026-10-09 it was open and blocked by #831. Re-read its state before adopting loading behavior.

## Assets and inspection

| Code | Role directory | Ship |
| --- | --- | --- |
| F1 | interceptor | Lance |
| F2 | patrol | Warden |
| F3 | explorer | Pilgrim |
| F4 | raider | Shiv |
| F5 | carrier | Bastion |
| F6 | prospector | Sluice |
| F7 | dreadnought | Rampart |

Every role contains packed editable `model.blend`, full `model.glb`, `model-reduced.glb`, `model-outline.glb`, approved `target.png`, and measured `model-report.json` / `lod-report.json`. The LOD report fingerprints its full source. Keep source assets and evidence under this spike; put only game-loaded shipping assets under `public/models/`, following the current asset preparation pipeline.

- [README.md](README.md): viewer and Blender authoring commands.
- [LOD.md](LOD.md): generation commands, triangle/file budgets, reference method and transition measurements.
- [LOD gallery](review/lods.html): all three levels, including Bastion's rear.
- [Target comparison gallery](review/index.html): targets and actual renders.
- [REVIEW-codex.md](REVIEW-codex.md): Sage findings and dispositions.
- [STATUS.md](STATUS.md): historical iterations and independent scores.

Run the root Vite dev server and open `/spikes/seven-ships/?ship=carrier`. The viewer supports forced Full / Reduced / Outline, Auto, medium/far distances and habitat rotation. Its normalized inspection scale is not the exported physical scale.

## Settled constraints

- Exports use **metres, Y up, +Z forward**. Apply one consistent transform to full and both LODs, their origins and rotor pivots. The game uses kilometres and -Z forward: verify the current loader before applying 0.001 scaling and a Y half-turn, so neither happens twice. Centre all levels using the full model's centre.
- Warden and Shiv weapons/grilles now have hull supports. Preserve them. Bastion's command glazing belongs on its bridge; do not restore deck cockpit fairings. Preserve its articulated bay and closed stern.
- Pilgrim has an **80 m walking-floor diameter at 3 RPM**, giving **0.40257 g**. Bastion and Rampart each have a **180 m floor diameter at 2.5 RPM**, giving **0.629012 g**. Capital outer envelopes are approximately 189.492 m across. Keep rotating assemblies separate from stationary structure.
- Preserve those ring dimensions and rates. Shrinking a capital to old roster bounds changes its gravity; reconcile any roster/berth conflict explicitly. Visual dimensions do not authorize changes to mass, handling, cargo capacity or economy.
- Advance one habitat phase per ship and apply it to every level. Switching must not reset rotation. Full capital meshes have **1.558017 m** conservative triangle-surface radial clearance. `authoredVertexGapMetres` is only a vertex diagnostic; simplified geometry is not physical-clearance evidence.
- Full geometry remains authoritative for bounds, collision and mounting-point raycasts. LODs are display-only. Preserve painted components: aggressive pruning previously removed visible hull/ring skins.

## Remaining integration work

1. Inspect current `src/ship-mesh.ts`, `src/courier-hull.ts`, ship definitions and station fit contracts. Adopt the current ship/station installation and shipping-asset preparation pattern. Resolve dimensions against the approved habitats before changing envelopes.
2. Prepare compressed shipping assets for seven full models and fourteen LODs using the established Meshopt/texture pipeline. Record checksums, output bytes and decoded geometry budgets. Reuse the supplied LODs unless production measurements justify a change.
3. Install through the current loader/cache and background queue contract. Node #838 calls for cockpit/home-station-only blocking boot, background Traffic hulls, immediate jump arrivals with stand-ins, warning-once failures and session-retained decoded models. Do not add a competing queue or make all these large assets block boot. Coordinate with that node if it has not landed. Preserve postcard and probe readiness behavior.
4. Connect applicable consumers: player/chase and inspection views, Traffic, wrecks and postcards. Verify cockpit compatibility, nav lights, exhaust and weapon origins against the full hull. Share geometry/material/texture resources safely across instances and levels; disposing one ship must not break another.
5. Integrate apparent-size selection and hysteresis. The study uses 40/400 reference reaches at 60-degree vertical FOV and 1800 device-pixel height, adjusted for actual projection. Inspect transitions under the game camera and lighting before settling production bands. Render only one level and preserve ring phase.
6. Verify collision, docking/berth fit and moving ring envelopes. Measure actual multi-ship frame time, draw calls, memory and network/decoding cost. Isolated viewer FPS does not establish production performance.
7. Run required headless checks, repository probe selection against the integration diff, canonical browser verification and before/after view sets under the shared probe lock. Follow the live map's review requirements. Obtain principal in-game visual/flight approval before merge; study acceptance is already settled.

## Existing verification and limits

At the implementation checkpoint, **15 tests / 1,565 assertions** and strict standalone viewer TypeScript passed. Checks cover source fingerprints, finite geometry, reductions, aligned bounds, painted surface retention, rotor metadata, full capital triangle clearance and outward-facing stern coverage at all three levels.

All seven final hardware captures passed without browser errors: forced levels, exactly one visible level, both automatic transitions and return to full, plus synchronized habitat phases. All 21 close views and three Bastion rear views were captured; every final outline and Bastion's reduced/rear views were visually inspected. LOD 1 removes 81–87% of triangles; LOD 2 removes 86–90%. Shading and pixels change at transitions; LOD.md records measured limits.

Four repository-selected browser probes passed at `969c8e5` (chase-orbit, handoff, model-viewer, pointer-lock); 92 were not run. Later armor-retention changes have final study tests/captures. This is partial browser coverage, not a full-suite or production-integration pass.

Sage's last raw verdict at `a9d5e87` was **changes-requested**. Its genuine vertex-only clearance-test defect was fixed at `e96d393`; post-fix tests passed. Remaining glossary matches and optional suggestions are dispositioned in REVIEW-codex.md. There was no post-fix Sage rerun and no Sage approval is claimed.

Historical independent visual scores did not reach the nominal 8/10 target. The principal subsequently accepted the designs and completed stern/LOD work. Preserve both facts; historical scores are not a request for another redesign.

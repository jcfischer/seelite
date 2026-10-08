# Approved shipyards: implementation and integration handoff

## Start here

The principal approved the final Coriolis-style models on 2026-10-08 and asked for this committed PR handoff. Visual exploration is complete; finish production implementation and integration in a subsequent task. Do not restart design exploration or chase further fidelity. No merge or deployment is authorized by this handoff alone.

Work is on `spike/shipyard-models-800`, isolated in `.worktrees/seelite-800`. Earlier commits are `318760e` (models/viewer) and `3bd6efa` (actual Carrier scale); the following commit contains the approved Coriolis finish and this handoff. [Node 800](https://github.com/jcfischer/seelite/issues/800) owns the prototype checkpoint, not production integration. Read the live machine map #1 and claim the appropriate integration node through `soma graph` before extending scope.

Read [README.md](README.md) for reproduction, controls and evidence, [assets.md](assets.md) for provenance, [visual review](evidence/coriolis-style/visual-review.md), [metrics](evidence/coriolis-style/metrics.json), and [VSA](../../VSA.md). The final independent scores are 8.2/8.1/8.0; the requested stop was 7/10. Principal approval is now explicit. Historical target and earlier capture files document superseded stages.

## Preserve these decisions

| Study | Intended existing form | Approved identity |
| --- | --- | --- |
| O1 | shipyard a | Gantry Works, open assembly structure |
| O2 | shipyard b | Foundry Hangar, twin enclosed halls |
| O3 | shipyard c | Crescent Slipway, open semicircle |

Verify the live form catalogue before wiring the mapping. All three remain in play. Use the original gritty Coriolis surface and palette; the cleaner earlier paint remains provenance only. Robotic tools use rigid joints/rails and stationary positive hull restraints in zero gravity. Every rotating capsule has enclosed access from the main structure through its rear axial bearing. Slipway's capsule is above the arc apex, docking upward relative to the ring. Rotation stays coaxial with the port.

The reference vessel is the current game Carrier A (`buildShipMesh("carrier", "a")`), approximately 379.7 × 176.4 × 145 m, identically scaled in every yard. Do not enlarge it per scene. It is a viewer fixture, not a simulation actor; production must decide whether a serviced vessel is an actual actor or a decorative prop. Capitals do not become eligible for capsule docking because they appear in the yard.

## What exists, and what does not

Editable `.blend`, exported `.glb`, deterministic Blender source, textures, joint hierarchy, viewer and prototype tests are complete. No production station builder, simulation geometry, collision proxy, LOD, game asset loader or flight integration has changed. Current GLBs are review assets (~55/80/34 MiB); they are not deployment-ready flight assets.

Author units are 10 m. Exported GLB coordinates are **metres**, Y up. Viewer scale is **0.1**, while the game needs **0.001** to convert metres to kilometres. Do not copy the viewer scale into flight. Carrier geometry starts in kilometres and uses 100 viewer units/km.

The `life-capsule` node rotates around local +Z. `docking-centre` is its child at local `[0,0,96]` m; `bearing-centre` belongs to the static root. Articulated nodes follow `tool-N-carriage/shoulder/elbow/wrist`; metadata records motion amplitude/phase. Root extras include the enclosed crew route in author units. See the builder/tests for exact hierarchy rather than duplicating it in a second catalogue.

**Critical flight mismatch:** the display aperture is 102 × 66 m; production shipyard slot dimensions currently are 120 × 70 m. The model also has a display rear bulkhead at capsule-local Z = -27 m. Build a flight export with a correctly sized opening and remove that display closure before attaching the authoritative interior. Do not globally rescale the whole yard to fit the slot. Existing prototype rays establish a clear approach into the display throat, not a fly-through interior.

## Integration sequence

1. Update onto current `origin/main` before implementation. This branch predates merged Coriolis integration (#791) and its review-asset deployment fix (#796); main was `30781f3` when inspected. Study `src/coriolis-flight.ts` and `spikes/coriolis/prepare-flight-asset.mjs` on main. Reuse their asset preparation, shared-resource/disposal and startup loading patterns where appropriate, without assuming the industrial yards share Coriolis's single rigid spinner.
2. Define the physical station contract in its existing authority. `src/station.ts`, `src/docking.ts` (`ApertureFrame`), `src/station-interior.ts` and `src/station-proxy.ts` own simulation dimensions, frames, berths and collision. Align the exported capsule docking frame with the canonical production frame by an explicit rigid transform/re-rooting. Keep the static structure separate from the spinner. Preserve Slipway's upward port relative to its ring. A visual-only axis exception must not disagree with autopilot or traffic.
3. Add a flight export path to the authored source. Replace the display throat/cap with the real opening and catalogue-driven interior, verify berth fit inside the capsule through its full roll, and preserve the enclosed rear connection. Production interiors belong under the spinner. Decide and validate any required capsule geometry adjustment explicitly rather than moving simulation dimensions independently.
4. Implement the three `src/station-mesh.ts` builders/adapter and their silhouette/reach contract. Remove superseded procedural surfaces to avoid duplicate hulls/interiors. Integrate fixtures, strobes, names, windows and detail levels using established station interfaces. Decorative warm lights are not navigation-light authority.
5. Build matching static/rotating collision proxies and broadphase bounds. Include long yard extremities and rotating capsule clearance, and prove approach/departure corridors and traffic routes against the new structure. Do not derive authoritative physics from live Three.js positions.
6. Port optional tool motion from the viewer using the authoritative game clock and pause semantics. It is currently bounded illustrative motion, **not collision-planned repair behavior**. Preserve joint parentage and fixed clamps; account for instancing, shared materials/textures and disposal. Do not promise physical manipulation without implementing it.
7. Produce optimized runtime assets under `public/models/`, with compression/LOD and measured load/GPU budgets. Coriolis's preparation script verifies decoded attributes and texture pixels after compression; apply comparable checks. Keep Blender sources, targets, evidence and review textures in `spikes/`; do not regress #796 by copying review files into the deployment. Explicitly upload LFS objects before pushing (this repository installs no LFS pre-push hook).
8. Wire async loading/error/retry into every relevant game, postcard and workbench entry point using the current Coriolis integration as reference. Avoid constructing live game/save state before required assets load. Confirm fallback behavior deliberately.

## Verification and delivery gates

The current prototype passed 3 model tests / 150 assertions, strict standalone viewer TypeScript, hardware-browser controls/animation/pause, true Carrier dimensions, five-roll throat rays and sampled full capsule sweep checks. Final capture had no browser errors or static sweep violations; warm cadence was about 56/60/60 FPS on Apple M1 Pro. This is **prototype evidence**, not production correctness or a guaranteed performance budget.

For integration, start with meaningful tests around unit conversion, canonical aperture alignment, full-roll clearance, berth fit, collision proxies, reach and disposal. Relevant existing suites cover station meshes/forms/proxies/interiors, aperture fit, hull docking, docking and station collisions/traffic. Run the mandatory PR probe selector before browser probes, then its canonical selected runner. Exercise actual flight approach, docking, launch, traffic, collision and resource cycling in hardware Chromium; capture the canonical station views and get principal flight-view approval. Run required full delivery gates before merge. Keep browser suites and Sage sequential under the repo SOP.

This prototype has no shipped player behavior and no public changelog entry. The production integration will need the principal-approved changelog sentence required by the live map. Keep issue lifecycle on `soma graph`; do not use PR closing keywords to bypass its checkpoint.

## Suggested skills

- `orienteer`: inspect the live machine map and claim/resolve the production integration scope.
- `the-algorithm` / `VSA`: define and verify the integration contract without treating this visual prototype as finished flight behavior.
- `dream-loop`: only for visual regressions or necessary flight-adaptation review; preserve the already-approved style and stopping point.
- `handoff`: carry forward verified progress and remaining integration work if another session is needed.

## PR handoff status

Draft PR: https://github.com/jcfischer/seelite/pull/811. The principal explicitly stopped Sage review and assigned it to the next agent. No Sage approval exists: the configured Claude executable was missing, and the Codex retry was terminated on request. Resume review only in the next agent's task. The PR body carries the latest check status.

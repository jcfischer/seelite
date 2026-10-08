# Asset provenance — Codex

New shipyard geometry authored with Blender, following the approved Coriolis/Courier/Porter/Bollard prototype workflow. No external models downloaded. Fal credentials were absent; Blender was installed. Initial authoring helpers and viewer/capture scaffolding were adapted from the Bollard study in the sibling seelite-798 worktree, then extended for three station models and independent axial capsule rotation.

The approved image targets and exact edit prompts come from this conversation's O1/O2/O3 v2 selection, copied into `target-o1.png` through `target-o3.png` and `target-prompts.json`.

Round 1 reused the Bollard generated paint texture. Independent review found the result mottled and concrete-like at station scale. Round 2 uses `paint-clean.png`, generated with built-in imagegen on 2026-10-08. Exact prompt in `texture-prompt-v2.txt`. Generated source: `exec-88bb7f17-3c9b-4a56-add6-1bbb63529b5f.png`. The GLBs embed the albedo and the Blender files pack it. Material tints, roughness, metalness and structural wear are authored; the viewer reuses albedo for a subtle bump approximation.

This generated material and authored model exception is scoped to the visual study, as recorded in node 800. Production asset adoption remains separate.

The initial illustrative Porter reference has been removed following the principal's scale correction. The viewer now builds the current Carrier A directly from `src/ship-mesh.ts` and reads its envelope from `src/hull.ts`. Game mesh coordinates are kilometres; multiplying by 100 gives the same 0.1 view-units/metre scale as the station models. There is no yard-specific size adjustment. Current source matches the primary checkout at this correction.

# Asset provenance — Codex

New shipyard geometry authored with Blender, following the approved Coriolis/Courier/Porter/Bollard prototype workflow. No external models downloaded. Fal credentials were absent; Blender was installed. Initial authoring helpers and viewer/capture scaffolding were adapted from the Bollard study in the sibling seelite-798 worktree, then extended for three station models and independent axial capsule rotation.

The approved image targets and exact edit prompts come from this conversation's O1/O2/O3 v2 selection, copied into `target-o1.png` through `target-o3.png` and `target-prompts.json`.

Round 1 reused the Bollard generated paint texture. Independent review found the result mottled and concrete-like at station scale. Round 2 uses `paint-clean.png`, generated with built-in imagegen on 2026-10-08. Exact prompt in `texture-prompt-v2.txt`. Generated source: `exec-88bb7f17-3c9b-4a56-add6-1bbb63529b5f.png`. The GLBs embed the albedo and the Blender files pack it. Material tints, roughness, metalness and structural wear are authored; the viewer reuses albedo for a subtle bump approximation.

This generated material and authored model exception is scoped to the visual study, as recorded in node 800. Production asset adoption remains separate.

`reference-porter.glb` is copied from the contemporaneous approved Porter O2 study in `seelite-797/spikes/porter-hull/porter-hull.glb` (node 797). It is used only as an illustrative serviced vessel in the viewer, at different presentation scales in the three yards; its authoring source remains in that study. It is not merged into the shipyard geometry and is not a change to the in-game Porter.

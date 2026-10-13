# Refinery assets — Codex

Geometry is locally authored in Blender by `build_model.py` and `primitives.py`.
The authoring primitives and viewer setup derive from the concurrent local shipyard
study at node 800, itself based on the Porter/Bollard/Courier studies. No external
model was downloaded. Fal credential names were absent when checked.

The principal approved four image targets and explicitly requested their actual
design work in a new branch/worktree, stopping at visual fidelity 7/10. O1 uses
the revised target with its digger removed. Targets are generated design images,
not screenshots of the implemented models.

`paint-clean.png` is the shipyard study's initial generated albedo, retained as source.
Its inherited provenance is retained in `paint-provenance.md`; that document
describes the source lineage, not refinery geometry.

Round 3 switches to `paint-wear.png` from the Bollard node-798 study, also generated
with built-in imagegen. Its exact prompt is recorded in the inherited
`paint-provenance.md` under Active paint texture. It supplies larger localized
chips and scratches instead of the almost-clean first pass.

`rock-albedo.png` was generated with built-in imagegen on 2026-10-08.
Prompt: seamless square tileable base-color material scan of pale warm-grey
and limestone-beige fractured asteroid bedrock, angular mineral grains,
charcoal fissures, fine dust and subtle iron-brown streaks; orthographic,
uniform diffuse light, no objects, text, perspective, cast shadows or highlights.
It is a generated albedo, not a measured PBR set. The viewer derives modest
bump relief from albedo; larger fracture relief is geometry.

Source outputs are metres with Y up and +Z approach. The inspection viewer uses
a uniform 0.1 display scale. Dimensions are design-study dimensions, not
certified production docking/collision envelopes.

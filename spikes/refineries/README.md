# Refinery design studies — Codex

Four editable, textured refinery studies for graph node 804. O1 Warren has no
digger; O2 Collar, O3 Spar and O4 Works retain the approved design directions.
The requested stopping point is independent visual fidelity 7/10. These assets
are isolated from production station selection, collisions and flight docking.

## Inspect

From this worktree:

```sh
npm run dev -- --host 127.0.0.1 --port 5214 --strictPort
```

Open <http://127.0.0.1:5214/spikes/refineries/>. Select O1–O4, drag to orbit,
scroll to zoom, choose six camera presets, compare the approved target, toggle
work lights or rotation, and export a PNG. H hides the interface.

## Edit and rebuild

Each `.blend` is directly editable. `build_model.py` and `primitives.py` reproduce
the authored geometry with generated albedo textures. Rebuilding replaces the
corresponding Blender file and GLB, so preserve manual Blender edits separately.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  --python spikes/refineries/build_model.py -- o1 o2 o3 o4
bun test spikes/refineries/model.test.ts
MODELS=o1,o2,o3,o4 node spikes/refineries/capture.mjs review
```

Capture uses the repository hardware-browser helper and shared probe lock.
Source units are metres, Y is up and +Z is the docking approach; viewer scale
is 0.1. Texture lineage and generation prompts are in `assets.md` and
`paint-provenance.md`.

## Verification and limits

The four exported-geometry tests check 210 assertions, including actual triangle
clearance along a 5-by-3 grid through each approach. They also check embedded
textures, projected rock UVs, material assignment and bounded mesh counts.
They do not certify ship collision envelopes or berth integration.

Hardware viewer checks cover model loading, full orbit, zoom, camera presets,
targets, lighting, rotation and PNG export. No browser errors were observed;
round-5 cadence was approximately 47–59 FPS on an Apple M1 Pro. Production build
passed, as did strict standalone viewer TypeScript checking. The repository
selector's partial browser run passed 8/8; this is not full-suite evidence.

Independent visual verdicts and final screenshots are retained in `evidence/`.
Principal visual approval remains separate from these scores; node 804 stays
open at the prototype checkpoint.

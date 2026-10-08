# Coriolis industrial spike

Refs #790. Dream Loop Pro. An isolated model experiment inspired by Blade Runner, Alien and Elite Dangerous; starts from the existing Coriolis rather than a replacement station family.

Authority: machine map #1; related station-form prototype #56. See `.dream-loop/constraints.md` for this run's constraint audit and `.dream-loop/target.png` for the generated visual target.

Baseline captured on Apple M1 Pro / ANGLE Metal at 53be4f7. This is a prototype for visual review, with production integration requiring a separate decision.

Principal authorization: Blender-authored model and generated texture files are allowed for this spike (2026-10-08). That is a scoped exception; production asset policy is unchanged.

## Inspect and rebuild

From this worktree:

```sh
bun install
bun run dev -- --host 127.0.0.1
# Open /spikes/coriolis/
/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/coriolis/build_model.py
bun test tests/coriolis-spike.test.ts
node spikes/coriolis/capture.mjs review
```

The viewer supports full mouse orbit, zoom, pan, four viewpoints and comparison with the current procedural station. It does not construct the live simulation. `coriolis-industrial.blend` is the editable authoring artifact; `build_model.py` rebuilds it deterministically. The GLB embeds its generated albedo. Geometry is authored in metres on game XYZ axes, then scaled to kilometres in the viewer.

See [constraints.md](constraints.md) for the map audit and scoped asset exception. The exported mesh is checked against the actual production reach and aperture values, including double-sided ray tests near aperture edges. These are rendering-spike checks, not validation of live docking, collision or integration. The demonstration throat ends at +Z=0.230 km; production interior integration remains separate work.

Measured on Apple M1 Pro / ANGLE Metal at 1280×1280: approximately 60 FPS (display-vsync limited). No extrapolation to slower GPUs or whole-game performance. Current export has 14 material/text meshes; `.dream-loop/round-*/metrics.json` records actual triangles and pass-inclusive draw counts.

Dream Loop progression: 3.3 → 5.5 → 6.0 → 6.25 / 10 through round 5. The target is a generated rendering, not a screenshot of implemented game content. Visual acceptance and any production rollout remain open.

Latest export: 126,180 triangles, 14 meshes, maximum actual vertex reach 0.58037 km. TypeScript and three geometric tests (28 assertions) pass. Four hardware-rendered views, model comparison, camera presets and mouse orbit pass with no browser exceptions. The target threshold of 8/10 has not been met; this is an inspectable visual spike. See `evidence/` for the current screenshot, metrics and independent critique.

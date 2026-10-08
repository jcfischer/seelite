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

Dream Loop progression: 3.3 → 5.5 → 6.0 → 6.25 → 6.15 / 10 through round 6. The target is a generated rendering, not a screenshot of implemented game content. Visual acceptance and any production rollout remain open.

Latest export: 140,596 triangles, 14 meshes, maximum actual vertex reach 0.58037 km. TypeScript and three geometric tests (28 assertions) pass. Four hardware-rendered views, model comparison, camera presets and mouse orbit pass with no browser exceptions. The target threshold of 8/10 has not been met; this is an inspectable visual spike. See `evidence/` for the current screenshot, metrics and independent critique.

Round 6 is the principal-requested single refinement pass: wider varied roof utilities and antennae, supported side service booms, geometry-based paint chips and panel-edge fixings, and a subtler generated paint texture with lower roughness. The prior weathered appearance is retained in `evidence/before-refinement.png` and commit `e8406ff`. Principal review follows this pass irrespective of score.

Round 6 judge: silhouette and detail improved; cleaner paint regressed resemblance. Score 6.15/10, below the 8/10 target. The final export additionally seats roof modules and inspection hatches flush against their supports; final hardware captures are in `.dream-loop/round-6-final/`. No further visual pass was started after the requested one.

Principal correction after round 6: restore the previous gritty finish while retaining the new geometry. The active export again uses `industrial-surface.png` on armour, with the original 0.45 metalness and 0.66 roughness. Roof utilities, antennae, side booms and panel-edge hardware remain. The 6.15 judge score describes the cleaner round-6 image, not this restored-material export; no new resemblance score is claimed. Current verification captures: `.dream-loop/round-6-grit/`.


## Fly the station

The principal approved the exterior and requested a playable version. Run Vite in this worktree and open:

`/?boot=direct&seed=42&system=0&no-save&coriolis=industrial&coriolis-start=approach&fps`

This starts a temporary flight 1.8 km outside the Coriolis aperture, co-moving and facing it, with the station targeted and a docking computer fitted. Default keys: Shift/Ctrl throttle, WASD pitch/yaw, QE roll, C clearance, U docking computer, Enter launch/skip traversal. Existing Settings bindings still apply. Reload resets the trial; no Commander save store is attached.

Only trade form A uses the new exterior, behind `coriolis=industrial`. Other station forms and unflagged boots use the original builder. The model is loaded once per page and shared across system changes. It follows the simulation's normal station pose, spin and near/far scaling.

The flight GLB removes the viewer's closed display tunnel. A 38m collar joins the authored aperture to the production interior. The front bulkhead, lane lights, shell front and corner rails are recessed 30m behind the mouth to fit the new skin. Berths, traversal coordinates, docking checks and simulation collision proxies remain production values. Added exterior machinery is cosmetic under those existing proxies.

Re-export: `Blender --background --python spikes/coriolis/build_model.py -- --flight` (use your Blender executable path). `capture-flight.mjs` boots hardware Chromium, checks actual Shift-key flight, docks, launches, and confirms an ordinary boot makes zero industrial-asset requests. Its docking traversal is accelerated with simulation steps and the existing skip-traversal control; this is automated evidence, not a claim of a full manual playtest.

Verification: 6 headless tests / 72 assertions; TypeScript and production build pass; hardware browser flight/docking/launch pass without page exceptions or collision impacts. About 60 FPS on the M1 Pro at 1440×1000 during the approach. `flight-evidence/` contains screenshots and the run report. The required probe selector returned all probes because main.ts is shared runtime; the full PR delivery suite and Sage review have not run. This remains a local opt-in spike, not a production release.

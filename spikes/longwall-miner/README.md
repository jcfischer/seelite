# Longwall B — articulated mining study (Codex)

Refs jcfischer/seelite#803. Isolated Dream Loop design prototype of the selected Quarry Spine O4 and anchored mining O5. The principal selected an approximately 84 m hull with a smaller human-scale cockpit. This study does not change the production miner, ship statistics, flight, saves or traffic. Authored assets are scoped to this study, following Courier, Porter and Bollard prototypes.

## Inspect

Run `npm run dev -- --host 127.0.0.1 --port 5213 --strictPort` in this worktree. Open http://127.0.0.1:5213/spikes/longwall-miner/.

Drag to orbit in both axes, scroll to zoom, right-drag to pan. **Mining pose** deploys the four anchors, advances the cutter to the rock and starts rotation. **Stow** retracts everything. **Anchor struts**, **Cutter feed** and **Rotate cutter** are independent inspection controls; they deliberately allow intermediate combinations for design review. **Asteroid** toggles the fixture. Presets, work lights, reference image and PNG export are available. H hides the controls.

The four articulated booms have shoulder, elbow and foot transforms, armored telescoping housings and sliding rods. Their feet meet an inclined fixture face; the cutter has a separate linear feed and rotary head. A central enclosed duct carries ore toward three sealed cassettes. The bridge is a compact two-seat enclosure; a topology test checks its combined shell and glazing for boundary holes.

`longwall-miner.blend` is the editable metre-scale model; `build_model.py` authors it reproducibly. `longwall-miner.glb` embeds the generated paint texture and retains named mechanism groups. Runtime transforms are in `kinematics.ts` and `viewer.ts`. This is a visual kinematic study, not a force/torque solver, collision-safe deployment planner or mining gameplay implementation. The export is stowed; the viewer drives the mechanisms. The rock is an inspection fixture, not a simulated asteroid.

## Scale and cargo estimate

Captured stowed bounds: about **84.4 m long × 34 m wide × 18.8 m high**. Three exported skip backing meshes enclose **3,141.66 m³** externally. Allowing **60–70%** usable volume gives **1,885–2,199 m³**. Assuming **1.5–2 t/m³** broken-ore bulk density yields **2,827–4,398 tonnes**. These are explicit design assumptions, not measured ore properties or a certified payload. Hull strength, mass, thrust and handling are unverified. Production `HULL_SPECS.miner.holdT` remains **40 t**; reconciling that with this prototype is a later integration decision.

Reproduce the volume from exported geometry:

```sh
node spikes/longwall-miner/measure-capacity.mjs
```

## Build and verify

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/longwall-miner/build_model.py
bun test spikes/longwall-miner/*.test.ts
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --lib ES2022,DOM,DOM.Iterable spikes/longwall-miner/viewer.ts
node spikes/longwall-miner/capture.mjs round-N
```

Capture guards served-worktree identity, observes the shared probe lock and requires a hardware renderer. It exercises independent anchor/feed control, cutter rotation, stow, mining pose, orbit, target modal and PNG export; captures six travel views plus deployed, anchored, UI and narrow views; records browser errors and observed frame cadence. Timing applies only to this viewer. Vite can miss ignored-worktree source changes; restart this viewer server before collecting evidence after source edits.

Visual review evidence and remaining limitations belong in `evidence/review.md`. The requested stopping threshold is **7/10 independent visual fidelity**, reached at **7.1/10**, with principal visual acceptance distinct from that score. No merge or deployment is authorized by this design checkpoint.

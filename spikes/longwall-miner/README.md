# Longwall B — articulated mining study (Codex)

Refs jcfischer/seelite#803. Isolated Dream Loop design prototype of the selected Quarry Spine O4 and anchored mining O5. The principal selected an approximately 84 m hull with a smaller human-scale cockpit. It began as an isolated study that changed no production code. Node #815 then made it the game's `miner/b`, as #794 did with the courier cockpit: **In the game (node #815)**, below, says how, and `HANDOFF.md`'s integration result says what moved and what is the principal's to decide. Everything here except `public/models/longwall-miner.glb` stays review-only.

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

Principal visual approval: 2026-10-08, “approved. Prepare PR for final implementation by another agent”. See HANDOFF.md (parent directory from evidence) for binding decisions and outstanding integration work.

## In the game (node #815)

`miner/b` is this model. `prepare-flight-asset.mjs` writes the stowed export to
`public/models/longwall-miner.glb` (Meshopt, lossless WebP, every vertex
attribute, node transform to 10 µm and texture pixel verified after a decode;
11.13 MiB). Only that file ships; everything else here stays review-only.

```sh
node spikes/longwall-miner/prepare-flight-asset.mjs
node spikes/longwall-miner/capture-game.mjs round-N   # flown, chase view, 4 sides
```

- **Loading.** `src/longwall-model.ts` fetches it behind the Retry panel on
  every page that builds a ship (the game, the postcard viewer, the ship
  workbench); `tests/setup/longwall-model.ts` installs it under bun.
  `buildShipMesh("miner", "b")` throws until it is installed, because the
  envelope, collision box, vents and muzzles are measured off the drawn mesh.
- **Frame.** Turned half a turn about Y to the game's nose-at-minus-Z,
  kilometres, and centred on its own box, so a berth that places the ship's
  origin places the box (the export's origin was 4.8 m forward of it and
  would have parked 2.1 m into a slot berth's end wall).
- **Fit.** The envelope is the measured 84.5 x 34.1 x 18.8 m (rounded up to
  0.1 m); it fits every berth of trade, shipyard and refinery and none at an
  outpost, exactly as the loft did. The
  vent placement is re-measured on this mesh and every attitude share is
  re-solved against it to #181's law (roll 0.00674 → 0.00390, pitch
  0.00850 → 0.00793, yaw 0.01038 → 0.00838), so the composed turn rates
  follow the length: 7.5% slower than the loft (84.5 m against 78.2).
  Linear acceleration is unchanged. The docking computer's first
  roll-tracking failure moved from 5.5 to 7.0 rpm (`docs/specs/docking.md`
  §4); that is measured, and nothing here separates the length, the box and
  the moved vents as its cause.
- **Not changed.** Mass, thrust, hold (40 t), integrity and price. The 215 t
  now reads 3.97 t per 1000 m³ against the roster's 1.2–2.4 band; the miner
  is a pinned exemption in `tests/hull.test.ts` until the principal rules.
- **Stowed, static.** Nothing articulates the anchors or the cutter in the
  game; their named groups survive for whatever mining node poses them.
- **Cost.** One flown miner is 111 draw calls and 283,590 triangles a frame
  (`evidence/game-report.json`), against 66 calls for the rest of that frame;
  the loft it replaced was 38 meshes and about 12k triangles. Every Traffic
  miner clones the one template, so buffers are shared but draws are not.
  The detail band sheds the mechanism with range (`longwallMechanism` in
  `src/ship-mesh.ts`): from 40 radii (about 1.7 km) the anchors' metal goes,
  leaving 33 of 109 meshes and 261,768 of 283,576 triangles; from 400 radii
  (about 17 km) the cutter's goes too, leaving 26 and 253,400. Every lamp and
  the whole hull stay, and quality does not gate it. The hull's own triangles
  draw at any range; a real LOD is owed its own node.
- **Wrecks.** A derelict miner is dark and untorn: the tear cuts a loft's
  grid, and this model has none.

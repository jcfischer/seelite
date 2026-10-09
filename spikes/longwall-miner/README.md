# Longwall B — articulated mining study (Codex)

Refs jcfischer/seelite#803. Isolated Dream Loop design prototype of the selected Quarry Spine O4 and anchored mining O5. The principal selected an approximately 84 m hull with a smaller human-scale cockpit. It began as an isolated study that changed no production code. Node #815 then made it the game's `miner/b`, as #794 did with the courier cockpit: **In the game (node #815)**, below, says how, and `HANDOFF.md`'s integration result says what moved and what is the principal's to decide. Everything here stays review-only except `src/models/longwall-miner.glb`, which ships, and the script and source export that build it (`prepare-flight-asset.mjs`, below).

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

Visual review evidence and remaining limitations belong in `evidence/review.md`. The requested stopping threshold is **7/10 independent visual fidelity**, reached at **7.1/10**, with principal visual acceptance distinct from that score. No merge or deployment is authorized by this design checkpoint. (Design head only: node #815 has since integrated it, and its merge waits on the principal's flight, `HANDOFF.md`.)

Principal visual approval: 2026-10-08, “approved. Prepare PR for final implementation by another agent”. See HANDOFF.md (parent directory from evidence) for binding decisions and outstanding integration work.

## In the game (node #815)

`miner/b` is this model. `prepare-flight-asset.mjs` writes the stowed export to
`src/models/longwall-miner.glb` (Meshopt, lossless WebP, every vertex
attribute, node transform to 10 µm and texture pixel verified after a decode;
11.13 MiB). The attributes are compared after `dedup` and `reorder`, so the
script also compares the written file's triangles with the export as read —
order-free, every attribute of every corner, by node — and
`verify-flight-asset.mjs` runs that comparison on its own without writing
(sage round 8; 283,528 triangles in 107 primitives, all exact — the game's
283,576 adds its two 24-triangle drive-glow discs). It reads
`dedup`'s two folds as the same drawing: the four anchors' identical parts
share meshes, and `pale-steel-1` is folded into the identical
`pale-steel-0`. Only that file ships; everything else here stays review-only,
except that this one script (with the `triangle-soup.mjs` it imports) and
the source export it reads are the production asset's build step, as `spikes/coriolis/prepare-flight-asset.mjs`
is the station's: removing either orphans the shipped file.

```sh
node spikes/longwall-miner/prepare-flight-asset.mjs
node spikes/longwall-miner/verify-flight-asset.mjs    # checks, writes nothing
node spikes/longwall-miner/capture-game.mjs round-N   # flown, chase view, 4 sides
```

- **Loading.** `src/longwall-model.ts` fetches it behind the Retry panel on
  every page that builds a ship (the game, the postcard viewer, the ship
  workbench); `tests/setup/longwall-model.ts` installs it under bun. In the
  game that puts it in the boot set, which map #1's Constraint does not allow;
  the principal waived that on node #838 until #838 lands (`HANDOFF.md`).
  `buildShipMesh("miner", "b")` throws until it is installed, because the
  envelope, collision box, vents and muzzles are measured off the drawn mesh.
- **Frame.** Turned half a turn about Y to the game's nose-at-minus-Z,
  kilometres, and centred on its own box, so a berth that places the ship's
  origin places the box (the export's origin was 4.8 m forward of it and
  would have parked 2.1 m into a slot berth's end wall).
- **Fit.** The model measures 84.4 x 34.0 x 18.8 m and its envelope is
  84.5 x 34.1 x 18.8 m. #181 rounds the box **up** to 0.1 m because a fit
  predicate reads it, and the length overruns 84.4 by float noise
  (84.40000010 m in the export), so it gains a whole 0.1 m. The beam does not
  overrun: built, it is 0.034000000000000002 km, which `hull.test.ts`'s
  rounding takes to 34.0 m, so the declared 34.1 m is 0.1 m generous, inside
  that test's 0.1 m allowance (measured in sage round 8; left as declared,
  because it is a hull stat this node does not move). It
  fits every berth of trade, shipyard and refinery and none at an
  outpost, exactly as the loft did. The
  vent placement is re-measured on this mesh and every attitude share is
  re-solved against it to #181's law (roll 0.00674 → 0.00390, pitch
  0.00850 → 0.00793, yaw 0.01038 → 0.00838), so the composed turn rates
  follow the envelope's length: 7.5% slower than the loft (84.5 m against
  78.2).
  Linear acceleration is unchanged. The docking computer's first
  roll-tracking failure moved from 5.5 to 7.0 rpm (`docs/specs/docking.md`
  §4); that is measured, and nothing here separates the length, the box and
  the moved vents as its cause.
- **Not changed.** Mass, thrust, hold (40 t), integrity and price. The 215 t
  now reads 3.97 t per 1000 m³ against the roster's 1.2–2.4 band; the miner
  is a pinned exemption in `tests/hull.test.ts` until the principal rules.
- **Stowed, static.** Nothing articulates the anchors or the cutter in the
  game; their named groups survive for whatever mining node poses them,
  though each anchor's metal is merged into one mesh per paint and that node
  splits it again from the export.
- **Cost.** One flown miner was 111 draw calls and 283,590 triangles a frame
  (`evidence/game-report.json`, captured at 644bb13), against 66 calls for
  the rest of that frame. Counted as meshes, it was 109 then and is 44 now,
  against the loft's 38 meshes and 12,028 triangles (`miner/b` at main
  bd09ae5, `evidence/loft-baseline.txt`); no draw figure was taken for the
  loft, and the capture was not retaken after the hull batch. Every Traffic
  miner clones the one template, so buffers are shared but draws are not.
  The template merges the static hull's opaque, unlit meshes into one per
  material (`batchLongwallHull`), 19 hull meshes to 10, and each stowed
  anchor's painted meshes the same way (`batchLongwallAnchors`), 20 meshes
  an anchor to 6: 109 to 44 a miner. The detail band sheds the mechanism with range (`longwallMechanism`
  in `src/ship-mesh.ts`): from 40 radii (about 1.7 km) the anchors' metal
  goes and the hull's opaque metal is drawn simplified (`longwallReduced`),
  leaving 23 meshes and 14,714 triangles; from 400 radii (about 17 km) the
  cutter's goes too, and the hull's metal gives way to one mesh of 17 boxes,
  one per part it drew (`longwallOutline`), leaving 10 meshes and 780
  triangles. The simplified hull's surface lies within 0.50 m of the model's,
  and the model's furthest point from it is 1.83 m, on the hoses it no
  longer draws (sampled, and pinned in `tests/longwall-mesh.test.ts`; the
  0.4 m is meshoptimizer's target); HANDOFF.md says what that changes. Those
  are mesh counts, not measured draws. Every lamp stays, and quality does not
  gate it.
- **Wrecks.** A derelict miner is dark and untorn: the tear cuts a loft's
  grid, and this model has none.

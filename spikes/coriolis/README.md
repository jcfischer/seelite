# Industrial Coriolis replacement

Refs #790, PR #791. The principal approved the weathered exterior and requested that it replace the current Coriolis. The authored model is now the default trade-A station in normal games, postcards and the model viewer. Other station forms retain their builders.

## Play and inspect

Run `bun run dev -- --host 127.0.0.1`. Ordinary play loads the new Coriolis without a flag. For a temporary approach study use:

`/?boot=direct&seed=42&system=0&no-save&coriolis-start=approach&fps`

This places a normal ship 1.8 km outside the aperture, facing and targeting the station. It grants no equipment and attaches no save store. Shift/Ctrl control throttle, WASD pitch/yaw, QE roll, C clearance and Enter launch/skip traversal; configured bindings still apply. Automatic docking requires buying a docking computer in normal play.

The standalone `/spikes/coriolis/` workbench retains the closed display model and the original procedural comparison. The canonical `/?model-viewer=station` uses the replacement.

## Integration

The flight GLB removes the display tunnel and end cap, preserving the complete 120 × 70 m opening. A collar joins the hull to the production bay. The bay mouth is recessed 30 m while berth coordinates, spin, docking checks and save data retain their existing values. A spinning proxy arm covers the added roof machinery; the complete flight asset is checked against the proxy.

A single same-origin GLB is loaded before station construction and shared across system changes. Imported emissive strengths are normalized to the live exposure ceiling; the armour uses the trade role tint while retaining its textured wear and panel contrast. Runtime navigation fittings supply clock-driven hull strobes, mouth chase lamps, aperture lights and both station-name plaques. The core is authored in metres and converted to kilometres; scene scaling follows the normal station path. Asset load failure rejects boot rather than quietly substituting a different station.

## Authoring and provenance

Dream Loop Pro, inspired by Blade Runner, Alien and Elite Dangerous. `coriolis-industrial.blend` is the editable display source; `build_model.py` deterministically reconstructs the model. Export the production variant with:

`/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/coriolis/build_model.py -- --flight`

The principal selected the original gritty `industrial-surface.png` finish after the last geometry refinement. The unused cleaner texture remains a historical authoring artifact. See [assets.md](assets.md), [constraints.md](constraints.md) and `evidence/` for provenance and visual review. The generated target was inspiration, not an implemented screenshot; no 8/10 resemblance score was achieved or claimed.

The earlier flight receipt in `flight-evidence/` records the opt-in implementation before default integration. The default replacement flight receipt is in `default-evidence/`. Current PR validation is recorded separately in the PR; do not treat historical captures as exact-head verification. `capture-flight.mjs` checks real throttle input, accelerated automatic docking, launch and a pinned no-save boot without a model flag on hardware Chromium. Headless tests inspect the actual GLB opening and the canonical builder installation.

Runtime asset: `public/models/coriolis.glb` (6.4 MiB). After the Blender flight export, run `node spikes/coriolis/prepare-flight-asset.mjs`; it losslessly encodes geometry with Meshopt and the embedded texture with WebP. No geometry simplification, texture resizing or palette changes. The decoder is bundled with the game; no external decoder service. The source export is an ignored intermediate. Headless tests decode the shipped asset with the same GLTFLoader, omitting only image maps in Bun, and check collision containment, reach, the slot, detail bands and shared-resource disposal across multiple berth seeds. The roof machinery has a spinning proxy arm inside the existing reach budget.

The frame-rate overlay in captures is a vsync-limited observation, not a GPU headroom benchmark. Browser rendering remains the texture verification tier.

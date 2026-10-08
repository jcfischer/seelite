# Industrial Coriolis replacement

Refs #790, PR #791. The principal approved the weathered exterior and requested that it replace the current Coriolis. The authored model is now the default trade-A station in normal games, postcards and the model viewer. Other station forms retain their builders.

## Play and inspect

Run `bun run dev -- --host 127.0.0.1`. Ordinary play loads the new Coriolis without a flag. For a temporary approach study use:

`/?boot=direct&seed=42&system=0&no-save&coriolis-start=approach&fps`

This places a normal ship 1.8 km outside the aperture, facing and targeting the station. It grants no equipment and attaches no save store. Shift/Ctrl control throttle, WASD pitch/yaw, QE roll, C clearance and Enter launch/skip traversal; configured bindings still apply. Automatic docking requires buying a docking computer in normal play.

The standalone `/spikes/coriolis/` workbench retains the closed display model and the original procedural comparison. The canonical `/?model-viewer=station` uses the replacement.

## Integration

The flight GLB removes the display tunnel and end cap, preserving the complete 120 × 70 m opening. A collar joins the hull to the production bay. The bay mouth is recessed 30 m while berth coordinates, spin, docking checks, collision proxies and save data retain their existing values. Added exterior machinery is cosmetic under the existing collision proxies.

A single same-origin GLB is loaded before station construction and shared across system changes. Runtime navigation fittings supply clock-driven hull strobes, mouth chase lamps, aperture lights and both station-name plaques. The core is authored in metres and converted to kilometres; scene scaling follows the normal station path. Asset load failure rejects boot rather than quietly substituting a different station.

## Authoring and provenance

Dream Loop Pro, inspired by Blade Runner, Alien and Elite Dangerous. `coriolis-industrial.blend` is the editable display source; `build_model.py` deterministically reconstructs the model. Export the production variant with:

`/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/coriolis/build_model.py -- --flight`

The principal selected the original gritty `industrial-surface.png` finish after the last geometry refinement. The unused cleaner texture remains a historical authoring artifact. See [assets.md](assets.md), [constraints.md](constraints.md) and `evidence/` for provenance and visual review. The generated target was inspiration, not an implemented screenshot; no 8/10 resemblance score was achieved or claimed.

The earlier flight receipt in `flight-evidence/` records the opt-in implementation before default integration. Current PR validation is recorded separately in the PR; do not treat historical captures as exact-head verification. `capture-flight.mjs` checks real throttle input, accelerated automatic docking, launch and an ordinary unflagged boot on hardware Chromium. Headless tests inspect the actual GLB opening and the canonical builder installation.

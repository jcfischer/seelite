# Miner cockpit study

Refs jcfischer/seelite#1143. Target options for a Longwall B cockpit, generated with Nano Banana Pro. The principal picks one before the Dream Loop builds it.

- `baseline.png`: the principal's game frame of the current miner cockpit (prototype 920-drill build c7567a25), with the browser chrome cropped off. The floating laser mounts and arms in it were a bug.
- `option-a.png`, `option-b.png`, `option-c.png`: the three targets. `option-*-prompt.txt` holds the exact prompt of each.

Each generation had three reference images: `baseline.png`; a Blender render of `../longwall-miner/longwall-miner.blend` from the pilot eye (the glazing layout); and `../longwall-miner/target.png` (the approved exterior paint).

Pilot eye: study frame (-0.6, 5.21, 20.2) m, right of the windscreen mullion and 1.56 m above the bridge floor. In the game's ship frame that is (0.6, 6.8, -25.0) m.

## Build and render (principal chose option B, 2026-10-29)

`target.png` is `option-b.png`, locked. `build_model.py` authors the cockpit in Blender, in pilot-local metres with the eye at the origin, and writes `miner-cockpit.blend` and `miner-cockpit.glb`. The lining, window reveals and mullion follow the Longwall B bridge facets and glazing exactly. The flight dash is the courier cabin's equipment, carried over at the frame the game shows it in and scaled about the eye. The five mining screens hang on a curved bank from the roof frame.

Screen quads: `screen-radar`, `screen-flight`, `screen-target`, `screen-status`, `screen-systems` (unpowered), and the mining set `screen-survey`, `screen-ore`, `screen-drill`, `screen-anchor`, `screen-lasers`. `label-*` quads carry the silkscreen captions. `screens.mjs` writes the fixture faces the render shows in place of the live HUD.

```sh
node spikes/miner-cockpit/screens.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --python spikes/miner-cockpit/build_model.py
/Applications/Blender.app/Contents/MacOS/Blender --background spikes/miner-cockpit/miner-cockpit.blend --python spikes/miner-cockpit/render.py -- /abs/path/pilot.png
node spikes/miner-cockpit/bloom.mjs /abs/path/pilot.png /abs/path/pilot-bloom.png
```

`render.py` places the exterior from `../longwall-miner/longwall-miner.blend` around the cockpit, removes the exterior's placeholder seats and consoles inside the bridge, and sets a rock face ahead. The sun lights only the outside (light linking). The game's camera is used: 60° vertical field of view at 3:2. Eevee renders the frame, and `bloom.mjs` adds a glow in place of the game's bloom pass.

View lost against the target: the real windscreen spans about 49° × 20° from the eye (−35° to +14° across, −2° to +18° up and down). The target's spans about 59° × 26° (±30°, −9° to +17°). That is roughly 37% less glass, lost mostly on the right and below the horizon. A glare-shield coaming fills the band between the glass sill and the dash.

`evidence/pilot-round-5.png` is the latest render and `evidence/target-vs-round-5.png` puts it beside the target. The independent judge scored 3.3, 3.4, 3.6, 3.9 and 4.0 over five rounds.

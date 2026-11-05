# Miner cockpit study

Refs jcfischer/seelite#1143. A two-seat bridge for the Longwall B miner, built with the Dream Loop and shown in the game behind `?cockpit=miner`. The principal reviewed it over 19 rounds in flight. This folder keeps only the final state. The intermediate round files were removed before review; the branch history still has them.

## Files

- `target.png`: the locked concept (two-seat concept #2, Nano Banana Pro). `target-prompt.txt` is its exact prompt.
- `build_two_seat.py`: authors the bridge in Blender, in pilot-local metres with the pilot eye (left seat) at the origin. It writes `miner-cockpit-2seat.blend` and `miner-cockpit-2seat.glb`, the file the game loads.
- `longwall-miner-v3.blend` / `.glb`: the Longwall B exterior with the V3 glass canopy, written by `reglaze_longwall.py` from `../longwall-miner/longwall-miner.blend`. The render and the seat measurement place it around the bridge.
- `textures/`: the material textures the build reads. `strut-texture.mjs` writes `strut-fine.png` from its generated 4K source.
- `screens/` and `screens.mjs`: the fixture faces that the Blender renders show in place of the live HUD.
- `render_two_seat.py`: renders a seat view or the concept view. `bloom.mjs` adds a glow in place of the game's bloom pass.
- `measure_seats.py`: the share of the frame where the view from each seat leaves through the glass, at the game camera (80°, pitched up 0.12 rad). `measure_canopy.py` measures the upward view through a study's glazing.
- `capture-seats.mjs`: game captures from both seats from a dev server. `band-repeat.mjs` and `band-wear.mjs` measure how much the strut paint repeats and how worn it looks.
- `render_exterior.py`: exterior review frames of a Longwall study.
- `evidence/`: the round-19 Blender views from both seats and from the concept camera, the approved exterior (`exterior/approved-*.png`), and the square-bloom fix.

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
node spikes/miner-cockpit/screens.mjs
$B --background --python spikes/miner-cockpit/build_two_seat.py
$B --background spikes/miner-cockpit/miner-cockpit-2seat.blend --python spikes/miner-cockpit/render_two_seat.py -- /abs/path/out.png [view]
$B --background spikes/miner-cockpit/miner-cockpit-2seat.blend --python spikes/miner-cockpit/measure_seats.py -- 80
```

## In the game

`?boot=overlay&hull=miner&mining=1&cockpit=miner`. The pilot sits on the left with the courier instruments, and the miner on the right with the mining instruments. Key `5` (`view.seatSwap`) moves the eye between the seats. Four miner screens (drill, anchor, stance, drill camera) stay dark until their data exists on main.

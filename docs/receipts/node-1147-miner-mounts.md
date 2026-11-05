# Model integration: node #1147, the miner's Mining Laser mounts

## Current result

- **Design:** the two mounts of the #920 drill study, approved by the
  principal on `prototype/920-drill` (head `3af26015`, rulings D-D7 to D-D12
  and D-D18). The study is `spikes/longwall-miner/mounts/`: `build_mounts.py`,
  `longwall-mounts.glb`, `mounts.json` and the Blender before/after renders.
- **Integration:** `spikes/longwall-miner/prepare-flight-asset.mjs` grafts the
  mounts into the approved Longwall B export (`mounts/graft-mounts.mjs`) before
  any check runs, then writes `src/models/longwall-miner.glb` as before.
  `verify-flight-asset.mjs` grafts the same mounts before it compares.
- **Mapping:** the six mount parts go into the export's static `hull` group,
  with the export's own `service-ochre`, `machined-alloy` and `dark-structure`
  materials. `batchLongwallHull` merges them into the hull's batches. Two empty
  nodes, `muzzle-h2` (port) and `muzzle-h3` (starboard), sit at the muzzle tips
  of `mounts.json`. `shipMuzzlesKm` reads a `muzzle-<slot>` node per hardpoint
  in key order and raycasts the others, so `h1` stays on the bow.
- **Shipped asset:** `db03227b…f3ed` (11,667,764 bytes) on main, now
  `32cde6f3ca0ff3677658ab5a3c14c1ef3c6996fd8eb065bb2724e29bb638d9c5`
  (11,680,724 bytes, 11.14 MiB), plain git. The unchanged script still writes
  main's file byte for byte, so the difference is the graft alone.
- **Open:** the principal's visual yes on the mounts in the game. The cockpit
  occlusion table (#920 D-D20) is not on main yet; the drill brief (#1150)
  measures it on this model.

## Asset and geometry preflight

- `node spikes/longwall-miner/prepare-flight-asset.mjs`: verified the approved
  export's triangles (now with the mounts) and exact vertex attributes, texture
  pixels and node transforms to 10 µm. The same paint lift as on main.
- `node spikes/longwall-miner/verify-flight-asset.mjs`: 283,984 triangles in
  113 primitives, every attribute exact (main: 283,528 in 107).
- Muzzles on the shipped file through the production loader
  (`tests/mining-mount-beam.test.ts`): `h1` (0, 0, −39.8) m, `h2`
  (−5.3, 5.81, −22.8) m, `h3` (+5.3, 5.81, −22.8) m. The ship frame's offset
  from the export is the same for both mounts.
- The model's box is unchanged: ±17.0 × ±9.39 × ±42.2 m, so the envelope,
  the berth origin and the collision box do not move.

## Runtime and performance evidence

Headless, `tests/longwall-mesh.test.ts`, on the shipped file:

| Figure | main | this branch |
| --- | --- | --- |
| Own miner, `full`: meshes drawn | 44 | 44 |
| Own miner, `full`: triangles | 283,576 | 284,032 |
| Traffic miner, `reduced`: meshes drawn | 44 | 44 |
| Traffic miner, `reduced`: triangles | 22,778 | 22,852 |
| `outline` level: triangles | 544 | 544 |
| Medium level: furthest sampled point from the model | 0.992 m | 0.992 m |
| Model vertices further than 0.135 m from the medium level | 83,855 of 482,918 | 83,520 of 483,638 |

The mounts add 456 triangles and no draw. The simplifier runs again on the
changed input, so the medium level differs everywhere by a little; the
sampled error did not grow. No LOD policy changed.

## Delivery evidence

- Tests, browser coverage, review and the principal's approval: in the PR.

## Historical measurements

- The #815 figures in `spikes/longwall-miner/README.md` and `HANDOFF.md`
  (283,576 and 22,778 triangles, 83,855 points) are main's before this node.

# Node #945 receipt: every duel-band cell stands on its own plate

Base `b0d518b` (origin/main). The principal's ruling of 2026-10-12: each cell
of the duel band gets its own plate, always — SHD, HEAT and the armed-group
label as well as TEMP. TEMP and SCOOPING keep the one plate #932 gave them.

## What changed

- `src/duel-hud.ts` — `duelBandPlates(row)`: one plate per cell, TEMP and
  SCOOPING merged when they sit side by side. The armed-group cell has no
  label, so its plate is named `GROUP` (`ARMED_GROUP_PLATE`).
- `src/main.ts` — `drawBandRow` paints the plates it is handed, using #931's
  geometry: `PROMPT_PLATE_FILL`, 0.4 of a cell gap past each end, inset 12%
  of the band at top and bottom. Only the duel band is handed plates; the
  course row gets none. `floorRender.duelPlates` records every plate painted.
  `tempPlate` and `scoopPlate` are as before.
- The floor fit is not touched. Each plate stays inside its half of the cell
  gap, so two neighbouring plates are 0.2 of a cell gap apart (4.4 px at
  scale 1, 3.2 px at 0.72).

## Floor fit, measured on this branch (seed 42, GPU lane)

| viewport | peace | fight, no star | fight over a star |
|---|---|---|---|
| 1440×900 | 1, overflow 0 | 1, overflow 0 | 1, overflow 0 |
| 900×620 | 1, overflow 0 | 1, overflow 0 | 1, overflow 0 |
| 390×780 | 0.72, overflow 0 | 0.72, overflow 0 | 0.72, overflow 0 |

These are the values the node gives for origin/main. `probe-duel-hud` checks
them at 900 and 390 for peace, for a fight away from a star and for a fight
in the 2 R band.

## Shots for the principal's eye

Fight away from a star (cruise, a contesting raider) and fight over the star
disc (normal flight at 1.5 R, nose on the disc, TEMP showing):

- `node-945-duel-cell-plates/fight-away-1440.jpg`
- `node-945-duel-cell-plates/fight-away-390.jpg`
- `node-945-duel-cell-plates/fight-star-1440.jpg`
- `node-945-duel-cell-plates/fight-star-390.jpg`

Seen in the star shots but out of this node's scope: the amber
`t selects a target` prompt above the band has no plate and is hard to read
on the disc.

## Probe consequences

- The skim row in `probe-duel-hud` counted the band's ink with the
  passive-hue sampler. Ink drawn over a plate falls outside that hue window,
  so the row now uses `litIn`, the any-tone sampler #932 added for the plate
  (cold 479 / hot 678 at 900 px, 296 / 386 at 390 px).
- The beam sample, 28 px down the beam in the cockpit, lay inside the duel
  band at 900 px. A plate darkens the beam behind it, so the paint read 6
  against the probe's floor of 10. The sample now moves further down the beam until it is clear
  of every plate (21 px of paint at 900, 19 at 390). The player sees the same
  thing: a beam crossing the band is dimmed under a plate.

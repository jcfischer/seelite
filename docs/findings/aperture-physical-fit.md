# The aperture as a physical fit: the pitch and yaw table for §9.1.9

Node #663, measured 2026-10-04. `collision.md` §2.3 (P1) makes a ship meet a
station on its hull box, so a wing that touches a slot's rim before the ship's
centre crosses the plane is an impact rather than an entry. P1 was chosen
without measuring the pitch half. §9.1.9 owes the table and §11 (joint 2) sends
it **to the principal to judge**: whether a hull's margin is the intended skill
tax or a reason to revisit P1. It is not a reason to cut the rim out of the
proxy. This file records data and makes no judgement.

## What was run

On commit `f0231ab` ("Print the aperture's physical-fit table for the
principal"), on an M1 Pro, headless bun:

```bash
bun scripts/measure-aperture-fit.ts
```

For every role and every hull its berths admit, the script reports two angles,
each tested at roll 0 and at check 4's 50° limit:

- the largest **pitch**: the nose toward the slot's short side;
- the largest **yaw**: the nose toward its long side.

Each angle is the largest at which a centred entry clears the selected form's
proxy, with both signs passing. The scan runs in 0.5° steps and stops at check
2's 35°.

A centred entry flies the ship's centre down the docking axis to the plane,
with the station held at one slot phase. The roll is taken about the docking
axis, so it is check 4's angle. The fit is owed only up to the plane, because
past it the ship is exempt (§5). The attitude composition and the clearance
test are `tests/helpers/aperture-physical-fit.ts`, which the asserted 0° row
in `tests/collision-stations.test.ts` also reads.

## Output, verbatim

```text
aperture physical fit: largest clear angle, both signs, 0.5° steps; check 2 refuses past 35°, check 4 past 50° of roll
role     hull         pitch r0  yaw r0 pitch r50  yaw r50
-- trade (slot 120 × 70 m)
trade    courier           ≥35     ≥35       ≥35      ≥35
trade    interceptor       ≥35     ≥35       ≥35      ≥35
trade    freighter         ≥35     ≥35      20.5     18.5
trade    miner            19.0     ≥35       0.5      0.5
trade    patrol            ≥35     ≥35       ≥35      ≥35
trade    explorer         22.5     ≥35      17.0     14.5
trade    raider            ≥35     ≥35       ≥35      ≥35
trade    tug               ≥35     ≥35      33.5     30.5
trade    prospector        ≥35     ≥35       ≥35      ≥35
-- shipyard (slot 120 × 70 m)
shipyard courier           ≥35     ≥35       ≥35      ≥35
shipyard interceptor       ≥35     ≥35       ≥35      ≥35
shipyard freighter         ≥35     ≥35      22.0     18.5
shipyard miner            20.5     ≥35       0.5      0.5
shipyard patrol            ≥35     ≥35       ≥35      ≥35
shipyard explorer         23.5     ≥35      18.5     16.0
shipyard raider            ≥35     ≥35       ≥35      ≥35
shipyard tug               ≥35     ≥35      33.5     30.5
shipyard prospector        ≥35     ≥35       ≥35      ≥35
-- refinery (pad, landing well 56.2 m)
refinery courier           ≥35     ≥35       ≥35      ≥35
refinery interceptor       ≥35     ≥35       ≥35      ≥35
refinery freighter         ≥35     ≥35       ≥35      ≥35
refinery miner             ≥35     ≥35       ≥35      ≥35
refinery patrol            ≥35     ≥35       ≥35      ≥35
refinery explorer          ≥35     ≥35       ≥35      ≥35
refinery raider            ≥35     ≥35       ≥35      ≥35
refinery tug               ≥35     ≥35       ≥35      ≥35
refinery prospector        ≥35     ≥35       ≥35      ≥35
-- outpost (pad, landing well 46.5 m)
outpost  courier           ≥35     ≥35       ≥35      ≥35
outpost  interceptor       ≥35     ≥35       ≥35      ≥35
outpost  freighter         ≥35     ≥35       ≥35      ≥35
outpost  patrol            ≥35     ≥35       ≥35      ≥35
outpost  raider            ≥35     ≥35       ≥35      ≥35
outpost  tug               ≥35     ≥35       ≥35      ≥35
outpost  prospector        ≥35     ≥35       ≥35      ≥35
```

## What it does and does not say

- **Every hull clears every aperture at 0°, square and at the 50° roll
  limit.** That is the half the test asserts.
- **At the roll limit, the miner has 0.5° of pitch or yaw** at both slot roles.
  Rolled to 50°, it fits a slot only when pointed straight down the axis. Check
  2 admits 35°. A rolled miner that is half a degree further off meets the rim.
- The explorer (14.5–18.5°) and the freighter (18.5–22°) lose about half of
  check 2's cone at the roll limit. The tug loses a little. The courier,
  interceptor, patrol, raider and prospector keep all of it.
- **Unrolled, the miner keeps 19–20.5° of pitch and the explorer 22.5–23.5°.**
  Yaw is free for every hull at roll 0, because yaw turns the beam along the
  slot's 120 m width.
- **Both pad roles clear at 35° for every hull.** This is the landing well
  (`padWellDepthKm`, node #663). Before the well, the docking-computer harness
  stopped every hull on the deck of both pad roles without a crossing, because
  the deck stood at the plane. The well depth is printed beside the
  role.
- **A centred entry is the best case.** An entry off the axis has less margin,
  as P1 says, and this table does not measure that.
- **The station is held at one phase.** A pilot who is not matching the spin
  at the plane is rolling relative to the slot, which is the 50° column.
- A change to a hull's envelope, a slot's size or a form's proxy makes these
  figures stale. The script reprints them, and a re-run on the new commit
  replaces this file.

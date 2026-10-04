# The aperture as a physical fit: the pitch and yaw table for §9.1.9

Node #663, measured 2026-10-04. `collision.md` §2.3 (P1) makes a ship meet a
station on its hull box, so a wing that touches a slot's rim before the ship's <!-- glossary-ignore: slot -->
centre crosses the plane is an impact rather than an entry. P1 was chosen
without measuring the pitch half. §9.1.9 owes the table and §11 (joint 2) sends
it **to the principal to judge**: whether a hull's margin is the intended skill
tax or a reason to revisit P1. It is not a reason to cut the rim out of the
proxy. This file records data and makes no judgement.

## What was run

Round 2 measurement on parent commit `692e8a4` plus the local seeded-corpus
repair (2026-10-04), M1 Pro, headless bun:

```bash
bun scripts/measure-aperture-fit.ts
```

For every role and every hull its berths admit, the script reports two angles,
each tested at roll 0 and at check 4's 50° limit:

- the largest **pitch**: the nose toward the slot's short side; <!-- glossary-ignore: slot -->
- the largest **yaw**: the nose toward its long side.

Each angle is the largest at which a centred entry clears the selected form's
proxy, with both signs passing. The scan runs in 0.5° steps and stops at check
2's 35°. Each cell is the worst angle over the role's stated seed corpus.
The refinery uses the twelve proxy-budget plans plus six actual stations from
the start systems of world seeds 1–12 (18 plans); the unplaced outpost uses
the twelve budget plans. The non-seeded trade and shipyard use one fixture.
The output lists every seed pair and the first worst sample in each column.

A centred entry flies the ship's centre down the docking axis to the plane,
with the station held at one slot phase. The roll is taken about the docking <!-- glossary-ignore: slot -->
axis, so it is check 4's angle. The fit is owed only up to the plane, because
past it the ship is exempt (§5). The attitude composition and the clearance
test are `tests/helpers/aperture-physical-fit.ts`, which the asserted 0° row
in `tests/collision-stations.test.ts` also reads.

## Output, verbatim

```text
aperture physical fit: largest clear angle, both signs, 0.5° steps; check 2 refuses past 35°, check 4 past 50° of roll
role     hull         pitch r0  yaw r0 pitch r50  yaw r50
-- trade (slot 120 × 70 m); N=1 plans; worst angle across plans
plans: assembly 0, berth 1
trade    courier           ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
trade    interceptor       ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
trade    freighter         ≥35     ≥35      20.5     18.5 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
trade    miner            19.0     ≥35       0.5      0.5 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
trade    patrol            ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
trade    explorer         22.5     ≥35      17.0     14.5 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
trade    raider            ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
trade    tug               ≥35     ≥35      33.5     30.5 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
trade    prospector        ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
-- shipyard (slot 120 × 70 m); N=1 plans; worst angle across plans
plans: assembly 0, berth 1
shipyard courier           ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
shipyard interceptor       ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
shipyard freighter         ≥35     ≥35      22.0     18.5 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
shipyard miner            20.5     ≥35       0.5      0.5 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
shipyard patrol            ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
shipyard explorer         23.5     ≥35      18.5     16.0 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
shipyard raider            ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
shipyard tug               ≥35     ≥35      33.5     30.5 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
shipyard prospector        ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
-- refinery (pad, landing well 56.2 m); N=18 plans; worst angle across plans
plans: assembly 0, berth 1; assembly 1, berth 1; assembly 2, berth 1; assembly 3, berth 1; assembly 17, berth 1; assembly 42, berth 1; assembly 1000, berth 1; assembly 65535, berth 1; assembly 7, berth 1; assembly 8, berth 1; assembly 12345, berth 1; assembly 99999, berth 1; assembly 745705128, berth 523440234; assembly 1650427524, berth 2669701724; assembly 2883206022, berth 1099627754; assembly 3449083801, berth 2290776610; assembly 3161350735, berth 251849636; assembly 4228491382, berth 3547429680
refinery courier           ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
refinery interceptor       ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
refinery freighter         ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
refinery miner             ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
refinery patrol            ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
refinery explorer          ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
refinery raider            ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
refinery tug               ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
refinery prospector        ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
-- outpost (pad, landing well 46.5 m); N=12 plans; worst angle across plans
plans: assembly 0, berth 1; assembly 1, berth 1; assembly 2, berth 1; assembly 3, berth 1; assembly 17, berth 1; assembly 42, berth 1; assembly 1000, berth 1; assembly 65535, berth 1; assembly 7, berth 1; assembly 8, berth 1; assembly 12345, berth 1; assembly 99999, berth 1
outpost  courier           ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
outpost  interceptor       ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
outpost  freighter         ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
outpost  patrol            ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
outpost  raider            ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
outpost  tug               ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
outpost  prospector        ≥35     ≥35       ≥35      ≥35 | first worst samples: assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1 / assembly 0, berth 1
```

## What it does and does not say

- **Every hull clears every aperture at 0°, square and at the 50° roll
  limit.** That is the half the test asserts.
- **At the roll limit, the miner has 0.5° of pitch or yaw** at both slot roles. <!-- glossary-ignore: slot -->
  Rolled to 50°, it fits a slot only when pointed straight down the axis. Check <!-- glossary-ignore: slot -->
  2 admits 35°. A rolled miner that is half a degree further off meets the rim.
- The explorer (14.5–18.5°) and the freighter (18.5–22°) lose about half of
  check 2's cone at the roll limit. The tug loses a little. The courier,
  interceptor, patrol, raider and prospector keep all of it.
- **Unrolled, the miner keeps 19–20.5° of pitch and the explorer 22.5–23.5°.**
  Yaw is free for every hull at roll 0, because yaw turns the beam along the
  slot's 120 m width. <!-- glossary-ignore: slot -->
- **Both pad roles clear at 35° for every admitted hull in this corpus.** This is the landing well <!-- glossary-ignore: pad -->
  (`padWellDepthKm`, node #663). Before the well, the docking-computer harness
  stopped every hull on the deck of both pad roles without a crossing, because <!-- glossary-ignore: pad -->
  the deck stood at the plane. The well depth is printed beside the
  role. These are measured plans, not a proof over every uint32 assembly seed.
- **A centred entry is the best case.** An entry off the axis has less margin,
  as P1 says, and this table does not measure that.
- **The station is held at one phase.** A pilot who is not matching the spin
  at the plane is rolling relative to the slot, which is the 50° column. <!-- glossary-ignore: slot -->
- A change to a hull's envelope, a slot's size or a form's proxy makes these <!-- glossary-ignore: slot -->
  figures stale. The script reprints them, and a re-run on the new commit
  replaces this file.

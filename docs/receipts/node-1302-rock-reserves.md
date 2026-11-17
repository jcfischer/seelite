# A charted rock carries a realistic reserve

Refs #1302. The principal's ruling of 2026-11-17, flying `27bd7e72`: a few
dozen tonnes of ore per asteroid is not realistic, and a normal rock should
hold about 400 t so the Longwall's 3,000 t ore bay takes several rocks or one
large one.

## The chosen figures

`RESERVE` in `src/rock-survey.ts`:

| Input | Before | After |
| --- | ---: | ---: |
| Surface floor | 2 t | 50 t |
| Surface at the largest rock | 150 t | 50,000 t |
| Deep floor | 30 t | 100 t |
| Deep at the largest rock | 600 t | 200,000 t |
| Deep chance, smallest → largest | 0.2 → 0.9 | unchanged |

The area and volume laws are unchanged: surface ore scales with `(r/r1)²`, a
deep deposit with `(r/r1)³`, and the deep chance with the rock's position in the
radius range. The two "at largest" figures scale by the same factor (×333), so
the deep deposit keeps its 4:1 ratio to the surface at the largest rock. The
floors are anti-zero guards: at the new scale the smallest charted rock's law
value is already about 100–300 t of surface ore, so the floors stay far below it
and the laws set every reading above the smallest rocks.

## What a rock now holds

Measured over 1,982 charted fields from seeds 1–20 (the field generator at
`FIELD_GENERATOR_VERSION` 2):

| Reading | Value |
| --- | ---: |
| Median charted rock, surface + deep | 524 t |
| Median charted rock, surface | 485 t |
| Lowest charted field's median rock | 449 t |
| Median of the field medians | 524 t |
| Largest charted rock, surface | 74,032 t |
| Largest charted rock, deep | 297,603 t |
| Median deep deposit, when present | 298 t |
| Deep deposits, share of rocks | 25.9% |
| Charted field total | about 2.2 million t (p50) |

The boot system of seed 2 (system 101, `field-00`, 758 rocks) reads median
total 522 t, median surface 482 t, largest surface 59,660 t, 211 deep rocks,
median deep 338 t and largest deep 200,895 t. This is the live probe's reading.

The old field held about 11,000 t (the #923 table's figure); the new one holds
about 2.2 million t. The mean is dominated by the largest rocks, which the area
and volume laws make worth tens of thousands of tonnes each.

## Recovery does not change

`RECOVERY_T_PER_H` stays 10. The instrument sweeps it at 0.01, 1, 100 and 1,000
t/h against the new reserves and every value gives the same 3.53× charted
refined ratio: with a field of 2.2 million t and a 3,000 t hold, a rock is never
drained and waited on, so recovery no longer binds. Raising it would make fields
regenerate as fast as they are mined; lowering it would not restore the old
scarcity, because the field is large enough that the pilot simply moves on. The
ratified 10 t/h stays as the slow, field-scale regeneration it was.

## The #923 table does not hold, and this is why

The table's **inputs** are unchanged: 35% refinery fee, 1 s/t throughput, 0.35
raw value share with 0.5 elasticity, 8–63 t raw stock, 37.5 t/s drill at 6 E/s
and 2.5 heat/s, 0.1 t/s grade-E Mining Laser with 0.5/0.4/0.75 ore shares, and
the 3,000 t skips. Its **measured ratios** move, because reserves no longer
bind. Ratio to good trade per active minute, p10 / p50 / p90:

| Longwall 3/A, 24 h, six fields | Before | After |
| --- | ---: | ---: |
| Charted raw | 0.57 / 0.64 / 0.78 | 3.00 / 6.84 / 9.25 |
| Charted refined | 0.93 / 1.14 / 1.56 | 2.18 / 3.53 / 7.00 |
| Rare raw | 1.55 / 1.85 / 1.95 | 13.57 / 16.00 / 16.49 |
| Rare refined | 2.89 / 3.84 / 3.85 | 7.60 / 11.43 / 12.98 |

The whole-clock (elapsed) ratios move the same way: charted refined 0.80 → 1.48,
rare refined 2.56 → 5.71. On the 8 h one-pass candidate, charted refined goes
0.92 → 1.99 and rare refined 3.10 → 6.33.

The cause is the ruling's own arithmetic. With the old reserves a charted field
ran dry in 121 of 144 refined runs and recovery was the binding limit; the
instrument's target band (0.8–1.2× trade for an ordinary miner on a charted
field) is now failed by every sample. Income per trip is still bounded by the
hold and the rates — the pilot fills 3,000 t from a few rocks and returns — but
the active rate rises because the pilot no longer spends most of it
repositioning between exhausted rocks.

The principal ratifies these figures at merge. Prices, refinery throughput and
fees were not touched, so the table's inputs still describe the shipped game;
its measured returns no longer do.

## The instrument's small-reserve tests

`scripts/lib/mining-comparison.ts` gains an optional `reserveScale` (default 1,
the shipped reserves). Eight of its tests exercise depletion, revisits and the
fee/fuel cash flow, and the shipped reserves no longer reach those states in a
test-sized clock. They run at `reserveScale: 0.001`; the balance runs above use
the default 1. The instrument's "production reads the shipped rocks" test still
reads scale 1.

## Evidence

- `tests/rock-reserves.test.ts` (new): the chosen figures; the median charted
  rock at 400 t or more over four seeds; every charted field's median at 400 t or
  more over three seeds; the largest rock scaling up; a full Longwall hold
  leaving most of the largest rock; an old-scale debit (150 t surface, 600 t
  deep) loading through `parseDeposits` and a whole save through `parseSave` and
  reading as the new reserve minus the debit.
- `scripts/probe-rock-reserves.mjs` (new, in the catalog): boots
  `?seed=2&hull=miner&no-save=&raider=off`, reads `rockContents` for all 758
  rocks of the start system's charted field through `window.__seelite`, and
  asserts the median total is at least 400 t. 4/4 checks passed.
- `scripts/probe-mining-release.mjs`: 21/21 checks passed with the new reserves.
  Its surveyed rock read `SILICATE STD · 38160 T · DEEP 45767 T`, and the
  drill's debit still equalled the skips' gain.
- `tests/mining-comparison.test.ts`: 46/46 passed.
- `npx tsc --noEmit`, `npm run lint:comments` and `npm run format:check` clean.

## Defaults taken

- The two "at largest" figures scale by the same ×333 factor, and the floors are
  raised to 50 t and 100 t, because a uniform ×333 floor (666 t and 10,000 t)
  would dominate the median and break the area and volume laws.
- `RECOVERY_T_PER_H` stays 10, because the sweep shows it no longer binds and
  raising it would remove depletion entirely.
- The instrument's `reserveScale` is optional and defaults to the shipped
  reserves, because the ratified candidate files must keep validating.

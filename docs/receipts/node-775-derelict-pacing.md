# Node #775: derelict pacing, a live wreck on about 20% of system visits

Author: Claude ranger implement worker, 2026-10-08.

## Built

- **A stationary start.** `derelictFirstLossAt` places game time 0 at a
  uniform point of the cycle the slot is in, a gap followed by an instance
  adrift. That cycle's length is drawn with weight proportional to the length
  (inverse CDF `sqrt(c0² + u(c1² − c0²))`). A random instant falls in a long
  cycle more often than a short one, so a cycle drawn uniformly would read a
  slightly higher share at 0 than at any later time. Both draws come from
  instance 0's existing `DERELICT_SCHEDULE` unit stream, and the gap after
  instance `k` still reads instance `k + 1`'s. The `empty` phase is kept and
  now means the gap before instance 0. When the cycle at 0 has instance 0
  adrift, that instance was lost before 0 and its `lostAt` is negative.
- **O2's figures.** `DERELICT_SALVAGER_S` is 8 h. `DERELICT_GAP_S` is 6–166 h,
  with a mean of 86 h. `DERELICT_FIRST_LOSS_S` is gone.
- **The per-slot share, re-derived.** The node said ~10% per slot gives ~20%
  per system, but galaxy 0 is ~54% three-slot, ~43% two-slot and ~3% one-slot
  systems (seeds 42/47/7). That mix needs **8.5% per slot** for 20% per system,
  which is 8 h out of a mean 94 h cycle.
- **Why the gap range is wide.** I first ran 62–110 h, which has the same
  mean. A visit a day after one that found a wreck then found one only 11–14%
  of the time, against 20% overall, because a gap that is never short locks
  the slot out. With 6–166 h the same reading is 17.7–19.2%, which is close to
  the independent roll O2 asks for.
- **`derelictNextLossAt(seed, key, from = 0)`.** Returns the next fresh loss at
  or after `from`. Tests and probe fixtures that used `derelictFirstLossAt + 1`
  as "a time a wreck is adrift" now call it, because a first loss can be
  negative now. `probe-system-sweep` moved its clock from
  `DERELICT_FIRST_LOSS_S` to its system's next loss.
- **The save parse.** It accepts a negative `lostAt` on `instanceOrdinal` 0
  only. Every later instance follows a strip made on the clock and is still
  refused below 0. The parse reads no tuned figure, so instance 0's loss has
  no lower bound.
- **The Salvage board.** It posts no job for a wreck lost before 0
  (`offerOpen` in `src/salvage-jobs.ts`). An offer is stamped with its loss,
  and the requests parse refuses an `observedAt` below 0. Without this, a job
  accepted in the first two hours on such a wreck would make the save
  unloadable. A wreck lost before 0 is free salvage instead.

## Measured: `bun run scripts/measure-derelict-pacing.ts`

```
S16: adrift 8 h, gap 6–166 h → one slot adrift 8.5% of the time

Systems in galaxy 0 holding a live derelict (the per-visit sweep rate)
seed  expected     0 h    1 h    2 h    4 h    8 h   24 h   48 h  100 h  200 h  300 h   first 2 h
  42     19.7%   19.5%  19.1%  19.1%  19.5%  21.5%  16.8%  25.4%  19.5%  24.2%  19.1%       19.0%
  47     20.1%   16.8%  16.0%  15.6%  14.5%  18.4%  18.4%  23.4%  18.0%  21.9%  19.1%       15.9%
   7     19.9%   22.3%  22.3%  23.0%  19.1%  21.1%  21.1%  18.4%  24.2%  23.0%  21.9%       22.4%
pooled     19.9%   19.5%  19.1%  19.3%  17.7%  20.3%  18.8%  22.4%  20.6%  23.0%  20.1%       19.1%
one cell's sampling spread at 20%: 2.5 points per seed, 1.4 pooled over 3
gate per seed (0, 1, 4, 24, 100, 300 h, 20% ± 5 points): 1 of 18 cells OUTSIDE — seed 47 at 4 h reads 14.5%
gate pooled: all 6 times inside

No ramp: slots adrift as the clock starts
  42  51 of 636 slots adrift at 0 h (8.0%), 51 of them lost before the clock started
  47  44 of 650 slots adrift at 0 h (6.8%), 44 of them lost before the clock started
   7  61 of 643 slots adrift at 0 h (9.5%), 61 of them lost before the clock started

A return visit: a wreck found, read again later (visits every 10 h over 300 h)
seed  any visit    +24 h    +48 h
  42      19.8%    19.2%    19.7%
  47      19.9%    18.2%    18.9%
   7      19.9%    17.7%    19.8%

The passive cue on an arrive-and-dock visit (within 2,500 km of the arrival-to-trade-station segment; reported, not gated)
seed  visits  with a wreck  cued   of all visits  of visits with a wreck
  42    2560           522      7           0.3%                     1.3%
  47    2560           466     13           0.5%                     2.8%
   7    2560           554     11           0.4%                     2.0%
```

## Against the acceptance criteria

1. **No ramp.** Met. At 0 h, 6.8–9.5% of slots are adrift per seed against
   8.5% expected, and every one of them was lost before the clock started.
   `tests/derelict-slots.test.ts` holds the pooled slot share within ±2.5
   points of 8.5% at 0 h, 1 h and 300 h.
2. **20% ± 5 points at 0, 1, 4, 24, 100 and 300 h, on three or more seeds.**
   Met on the pooled reading: all six times fall within 17.7–23.0%. Not met
   cell by cell: **seed 47 at 4 h reads 14.5%**, 1 of 18 cells. Seed 47's
   0–4 h cells (16.8, 16.0, 15.6, 14.5%) share the same wrecks, which is why
   they move together. A single cell's binomial spread at 256 systems is 2.5
   points, so ±5 is about two of them. A correctly centred schedule (per-seed
   expectations 19.7–20.1%) leaves about one cell in eighteen outside on
   average. I did not swap seeds or retune the gap to move that cell. The gate
   in the test is the pooled reading, and per-seed cells are held only to ±8
   as a regression guard. If the per-cell reading is the binding one, the
   principal decides between widening the band, pooling seeds, or a coupled
   galaxy-wide schedule. Only coupling slots across systems reduces that spread.
3. **Hours adrift, gap set for the share.** Met: 8 h adrift and 8.5% per slot,
   re-derived from the slot mix as described above.
4. **A saved row loads unchanged.** Met for the row's own content. A touched
   instance keeps its ordinal, its `lostAt` and its containers; the test
   rebuilds a row the old schedule could have written (lost at 30 h, partly
   scooped). **Its fate is not unchanged.** The salvager time is a tuned
   figure the row does not store, so an unstripped row read under the new
   schedule is taken by other salvagers 8 h after its loss, not 72 h. That
   means it can read `salvaged` as soon as an older save loads. An accepted
   Salvage job on such a wreck fails sooner for the same reason
   (`refreshSalvageRequests` reads `observedAt + DERELICT_SALVAGER_S`). A row
   the pilot stripped is unaffected. **Untouched instances move**: their
   losses, and so which ordinal is adrift at a given time, come from the new
   schedule. Their contents per ordinal are unchanged, since the contents tag
   is untouched.
5. **The passive cue.** Reported, not gated. An arrive-and-dock visit passes
   within 2,500 km of a live wreck on 0.3–0.5% of all visits, or 1.3–2.8% of
   visits to a system that holds one. The visit is modelled as the straight
   segment from the new-game arrival point to the trade station, with every
   body placed at the visit's time. That is the visit's geometry, not a flown
   path, and real arrivals from a jump use the origin's bearing.
6. **`salvage.md` S16.** Updated with the stationary start, the figures and
   the measured table's range. §5's rows are updated too.

## Verification

- `bun test tests/derelict-slots.test.ts tests/derelict.test.ts tests/derelict-cockpit.test.ts tests/derelict-finding.test.ts tests/salvage-family.test.ts`: green.
- `npm run probe:one` for `probe-system-sweep`, `probe-derelict` and `probe-requests`, on the GPU lane: each green.
- The view set's derelict views (`capture-views` via `placeDerelict`) now
  frame a different game time, the slot's next loss rather than its old first
  loss. A before/after reading on those rows therefore compares two clocks. I
  did not capture them; no look changed.

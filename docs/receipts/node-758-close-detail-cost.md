# Node #758 — what the close-detail band costs at station altitude

A findings receipt. It prices the band of node #720 on terran at 2, 1.6, 1.5 and 1.2 radii, at pixel
ratio 1 and 2, and chooses nothing: the ruling node owns the cap, the resolution of the ground, the relief
path and the cloud footprint.

**Every figure here is** `ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)`, headed,
on the GPU lane (`SEELITE_PROBE_RENDERER=hardware`), build `8a5903a1cec3c6887c41c3885a8dff333b973500`
(the instrument commit; `src/` is `origin/main`'s at `adc63328`), 1440x900, at the pixel ratio its table
names. Each row of each JSON file carries renderer, build and lane, and the instrument refuses a lane that
is not the GPU lane, so a SwiftShader run cannot produce a file.

## What was measured

`node scripts/measure-planet-cost.mjs --close-detail`, subject `planet-4` of the canonical world (seed 47),
the native terran body with its own weather shell, framed as `planet-terminator` is (sun 70 degrees off the
camera's line), chase view, clock re-pinned before every cell. The relief path of the subject is pinned in
every cell, so the cube bake never takes it over. Eight arms, each a complete state; every arm other than
`interim` moves exactly one lever off it:

| arm | lever moved off `interim` | node #720 |
| --- | --- | --- |
| `interim` | none: High, the game's own cap (6), half-res ground, screen-space relief, clouds on their own footprint | D10 |
| `cap-0` | the band off | D10 |
| `cap-2`, `cap-4`, `cap-6` | the cap ladder (`cap-6` is the interim state reached through the override) | D10 |
| `full-res` | ground drawn at full resolution inside the band | D11 |
| `analytic-gradient` | analytic relief instead of screen-space | D8 |
| `clouds-at-ground` | the clouds' pixel angle taken from the ground's half-res target | D9 |

Cap and clouds share one cap uniform, so `cap-N` moves the ground's and the clouds' extra octaves together.

**Order.** The 8 arms x 5 radii (200 radii as the run's own invariant, plus the four) are one list,
shuffled from a printed seed, with no arm twice in a row. The sweep ran twice per pixel ratio, with seeds
20261027 and 20261028, and a third time at ratio 2 with 20261029 (see the S1 cells below). Each cell is
the median of five readings of the `?fps` meter after a settle; the drift control (`interim` at 200R) is
read before and after each run.

**Every arm is read back from the page before its cell is accepted**: the ground's and the cloud shell's
cap, whether the half-res target engaged, the relief path drawn, the clouds' pixel angle against the
ground's, High quality and a render scale of 1. A cell whose state is not the arm's is a throw.
At 2, 1.6, 1.5 and 1.2 radii the unpinned game draws `screen-space`, half-res, cap 6 and the footprint
program, so `interim` is the frame the player gets, and every cell inside the band except `cap-0` drew the
footprint program.

Raw output, the JSON per run and the joined tables are in `docs/receipts/node-758-runs/`.

## Pixel ratio 2

Frame time, ms, and the rate that implies, **middle of the three sweeps** (S1/S2/S3 in `report.md`). The
rate is what the unthrottled `rAF` meter reads, not what a display shows.

| arm | 2R | 1.6R | 1.5R | 1.2R |
| --- | --- | --- | --- | --- |
| `cap-0` (band off) | 8.3 (120 fps) | 10.7 (94 fps) | 11.6 (86 fps) | 11.8 (85 fps) |
| `cap-2` | 8.8 (114 fps) | 11.8 (85 fps) | 12.9 (78 fps) | 13.4 (75 fps) |
| `cap-4` | 8.8 (114 fps) | 12.6 (79 fps) | 13.9 (72 fps) | 14.8 (67 fps) |
| `cap-6` | 8.6 (116 fps) | 12.7 (79 fps) | 14.1 (71 fps) | 15.8 (63 fps) |
| `interim` (cap 6, shipped) | 8.6 (117 fps) | 12.6 (79 fps) | 14.0 (72 fps) | 15.8 (63 fps) |
| `full-res` | 14.6 (69 fps) | 22.6 (44 fps) | 26.0 (38 fps) | 29.5 (34 fps) |
| `analytic-gradient` | 10.0 (100 fps) | 14.9 (67 fps) | 16.9 (59 fps) | 19.2 (52 fps) |
| `clouds-at-ground` | 8.7 (116 fps) | 12.2 (82 fps) | 13.5 (74 fps) | 15.4 (65 fps) |

Read as differences, ms (positive costs more):

| question | 2R | 1.6R | 1.5R | 1.2R |
| --- | --- | --- | --- | --- |
| what the band costs: `interim` minus `cap-0` | +0.3 | +1.9 | +2.4 | +4.0 |
| ladder over no band: `cap-2` minus `cap-0` | +0.4 | +1.1 | +1.3 | +1.6 |
| ladder over no band: `cap-4` minus `cap-0` | +0.5 | +1.9 | +2.3 | +3.1 |
| ladder over no band: `cap-6` minus `cap-0` | +0.3 | +2.0 | +2.5 | +4.0 |
| full-res ground: `full-res` minus `interim` | +6.0 | +10.0 | +12.1 | +13.7 |
| analytic relief: `analytic-gradient` minus `interim` | +1.4 | +2.3 | +2.9 | +3.4 |
| clouds on the ground's footprint: `clouds-at-ground` minus `interim` | +0.1 | -0.4 | -0.5 | -0.4 |

What the numbers say, without choosing:

- The band's cost grows as the camera closes and with the cap: at 1.2R it is 1.6, 3.1 and 4.0 ms for caps
  2, 4 and 6, so the last two octaves cost less than the middle two. At 2R, where the fade has taken the
  octaves to zero, it is 0.3 to 0.5 ms. The unpinned game draws the footprint program there (printed by
  every run), which is consistent with a small fixed cost of the program with no octave to add; the
  sweeps did not isolate it.
- Full resolution on High costs 6 to 14 ms more than the half-res ground: 29.5 ms against 15.8 at 1.2R,
  1.9 times the frame. It takes 1.6R, 1.5R and 1.2R under 60 fps on this machine.
- The analytic relief costs 1.4 to 3.4 ms more than screen-space on this renderer.
- Capping the clouds at the ground's footprint saves 0.4 to 0.5 ms at 1.6, 1.5 and 1.2R; the clouds'
  extension costs about that much.

## Pixel ratio 1

Mean of the two sweeps. **Nothing but the full-res ground is resolved at this ratio.**

| arm | 2R | 1.6R | 1.5R | 1.2R |
| --- | --- | --- | --- | --- |
| `cap-0` | 5.6 | 6.7 | 6.7 | 6.9 |
| `cap-2` | 5.6 | 6.5 | 6.6 | 6.9 |
| `cap-4` | 5.5 | 6.9 | 6.9 | 6.8 |
| `cap-6` | 5.3 | 6.8 | 6.8 | 6.7 |
| `interim` | 5.4 | 6.9 | 7.2 | 6.9 |
| `full-res` | 6.9 | 7.8 | 8.5 | 9.2 |
| `analytic-gradient` | 5.1 | 6.8 | 7.0 | 7.4 |
| `clouds-at-ground` | 5.6 | 6.4 | 6.6 | 7.1 |

The frame at this ratio is 5 to 7 ms, and the widest column (a planet of a few pixels) already reads 4 to
5 ms, so the planet is not most of the frame. The band, the cap ladder, the analytic relief and the clouds
all sit inside a spread of about 1 ms, which is also the size of the cells' own readings (the full range
across the five readings of one cell is typically 0.3 to 1.5 ms) and of the two sweeps' disagreement (median 0.23 ms, at most 1.14 ms).
`interim` minus `cap-0` is -0.3, +0.2, +0.5 and +0.0 ms; those four numbers do not establish a cost, and
they are not a measurement of zero. Full-res costs +0.9 to +2.2 ms here, which the instrument does resolve.

## Implausible readings, and what explained them

**Three cells in the first protocol read the previous cell's cost for their opening readings.** The first
four sweeps (the same build, median of five, no re-read) held `cap-6` at 1.5R in the first ratio-2 sweep at
27.9, 27.2, 22.0, 14.0, 13.9 ms straight after `full-res` at 1.5R (25.8), `cap-2` at 1.6R at 30.7, 30.7, 16.5,
11.7, 11.7 after `full-res` at 1.2R (29.2), and `cap-0` at 1.5R at 24.4, 14.1, 11.3, 11.5, 11.4 after
`full-res` at 1.6R (22.5). In each the settle had passed on readings still at the old level, and the median
of five landed between the two states (22.0, 16.5, 11.5). Of 160 cells, every steady one had a
first-two-against-last-two trend of 0.25 or less and these three had 0.97, 1.62 and 0.68. All three follow
a `full-res` cell; of eight cells that followed an in-band `full-res` cell at ratio 2, those three were
affected. An isolated repeat (seed 6, `full-res` then `cap-6` at 1.5R) did not reproduce it
(25.4-25.8 then 14.1-14.4). **The mechanism is not established.** What is established is the shape (a tail
at the predecessor's cost, then the cell's own cost, converging on what the other sweep reads) and that a
median of five cannot recover it. The instrument now measures the trend (`cellTrend`, limit
`CELL_TREND_LIMIT` = 0.4, in the gap between 0.25 and 0.68), reads such a cell again after a fresh settle up
to three times, records what it discarded, and throws if the third read still moves. The first-protocol
cells are in `node-758-first-protocol-anomalies.txt`; **no figure above comes from that protocol.** In the
final five runs seven cells were read again (listed in `report.md` and each run's `.txt`): five at ratio 2
with the same shape, and two at ratio 1 where the opening reading was a single spike (`full-res` at 200R,
4.2, 8.2, 5.3, 4.2, 4.3) or a short decay (`cap-0` at 2R, 5.9, 5.6, 4.3, 3.8, 4.0).

**One of the three ratio-2 sweeps (S1) has four cells 1.7 to 2.5 ms above the other two.** `cap-2` at 1.5R
14.53 (12.76 and 12.85 in S2 and S3), `analytic-gradient` at 1.6R 17.36 (14.90 and 14.93), `cap-6` at 1.2R
18.02 (15.75 and 15.80) and `cap-6` at 1.5R 16.47 (14.12 and 14.08). They are positions 30, 31, 33 and 39
of that run's 40 (counted from 0), each steady inside its cell (trend under the limit), and none follows a `full-res` cell
except the last, which was read again and then settled at 16.5. The instrument's own check saw it: the
control pair, `interim` minus `cap-6` (one state reached two ways), is -2.37 and -2.29 ms at 1.5R and
1.2R in S1 and between -0.14 and +0.12 ms everywhere in S2 and S3. **The cause is not established**; it
is consistent with load outside the run (the host's load average was 5.6 at the start and other jobs share
this GPU), and the 200R cells of that sweep alternate between 3.7 and 5.9 ms. S2 and S3 agree with each
other to a median of 0.10 ms (at most 0.92 ms, `full-res` at 1.5R), and the table above takes the middle
of three, which discards S1's four cells without selecting them by hand. If the S1 cells were taken at
face value, `cap-6` would cost 2.3 ms more than `interim` at 1.2R although they are the same state.

**The 200R column is not flat.** A planet of a few pixels should cost every arm the same, and the cells
there span 3.7 to 6.2 ms across the ratio-2 sweeps (3.7 to 5.9 within the first) and 3.9 to 5.3 ms across
the ratio-1 sweeps. The invariant the
instrument checks is a factor of two, which it passes, so this receipt reads the column as a statement of
the noise at the CPU-bound far end: differences under about 1 ms at ratio 1 are not resolved by one
sweep. At ratio 2 the quantities this receipt reports are several times that.

**Drift controls** (`interim` at 200R before and after): ratio 1, 4.86 to 5.16 and 4.39 to 5.33 ms; ratio 2,
5.34 to 5.90, 5.71 to 6.01 and 5.65 to 5.16 ms. Two endpoints cannot locate a mid-run sag, which is why the
control pair and the repeats above carry the argument.

## What the sweeps do not say

- Nothing here is a ceiling, a cap, a verdict on the half-res ground or a choice of relief path.
- The table prices `planet-4` at sun angle 70 degrees from one camera pose per radius. Other bodies, other
  sun angles and a station in frame were not varied.
- Pixel ratio 2 is a 2880x1800 buffer on a 1440x900 viewport. A display or a Resolution setting other than
  those two was not measured, and Auto resolution is refused by the instrument.
- Frame rates are the unthrottled `rAF` rate of the meter, not a display's.
- The look of the band at each cap is the principal's by eye (`cp-seelite-footprint-octaves-terran`); no
  figure here says whether a cap is legible.

## Changes

- `scripts/lib/planet-cost.mjs`: the arm roster and its refusal, the shuffled interleaved sweep order, the
  arm-landed read-back check, the figure identity (renderer, pixel ratio, build SHA, lane), the build and
  lane readers, the arm deltas, the control-pair gap, the cross-sweep agreement and the cell trend.
- `scripts/measure-planet-cost.mjs`: `--close-detail` (with `--ratios`, `--seed`, `--label`, `--arms`).
- `scripts/report-close-detail-cost.mjs`: joins the sweeps into the tables in `report.md`.
- `tests/planet-cost.test.ts`: 67 tests, each new guard asserted from both sides.
- The game's `src/` is unchanged. This is not a major change under `src/changelog.ts`'s definition.

## Verification

- `bun test tests/planet-cost.test.ts`: 67 pass. Typecheck, biome format and lint, ESLint and the comment
  baseline guard are clean; `check-launcher-wiring` is ok.
- The instrument ran on the hardware lane as above. A reduced run first showed the stamped rows carry the
  build marked `+dirty` while the tree was. **No browser run was seen to refuse an arm:** the read-back
  checks are asserted headless from both sides, and every cell of the final runs passed them.

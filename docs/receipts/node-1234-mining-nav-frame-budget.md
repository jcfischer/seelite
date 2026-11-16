# The Navigation list's frame budget under `?mining=1` — node #1234

## Result

The budget is the principal's ruling of 2026-11-13 (via node #1242): on the
populated charted cockpit path with `?mining=1`, the **whole frame stays at or
under 16.7 ms (60 fps), paint included**, measured on the quiet hardware GPU
lane against a paired run of the same path with the flag off. Interaction
latency was not ruled on and is measured below.

On that path at the **shipped antialiasing default (off)**, the frame now holds
60 fps with one late interval in 833. Before this change it dropped 8.2% of its
intervals (68 of 833). Two runs of the same change agree.

At **2x antialiasing**, the frame still spends 9.43 ms of main thread on the
list and drops 7.8% of intervals (65 of 833). That is **over the budget**, and
the gap is
returned to the principal rather than closed: 2x is a player-chosen lever the
game ships off, `settings.ts` prices it at about four times the frame, and the
remaining cost is the projection and formatting of 596 rows per frame, which
this change does not touch (its `script` term reads the same 4.4 ms before and
after).

## The change

One declaration in the live cockpit's stylesheet, in `src/live-cockpit.ts`:

```css
.lc-nav-list > li { content-visibility: auto; contain-intrinsic-size: auto 45px; }
```

A populated charted field puts 606 rows in the Navigation list and the panel
shows **six** (`domRowsInView: 6` in every run below). The browser laid out,
restyled and recorded the paint of all 606 on every frame the printed ranges
changed, which is every frame. `content-visibility: auto` skips layout, style
and paint for the rows outside the scrollport; `contain-intrinsic-size` gives a
skipped row its own pitch (45 px) so the scroll height stays sane, and the
`auto` keyword replaces the estimate with the measured height once a row has
rendered.

**The visible rows are unchanged in text, position and size.** Measured on one
held frame, both with and without the declaration: the same six rows, at the
same offsets (0, 45, 90, 135, 179, 224 px) and the same 43 px height. The whole
scroll height moves from 28,448 to 28,314 px (−0.47%), which is the estimate the
unseen rows carry until they render.

**Glyph rasterisation inside the rows does change.** Two captures of the same
mode 1.5 s apart differ in 0 pixels; the capture with the declaration and the
capture without it differ in 13,836 pixels — 0.392% of the panel, worst channel
delta 200, every one of them on a row's glyphs and none on the panel, the
chrome or the rows' geometry. Paint containment changes how the text is
rasterised. Captures: `/tmp/nav-identity-cv-top.png`,
`/tmp/nav-identity-plain-top.png`, and the marked diff
`/tmp/nav-identity-diff.png`. **The principal's yes on that difference is owed**,
and it is the only visible consequence of this node.

**A contained row paints on the panel's second frame, not on the tick it is
written.** Skipping the layout and paint of a row means it is laid out and
painted at the next rendering opportunity, so a DOM read on the tick the list is
built sees the row's box inside the scrollport with no rendered text. Measured
on this path's own list: `innerText` was `""` on that tick and after one
`requestAnimationFrame`, carried the row after the second, and still carried it
200 ms later. `probe-derelict.mjs` read the row on that tick, so its `visual
floor writes knowledge and paints selectable Navigation wreck` check failed
against the empty string; the probe now waits for the row to have painted, which
is what that check always meant.

**The declaration is not scoped to the rows below the scrollport, and that is
measured, not assumed.** `li:nth-child(n + 7)` leaves the six rows the 234 px
panel can show out of the containment, and on this path that costs 3 ms of task
and the dropped intervals back: 9.66 ms of task with 30 late of 357 intervals,
against 6.67 ms with 1 of 357 for the whole list. Paint containment is what keeps
the visible rows' redraw from invalidating the panel around them, so exempting
them gives up most of the win.

## Workload and method

`scripts/measure-mining-nav-budget.mjs`, run on 2026-11-13 (four runs, all on
clean head `48d5fd4f1cd2615a04e1e0e768c5d2441cb6b6cb`, instrument SHA-256
`70a99c99962c…` recorded in each `summary.json`).

- Hardware lane, refused unless the player's renderer answers:
  `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)`.
- World `0x5ee11e`, system 173, charted `field-00`: 596 production rocks, 606
  Navigation rows (596 rock rows, 78 disabled by the 40 km target limit), 158
  rocks inside 8 km of the camera. Quality high, 1440x900 at device scale 2.
- The densest cleared stand beside the densest rock, the cockpit looking left at
  the Navigation tab, drifting 50 m/s through the cluster as the field's own
  centre velocity carries it. Every rock surveyed, so every row is populated.
- Three arms, shuffled from seed 1234 over 6 blocks after 20 warm frames each,
  plus one unshuffled pass of all three before the blocks. `FRAMES=120` records
  119 intervals per pass (the first is spent opening the loop), so every arm
  reads **833 intervals**:
  - `nav-mining` — `?mining=1`, the tab on screen;
  - `nav-off` — the same path, camera and tab with the flag off (10 rows);
  - `forward-mining` — `?mining=1`, head forward, so no rows are built. **The
    control.**
- The display's pacing is left on. The whole-frame figure is the
  `requestAnimationFrame` interval, which carries paint and compositing: a frame
  that fits is presented on its refresh, and one that does not is presented late.
  A frame is **late** when its interval exceeds 25 ms — one and a half budgets,
  because a display can only present on a refresh and a 120 Hz panel's
  two-refresh frame jitters either side of 16.7.
- The late share is **pooled over every interval the arm sampled**: late
  intervals counted over intervals read, summed across the passes. It is never a
  median, mean or mode of the passes' shares, because those are shares of shares
  and a run can drop a tenth of its frames from one pass of three while the
  median pass reads 0% — which is exactly the run this budget exists to catch.
  Each pass in `summary.json` therefore records `late` (how many of its
  intervals ran past 25 ms) and `frames` (how many intervals it read), and the
  control's guard reads the same pooled figure.
- Chrome's own counters give the main-thread split over the same frames: task,
  script, recalc-style and layout. Paint *recording* is inside the task; raster
  and compositing are inside the interval.
- The flag-on and flag-off pages are one browser. Only one page draws at a time:
  the other's `requestAnimationFrame` is replaced with a recorder, and the run
  refuses itself unless both its frame counter **and its game clock** hold still
  for 250 ms before and through the arm. Without that, both pages drew and the
  first run priced the flag against a machine running two copies of the game.
- Quiet host: a 1-minute load average below 5 before and through every block
  (recorded 1.86–4.45 on 18 cores), zero page errors in all four runs.
- A row press is timed from the dispatch to the frame that shows it selected,
  12 presses per arm after a warm frame.

**`--disable-gpu-vsync --disable-frame-rate-limit` was tried and withdrawn.**
With the pacing lifted, `requestAnimationFrame` runs ahead of the presented frame
and the interval stops containing the frame's own cost: one arm read 14.20 ms of
period beside 15.03 ms of main-thread work, which is not a frame. A lifted run
is the right instrument for pricing one term against another inside a frame, and
the wrong one for asking whether the frame fits.

## Measurements

Per-frame medians of the passes for period, task, script, style and layout.
`late` is the **pooled** share — late intervals over intervals sampled, with the
count it came from. The four runs archived under `/tmp` recorded the per-pass
shares rather than the counts; every pass read the same 119 intervals, so the
pool of those shares is their mean and the counts below are exact.

### At the shipped default, antialias off

| Arm | period ms | late | task ms | script | style | layout |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `nav-mining` before | 16.60 | **8.2%** (68/833) | 12.95 | 4.33 | 0.64 | 4.89 |
| `nav-mining` after | 16.70 | **0.1%** (1/833) | 6.46 | 4.33 | 0.13 | 1.09 |
| `nav-off` (flag off) | 16.60 / 16.70 | 0.1% / 0.0% | 2.64 / 2.68 | 2.12 | 0.05 | 0.12 |
| `forward-mining` (control) | 16.60 / 16.50 | 0.0% / 0.1% | 2.99 / 3.07 | 2.74 / 2.83 | 0 | 0 |

Added main-thread time, `nav-mining` over the flag-off run: **+10.32 ms**
before (49/49 block pairings) and **+3.78 ms** after (49/49), of which `layout`
is +4.77 before and +0.97 after, and `style` +0.59 before and +0.08 after. Over
the head-forward control the same delta is +9.96 before and +3.39 after.

So the change takes 6.5 ms of main-thread work and the dropped intervals with
it: the frame goes from a median of 16.60 ms with 8.2% of its intervals late
(one in twelve) to 16.70 ms with one late interval in 833. The task figure also
carries the list's own scenario
variance between runs (the pre-change runs read 12.95 and 13.99 ms at the two
antialias settings), which is why the paired deltas are the figures to quote.

### With 2x antialiasing, the player's lever

| Arm | period ms | late | task ms | script | style | layout |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `nav-mining` before | 16.50 | **8.3%** (69/833) | 13.99 | 4.57 | 0.69 | 4.88 |
| `nav-mining` after | **16.60** | **7.8%** (65/833) | 9.43 | 4.42 | 0.75 | 1.62 |
| `nav-off` (flag off) | 16.60 / 16.70 | 0.0% / 0.1% | 2.72 / 2.57 | 2.11 / 1.98 | 0.05 | 0.12 |
| `forward-mining` (control) | 16.60 / 16.70 | 0.0% / 0.0% | 2.85 / 2.47 | 2.63 / 2.27 | 0 | 0 |

Added over the flag-off run: +11.27 ms before, +6.85 ms after. **The budget is
not met here.** The control holds every frame while the list is on screen and
the list costs 6.85 ms more than it does with the flag off, so the overrun is
attributable rather than noise: the frame's own work at 2x plus the list's
6.96 ms over the control does not fit one refresh. What is left of the list is
`script` — the per-frame projection and formatting of 596 rows — which this
change does not touch and which reads 4.4 ms at both antialias settings.

**Decision owed:** accept the 2x gap (7.8% of intervals late, 9.43 ms of main
thread) or set the budget as applying to the shipped default and treat 2x like
every other affordability lever in `settings.ts`. A further slice could virtualise
the list so only the rows in the scrollport are projected and formatted, which is
where the remaining 4.4 ms lives.

### Interaction latency (measured, not ruled)

Press to the frame that shows the row selected, 12 presses per arm after a warm
frame:

| Run | `nav-mining` median / max | `nav-off` median / max |
| --- | ---: | ---: |
| AA off, before | 38.5 / 43.4 ms | 32.6 / 32.8 ms |
| AA off, after | **30.6 / 33.6 ms** | 32.7 / 32.8 ms |
| AA 2x, before | 54.4 / 71.7 ms | 32.6 / 33.2 ms |
| AA 2x, after | **29.1 / 50.6 ms** | 32.7 / 33.0 ms |

A press on the populated list used to cost 6–22 ms more than one on the flag-off
list; after the change it costs the same as a list of ten rows. The earlier
pre-change run of the same instrument read 51.4 ms median / 59.2 ms max at AA
off, so the press figure carries a run-to-run spread of about 13 ms and the
comparison to make is within a run.

## Reproduction

```sh
SEELITE_PROBE_RENDERER=hardware node scripts/measure-mining-nav-budget.mjs
SEELITE_PROBE_RENDERER=hardware ANTIALIAS=2 node scripts/measure-mining-nav-budget.mjs
```

`BLOCKS`, `FRAMES`, `PRESSES`, `ORDER_SEED`, `OUTPUT`, `WORLD`, `SYSTEM`,
`KIND`, `ANTIALIAS` and `MAX_LOAD` are overridable. `FRAMES` is not free below
the documented 120: a pass of 59 intervals is dominated by the frames just after
its ship is re-stood. The same scene read 8.5% late and 10.17 ms of task at
`FRAMES=60`, where 119-interval passes read 0 late of 357 and 6.63 ms, and the
instrument warns when it is run that short. Each run writes
`summary.json` (provenance, host samples, every pass's readings — a median
period and a main-thread share per meter, plus the late-interval count and the
interval count that the pooled late share is computed from — per-arm facts,
presses and the summarized table) under `OUTPUT`, which defaults to
`/tmp/seelite-mining-nav-budget-1234`. The four runs behind the tables are at
`/tmp/seelite-mining-nav-1234-aa0-before`, `-aa0`, `-aa2-before` and `-aa2`.

Re-read after the pooled-late fix, at the documented pass length and 2 blocks:
`nav-mining` 16.70 ms period, 0 late of 357 intervals, 6.63 ms of task;
`nav-off` 2.78 ms; `forward-mining` 3.16 ms (`/tmp/seelite-mining-nav-1234-smoke120`).
That reproduces the after column of the table below.

The instrument refuses, rather than reports: a software rasteriser; two pages
that are not the same field; a page that will not hold still while another arm is
measured; an arm with missing readings or readings that are not costs; a control
that dropped its own frames; a late count that is not a count or that exceeds
its pass's interval count; and a page error.

The arithmetic — the budget, the late-frame rule, the paired deltas and the
verdict — is `scripts/lib/mining-nav-budget.mjs`, and
`tests/mining-nav-budget.test.ts` covers the refusals, the exactly-at-budget
boundary, the "median inside the budget but frames dropped" case, and the
pooled-late rule: one late pass of three, a late minority outvoted by four quiet
passes, a control that late pass refuses, and a pool weighted by the intervals
each pass read rather than by the number of passes.

## Verification

Headless: `tests/mining-nav-budget.test.ts` (27 tests). Browser: the change is
in the cockpit's Navigation list, so `probe-navigation-console.mjs` covers it —
74/74 checks passed on the branch, and `probe-derelict.mjs` 23/23 with its
Navigation row read once painted. A same-mode capture pair 1.5 s apart is
identical pixel for pixel, which is what makes the 0.392% mode difference an
attributable difference and not camera noise.

Re-ran the documented smoke pass on the reviewed head after the probe fix
(`BLOCKS=2 FRAMES=120`, AA off, hardware lane): `nav-mining` 16.60 ms period, 1
late of 357 intervals, 6.67 ms of task; `nav-off` 2.77 ms; `forward-mining` 3.26
ms; added over the flag off 3.90 ms of task in 9 of 9 block pairs, verdict
"within the 16.7 ms budget by 0.10 ms, 0.3% of frames late"
(`/tmp/seelite-mining-nav-1234-uncond`).

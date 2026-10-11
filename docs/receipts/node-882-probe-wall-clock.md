# Node #882 — probe wall clock: an idle baseline, and the two slowest rows

Branch `node/882-probe-wallclock`. Checkpoint
`probe-wallclock-idle-baseline-music-opening`: *the suite's slowest rows have a
measured idle baseline and at least one of them is demonstrably shorter, with
the gate still green.*

Logs. `npm run probe`: `/tmp/seelite-882-before.log` (the idle baseline),
`/tmp/seelite-882-after.log` (the round-1 tree, kept because §6 attributes its one
red) and `/tmp/seelite-882-after2.log` (the final tree, the one to quote).
Headless: `/tmp/seelite-882-test3.log`. `probe-opening` alone, before its rows
changed and on the final tree: `/tmp/seelite-882-opening-rows.log` and
`/tmp/seelite-882-opening-step5.log`. The music render sweep:
`/tmp/seelite-music-bands.log`. Sage: `/tmp/seelite-882-sage.log` (round 1) and
`/tmp/seelite-882-sage2.log` (round 2, two lenses failed to run so it does not
count as the round). PR: [**#884**](https://github.com/jcfischer/seelite/pull/884).

## 0. The request, and what it turned out not to be

The timings that started this — `probe-music` 410.8 s, `probe-opening` 422.5 s —
came from a suite that was running while other things were too. That is worth
saying once because it is the easy explanation and it is mostly **wrong**.
Same 63 probes, one agent's sample against an idle re-run:

| probe | contended | idle | |
|---|---|---|---|
| `probe-occlusion` | 52.2 s | 17.9 s | ×2.9 |
| `probe-hud` | 59.3 s | 34.8 s | ×1.7 |
| `probe-ai-intent` | 57.6 s | 37.7 s | ×1.5 |
| `probe-binding-store` | 73.9 s | 67.8 s | ×1.1 |
| `probe-music` | 410.8 s | 379.9 s | ×1.08 |
| `probe-opening` | 422.5 s | 395.9 s | ×1.07 |
| 63 probes, total | 1992 s | 1810 s | ×1.10 |

Contention is worth ~10% of a suite and nearly 3× on a GPU-bound probe. It is
worth nothing on the two rows that dominate. Those two are slow **by
construction**, and only construction is available for them.

## 1. The baseline (O1), idle

`npm run probe` with nothing else on the machine: **100/100 in 2356.8 s**, peak
load 12.0 on 10 cores. The slowest five are 1046 s — 44% of the suite — in one
sequential lane:

`probe-opening` 395.9 · `probe-music` 379.9 · `probe-audio-cues` 142.4 ·
`probe-binding-store` 67.8 · `measure-cruise-detour` 60.2

## 2. What shipped

**A run says what it was running on** (`scripts/lib/probe-contention.mjs`,
`probe-all.mjs`, `probe-guard.mjs`). A direct run while the suite holds the lock
prints who holds it and that its timings are not trustworthy; a suite child
stays quiet, and a suite that is the holder does not warn about itself. A **green**
probe over a minute now prints its peak load too — only reds carried a figure
before — and the runner ends with a new line naming the slowest probes and their
share of the total. (The trailing peak-load line itself is #84's, not this node's.)
Both are cheap and both are the thing that was missing — this whole node exists
because a number was read as a defect.

**Four opening rows reach their shot through the game's phase handle instead of
waiting for it** (`probe-opening.mjs`, commit `353ef579`). Enter during the
cruise shot, click SKIP, and the two quit rows each waited in wall clock for a
shot the page could have been put in directly. The row that *watches* the
opening still watches it — that row's claim is the wall clock.

**The seed sweep steps the script instead of watching it** (`probe-opening.mjs`,
commit `f41f1c2b`), which needed a change in `src/opening.ts` — see §4.

**A direct run names the renderer lane it took** (`probe-guard.mjs`, commit
`25a26c80`). `npm run probe` forces the GPU lane and `probe:cpu` names the
software one; a bare `node scripts/probe-x.mjs` sets neither and gets a
SwiftShader page in silence. Measured here: the same boot reached a first frame
in 1.6 s on the GPU lane and never got there inside `bootedGame`'s 20 s on the
software one — which reads as a page that will not boot.

## 3. The opening rows: 395.9 s → 138.9 s

Attributed by timestamp, before (`/tmp/seelite-882-opening-rows.log`):

| the time went to | before | after |
|---|---|---|
| the per-frame seed sweep, 5 seeds | 217 s | ~30 s |
| the 4 rows that waited for a shot | 88 s | 12 s |
| two watched openings | 61 s | 61 s — still watched |
| everything else | 30 s | 47 s |

The after-column is the **suite** figure for the final tree (`probe-opening`
138.0 s in `/tmp/seelite-882-after3.log`; 138.9 s on the round-2 tree) — the same conditions as
the 395.9 s before it. The standalone re-runs of that probe read 156.4 s, and this
branch's own notice says why that number is not the one to quote: that run shared
the machine with the suite and prints “Nothing in this run is evidence about how
long anything takes.” Comparing a contended after-time to an idle before-time is
the mixed-conditions read this node exists to prevent (sage round 4 on #884).

**33/33 checks** — the 28 the watched version ran, plus one stride check per
seed (§4). The watched rows are untouched on purpose: they
are the evidence that the sequence *looks* right, and a hold runs no wall time.

## 4. `advanceTo`, and why the sweep could not be stepped before

`OpeningRun.advanceTo` treated an aim past the end of the aimed shot as
impossible and kept stepping after it: the whole rest of the script, then a
throw. Measured on seed 47 — `the opening ended before forming at 3.0166 s` —
after 181 steps of a script that samples about 3,700 of them. That is correct for a caller that wants
a moment and cannot get it, and fatal for one that walks the script a step at a
time and wants the boundary.

Now the shot's own end counts as arriving; the caller reads `shot` afterwards to
learn whether it got its time or the boundary. Test first in
`tests/opening.test.ts`; the whole headless suite is green with it — **5857 pass,
0 fail** (`/tmp/seelite-882-test2.log`) — and `tsc --noEmit`, `biome format` and
`npm run check:wiring` are clean.

**Both ways at one build on seed 47**, in that order (`/tmp/seelite-step.log`,
`/tmp/seelite-882-opening-step2.log`):

| | watched, every frame | stepped, every step |
|---|---|---|
| `takeJumpR` / `takeTurnDeg` | 0.0293 / 0.80 | **0.0293 / 0.80** |
| `closestR` | 6.206 | 6.206 |
| `worstOffDeg` | 19.05 | 19.36 |
| one seed | 44 s | 4 s |

The table's figures came from a sampler whose stride was wrong (§4's second half), so read it as a timing comparison only.

What it shows less of is the arrival's **look**: that runs on wall time, and a
hold runs none of it. The row's own comment says it is evidence about the camera
and the ship through the script, never about what the flicker looked like on a
person's screen — that stays with the watched row, the frames it writes to disk,
and `npm run views`.

### The stride was one step too wide, and a review caught it

The sampler that produced the figures above aimed each step by a `1 / 60` it had
typed itself and believed it was seeing every step. It was not: a shot shown at
1.5x or 2x moves the script's shown clock by *less* than `dtS` per step, so aiming
`dtS` at the cruise, approach and dock shots swallowed two steps at a time — and
since `closestR` and `worstOffDeg` are min/max over those rows, the fly-by's worst
framing could fall between samples and still pass. And the equivalence table above is
**not evidence about the corrected sampler**: it was measured with that too-wide
one, and `closestR`/`worstOffDeg` are computed over every row rather than over the
arrival alone, so it was never a control on the stride — it passed while the stride
was wrong. Sage's round 1 on PR #884 named the defect; round 3 named this sentence
about it.

And the figures did not move — which
is a finding, not a clean-up. Measured at one build on all five seeds, three
samplers, full precision (`/tmp/seelite-882-ladder.log`):

| sampler | rows, seed 47 → 51 | `closestR` | `worstOffDeg` | `takeTurnDeg` |
|---|---|---|---|---|
| watched, every frame | 4541, 4373, 4586, 4463, 4722 | 6.197014 … 6.197024 | 20.000000 | 0.7978 |
| stepped, the script's stride | 3702, 3551, 3648, 3562, 2852 | **identical** | **identical** | **identical** |
| stepped, the too-wide stride | 2273, 2197, 2246, 2203, 1847 | **identical** | **identical** | **identical** |

So on these seeds the figures this row gates were **insensitive to the stride**: the
too-wide sampler was not passing on a framing the corrected one now catches, and an
earlier draft of this section and of the probe's comment claimed it was. What the
stride check protects is the row's *claim* — that it sampled every step — and the
2852–3702 samples it takes are 2852–3702 distinct steps, where the watched row's
4373–4722 frames include the frames that ran no step at all.

What shipped instead:

- `src/opening.ts` owns the stride: `openingStepS(shot)` is
  `OPENING.dtS / shotRatio(shot)`, and it is now also what `unit()` steps by, so the
  arithmetic is spelled once. There was an `openingSteps(shot)` beside it claiming
  720 steps for the cruise shot — round 2's finding, since the leg sizes that shot —
  and its replacement, a whole `Record` of shot lengths, was round 4's: a table of
  lengths is a second spelling of the state machine that owns them. It is gone, and
  the headless test holds the walk to the stride itself, which needs no lengths:
  `advanceTo` by `openingStepS` advances `shownBy` by exactly that, or the test is
  red. Mutation-checked: aiming by `OPENING.dtS` turns it red.
- `Game.openingScript()` puts the shot order, the stride and the counts on the
  page, so the probe reads them off the module instead of restating them —
  CLAUDE.md's rule, which the first version broke twice over: its own shot-order
  array and its own `1 / 60`.
- The seed row checks the **stride**, not a row count: consecutive samples have to
  sit exactly one of the script's steps apart in the script's own shown clock, and
  `strideErr` comes out ~1e-16 on all five seeds. Counting rows per shot was the
  first attempt at the check and it was wrong — the cruise shot yielded 17 to 868
  rows across the five seeds, because the leg sizes that shot, which is why
  `openingSteps` says `null` for it now instead of the 720 it used to claim.
- `tests/opening.test.ts` pins it without a browser, and was mutation-checked:
  aiming by `OPENING.dtS` instead of `openingStepS` turns it red.

The saving stands — about 4 s a seed against 43 — and the sampler is finer than a
watched frame on every shot now, not on one of them.

## 5. The music row: measured, and left alone

`probe-music`'s 379.9 s is offline rendering, ~578 audio-seconds of it. Measured
throughput:

| pages | browsers | audio/s | wall for 578 s of audio |
|---|---|---|---|
| 1 | 1 | 2.34× | 247 s |
| 8 | 1 | 2.68× | 216 s |
| 2 | 2 | 2.30× | — |
| 4 | 4 | 2.50× | — |
| 8 | 8 | 2.55× | — |

**Parallelism does not scale.** Ten times the browsers buys 9%. A second
renderer lane would cost its own lock, port and evidence-directory rules to buy
25 s. Not taken.

The window cut was taken as far as the evidence allowed and then stopped
(`/tmp/seelite-music-bands.log`). Cutting every held bed to 8 s and each Danube
piece to its first 12 s instead of 20 takes 578 audio-seconds to 366 — 91 s of the
suite, 3.9%. What it costs:

| | at the shorter window |
|---|---|
| centroid (`hz`) | **identical on all 32** — the timbre claim survives |
| onset | **identical** — it is a script event, not a window |
| rms | −8% to −37% (music-calm-second −37%) |
| peak | **0 to −42%** — the bed's loudest moment is not in its first 8 s |

Peak is the clipping guard: the row compares against `MUSIC_CEILING_PEAK`.
Re-anchoring it downward means the guard would no longer contain the loudest
sample of the music it guards, for 21 of 32 renders, to save 3.9% of a suite.
The only windows that lose nothing are the two adaptive runs at 12 s — the scene
change they exist to test is at 10 s, and rms/peak/hz/onset come back identical
— and that is worth 7 s. Not taken either.

**This is the row that would not yield, and the reason is the evidence, not the
machinery.** If the suite's wall clock matters more than 3.9%, the honest way to
buy it is a second music-shaped row that renders a short window *in addition* to
the band rows — more time, not less — or 8-page parallel rendering inside the
one browser, worth ~25 s.

## 6. After

Two runs on two trees, both with the runner's own load figure printed:

| tree | suite | peak load | `probe-opening` | slowest five |
|---|---|---|---|---|
| before (`9ba7b893`, idle-ish) | **2356.8 s** | 12.0 | 395.9 s | 1046.2 s |
| PR round 1 (`d0d36dd6`, loaded) | 99/100 in 2250.9 s | 18.1 | 138.8 s | 819.8 s |
| round-2 tree (`4663dae8`) | **100/100 in 2223.7 s** | 23.9 | 138.9 s | 812.0 s |
| **final tree** (`1347f914`) | 99/100 in **2183.3 s** | 19.2 | **138.0 s** | **804.1 s** |

The last row is the one to quote: `/tmp/seelite-882-after3.log`. 2356.8 s to
2183.3 s is **7.4%** — less than `probe-opening` alone gave up (258 s of the suite,
11.0%), because `probe-music` took 388.1 s in that run against 379.9 s in the
baseline and nothing on this branch touched it. Peak load reached 23.9 on 10 cores
towards the end of a run nobody else was sharing the machine with, which is itself
the reason the figure prints on every slow line now.

**The one red is not this branch's.** `probe-station-interior-kit`'s
*cold install tail stays within its live-frame budget* failed on the `bay` view
with `installMaxMs` 66.6 ms against an 8.8 ms median, and passed on `flight`. It
reproduced alone on this branch twice and — run as its own checkout against its
own origin, `.worktrees/882-main-check` at `origin/main` `8b7a5871` —
**reproduced identically on main, twice, same check, same view**, at load 9.6 and
17.2. Nothing this branch touches is in that probe's path: not `probe-opening`,
not the runner, not `OpeningRun.advanceTo`. It is an assertion that does not
survive the machine being busy with something that is not another probe.

The round-2 run had it **green** and the final tree's run had it **red** again
(`99/100`, `/tmp/seelite-882-after3.log`) — and re-run alone, with the lock free, it
is **39/39 green** again at load 14. That is the SOP's own discriminator, "green
alone points at the machine", applied three times over two trees, and it is what
`#885` is about: the row is load-sensitive on a machine that is rarely quiet, and
nothing on this branch touches it.

That last sentence is the finding this node leaves behind. The lock guards
probe-against-probe. It cannot see a capture run, a compile, or a second agent —
and §0 measured that a loaded machine is worth ×2.9 on `probe-occlusion` and a
66 ms frame in a cold interior install. `probe-all` prints peak load for every
slow probe; a **direct** run that fails prints no load at all. That is the next
node.

## 6b. Sage on PR #884: three rounds, and what each changed

Verdict `changes-requested`: 17 findings, 3 important. The two that mattered were
both true and both about claims this receipt had made:

- **the stride was one step too wide** — §4's own sub-section.
- **the probe restated the opening's shot order**, which CLAUDE.md:742 forbids for
  the reason it gives: a probe holding its own copy of a constant goes falsely red
  when the module changes it. The order, the stride and the counts now come from
  `Game.openingScript()`.

Also taken: the four `holdToShot` rows read back the shot they landed on and assert
it (a row named "Enter during the cruise shot" stayed green off that shot, because
the end state it compares matches the skipped run whatever shot the hold reached);
`formatLoad` in one place instead of two rules for the same figure; one `printCondition`
helper instead of the say-once shape written twice; the unstable suite-size figures out
of CLAUDE.md and out of a duplicated test header, pointing at this receipt; the
renderer-lane sentence into the SOP paragraph that told people to re-run a red alone;
`rendererLaneNotice` back below the doc comment it had displaced; this receipt's
credit for #84's trailing peak-load line corrected; and the two glossary aliases
(§Opening now names the **held** way through it, and the `hold` alias note its sixth
sense).

Round 2 (`d0d36dd6`) came back `changes-requested` with two true findings of its
own — `openingSteps` asserting 720 steps for the cruise shot the leg sizes
(§4), and `openingStepS` duplicating arithmetic still inline in `unit()` — plus
collateral this branch had caused: a `biome format docs` run had reformatted another
node's evidence JSON, which is not this branch's to do and was reverted, twice,
because the second copy (`node-684-capacity-summary.json`) was found in round 3.
Two lenses failed to run in that round, so it does not count as the round; round 3
ran all seven and came back `commented`, and its one important finding was this
file's and the probe's own comment still crediting the abandoned row-count check.
Both are corrected here, along with: the `holdToShot` doc claiming every row that
uses it compares end states (the two quit rows assert named save/reload fields
instead, and now also the shot the hold landed on); the starvation story written
down four times with its figures drifting between copies, which now lives in
`probe-contention.mjs` and this receipt only; and `openingSteps`'s lack of a
production caller, accepted on the record — its caller is the headless test, and
the alternative is that test restating `OPENING`'s arithmetic one directory over.

Round 4 (`c552ee89`) kept finding true things: a sampler that stops early looked
like a sampler that saw the whole opening (the row now gates on `swept` and
`truncated`); the contention notice hung on `guardedTree`, a seam not every probe
passes, so it now also prints from `launchChromium`, which every browser probe
passes; one 1.6 s measurement lived in four files, so CLAUDE.md and the code and
test comments cite the receipt instead of restating it; `peak load` was spelled in
two branches, so `loadSuffix` spells it; the `23–47` load figure in the lib header
matched no retained run, so it names the shared suite it came from without the
number; and §3's headline after-time came from a run whose own first line disowns
its timings, so it quotes the suite instead. That round's seven lenses all ran.

Left, deliberately: the two older shot-order spellings inside `probe-opening.mjs`
that predate this branch — one is an assertion's own expected string — and
8-page in-browser render parallelism, measured at ~25 s for its own machinery.

## 7. Not done here

- The suite's *parallelism*, which is the only remaining lever of size and is a
  node of its own: a music-lane render in parallel with the game lane would need
  the machine-scaling above re-measured with the GPU lane in the mix, because
  two browsers were 2.30× — and `probe-occlusion` shows contention multiplies
  where pixels are involved.
- The 8-page in-browser render parallelism (~25 s), measured and left.
- The headless (`probe:cpu`) lane, which `probe-lock.mjs` says has never been
  run as a lane; §5's numbers say it would not be faster.
- `probe-audio-cues` (142.4 s), untouched: its cues are rendered whole, and a
  cue's whole body *is* what its row measures.
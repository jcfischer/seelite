# Node #882 — probe wall clock: an idle baseline, and the two slowest rows

Branch `node/882-probe-wallclock`. Checkpoint
`probe-wallclock-idle-baseline-music-opening`: *the suite's slowest rows have a
measured idle baseline and at least one of them is demonstrably shorter, with
the gate still green.*

Logs: `/tmp/seelite-882-before.log` (before), `/tmp/seelite-882-after.log`
(after, same tree as the four commits below), `/tmp/seelite-882-test.log`
(headless), `/tmp/seelite-882-opening-final.log` and
`/tmp/seelite-882-opening-step2.log` (the opening probe alone, before and after
its rows), `/tmp/seelite-music-bands.log` (the music render-window sweep).

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
stays quiet, and a suite that is the holder does not warn about itself. The
runner adds two lines at the end: peak load, and the slowest probes with their
share of the total. Both are cheap and both are the thing that was missing —
this whole node exists because a number was read as a defect.

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

## 3. The opening rows: 395.9 s → 137.5 s

Attributed by timestamp, before (`/tmp/seelite-882-opening-rows.log`):

| the time went to | before | after |
|---|---|---|
| the per-frame seed sweep, 5 seeds | 217 s | 17 s |
| the 4 rows that waited for a shot | 88 s | 12 s |
| two watched openings | 61 s | 61 s — still watched |
| everything else | 30 s | 47 s |

28/28 checks, same as before. The watched rows are untouched on purpose: they
are the evidence that the sequence *looks* right, and a hold runs no wall time.

## 4. `advanceTo`, and why the sweep could not be stepped before

`OpeningRun.advanceTo` treated an aim past the end of the aimed shot as
impossible and kept stepping after it: the whole rest of the script, then a
throw. Measured on seed 47 — `the opening ended before forming at 3.0166 s` —
after 181 of the script's ~2600 steps. That is correct for a caller that wants
a moment and cannot get it, and fatal for one that walks the script a step at a
time and wants the boundary.

Now the shot's own end counts as arriving; the caller reads `shot` afterwards to
learn whether it got its time or the boundary. Test first in
`tests/opening.test.ts`; the whole headless suite is green — 5855 pass, 0 fail —
with it.

**Both ways at one build on seed 47**, in that order (`/tmp/seelite-step.log`,
`/tmp/seelite-882-opening-step2.log`):

| | watched, every frame | stepped, every step |
|---|---|---|
| `takeJumpR` / `takeTurnDeg` | 0.0293 / 0.80 | **0.0293 / 0.80** |
| `closestR` | 6.206 | 6.206 |
| `worstOffDeg` | 19.05 | 19.36 |
| arrival rows | 710 | **360 = `arriveS / OPENING.dtS`** |
| one seed | 44 s | 4 s |

The continuity figures are identical and the framing figures agree to a decimal.
The row counts look backwards and are the point: 360 is every step the arrival
shot has, and the watched run's 710 frames cover those same 360 steps — a frame
shorter than the script's step samples the same camera twice. So the stepped
sampler is finer *and* free of duplicates.

What it shows less of is the arrival's **look**: that runs on wall time, and a
hold runs none of it. The row's own comment says it is evidence about the camera
and the ship through the script, never about what the flicker looked like on a
person's screen — that stays with the watched row, the frames it writes to disk,
and `npm run views`.

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
(`/tmp/seelite-music-bands.log`). Cutting every held bed to 8 s and the Danube
intro to 12 s takes 578 audio-seconds to 366 — 91 s of the suite, 3.9%. What it
costs:

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

`npm run probe` on the shipped tree: **99/100 in 2250.9 s**, peak load **18.1**
on 10 cores (`/tmp/seelite-882-after.log`) — 2356.8 s to 2250.9 s is **not** the
change's worth, because this run was not idle either: another agent's capture
servers were up through it, and the runner's own line says so.

The two rows this branch moved, from that run:

| | before | after |
|---|---|---|
| `probe-opening` | 395.9 s | **138.8 s** |
| `probe-music` | 379.9 s | 400.5 s — untouched, and the run was loaded |
| slowest five | 1046.2 s | 819.8 s |

**The one red is not this branch's.** `probe-station-interior-kit`'s
*cold install tail stays within its live-frame budget* failed on the `bay` view
with `installMaxMs` 66.6 ms against an 8.8 ms median, and passed on `flight`. It
reproduced alone on this branch twice and — run as its own checkout against its
own origin, `.worktrees/882-main-check` at `origin/main` `8b7a5871` —
**reproduced identically on main, twice, same check, same view**, at load 9.6 and
17.2. Nothing this branch touches is in that probe's path: not `probe-opening`,
not the runner, not `OpeningRun.advanceTo`. It is an assertion that does not
survive the machine being busy with something that is not another probe.

That last sentence is the finding this node leaves behind. The lock guards
probe-against-probe. It cannot see a capture run, a compile, or a second agent —
and §0 measured that a loaded machine is worth ×2.9 on `probe-occlusion` and a
66 ms frame in a cold interior install. `probe-all` prints peak load for every
slow probe; a **direct** run that fails prints no load at all. That is the next
node.

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
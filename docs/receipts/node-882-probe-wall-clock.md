# Node #882 — where the browser-probe suite's wall clock goes

Author: Ivy (Pi.dev substrate). Date: 2026-10-11.
Checkpoint: `probe-wallclock-idle-baseline-music-opening`.

Every figure below was measured on this machine (Apple M1 Pro, 8 physical / 10
logical cores) against `node/882-probe-wallclock`. The idle baseline is the
committed tree at `9ba7b893`. **One claim this receipt withdraws is named in
§1** — it was asserted before it was measured, and the measurement refutes it.

## 1. The starting numbers, and a claim corrected

A suite run that shared the machine with another worktree's direct probe runs,
at load average 23–47:

```
100 probes, 63 of them printed: 1992.0s of probe seconds in 36.5 min of wall
     probe-music    410.8s   probe-opening   422.5s   probe-audio-cues 156.8s
```

The claim carried into the node was that those seconds were mostly the machine,
not the probes. **It is wrong except for one probe.** The same 63 probes, run
alone with nothing else on the box:

| probe | loaded | alone | ratio |
|---|---|---|---|
| probe-occlusion.mjs | 52.2s | 17.9s | **2.92** |
| probe-neural-voice.mjs | 29.7s | 21.7s | 1.37 |
| measure-cruise-detour.mjs | 67.1s | 60.2s | 1.11 |
| probe-audio-cues.mjs | 156.8s | 142.4s | 1.10 |
| probe-binding-store.mjs | 73.9s | 67.8s | 1.09 |
| probe-music.mjs | 410.8s | 379.9s | 1.08 |
| probe-opening.mjs | 422.5s | 395.9s | 1.07 |
| **the 63 together** | **1992s** | **1810s** | **1.10** |

Contention cost 9% of the total and 2.9× on `probe-occlusion`. The two probes
that dominate are **intrinsically** slow. #84's rule still holds — a red under
load is unattributed — but "the suite is slow because the box was busy" is not
true, and saying it was would have hidden the actual cost.

## 2. Idle baseline, whole suite (before)

```
100/100 gating probes passed in 2357s · peak load 12.0 on 10 cores
     slowest 5 of 100: probe-opening.mjs 395.9s · probe-music.mjs 379.9s ·
     probe-audio-cues.mjs 142.4s · probe-binding-store.mjs 67.8s ·
     measure-cruise-detour.mjs 60.2s — 1046.2s of 2356.8s (95 more under)
```

Log: `/tmp/seelite-882-before.log`. Two probes are 33% of the suite; five are
44%. That is where any speedup has to come from, and it is why the summary now
prints that line — a hundred lines in alphabetical order did not say it.

## 3. `probe-music` (379.9s): the render is the wall clock, and it does not parallelise

The probe renders 32 music entries; cut to its 20 s band window that is **630 s
of audio rendered offline**, plus ~28 s of hard sleeps (one 17 s, so the Danube
intro passes on wall time before the docking plane) and a few live-context rows.

Render rate, one page, idle box (`sequential, one page`):

```
98s of audio in 41.9s wall — 2.34x realtime
8 renders in parallel, 8 pages, one browser: 128s in 47.8s — 2.68x
2 renders in parallel, 2 browsers:  32s in 13.9s — 2.30x
4 renders in parallel, 4 browsers:  64s in 25.6s — 2.50x
8 renders in parallel, 8 browsers: 128s in 50.3s — 2.55x
```

**Offline audio rendering does not parallelise on this machine** — eight browser
processes reach 2.55× against one page's 2.34×, so a parallel lane buys ~9–14%,
not the 4–8× that would pay for the lane machinery. Node #882's out-of-scope note
predicted this from a loaded run; it is now measured on an idle one.

So the only lever left is **rendering fewer audio seconds** — and that is not
free. Every music entry was rendered at 6/8/10/12/20 s windows and its band
statistics compared against the entry's own 20 s figures (13 of 32 entries before
the run was stopped; the pattern is uniform):

| entry | rms at 6s | rms at 20s | drift |
|---|---|---|---|
| voice-strings | 0.05551 | 0.03647 | **+52%** |
| voice-brass | 0.05407 | 0.03628 | +49% |
| music-voices | 0.03553 | 0.03047 | +17% |

A shorter window measures a different span of the song — the attack rather than
the phrase — so **no shortened window lands inside the existing ±10% band**. The
bands are centred on the render the principal listened to (`probe-music`'s own
words), which means cutting windows re-anchors that evidence and narrows what it
covers. That is a criterion decision, not a harness tuning, and this node did not
make it. **C4 as written assumed a free 50%; there is no free 50%.**

## 4. `probe-opening` (395.9s): eleven openings, and where each one sits

Per-row wall timestamps (same build, alone, `/tmp/seelite-882-opening-rows.log`):

| row group | wall | what it waits for |
|---|---|---|
| guided skipped at boot | 5.0s | nothing — `skip()` fast-forwards |
| watched guided opening | 44.1s | the whole script, on frames |
| **per-frame sweep, seeds 47–51** | **217.0s** | the whole script, per seed |
| Enter during the cruise shot | 18.0s | wall clock to reach `cruise` |
| click on SKIP | 13.0s | wall clock to reach `flypast` |
| quit at `cruise`, quit at `dock` | 57.3s | wall clock to reach each shot |
| free watched opening | 17.0s | the free script, on frames |
| `?boot=direct`, `?system=`, raider, fallback | 17.0s | fast-forwarded runs |
| `?cinematic=held` | 8.1s | — |

Four rows were paying 88 s to *arrive* at a shot they only needed to be on.
They now get there through the game's own phase handle (`holdOpening` →
`advanceTo`, which steps at `OPENING.dtS` — the one step the script is flown at):

```
before  395.9s in suite / 396.6s alone
after   330.9s alone, 28/28 checks passed
```

`/tmp/seelite-882-opening-final.log`. Every one of those four rows still compares
its own end state with the skipped run's, which is the control on the
substitution: a hold that changed the run would go red there rather than pass.

## 5. The sweep is 55% of the probe, and what it needs to be cut

Stepping the script instead of watching frames was tried, and the measurement is
good: same seed, same build, two pages:

```
watched on frames: 4777 rows, 44.0s wall
stepped by handle: 5545 rows,  2.3s wall
takeJumpR 0.0293 both · takeTurnDeg 0.80 both · closestR 6.206 both
worstOffDeg 19.36 stepped against 19.05 watched
```

Same run, sampled every step instead of every frame — a finer sample, since the
step is smaller than a 60 fps frame. **It cannot be shipped as it is**:
`advanceTo` treats an aim past the end of the current shot as an error and runs
the script to `done` on the way there, so a per-step sampler either dies at the
first shot boundary (`the opening ended before forming at 3.0166 s`) or has to
restate each shot's length in the probe. Cutting that needs a small change in
`src/opening.ts` — `advanceTo` stopping at the shot's end instead of throwing —
and that is its own node with its own test, not a line inside a probe.

One more thing the stepped sampler would have traded: the arrival's *look* runs
on wall time and a hold runs none of it, so a stepped sweep is evidence about the
camera and the ship through the script and never about what the flicker looked
like on a person's screen.

## 6. What shipped in this node

- `scripts/lib/probe-contention.mjs` + `tests/probe-contention.test.ts`: a direct
  probe run names whoever holds the probe lock, on stderr, once, and says its own
  seconds are not evidence. `probe-all` sets `PROBE_LOCK_PID` so a suite does not
  warn about itself. Still not a refusal — re-running a red alone is what the
  no-lock rule is for (#84).
- `probe-all`: the peak load now prints on a **green** probe over a minute, and
  the summary names the slowest probes and their share of the run.
- `tests/script-gates.test.ts` derives the scratch tree's copies from the import
  graph rather than typing the list, which is what made adding one import to
  `probe-guard.mjs` fail there as `ERR_MODULE_NOT_FOUND`.
- `probe-opening`: four rows reach their shot through the phase handle. **−65 s.**
- `CLAUDE.md`: the #84 paragraph now says a direct run names the holder and a
  slow green line names its load.

Not shipped, with the reason measured above: a parallel render lane (§3), shorter
music windows (§3, a criterion decision), the stepped seed sweep (§5, needs
`src/opening.ts`).

## 7. Loose ends worth naming

- **A direct probe run without `SEELITE_PROBE_RENDERER=hardware` silently gets
  the software lane.** It cost this session a 20 s `bootedGame` timeout that read
  like a defect in the page. `npm run probe:cpu` is the deliberate fallback; a
  bare `node scripts/probe-x.mjs` gets it by accident. Same honesty gap as §6,
  different variable.
- `npm test` 5852 pass / 1 fail on this branch was the `script-gates` fixture
  list described above; it is fixed in the same commit.
- The full-suite `after` figure is not in this receipt: the suite has not been
  run whole since the `probe-opening` change. Expected from §4: 2357s → ~2290s.
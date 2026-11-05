# Node #1129 — cruise-detour gate cost

Checkpoint: `cruise-detour-gate-cost`. Base:
`adbb365e092b0454e30e3ccd8f495056a536d42b`.

## C1 — boot versus simulation

Measured on 2026-11-05, on this host, with the hardware lane reporting
`ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)` and
18 logical cores. Runs were sequential, with the machine-wide probe lock held;
no other browser suite, review, test suite or build was launched by this worker
alongside them. The host still had ordinary background activity, including a
persistent bun process using about one core. During pair 3, other bun processes
appeared and the one-minute load rose to about 12; that pair is recorded as
incidental competing load, not presented as idle evidence. Load is reported
with the measurements rather than assumed to be zero.

The original script reused a page and navigated it for each seed. The baseline
keeps that behavior, seeds 1–20, all five assertions and the 12,000-step budget.
[The instrumentation patch](node-1129-baseline-instrumentation.patch) applies
at the base ref with `git apply --unidiff-zero` and adds counters and timings
only. It is separate from the
shipped script so the baseline remains reproducible.

`bootMs` times navigation through `bootedGame` (first frame and settled sky,
with the existing full-model URL flag). `evaluateMs` times the driver call
that searches for a detour station, resets and flies it. The existing `cpuMs`
is `performance.now()` elapsed time from engaging the selected leg through its
synchronous steps and result collection; it is not an OS process CPU counter.
No explicit render is called inside that loop. Seeds with no initial detour
still pay the full boot and station search, but run no measured leg and report
zero steps/`cpuMs`. Per-seed `wallMs` brackets boot and evaluation; the shipped
script additionally includes page creation and closing. Whole-script wall
includes guard/launch overhead and excludes final browser teardown. Runner
row time includes teardown.

The first original-workload run took **209.893 s** inside the script (**210.0 s**
as the runner row). Of that, **207.519 s (98.9%)** was boot waits and **1.452 s
(0.69%)** was the eight measured detour loops, totaling **6,563 steps**. All
five checks passed, with eight arrivals and no timeouts. Twelve seeds had no
initial detour. The measured limiter is repeated game boot, not step volume.
A diagnostic CPU sample during boot read the Chromium renderer at 170.7% CPU
and the host load well below its 18 logical cores.

A separate, excluded CDP boot profile on seed 1 collected
8,201 samples. Its largest named self-time sites include
`worker.onmessage` in `src/rock-pieces-thread.ts`, Three.js
`intersectTriangle`, and `reducedGeometry` in `src/authored-levels.ts`.
Those identify geometry/setup work in the boot window; the main-thread profile
does not attribute every native, worker or GPU cost. Its top sites are retained
in the raw data, and its instrumented timing is excluded from the comparison.

This attributes today's row; it does not establish the historical cause of
294.6 s versus #882's 60.2 s on a different revision and machine. The proposed
step-cost explanation is not supported by this run's attribution.

| Seed | Boot (s) | Loop `cpuMs` | Seed wall (s) | Steps |
| --- | ---: | ---: | ---: | ---: |
| 1 | 10.050 | 132.3 | 10.185 | 772 |
| 2 | 10.100 | 0.0 | 10.101 | 0 |
| 3 | 10.635 | 0.0 | 10.638 | 0 |
| 4 | 10.983 | 0.0 | 10.984 | 0 |
| 5 | 10.850 | 0.0 | 10.852 | 0 |
| 6 | 10.351 | 0.0 | 10.353 | 0 |
| 7 | 10.116 | 75.9 | 10.194 | 604 |
| 8 | 10.292 | 0.0 | 10.294 | 0 |
| 9 | 10.299 | 0.0 | 10.301 | 0 |
| 10 | 9.834 | 145.5 | 9.982 | 719 |
| 11 | 10.105 | 145.8 | 10.252 | 658 |
| 12 | 10.204 | 230.6 | 10.437 | 1030 |
| 13 | 10.137 | 102.2 | 10.241 | 575 |
| 14 | 10.164 | 0.0 | 10.166 | 0 |
| 15 | 11.067 | 0.0 | 11.070 | 0 |
| 16 | 11.283 | 0.0 | 11.285 | 0 |
| 17 | 10.317 | 431.7 | 10.750 | 1477 |
| 18 | 10.502 | 0.0 | 10.504 | 0 |
| 19 | 10.150 | 187.6 | 10.339 | 728 |
| 20 | 10.080 | 0.0 | 10.082 | 0 |

## C2 — reduced gate

The default gate now uses **seeds 1, 2 and 17**. Seed 1 is an engaging leg
(772 steps); seed 17 is the longest engaging leg in the baseline (1,477 steps)
and retains the raider-off fixture that prevents interdiction from interrupting
a detour measurement. Seed 2 exercises non-engagement accounting. Every existing
assertion remains: seed accounting, at least one production leg, arrival at the
selected station, no exhausted budget, and active detours for every chosen leg.
The 12,000-step ceiling is unchanged, and loops still stop only at a real exit
or the ceiling. Each seed now gets a fresh page, in accordance with the repo's
rule against navigating a page that has already measured something.

The script emits per-seed timing/step records and full successful-leg records,
plus total boot and loop times, mode, seeds, budget, core count and peak load.
Non-finite per-seed measurements throw instead of becoming a plausible figure.

The first two low-load pairs provide the idle before/after: **209.893 →
32.256 s**, repeated at **208.259 → 32.249 s**. Over five alternating runs
per side, median script wall is **209.893 → 32.249 s**, or **15.4% of the
original cost (84.6% lower, 6.5× faster)**. Baseline range is 198.315–217.049 s;
gate range is 30.162–34.206 s. Every baseline ran 6,563 steps across eight
engaging legs, every gate ran 2,249 across two, and all ten runs passed 5/5.
The later pairs include incidental host activity and are robustness evidence,
not five claims of a perfectly idle host.

| Pair | Baseline (s) | Gate (s) | Peak load, baseline / gate |
| --- | ---: | ---: | ---: |
| 1 | 209.893 | 32.256 | 4.9 (runner, rounded) / 4.55 |
| 2 | 208.259 | 32.249 | 4.62 / 4.54 |
| 3 | 217.049 | 31.776 | 12.51 / 9.50 |
| 4 | 198.315 | 30.162 | 9.83 / 5.68 |
| 5 | 210.366 | 34.206 | 8.81 / 8.81 |

Pair 1 used the normal one-probe runner (ephemeral guarded dev server); pairs
2–5 used the same instrumented baseline snapshot and shipped script against
a guarded server at port 5189, under the probe lock, in A/B order. The hardware
lane and full-model boot flag were unchanged. No rendering window, game
implementation or shared browser launcher was tuned. Saving 17 boots explains
approximately 177 seconds of the first pair's 177.6-second reduction; dropping
loop work explains less than one second. This is a coverage trade, not a
claim that Game.step itself became faster.

[Raw per-seed data and run summaries](node-1129-cruise-detour-cost.json)
retain the measurement boundaries, work counts and load beside the figures.

## C3 — full manual corpus

With a dev server serving this worktree, run:

```sh
PROBE_ORIGIN=http://localhost:5173 SEELITE_PROBE_RENDERER=hardware node scripts/measure-cruise-detour.mjs --full
```

This still uses **every seed 1–20**, the full **12,000 steps per leg**, the real
Game steering loop and all five original assertions. The reduced gate no longer
covers seeds 3–16 and 18–20; the manual command covers them. As before, each seed
flies the first station that engages a detour, not every station in that seed.
Legacy custom runs remain available, for example:

```sh
SEELITE_PROBE_RENDERER=hardware node scripts/measure-cruise-detour.mjs http://localhost:5173 3 16
```

The shipped `--full` command was also run to completion: **20 accounted
seeds, eight arrivals, zero timeouts, 6,563 steps, 5/5 checks**. Its peak host
load was 34.05 and its script wall was 229.132 s, so that run proves the manual
coverage and is excluded from the idle performance comparison.

The custom example selects seeds 16–18. Invalid counts, first seeds and
ambiguous modes refuse before browser launch. Headless tests pin both presets, the original budget,
custom selection and invalid input.

This is probe work, so it does not meet `src/changelog.ts`'s definition of a
major player-visible change. No changelog entry or visual acceptance is needed.

## Verification and delivery scope

- C1: the original 20-seed workload is attributed per seed above and in the raw
  data; the baseline patch preserves its workload and all five checks.
- C2: both low-load pairs and the five-pair spread show a lower gate cost; all
  five original checks passed in every run. No simulation or renderer source changed.
- C3: the full manual command above retains and ran the original 20 seeds and
  12,000-step ceiling.

The corpus tests were written first and failed on the missing selector, then
passed after implementation. The affected test run covered the corpus selector,
probe selection, import-impact routing and URL construction: **98 pass, 0 fail**.
Typecheck/build, format, script lint, comment lint and launcher wiring passed.
Removed comments reduced this script's comment baseline from three to one.

Browser selection was inspected before probing. The diagnostic selection of
the complete diff falls back to all probes because the new private helper is
under `scripts/lib/`; following the implement-worker SOP, only the affected
`measure-cruise-detour` probe ran here. These are focused browser checks, not a
selected PR-gate or full-suite browser pass. The supervisor owns that final gate.

The required single full `npm test` run finished with **7,444 pass, 1 fail**
(7,445 tests across 459 files, 639.26 s). The failure was
`tests/field-flight-collision.test.ts:69`, the worker stall comparison:
inline 257.718 ms, worker 231.814 ms, required worker < 128.859 ms. That file,
its setup and all simulation source are byte-unchanged from the base commit.

The isolated failing test was then run on a source snapshot of the base ref
with the same preloads and unchanged model assets: **1 pass, 0 fail**, inline
429 ms / worker 58 ms. The same isolated run on this branch also passed:
**1 pass, 0 fail**, inline 316 ms / worker 66 ms. This narrows the issue to a
full-suite timing observation but does not establish its cause or reproduce a
full-suite failure on the base. No collision code, assertion or threshold was
changed, and the full suite was not repeated, per the implement-worker SOP.
The supervisor's full base comparison remains necessary.

Host logs for that follow-up: `/tmp/node-1129-full-tests.log`,
`/tmp/node-1129-base-failure.log` (the isolated base run passed), and
`/tmp/node-1129-worker-rerun.log`. The committed timing data above does not
include any test or build running alongside a comparison measurement.

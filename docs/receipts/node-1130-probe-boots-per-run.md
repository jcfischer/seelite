# Node #1130: fewer boots per probe run

Measured on 2026-11-05, on the hardware lane: `ANGLE (Apple, ANGLE Metal
Renderer: Apple M5 Pro, Unspecified Version)`, 18 cores, Node 24.19.0.
The baseline probe bodies are from `cf4976d32991f4f6d4efc1ba65e38d3ea16d9d1f`.
Each baseline module was loaded before its implementation changed. Game source,
assets, renderer options, readiness predicates and measurement windows did not
change. The after arm added injected placement/framing helpers to support resets;
these install browser globals and are an additional setup difference between arms.
Each probe ran once before and once after, alone under the machine-wide lock.
The waits for another worktree's capture and suite are excluded. The table below
records the original implementation at `af1e78cf`; the review corrections and
final rerun are recorded separately below.

## C1 and C2: idle receipts

Seconds are wall time, not simulation time. Total seconds are the runner's
per-probe figure; boot seconds are the instrumented child spans. The raw
[JSON receipt](node-1130-probe-boots-per-run.json) retains both timings, each boot's
URL and duration, check counts and peak load. Before peak loads were 6.0, 6.0,
7.8 and 6.1 respectively; after they were 4.8, 5.8, 5.4 and 5.9.

| Probe | Before total s | Before boot s | Before boots | After total s | After boot s | After boots | Checks before → after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| probe-docking.mjs | 164.5 | 153.5 | 13 | 123.8 | 113.1 | 10 | 73 → 76 |
| probe-death.mjs | 155.9 | 135.0 | 12 | 143.4 | 122.4 | 11 | 37 → 38 |
| probe-binding-store.mjs | 143.0 | 101.2 | 9 | 130.5 | 87.4 | 8 | 33 → 33 |
| probe-boot.mjs | 94.2 | 91.5 | 9 | 70.8 | 67.9 | 7 | 58 → 58 |

Combined: **557.6 → 468.5 seconds**, saving **89.1 seconds (16.0%)**, and
**43 → 36 game-load attempts**. Every changed probe was faster in this pair.
These are single-run observations, not a latency distribution or a guarantee
for another host or a loaded suite.

Boot spans dominated all four baselines: about 93%, 87%, 71% and 97% of their
respective totals. Binding-store still had **41.8 seconds outside boots**:
its interleaved holds and rest gates remain, with every sample and band intact.
Docking also closes its completed initial page before the form sweep, so its
saving includes removing that competing frame loop, not just three boots.

## Measurement mechanism

`scripts/lib/probe-boot-timing.mjs` is an opt-in Node preload. It instruments the
guard in memory, without changing its launch options or readiness behavior.
It refuses unrecognised guard exports, non-finite/negative durations and boot
spans exceeding total time. Its tests cover navigation plus readiness, failed
readiness, pages sharing a context, and the workbench-return span.

A normal boot span starts just before `goto` and ends after `bootedGame`,
including the progressive sky. A death-recovery span starts at the load-event
wait immediately before the kill, so it also includes death reconciliation.
Probe-boot's workbench return never waits for `bootedGame`: that attempt is
counted from route commit until close (0.135 s before, 0.126 s after), not
presented as a completed boot. Its completed readiness waits fall from eight to
six; its game-load attempts fall from nine to seven. Total time includes browser
launch/close and checks, and excludes the runner's server setup and lock waits.

Rerun all four serially under one lock, with Node supporting `registerHooks`
(the measured version is above):

```sh
PROBE_SELECTION=1 \
PROBE_FILES=probe-boot.mjs,probe-binding-store.mjs,probe-death.mjs,probe-docking.mjs \
PROBE_CONCURRENCY=1 PROBE_BOOT_TIMING=1 \
NODE_OPTIONS="--import $PWD/scripts/lib/probe-boot-timing.mjs" \
npm run probe:gpu -- --show-output --log /tmp/probe-boots.log
```

Run the baseline scripts at the recorded ref with the same preload to reproduce
that arm. The preload alone does not change a probe's boot count.

## C3: the boots retained

| Probe | Reuse | Boots still exercised |
| --- | --- | --- |
| Docking | Same-seed station cases share a page, reset between roles. The twelve seeded form cases remain. | Every distinct seeded world still boots with its generated forms and full model catalog. No station form is rewritten. |
| Death | The no-save death resets the warning page, including its original commander and viewport. | All five saved-death setup boots and five recovery reloads remain, plus the no-save boot. |
| Binding-store | Only the final single-command versus doubled-command comparison resets. The native storage writer is restored and the default layout selected through Game. | The first boot and every storage-load/notice boot remain. Each uses a fresh page in the same real browser context, preserving localStorage and IndexedDB without navigating a measured page. Rest failures survive page replacement. <!-- glossary-ignore: Command --> |
| Boot | Normal-flight rig absence uses the initial game's reset fixture. | Initial/direct boot, same-seed repeat, different seed, workbench return, matched unflagged and FPS-flag boots, settings/direct boot and combat-flag boot remain. The reset does not clear the combat rig or its construction evidence. |

`rememberFlightFixture` restores commander and commerce snapshots, resets dock,
system caches, flight and Traffic, then calls `resetToFixture` for a neutral
pose before clock-reset frames. It neither replays startup nor restores storage,
settings or patched methods. The no-save and same-seed docking rows assert the
reset's live state, including a whole hull and no collision impacts.

The shipped [predicate audit](../../scripts/lib/probe-check-audit.mjs) compares
ASTs of each `check` call's second argument as a multiset, consuming duplicate
matches. It matches 33 death, 51 docking, 34 binding-store and 47 boot predicate
expressions against the baseline, with none missing; the
[raw audit output](node-1130-check-audit.json) records the added expressions too.
Its tests show that an unchanged count with a weakened predicate fails the audit.
Reproduce it from the repository root:

```sh
node scripts/lib/probe-check-audit.mjs cf4976d32991f4f6d4efc1ba65e38d3ea16d9d1f
```

This proves expression retention, not equivalent upstream inputs or coverage.
Source review of the changed setup paths is separate evidence: the station
seed/type/form tuples and flight arithmetic remain, the no-save death uses the
warning page only after restoring its commander and viewport, and binding-store
restores the native writer and selects the default layout before its comparison.
The FPS row now compares two fresh boots with the same setup, differing only by
`fps`, instead of repeating the already-checked initial page. A second navigation
on a measured page violates #121, so the original same-page A/B rationale is
superseded by matched fresh pages. Neither the absence row alone nor an expression
audit proves the meter works; the positive arm still requires a measured rate and
its complete format. The original browser execution ran 201 baseline checks plus
four reset checks, for **205 passing checks**.

## Original implementation validation

The browser run covered exactly these four changed probes, serially; it is not
a full-suite or automatic PR-gate claim. Diagnostic selection expands to all
120 because the opt-in timing module is probe infrastructure. The ranger task
limits this worker to affected probes; the supervisor owns the final gate.
There are no changes to game source or ordinary browser launch behavior.

Validation passed: all four affected hardware probes (205 checks); 70 targeted
headless tests across five files; typecheck; format; lint; comments; wiring;
production build and bundle-size guard. The single full `npm test` invocation
on this host passed **7,453 tests across 461 files**, with zero failures
(617.46 seconds).

This is probe work, not a major player-visible change under `src/changelog.ts`.

## Review round 1 corrections

- R1: Storage refusal preserves its first native writer across repeated calls;
  restoration refuses a missing writer and verifies a real localStorage roundtrip.
  Headless tests execute the probe's actual browser callbacks. Restoring the old
  assignment and removing the guard makes both tests fail.
- R2: `flyStationCase` owns the station flight; cases are grouped by seed and an
  index controls resets. `installFlightFixtureHooks` owns hook installation and
  binding-store's `bootPage` owns both initial and replacement-page setup.
- R3: Commerce is cloned at capture and restore. The fixture test now mutates its
  Map in place on two successive resets; it fails with the prior live reference.
- R4: Boot probe hooks are installed only on its initial reusable fixture. The
  matched unflagged/flagged FPS boots both use the ordinary setup without those
  hooks. Death's warning page, binding-store pages and docking's station pages
  still install the hooks for their fixture resets.
- R5: The predicate audit and its output ship with the receipt. Its scope is
  expression comparison; upstream setup changes are named above.

The word “command” in binding-store's comparison refers to a key binding's
`CommandId` (`fly.pitchUp`, `fly.yawStarboard`), not the fiction's canonical
Intervention concept. The binding terminology is intentional here.

## Review verification timings

The first final-code rerun passed all 205 checks. Its total/boot seconds were
171.7/150.1 (death), 177.9/159.9 (docking), 140.4/97.2 (binding-store), and
115.2/111.2 (boot). Three totals exceeded the original C1 receipt despite fewer
boots. That prompted a repeated baseline, with unchanged probe bodies read from
`git show cf4976d3:scripts/<probe>` by an in-memory Node load hook. Game source,
launch options, timing preload and renderer lane were the same; the baseline
passed its 201 checks. Both runs were serial under the machine-wide lock, with
no concurrent tests or build from this worker.

The baseline boot probe returned to 11–12 second boot spans, so the corrected
boot probe was then rerun immediately and passed its 58 checks in 91.3 seconds.
Execution order was final four, baseline four, then corrected boot alone. Every
sample, including the slower first boot-probe rerun, remains in `reviewRound1`
in the JSON receipt. The table uses that last boot-probe run and the first final
runs for the other three probes:

| Probe | Repeated baseline total s | Baseline boot s | Baseline boots | Final total s | Final boot s | Final boots | Peak load baseline → final |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Death | 207.2 | 185.3 | 12 | 171.7 | 150.1 | 11 | 9.7 → 8.2 |
| Docking | 233.5 | 214.6 | 13 | 177.9 | 159.9 | 10 | 12.3 → 10.5 |
| Binding-store | 156.6 | 114.2 | 9 | 140.4 | 97.2 | 8 | 11.5 → 9.9 |
| Boot | 94.4 | 91.7 | 9 | 91.3 | 88.4 | 8 | 6.8 → 7.5 |

Final game-load attempts are **43 → 37**, including the restored independent
unflagged FPS boot. Each final total is below its repeated baseline, but these
are samples under varying host load, not a second idle distribution or an
isolated estimate of the boot-count intervention. In particular, the final death
and docking totals do not beat the original idle C1 numbers. The original idle
pair above belongs to `af1e78cf`; it must not be presented as timing the review
corrections. No load threshold or causal attribution is inferred from these
samples.

## Review validation

Final code passed 76 targeted headless tests across seven files; all four
changed hardware probes (205 checks); the boot-only follow-up (58 checks);
typecheck; format; lint; comments; wiring; and the production build with its
bundle-size guard. The one full `npm test` invocation in this finish pass ran
on this host and passed **7,459 tests across 463 files**, with zero failures
(**869.21 seconds**). No full browser suite was run.

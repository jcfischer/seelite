# Node #1130: fewer boots per probe run

Measured on 2026-11-05, on the hardware lane: `ANGLE (Apple, ANGLE Metal
Renderer: Apple M5 Pro, Unspecified Version)`, 18 cores, Node 24.19.0.
The baseline probe bodies are from `cf4976d32991f4f6d4efc1ba65e38d3ea16d9d1f`.
Each baseline module was loaded before its implementation changed. Game source,
assets, renderer options, readiness predicates and measurement windows did not
change. Each probe ran once before and once after, alone under the machine-wide
lock. The waits for another worktree's capture and suite are excluded.

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
| Binding-store | Only the final single-command versus doubled-command comparison resets. The native storage writer is restored and the default layout selected through Game. | The first boot and every storage-load/notice boot remain. Each uses a fresh page in the same real browser context, preserving localStorage and IndexedDB without navigating a measured page. Rest failures survive page replacement. |
| Boot | Unflagged FPS absence and normal-flight rig absence use the initial game's reset fixture. | Initial/direct boot, same-seed repeat, different seed, workbench return, FPS-flag boot, settings/direct boot and combat-flag boot remain. The reset does not clear the combat rig or its construction evidence. |

`rememberFlightFixture` restores commander and commerce snapshots, resets dock,
system caches, flight and Traffic, then calls `resetToFixture` for a neutral
pose before clock-reset frames. It neither replays startup nor restores storage,
settings or patched methods. The no-save and same-seed docking rows assert the
reset's live state, including a whole hull and no collision impacts.

All original check predicates were retained: an AST audit found 33 death, 51
docking, 34 binding-store and 47 boot `check` call sites, with no losses. The
unflagged FPS row's label/page reference changed to name its reused fixture;
its absence assertion remains. Browser executions retain all 201 original
checks and add four reset checks, for **205 passing checks**.

## Delivery validation

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

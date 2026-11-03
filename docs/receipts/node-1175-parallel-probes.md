# Node #1175: parallel probe suite

Machine: Mac Mini, Apple M5 Pro, 18 cores, 64 GB. Renderer: `ANGLE (Apple,
ANGLE Metal Renderer: Apple M5 Pro)`, the hardware lane (`npm run probe:full`).
All runs were on 2026-11-03. No other suite, sage review or test run ran
alongside them.

## C1. Serial baseline

Taken by the principal at concurrency 1 before #1176 merged; the log
finished 16:40. 120 probes, **4052 s** wall clock (67.5 min), **peak load 7.0**.
114 of 119 gating probes passed. The five reds (`probe-death`,
`probe-display-contacts`, `probe-nebula`, `probe-shipyard`, `probe-witchspace`)
were the ones #1176 fixed; their seconds measure how far they got, so
`scripts/lib/probe-durations.json` leaves them out and the scheduler starts them
first as unknowns. `probe-output-stage` is quarantined (#975).

The runner prints a probe's peak load only for a red or a green over a minute,
so the column is empty for the rest.

| probe | seconds | verdict | peak load |
|---|---:|---|---:|
| `probe-music.mjs` | 198.7 | green | 4.3 |
| `measure-cruise-detour.mjs` | 185.1 | green | 4.0 |
| `probe-death.mjs` | 133.0 | red (assert) | 3.8 |
| `probe-docking.mjs` | 131.1 | green | 4.5 |
| `probe-opening-cinematic.mjs` | 130.6 | green | 7.0 |
| `probe-binding-store.mjs` | 125.0 | green | 5.0 |
| `probe-save.mjs` | 121.0 | green | 3.8 |
| `probe-opening.mjs` | 113.6 | green | 5.6 |
| `probe-model-queue.mjs` | 101.2 | green | 4.5 |
| `probe-music-game.mjs` | 84.7 | green | 4.8 |
| `probe-boot.mjs` | 77.3 | green | 4.6 |
| `probe-audio-cues.mjs` | 76.3 | green | 3.9 |
| `probe-model-download.mjs` | 75.8 | green | 4.1 |
| `probe-collision.mjs` | 66.9 | green | 3.2 |
| `probe-station-visuals.mjs` | 62.5 | green | 3.2 |
| `probe-chase-orbit.mjs` | 60.4 | green | 3.6 |
| `probe-pointer-lock.mjs` | 60.1 | green | 4.3 |
| `probe-lane-wait.mjs` | 59.9 | green |  |
| `probe-planet-surfaces.mjs` | 59.8 | green |  |
| `probe-station-interior-kit.mjs` | 59.5 | green |  |
| `probe-commander.mjs` | 58.0 | green |  |
| `probe-neural-voice.mjs` | 55.3 | green |  |
| `probe-rock-placement.mjs` | 51.0 | green |  |
| `probe-console-sound.mjs` | 48.9 | green |  |
| `probe-occlusion.mjs` | 48.9 | green |  |
| `probe-mouse-flight-layout.mjs` | 43.4 | green |  |
| `probe-scoop-migration.mjs` | 42.3 | green |  |
| `probe-live-cockpit.mjs` | 40.8 | green |  |
| `probe-docking-traffic.mjs` | 40.5 | green |  |
| `probe-ship-visuals.mjs` | 40.0 | green |  |
| `probe-display-contacts.mjs` | 39.2 | red (assert) | 4.0 |
| `probe-sky.mjs` | 38.5 | green |  |
| `probe-collision-surface.mjs` | 36.9 | green |  |
| `probe-requests.mjs` | 36.7 | green |  |
| `probe-eject.mjs` | 36.1 | green |  |
| `probe-weapon-sound.mjs` | 33.2 | green |  |
| `probe-traffic-continuity.mjs` | 33.1 | green |  |
| `probe-postcard.mjs` | 31.7 | green |  |
| `probe-arrival.mjs` | 31.2 | green |  |
| `probe-derived-names.mjs` | 30.8 | green |  |
| `probe-system-sweep.mjs` | 30.4 | green |  |
| `probe-nebula.mjs` | 30.1 | red (pageerror) | 4.4 |
| `probe-mining-mounts.mjs` | 29.8 | green |  |
| `probe-voices.mjs` | 29.1 | green |  |
| `probe-mouse-sensitivity.mjs` | 28.5 | green |  |
| `probe-frame-attribution.mjs` | 28.1 | green |  |
| `probe-vent-keys.mjs` | 28.0 | green |  |
| `probe-relay.mjs` | 27.2 | green |  |
| `probe-station-console.mjs` | 25.1 | green |  |
| `probe-flight-sound.mjs` | 24.8 | green |  |
| `probe-first-day.mjs` | 23.7 | green |  |
| `probe-controls-reference.mjs` | 23.4 | green |  |
| `probe-relay-defender.mjs` | 23.0 | green |  |
| `probe-duel-hud.mjs` | 21.7 | green |  |
| `probe-shipyard.mjs` | 21.2 | red (crash) | 4.0 |
| `probe-derelict.mjs` | 21.1 | green |  |
| `probe-mining-drill.mjs` | 21.0 | green |  |
| `probe-output-stage.mjs` | 20.9 | quarantined red (assert) | 3.7 |
| `probe-key-dispatch.mjs` | 20.7 | green |  |
| `probe-pad-panels.mjs` | 20.5 | green |  |
| `probe-missiles.mjs` | 20.3 | green |  |
| `probe-production-boot.mjs` | 20.2 | green |  |
| `probe-interdiction.mjs` | 20.1 | green |  |
| `probe-fire-groups.mjs` | 20.0 | green |  |
| `probe-death-wreck.mjs` | 19.5 | green |  |
| `probe-hud.mjs` | 19.3 | green |  |
| `probe-raider-outpost.mjs` | 19.3 | green |  |
| `probe-rebind.mjs` | 19.3 | green |  |
| `probe-gamepad.mjs` | 18.6 | green |  |
| `probe-adaptive-resolution.mjs` | 18.5 | green |  |
| `probe-station.mjs` | 18.5 | green |  |
| `probe-model-viewer.mjs` | 17.4 | green |  |
| `probe-planet-footprint.mjs` | 15.8 | green |  |
| `probe-traffic-engagement.mjs` | 15.8 | green |  |
| `probe-cockpit-surface.mjs` | 15.5 | green |  |
| `probe-navigation-console.mjs` | 15.4 | green |  |
| `probe-gun-feedback.mjs` | 15.2 | green |  |
| `probe-station-route-traffic.mjs` | 15.0 | green |  |
| `probe-cabin-pass.mjs` | 14.4 | green |  |
| `probe-asteroid-field.mjs` | 14.3 | green |  |
| `probe-dock-arrival.mjs` | 14.0 | green |  |
| `probe-witnesses.mjs` | 13.2 | green |  |
| `probe-capture.mjs` | 12.4 | green |  |
| `probe-light-rig.mjs` | 12.1 | green |  |
| `probe-station-mouth.mjs` | 12.1 | green |  |
| `probe-inter-system-traffic.mjs` | 11.8 | green |  |
| `probe-outfitting.mjs` | 11.6 | green |  |
| `probe-mining-survey.mjs` | 11.5 | green |  |
| `probe-cruise.mjs` | 11.2 | green |  |
| `probe-witchspace.mjs` | 11.2 | red (pageerror) | 3.4 |
| `probe-bounty.mjs` | 11.1 | green |  |
| `probe-quality-bloom.mjs` | 11.1 | green |  |
| `probe-traffic-mouth.mjs` | 11.1 | green |  |
| `probe-ladders.mjs` | 11.0 | green |  |
| `probe-pad-instrument.mjs` | 10.9 | green |  |
| `probe-hold.mjs` | 10.8 | green |  |
| `probe-approach-handoff.mjs` | 10.7 | green |  |
| `probe-npc-vents.mjs` | 10.7 | green |  |
| `probe-raider-consequence.mjs` | 10.7 | green |  |
| `probe-chase-view.mjs` | 10.6 | green |  |
| `probe-frame-acceleration.mjs` | 10.6 | green |  |
| `probe-market-shelf.mjs` | 10.6 | green |  |
| `probe-vent-display.mjs` | 10.6 | green |  |
| `probe-gimbal.mjs` | 10.4 | green |  |
| `probe-variants-loadouts.mjs` | 10.4 | green |  |
| `probe-handoff.mjs` | 10.1 | green |  |
| `probe-horizon-views.mjs` | 10.1 | green |  |
| `probe-cruise-detour.mjs` | 10.0 | green |  |
| `probe-cruise-light.mjs` | 10.0 | green |  |
| `probe-raider-frame.mjs` | 10.0 | green |  |
| `probe-carrier-scan.mjs` | 9.9 | green |  |
| `probe-cockpit-laser.mjs` | 9.9 | green |  |
| `probe-moving-guard.mjs` | 9.8 | green |  |
| `probe-flown-mass.mjs` | 9.7 | green |  |
| `probe-public-site.mjs` | 9.0 | green |  |
| `probe-planets.mjs` | 8.5 | green |  |
| `probe-field-flight.mjs` | 4.3 | green |  |
| `probe-galaxy-map.mjs` | 3.2 | green |  |
| `probe-planet-gradient.mjs` | 2.5 | green |  |
| `probe-state-gallery.mjs` | 2.5 | green |  |

## C2, C3. What the runner does now

`scripts/lib/probe-schedule.mjs` orders the pool longest first from
`probe-durations.json`, which `scripts/record-probe-durations.mjs` writes from a
full serial log. A probe with no recorded duration starts before every timed
one, ordered by name. The exclusive group runs one probe at a time after the pool
has drained, and the summary prints each member with its reason.

## C4. Concurrency 4 and 6 against the baseline

Both runs at `1c26b56`, which is this branch's scheduler with the three
exclusive members #1175 named.

| | serial | 4 | 6 |
|---|---:|---:|---:|
| wall clock | 4052 s | **1252 s** | **953 s** |
| sum of probe seconds | 4052 s | 4570 s | 4989 s |
| median per-probe slowdown (greens in both) | | ×1.13 | ×1.22 |
| worst per-probe slowdown | | ×1.38 `probe-cruise-detour` 10.0→13.8 s | ×1.46 `probe-audio-cues` 76.3→111.6 s |
| `probe-music` | 198.7 s | 243.5 s | 284.3 s |
| peak load | 7.0 | 11.6 | 16.5 |
| gating reds | 5 (pre-#1176) | 0 | 1 |

The exclusive members ran at their serial times in both runs:
`probe-station-interior-kit` 59.5 / 58.0 / 57.4 s, `probe-occlusion` 48.9 /
45.6 / 45.7 s, `probe-live-cockpit` 40.8 / 40.5 / 40.7 s.

**The one red at 6, attributed.** `probe-planet-surfaces` failed `all 8
classes draw the same body differently`: closest pair 8.6 against a same-class
repeat of 2.6 × 5, at peak load 15.4. Re-run alone with `npm run probe:one`
twice: green both times, 57.5 s and 57.7 s, peak load 6.1 and 4.9. The row's
noise floor is two renders of one body, and a starved GPU makes those differ,
so the red belongs to load. It joins the exclusive group.

**Default: 6** (principal, 2026-11-03), with `probe-planet-surfaces` alone.

## Why this is not ten minutes

Each added worker makes every probe slower, so the work grows with concurrency:
4052, 4570, 4989 s. At 6 the pool's makespan is near its floor of work over
workers (4989 / 6 ≈ 832 s), and the exclusive group adds ~200 s. `probe-music`
starts in the first wave and is done by 285 s, so longest-first already removed the tail
#882 §7 described; scheduling has nothing left to give. The remaining time is
GPU throughput.

## C5. Open

Three consecutive green full runs at concurrency 6, with `probe-planet-surfaces`
in the exclusive group, have not been run yet.

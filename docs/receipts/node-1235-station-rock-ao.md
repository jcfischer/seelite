# Station-held ambient occlusion beside a close rock — node #1235

## Result

The state is reachable in production flight. A refinery opens AO, a targeted cruise spool limits the first powered step, and the pilot retargets the star and continues toward a rock. The station's 30-rendered-frame closing delay carries AO to the rock. Distance from the station alone does not establish that this state is unreachable.

On the measured cockpit approach, AA0 meets the stated limits on both quality sides. AA2 meets high's +1.0 ms limit but exceeds low's +0.4 ms limit. **The measured gap is returned to the principal; this receipt does not supply gap acceptance or certify `cp-seelite-mining-rock-ao`.** No production renderer, geometry, material, population or Navigation behavior changes in this delivery.

## Workload and flight evidence

Measured on 2026-11-12 against production base `cadb0b0fc082373e934369bce2d506dbed1c40d1`, with the new instrument's SHA-256 `e54bbc3e53af5ecb3fd2c2f437746302d6564297aaa8190559bd5c20ac4ae6ab`. The raw summaries also record source revision/hash and UTC start time.

- World `0x5ee11e`, system 173, charted `field-00`: 596 authored rocks, slot 290, radius 0.394461 km. The field and station are generated through the shipped path. No geometry is relocated or enlarged.
- 1440×900, device scale 2, cockpit looking forward, quality high and low, AO requested on, AA0 and AA2. The hardware renderer is asserted as `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)`.
- The departure is initialized outside the refinery at 1.9 times its measured visual bounding radius, co-moving and aimed toward the rock. At that position the station opens AO through the normal gate; enclosure is about 0.555 rad. The rock starts about 187.932 km from the camera.
- Thereafter `Game.step(dt)` integrates every position. The reference pilot supplies attitude and throttle, holds throttle closed during spool, starts cruise with the charted field selected, then selects the known star after the first powered step. It solves a throttle for a close pass using the shipped cruise predictor. Attitude changes are checked against the hull's turn-rate limit; the largest consecutive turn at `dt=0.1` is 0.001670 rad (0.096°). There is no instantaneous reversal, per-frame position placement, forced cruise regime or explicit occlusion pin.
- At `dt=0.1`, the flight takes 3.1 simulation seconds including spool. The camera reaches 0.473373 km from the rock's centre, about 78.9 m outside its bounding sphere. Its angular diameter exceeds the camera's 60° vertical field of view. The captured image confirms the close rock occupies the forward view.
- The reached state is still in cruise at about 1,751 km/s. AO is enabled and unpinned, both gates are open, the AO closing counter is 2 of 30, and station enclosure has fallen to about 0.006002 rad. Thus this is a **station-held AO tail**, rather than a station physically adjacent to the rock. Collision count does not increase.

The pilot uses exact world information as a reference controller. This proves a legal state transition under the shipped translation, spool and cruise rules; it does not claim that an ordinary pilot reliably makes this precise pass. The normal-flight diagnostic (`ROUTE=normal`) also flies from the refinery and records closure; it does not infer global unreachability from one route.

## Timing method

`scripts/measure-station-rock-ao.mjs` owns its dev server, checks its served tree, waits for the full model catalog, holds the machine's probe lock and refuses a software renderer. The quiet-host condition is a 1-minute load below 5 on this 18-core host, checked before/through/after the blocks. No tests, build or review ran concurrently with the measurements.

Each quality has a field arm and a no-field control. Every repeat restores only the departure, invalidates derived world caches, closes the gates, lets the station open them naturally, then replays the same physical flight inputs. Both arms must reach the same camera within 1 m, keep AO open and unpinned, and incur no collision. The no-field control hides the field and skips its draw update; the rest of the scene and the station's AO tail remain.

After each arrival, the simulation clock is held for a short burst of 16 `render(0)` calls. Every rendered frame checks that AO is still open and unpinned. The gate continues counting down; it is never held open artificially. A 1×1 `readPixels` drains the GPU before and after each burst. Six arrivals form one block (96 timed frames), with six blocks per arm, a discarded warm block per arm, and order shuffled from seed 1235. Each side has 36 timed flight replays, six warm replays and a final field replay for the capture. Page errors are counted and cause refusal.

The reported delta is the difference of arm medians. This is the repository's **GPU-lane CPU submission plus GPU-completion cost**, not an isolated GPU timer reading and not player frame cadence. ANGLE Metal's untrusted timer is not used. The short clock-held bursts avoid timing only one serialized frame, whose submission/fence overhead gives a different number. They measure the reached frame, not the mean cost of the whole cruise or the duration of the transient close pass.

## Measurements

Each field/control entry is median ms per frame, followed by the range of its six block means. Separation is 36/36 in every row.

| AA | Quality | Field median (range), ms | No-field median (range), ms | Added ms | Limit ms | Gap ms |
| --- | --- | --- | --- | ---: | ---: | ---: |
| 2 | High | 4.254 (4.249–4.270) | 3.598 (3.582–3.610) | 0.656 | 1.0 | 0 |
| 2 | Low | 2.920 (2.913–2.926) | 2.373 (2.371–2.398) | 0.547 | 0.4 | **0.147** |
| 0 | High | 2.867 (2.847–2.947) | 2.544 (2.541–2.559) | 0.322 | 1.0 | 0 |
| 0 | Low | 1.782 (1.764–1.808) | 1.440 (1.434–1.463) | 0.342 | 0.4 | 0 |

AA2 load samples span 1.585–1.903; AA0 samples span 1.300–1.683. Both runs have zero page errors, and all replay checks passed. The paired delta isolates field draw/update work in this AO-held scene; it does not isolate AO execution from the other field work.

An independent AA2 repeat with shuffle seed 1236 and the same six blocks, six replays and 16-frame bursts adds +0.642 ms high and +0.569 ms low. Low's nominal gap is +0.169 ms. Both separations are 36/36; load samples span 1.537–2.546, with zero page errors. Across the two final AA2 runs, high is +0.642–0.656 ms and low is +0.547–0.569 ms. The low-side excess is larger than the between-run variation.

The old +1.689 ms high / +0.642 ms low are pinned rare-field stress measurements from node #1209. They are not measurements of this flown charted-field camera, and the difference between them and this table is **not a speedup**. The present result establishes reachability and measures one concrete approach; it does not certify every rock, face, field, orbit phase, viewport or AA4 setting.

Node #968's receipt records an existing allowance of about +0.6 ms for low at `close`. That historical allowance is disclosed here, but this delivery does not assume it supplies the explicit acceptance requested for the station-held AO corner in node #1235. The stated +0.4 ms limit remains the comparison above.

A separate 60 Hz corroboration (dt=1/60, one block and one repeat per arm, not used for the cost table) reaches the state on both qualities after 3.033 simulation seconds. It records 184 states, AO closing counter 2, the same approximately 0.473371 km camera range, and a maximum consecutive turn of 0.000261 rad. Its warm/timed/capture replays all pass.

## Reproduction and retained evidence

```sh
SEELITE_PROBE_RENDERER=hardware OUTPUT=/tmp/seelite-station-rock-ao-1235-star-aa2 node scripts/measure-station-rock-ao.mjs
SEELITE_PROBE_RENDERER=hardware ANTIALIAS=0 OUTPUT=/tmp/seelite-station-rock-ao-1235-star-aa0 node scripts/measure-station-rock-ao.mjs
SEELITE_PROBE_RENDERER=hardware DT=0.016666666666666666 BLOCKS=1 REPEATS=1 OUTPUT=/tmp/seelite-station-rock-ao-1235-star-60hz node scripts/measure-station-rock-ao.mjs
```

The independent repeat is retained under `/tmp/seelite-station-rock-ao-1235-star-aa2-repeat/`, with its adjacent `.log`; reproduce it with `ORDER_SEED=1236` and that output path.

Each output directory contains `summary.json`, the complete flown samples in `6218014-173-charted-{high,low}-aa{0,2}-dt*.json`, and the corresponding PNG. Logs are alongside the directories with `.log` appended. Captures and raw measurements stay outside git. Development runs with the earlier overshooting controller, one-frame timing or incomplete diagnostics are discarded; only the final forward-flight runs named above support this receipt.

The default free-cruise route exits successfully only when the required frame-filling, enabled, unpinned AO arrival and its measurement succeed, including an over-budget verdict. `gapMs` and `verdict` carry budget failure; they must not be interpreted as accepted merely because the process exits zero. An unreached required arrival causes an error after its JSON, screenshot and summary are retained. Invalid/missing timing data, a busy host, a failed flight, a replay mismatch, an excessive turn or an invalid replay gate also causes an error. `ROUTE=normal` is an explicit diagnostic exception: a completed close approach can exit zero with "not reached on this flight" and no cost verdict.

## Verification and remaining gate

The original delivery's arithmetic regression tests refuse missing/nonfinite samples and verify that low uses its own limit rather than high's. Its affected `station-rock-cost`, `occlusion` and `game-url` files passed 74 tests, and its `npm test` run passed all 7,814 tests across 488 files, with zero failures (556.33 s). Typecheck, build, format, lint, comment lint and launcher wiring also passed. The launcher check explicitly registers this manual instrument's error handling, as it does the existing field-cost instruments.

Review round 1 adds an unconditional route-aware arrival assertion outside the timing conditional. The five `station-rock-cost` tests cover zero/missing/nonfinite qualifying counts, a non-filling arrival, disabled/closed/pinned AO, a valid arrival and the normal-route diagnostic. Replay restoration and tape timing now have separate local helpers and share the AO gate predicate. `Game.fields` is the getter for the `fieldDraws` list iterated by `updateFields`; each replay now asserts that the selected arm replaced that list.

GPU validation retained at `/tmp/seelite-1235-review-{before-closed,after-closed,normal,positive}/`, with adjacent `.log` files, demonstrates the repaired process behavior. Temporarily changing the AO closing delay from 30 rendered frames to 1 produces a frame-filling arrival with zero qualifying frames and AO disabled. Before the repair it exited 0; afterward it exits 1 with the required-state error and retains the flight evidence. The production constant was restored immediately after each negative run. The normal diagnostic exits 0 with AO closed and no timing. With production constants, a one-block, one-repeat AA2 validation on both qualities exits 0 with AO enabled, open and unpinned, zero page errors, and three field/two control replays per quality (warm, timed and field capture). Its +0.794 ms high / +0.556 ms low deltas validate the instrument; they do not replace the six-block cost table above.

Review round 1's single full `npm test` run passes 7,816 tests across 488 files, with zero failures (558.62 s), retained at `/tmp/node-1235-review-npm-test.log`. Build (including typecheck), format, lint, comment lint and launcher wiring pass again.

Browser scope is the new measurement instrument only, including the two AA2 runs, AA0, the 60 Hz check and the normal-route diagnostic retained at `/tmp/seelite-station-rock-ao-1235-star-normal/`. The supervisor owns the final selected browser gate and Sage review under the worker SOP. No full browser suite was run.

The principal must accept the measured AA2 low-side gap explicitly, or a subsequent implementation must reduce it. This receipt returns that decision with measured flight evidence and does not close the node or unblock mining release.

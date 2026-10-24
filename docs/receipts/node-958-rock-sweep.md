# Node #958 — rock contact through sweepShip

`sweepShip` accepts a `RockSolid`: unit-bound `RockPieces`, a radius in kilometres,
and the rock's pose and origin velocity at both ends of the tick. A rock impact
keeps the existing ship `part` and adds the met cone's `piece` index. This is the
collision seam; field placement and its caller are separate work.

## Mechanism

The ship's endpoints are taken into the rock's frame. Convex cone bounds and
leaves use `collision.ts`'s existing GJK and conservative-advance loop. A heap in
`firstRockLeaf` advances children from their parent's contact time; the first
leaf popped owns that rock's sweep. Rock results compete with ordinary solids
and the aperture plane before the existing response resolves world witnesses,
body-relative point velocities, damage, bounce and carry.

The contact gap includes the rock spin's sagitta at the larger endpoint distance.
Rock advances converge on that gap, with a 1 nm rounding allowance. Ordinary
pairs retain their existing advance target. Converging on the declared gap makes
the leaf's reported contact independent of the parent time it started from:
advancing toward the ordinary 2.5 cm target instead left tree and flat times
different by microseconds. The per-pair limit remains 64.

Start classification reuses the existing per-pair ghost and resting paths.
Placement-gated ghost policy and resting across cone boundaries are not delivered
by this node. The two ship boxes remain separate pairs throughout.

## Accuracy and regression evidence

`bun test tests/collision-rock.test.ts tests/rock-pieces-boundary.test.ts`:
**14 passed, 0 failed**, including nine rock-sweep tests.

| Row | Evidence |
| --- | --- |
| R1 | Spike ridge, 2 and 10 km/s, three heights each: impact no later than the 20,000-sub-step reference plus one sub-step. |
| R2 | Spike needle between the hull's face-lattice samples: sampled end points stay outside; the sweep meets the needle by the reference time. |
| A1 | Seed 956, 192 steps over all 16 archetypes at 25 and 400 m radius, 0.2/2/10 km/s. 109 reference hits met; 49 initial-overlap cases excluded as in the spike. Maximum seven advances per pair, no exhausted pair. |
| A2 | All 16 archetypes: tree and every-piece flat sweep report the same piece and ship part, with times agreeing within 1 ns. Starts are clear, to measure swept contact rather than initial resting-piece order. |
| A3 | 64 reference-bisected grazes, 2 m clear at 2 and 10 km/s: no impact. |
| Frames | A rotated, translating rock at astronomical coordinates preserves transformed witnesses, contact time and body-relative closing speed. |
| Spin | A spinning rock and turning hull meet by exact world-path sub-steps; a separate row measures the sagitta's addition to the contact gap. |
| Timeline | Rock contact competes with ordinary spheres and aperture-plane crossings. |

The initial five tests failed against the unsupported rock input before the
production implementation was added. The reference GJK, pieces builder and
sweep are retained under `tests/fixtures/rock-sweep-956/`, from
[`71033d016f079bc79603c7cd66290b35a6f68800`](https://github.com/jcfischer/seelite/tree/71033d016f079bc79603c7cd66290b35a6f68800/spikes/asteroid-sweep-956),
with import paths adapted, comments removed and formatting applied. The severe
synthetic ridge/needle use that builder; the production builder's 1.01 inflation
limit is unchanged. Archetype tests use the shipped heightfields and production
pieces, with the reference's independent GJK reading those same hull vertices.

Existing collision tests: **191 passed, 0 failed** across `collision.test.ts`,
`collision-cutter`, `collision-pair-resting`, `collision-stations` and
`collision-traffic`.

## Same-host cost

Reproduce with `bun run scripts/measure-rock-sweep.ts`. Both arms read the same
64-texel production geometry and ship endpoints. The production arm receives
world endpoints around a rock spinning once per 240 s; the retained spike
receives their rock-frame endpoints and the same sagitta allowance. Cases follow
the spike's five scenarios, all 16 archetypes and radii 25/40/100/400 m. Nine
repetitions alternate arm order. Figures are median microseconds per rock per
tick over the 16 archetypes × repetitions, after warm-up; construction and
reference-based fixture placement are excluded. The instrument rejects
non-finite timings, a capped pair, and any row above 2× the spike.

Apple M1 Pro, load averages 2.7 / 5.5 / 6.7 at measurement start. Every row
passed; production medians span 0.058–0.563 ms/rock/tick, at 1.08–1.24× the
same-host spike.

| Radius (m) | Scenario | Spike (µs) | Production (µs) | Ratio |
| ---: | --- | ---: | ---: | ---: |
| 25 | approach | 387.0 | 428.8 | 1.11 |
| 25 | assist off | 385.5 | 431.4 | 1.12 |
| 25 | graze | 209.6 | 225.8 | 1.08 |
| 25 | resting | 482.7 | 562.6 | 1.17 |
| 25 | near | 50.5 | 58.4 | 1.16 |
| 40 | approach | 356.1 | 402.3 | 1.13 |
| 40 | assist off | 371.6 | 418.2 | 1.13 |
| 40 | graze | 222.8 | 245.2 | 1.10 |
| 40 | resting | 425.8 | 528.5 | 1.24 |
| 40 | near | 62.5 | 71.0 | 1.14 |
| 100 | approach | 318.7 | 357.9 | 1.12 |
| 100 | assist off | 322.8 | 350.9 | 1.09 |
| 100 | graze | 276.3 | 303.5 | 1.10 |
| 100 | resting | 354.8 | 432.5 | 1.22 |
| 100 | near | 92.7 | 106.5 | 1.15 |
| 400 | approach | 223.0 | 246.4 | 1.11 |
| 400 | assist off | 313.2 | 340.1 | 1.09 |
| 400 | graze | 261.6 | 291.3 | 1.11 |
| 400 | resting | 210.2 | 253.6 | 1.21 |
| 400 | near | 130.6 | 141.4 | 1.08 |

## Delivery checks

- Typecheck, production build, format, script lint and comment lint passed.
- Browser selection was inspected before running probes. The selector expands
  the shared collision/instrument changes to all 113 probes. The worker contract
  forbids the full suite, so only the affected collision probes ran here:
  `npm run probe:one -- collision --show-output --log /tmp/node-958-probes.log`.
- Hardware lane: ANGLE Metal / Apple M1 Pro. Surface **9/9**, station collision
  **35/35**, **2/2 probes**, 101 s. This is manually selected partial coverage;
  111 probes did not run. The supervisor owns the final browser gate.
- The sandboxed Chromium preflight aborted with EPERM; the same probes passed
  when run outside the sandbox on this host.
- This internal collision seam is not a major public changelog change.
- Full host `npm test`, run once before commit: **6,890 passed, 0 failed**
  across 407 files (1,101 s).

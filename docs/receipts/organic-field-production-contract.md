# Organic field production contract — #1209

**Nothing here is ratified.** This node measures and proposes the production population and hands the figures to #923. Ratification stays with the principal on #923: the body's "ratified population/economy" conflicts with #923 waiting on #1209, and that is the resolution the principal was given. Every shipped population figure is **provisional pending #923**.

The node stays open. It changes what the game looks like, so it closes only on the canonical view set and the principal's yes.

## What shipped

- `fieldRocks` returns the approved #1043 arrangement. `latticeRocks` is the old generator, kept as the source of each slot's physical draws and as the instrument's baseline.
- One layout: drawing (`buildFields`), collision (`fieldRockSolids`), targeting and surveys (`FieldDraw.rocks`), saved deposits (`catalog`) and the instrument's `production` layout all call `fieldRocks`. Field-frame acquisition and discovery read the field centre, which did not move.
- Three appended tags (`ASTEROID_LOBES`, `ASTEROID_ANCHOR`, `ASTEROID_KEEP`) replace the study's private seeds, as #1's Constraints require. A test feeds `arrangeRocks` the study's seeds and gets `organicRocks` rock for rock, so the generator is the approved one. Each system therefore has a different instance of the same arrangement: fixture system 173 has 596 rocks against the study's 676, and system 0's rare field 298 against 320.
- `FIELD_GENERATOR_VERSION` is 2. `FIELD_EXTENT_KM` (44.26 charted, 37.72 rare) stays inside the 50 km drop radius.
- Collision indexes continuous anchors in 2.5 km buckets of several rocks each, sorted by slot.

## Population: proposal for #923

Provisional and unchanged from the study's arrangement parameters, because #923 ruled that the economy balances on the organic field's rock count, and because cost did not need a population cut (below). Seeds 1, 47, 1234, galaxies 0 and 1, from `bun scripts/measure-field-population.ts`. Each cell is min / p50 / p99 / max per field.

| Profile | Layout | Rocks | Reserve, t | Largest quarter, t |
| --- | --- | ---: | ---: | ---: |
| Charted | Lattice | 155 / 186 / 212 / 216 | 1,538 / 3,539 / 6,122 / 6,618 | 601 / 2,308 / 4,732 / 5,270 |
| Charted | Study | 458 / 631 / 756 / 843 | 6,583 / 10,914 / 14,901 / 17,990 | 3,489 / 6,755 / 10,607 / 13,809 |
| Charted | Production | 472 / 635 / 769 / 786 | 6,698 / 10,999 / 15,188 / 16,350 | 3,322 / 6,770 / 10,496 / 11,482 |
| Rare | Lattice | 66 / 91 / 107 / 109 | 1,059 / 2,726 / 4,875 / 5,396 | 509 / 2,029 / 4,158 / 4,599 |
| Rare | Study | 239 / 308 / 363 / 381 | 4,668 / 7,560 / 11,154 / 12,135 | 2,549 / 5,396 / 8,669 / 9,703 |
| Rare | Production | 221 / 313 / 379 / 391 | 4,376 / 7,754 / 11,470 / 12,338 | 2,606 / 5,505 / 8,862 / 9,766 |

Thinning does bias the retained radii, slightly. Charted p90 falls from 0.115 km to 0.106 km and p99 from 0.304 to 0.281; rare p90 from 0.252 to 0.221 and p99 from 0.529 to 0.501. The p50 and the maximum barely move. Total reserve is about 3.1× the lattice's on charted fields and 2.8× on rare ones.

On the 40 km limit, which is unchanged: fixture 173 shows 78 of 596 rows disabled from the measured dense stand.

## Economy against the study layout

Clean head `1da8fcc5419c81f8f3065f6872ba2725ad2cb02c`. The study rows reproduce #1216's figures at that head. Only the layout differs between the two columns (`docs/candidates/mining-economy-v3-production.json`, `-v3-sustained-production.json`). Ratios to trade, p10 / p50 / p90, Longwall 3/A; charted N=24, rare N=5.

| Scenario | One pass, study | One pass, production | Sustained, study | Sustained, production |
| --- | ---: | ---: | ---: | ---: |
| Charted raw | 0.55 / 0.72 / 1.20 | 0.36 / 0.77 / 1.29 | 0.28 / 0.44 / 0.61 | 0.34 / 0.40 / 0.58 |
| Charted refined | 0.73 / 1.09 / 1.89 | 0.54 / 1.15 / 1.62 | 0.47 / 0.75 / 1.08 | 0.57 / 0.68 / 0.96 |
| Rare raw | 1.93 / 2.75 / 3.06 | 2.20 / 3.42 / 3.84 | 1.08 / 1.48 / 1.59 | 0.99 / 1.40 / 1.45 |
| Rare refined | 2.86 / 3.59 / 3.67 | 1.97 / 3.40 / 3.76 | 1.74 / 2.66 / 2.96 | 1.67 / 2.26 / 2.45 |

Elapsed against trade, sustained p50: charted raw 0.26 to 0.25, charted refined 0.42 to 0.38, rare raw 0.83 to 0.83, rare refined 1.46 to 1.36.

Population did not change, so these moves are a new instance of the same arrangement, not a different density; rare rests on N=5. No population alternative was run because none was adopted. Row hashes did not move: v1 `fd61e348b0542bd8`, v2 `4baacf6feb98a104`, v3 `344d19a88ed12977`. No ruled candidate value changed, and #1216's F1 on recovery remains a finding for #923. The instrument's figures are model predictions, not flown results.

## Close-view cost: resolved, with one limit

**Which run.** Every figure below comes from the run started at 22:39 CET on 2026-11-08 on clean head `930a22a6`, after the coordinator force-stopped two orphaned browsers, except the "before" column, which is the run started at 22:23 CET the same evening, also after that stop, on clean base `625e2227` with the updated instrument. Earlier samples were discarded and are not cited, which says nothing about whether they were wrong. Apple M5 Pro, ANGLE Metal, 1440×900 at device scale 2, six shuffled blocks of 48 frames, against a no-field control, quality side stated. Load stayed between 2.6 and 4.6 except the rare AA2 run 2, which ran at 13–15 from other work.

**Why it failed.** The study's +2.377 / +0.964 ms were pinned-on arms. The pinned decomposition on the base attributed about 1.5 ms of the high figure to the ambient occlusion over a rock filling the frame. Population cannot touch that: one rock is the subject, and a smaller rock at 1.2 radii fills the same frame. Low never opens the gate for rocks, so its +0.964 ms measured a state a rock cannot reach.

**What changed, none of it the rock's shape or material:**

1. A level-0 rock opens the shadow pass only (`stepOcclusionGates`). #950 D2 and #918 Q2 ruled shadows, and every look the principal approved was drawn without rock AO: the #968 yes predates #970, and the #1043 study's frames pin occlusion off.
2. While rocks alone hold the shadow open, the hull stops casting and keeps receiving (`rockShadowOnly`). Its casters were 33 of the 36 added calls.
3. A field draws at most five rocks at level 0 (`MAX_LEVEL0_ROCKS`). #950's measured budget of five became a limit, because a cluster passed it.

**These are look changes**, for the principal's view-set yes: near rocks on high there is no AO on the rocks, none on the cockpit cabin and no hull self-shadow, as in open space.

Added ms against budget on the state a pilot flies in (the gate decides each arm). Worst of `close`, `inside`, `edge`, `far` and `dense`:

| Fixture, AA, camera | High ms (≤1.0) | High calls (≤12) | Low ms (≤0.4) | Low calls (≤6) |
| --- | ---: | ---: | ---: | ---: |
| Charted, 0, chase | 0.474 | 4 | 0.280 | 3 |
| Charted, 0, cockpit | 0.544 | 12 | 0.368 | 3 |
| Charted, 2, chase | 0.626, run 2 0.786 | 4 | 0.304, run 2 0.370 | 3 |
| Charted, 2, cockpit | 0.773 | 12 | **0.422** | 3 |
| Rare, 0, chase | 0.522 | 3 | 0.294 | 3 |
| Rare, 0, cockpit | 0.569 | 11 | 0.387 | 3 |
| Rare, 2, chase | 0.781, run 2 0.878 | 3 | 0.344, run 2 0.386 | 3 |
| Rare, 2, cockpit | 0.835 | 11 | **0.485** | 3 |

**The limit.** Low at `close`, AA2, cockpit is above +0.4 ms. It stays inside the principal's existing allowance for that one view (#968 D3, 2026-10-19: accepted as the fill-bound worst case up to about +0.6 ms at `close` only). No budget was changed. Low at `inside`, `edge`, `far` and `dense` is at most +0.114 ms. The worst case is one rock's fill through its approved material, which population, LOD and radius do not reduce.

Before and after, `close` on chase, gate deciding:

| Fixture, AA | High before | High after | Low before | Low after |
| --- | ---: | ---: | ---: | ---: |
| Charted, 0 | +1.428 (74 calls) | +0.474 (4) | +0.259 | +0.280 |
| Charted, 2 | +2.192 (74) | +0.626 (4) | +0.302 | +0.304 |
| Rare, 0 | +2.024 (74) | +0.522 (3) | +0.349 | +0.294 |
| Rare, 2 | +3.065 (74) | +0.781 (3) | +0.414 | +0.344 |

The before layout's largest rock is not the same subject as the after layout's on the rare fixture, so the small low differences are not a speedup claim.

Pinned arms, for the paired control the body asks for, chase at `close`: pair on, high +1.008 / +1.436 charted and +1.193 / +1.663 rare at AA0 / AA2, low +0.294 / +0.497 and +0.334 / +0.619; pair off, high +0.333 / +0.349 and +0.372 / +0.460, low +0.289 / +0.307 and +0.300 / +0.350. Pair-on at `close` now needs a station opening the gate beside a rock filling the frame. Charted fields sit 150–300 km from their refinery, but this was not measured in flight, so it is an unmeasured corner rather than a guarantee.

Cold install on system 173: longest frame before the swap 41.8 ms, swap frame 27.5 ms, at load about 13.

## Navigation: measured, no budget exists

`scripts/measure-field-navigation.mjs`, same run, live `requestAnimationFrame` loop with the clock running, drifting 50 m/s through the densest cluster on high with every rock surveyed. Only `?mining=1` reaches these rows.

| Fixture, AA | Rows (disabled) | Within 8 km | Camera in field frame, km | Task ms/frame: Navigation, forward, no rows | Layout | Style | Row press median / max |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| Charted, 0 | 596 (78) | 158 | -18.67, 14.23, 3.19 | 11.50, 1.72, 1.84 | 4.63 | 0.48 | 25.7 / 36.9 ms |
| Charted, 2 | 596 (78) | 158 | -18.67, 14.23, 3.19 | 14.62, 2.20, 2.19 | 5.87 | 0.62 | 27.6 / 33.5 ms |
| Rare, 0 | 298 (0) | 111 | -13.31, -4.96, 1.72 | 5.46, 1.76, 1.98 | 1.56 | 0.17 | 28.5 / 34.0 ms |
| Rare, 2 | 298 (0) | 111 | -13.31, -4.96, 1.72 | 5.70, 2.01, 1.95 | 1.71 | 0.18 | 26.8 / 33.3 ms |

The rAF period held 16.7 ms in every arm, which vsync floors, so it shows no headroom. **A populated charted list costs about 10–12 ms of main-thread time a frame**, which is most of a 60 Hz frame. Nothing has passed or failed here, because no Navigation budget exists; it is a finding for the mining release #1197, not an affordability guarantee. Browser paint is not in these counters.

## Flight, contact and saves

Headless, in `tests/field-collision.test.ts`, `tests/field-contact.test.ts`, `tests/field-frame.test.ts` and `tests/deposit-state.test.ts`:

- Bucket reach sets equal a full traversal, on both profiles, for co-moving crossings of the whole field.
- A ship flown in steps at the densest rock strikes a rock at 0.2, 2, 20 and 200 km/s closing.
- A ship inside a moved rock, as an older save can leave it, ghosts the rock and takes no impact from it.
- The 50 km drop clears every rock at every drift phase; the frame is acquired at the arrival point.

**Save migration, on a real save.** `tests/fixtures/save-field-generator-v1.json` was written by the code at `625e2227` through `serializeSave`, with six deposit rows in two fields and a discovered rare field. It loads with its deposits dropped (#951 D5, every field's fingerprint changed) and discovery, clock, credits, hull, loadout, ladders, flight and the other seven galaxies unchanged, and it survives a round trip. The fingerprints are pinned anew.

The browser gate, CI and sage rounds are recorded on the PR that carries this receipt, because recording them here would change the head they cover.

## Canonical views

Eight new rows (`asteroid-field-{charted,rare}-{far,side,overview,dense}`, lever #1209) stand at the approved study's cameras. Paths and the before and after runs are on the PR and the node. **The principal's yes is still owed.**

## Spike note

`spikes/field-shape-1043` now reads `latticeRocks`, so the study layout still reproduces. Its `collision-worker.ts` and `anchor-query.test.ts` compared against the old lattice broadphase, which no longer exists; their figures remain valid at the revisions the #1043 receipt names.

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

On the 40 km limit, which is unchanged: fixture 173 shows 78 of 596 rows disabled from the measured dense stand. The other measured fields show none.

## Economy against the study layout

Clean head `1da8fcc5419c81f8f3065f6872ba2725ad2cb02c`; the per-galaxy fingerprint pin is unchanged since, so the rocks measured are the rocks shipped. The study rows reproduce #1216's figures at that head. Only the layout differs between the two columns (`docs/candidates/mining-economy-v3-production.json`, `-v3-sustained-production.json`). Ratios to trade, p10 / p50 / p90, Longwall 3/A; charted N=24, rare N=5.

| Scenario | One pass, study | One pass, production | Sustained, study | Sustained, production |
| --- | ---: | ---: | ---: | ---: |
| Charted raw | 0.55 / 0.72 / 1.20 | 0.36 / 0.77 / 1.29 | 0.28 / 0.44 / 0.61 | 0.34 / 0.40 / 0.58 |
| Charted refined | 0.73 / 1.09 / 1.89 | 0.54 / 1.15 / 1.62 | 0.47 / 0.75 / 1.08 | 0.57 / 0.68 / 0.96 |
| Rare raw | 1.93 / 2.75 / 3.06 | 2.20 / 3.42 / 3.84 | 1.08 / 1.48 / 1.59 | 0.99 / 1.40 / 1.45 |
| Rare refined | 2.86 / 3.59 / 3.67 | 1.97 / 3.40 / 3.76 | 1.74 / 2.66 / 2.96 | 1.67 / 2.26 / 2.45 |

Elapsed against trade, sustained p50: charted raw 0.26 to 0.25, charted refined 0.42 to 0.38, rare raw 0.83 to 0.83, rare refined 1.46 to 1.36.

Population did not change, so these moves are a new instance of the same arrangement, not a different density; rare rests on N=5. No population alternative was run because none was adopted. Row hashes did not move: v1 `fd61e348b0542bd8`, v2 `4baacf6feb98a104`, v3 `344d19a88ed12977`. No ruled candidate value changed, and #1216's F1 on recovery remains a finding for #923. The instrument's figures are model predictions, not flown results.

## Close-view cost: resolved, with one limit

**Which run.** Every figure below comes from the run started at 23:15 CET on 2026-11-08 on clean head `c2bed654`, after the coordinator force-stopped two orphaned browsers, with each script starting only below a 1-minute load of 5 (recorded 3.2–4.8), unless a line says otherwise. The "before" column and the decomposition are on clean base `625e2227`, also after that stop. Samples before the stop were discarded, which says nothing about whether they were wrong. So was a run on `91838bb6` at load 5–16 from other work, which read up to +5.851 ms at 75% separation. Apple M5 Pro, ANGLE Metal, 1440×900 at device scale 2, six shuffled blocks of 48 frames, against a no-field control.

**Why it failed.** The study's +2.377 / +0.964 ms were pinned-on arms. A pinned decomposition on the base, rare AA2 `close` at load 5–10 from other work, added +0.712 ms with the pair off, +0.903 with shadow alone and +2.632 with AO alone: about 1.9 ms of the high figure is the ambient occlusion over a rock filling the frame. Population cannot touch that: one rock is the subject, and a smaller rock at 1.2 radii fills the same frame. Low never opens the gate for rocks, so its +0.964 ms measured a state a rock cannot reach.

**What changed, none of it the rock's shape or material:**

1. A level-0 rock opens the shadow pass only (`stepOcclusionGates`). #950 D2 and #918 Q2 ruled shadows, and every look the principal approved was drawn without rock AO: the #968 yes predates #970, and the #1043 study's frames pin occlusion off.
2. While rocks alone hold the shadow open, the hull stops casting and keeps receiving (`rockShadowOnly`). Its casters were about 33 of the 36 added calls in the run on `1da8fcc5`.
3. A field draws at most five rocks at level 0 (`MAX_LEVEL0_ROCKS`), those in front of the camera first. #950's measured budget of five became a limit, because a cluster passed it.

**These are look changes**, for the principal's view-set yes: near rocks on high there is no AO on the rocks, none on the cockpit cabin and no hull self-shadow, as in open space.

Added ms against budget on the state a pilot flies in (the gate decides each arm). Worst of `close`, `inside`, `edge`, `far` and `dense`, which was `close` in every row. World 0x5ee11e systems 173 and 0 are the fixtures; world 47 system 18 (783 rocks) and world 1 system 30 (391 rocks) are the largest fields in the first galaxy of the corpus's worlds.

| Field, AA, camera | High ms (≤1.0) | High calls (≤12) | Low ms (≤0.4) | Low calls (≤6) |
| --- | ---: | ---: | ---: | ---: |
| Charted 596, 0, chase | 0.534 | 4 | 0.301 | 3 |
| Charted 596, 0, cockpit | 0.607 | 12 | **0.409** | 3 |
| Charted 596, 2, chase | 0.768, run 2 0.626 | 4 | 0.369, run 2 0.309 | 3 |
| Charted 596, 2, cockpit | 0.867 | 12 | **0.505** | 3 |
| Rare 298, 0, chase | 0.599 | 3 | 0.350 | 3 |
| Rare 298, 0, cockpit | 0.667 | 11 | **0.421** | 3 |
| Rare 298, 2, chase | 0.660, run 2 0.748 | 3 | **0.415**, run 2 0.357 | 3 |
| Rare 298, 2, cockpit | 0.916 | 11 | **0.555** | 3 |
| Charted 783, 0, chase | 0.417 | 4 | 0.244 | 3 |
| Charted 783, 0, cockpit | 0.561 | 12 | 0.332 | 3 |
| Charted 783, 2, chase | 0.370 | 4 | 0.246 | 3 |
| Charted 783, 2, cockpit | 0.710, run 2 0.609 | 12 | 0.365, run 2 0.294 | 3 |
| Rare 391, 0, chase | 0.458 | 3 | 0.271 | 3 |
| Rare 391, 0, cockpit | 0.554 | 11 | 0.301 | 3 |
| Rare 391, 2, chase | 0.669 | 3 | 0.309 | 3 |
| Rare 391, 2, cockpit | 0.784, run 2 0.810 | 11 | **0.454**, run 2 0.460 | 3 |

**The limit.** Low at `close` is above +0.4 ms in the bold rows, at most +0.555 ms. That stays inside the principal's existing allowance for that one view (#968 D3, 2026-10-19: accepted as the fill-bound worst case up to about +0.6 ms at `close` only). No budget was changed. Low at `inside`, `edge`, `far` and `dense` is at most +0.147 ms. The worst case is one rock's fill through its approved material, which population, LOD and radius do not reduce, and the field's rock count does not order it: the largest fields here read lower than the fixtures, because each `close` frames a different rock.

Before and after, `close` on chase, gate deciding (before: the 22:23 run):

| Fixture, AA | High before | High after | Low before | Low after |
| --- | ---: | ---: | ---: | ---: |
| Charted, 0 | +1.428 (74 calls) | +0.534 (4) | +0.259 | +0.301 |
| Charted, 2 | +2.192 (74) | +0.768 (4) | +0.302 | +0.369 |
| Rare, 0 | +2.024 (74) | +0.599 (3) | +0.349 | +0.350 |
| Rare, 2 | +3.065 (74) | +0.660 (3) | +0.414 | +0.415 |

The before layout's largest rock is not the same subject as the after layout's on the rare fixture, so the small low differences are not a speedup claim.

Pinned arms, for the paired control the body asks for, chase at `close`: pair on, high +1.047 / +1.566 charted and +1.196 / +1.689 rare at AA0 / AA2, low +0.315 / +0.603 and +0.342 / +0.642; pair off, high +0.339 / +0.499 and +0.396 / +0.465, low +0.294 / +0.345 and +0.301 / +0.358. Pair-on at `close` now needs a station opening the gate beside a rock filling the frame. Charted fields sit 150–300 km from their refinery, but this was not measured in flight, so it is an unmeasured corner rather than a guarantee.

Cold install on system 173: longest frame before the swap 40.6 ms, swap frame 20.9 ms.

## Navigation: measured, no budget exists

`scripts/measure-field-navigation.mjs`, same run, live `requestAnimationFrame` loop with the clock running, drifting 50 m/s through the densest cluster on high with every rock surveyed. Only `?mining=1` reaches these rows.

| Field, AA | Rows (disabled) | Within 8 km | Camera in field frame, km | Task ms/frame: Navigation, forward, no rows | Layout | Style | Row press median / max |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| Charted 596, 0 | 596 (78) | 158 | -18.67, 14.23, 3.19 | 12.89, 1.83, 1.98 | 5.19 | 0.53 | 36.4 / 44.2 ms |
| Charted 596, 2 | 596 (78) | 158 | -18.67, 14.23, 3.19 | 11.46, 2.27, 2.27 | 4.69 | 0.47 | 24.1 / 33.8 ms |
| Charted 783, 0 | 783 (0) | 161 | -7.17, -7.20, 8.07 | 14.27, 2.09, 2.32 | 6.24 | 0.63 | 32.4 / 37.2 ms |
| Charted 783, 2 | 783 (0) | 161 | -7.17, -7.20, 8.07 | 15.00, 1.79, 2.09 | 6.51 | 0.67 | 28.9 / 31.3 ms |
| Rare 298, 0 | 298 (0) | 111 | -13.31, -4.96, 1.72 | 5.54, 2.11, 2.25 | 1.59 | 0.17 | 28.8 / 33.8 ms |
| Rare 298, 2 | 298 (0) | 111 | -13.31, -4.96, 1.72 | 5.57, 2.39, 2.34 | 1.59 | 0.17 | 28.8 / 33.4 ms |
| Rare 391, 0 | 391 (0) | 103 | 1.52, -3.07, -2.88 | 8.03, 1.91, 2.14 | 3.02 | 0.31 | 28.0 / 33.3 ms |
| Rare 391, 2 | 391 (0) | 103 | 1.52, -3.07, -2.88 | 8.38, 2.06, 2.11 | 3.10 | 0.32 | 27.7 / 33.2 ms |

The rAF period held 16.7 ms in every arm, which vsync floors, so it shows no headroom. **A populated charted list costs about 9–13 ms of main-thread time a frame**, 15 ms in all at the largest field, which is most of a 60 Hz frame. Nothing has passed or failed here, because no Navigation budget exists; it is a finding for the mining release #1197, not an affordability guarantee. Browser paint is not in these counters.

## Flight, contact and saves

Headless, in `tests/field-collision.test.ts`, `tests/field-contact.test.ts`, `tests/field-frame.test.ts` and `tests/deposit-state.test.ts`:

- Bucket reach sets equal a full traversal, on both profiles, for co-moving paths that start and end outside the field and pass through a rock, on 24 rocks per profile.
- A ship flown in steps at the densest rock strikes a rock at 0.2, 2, 20 and 200 km/s closing.
- A ship inside a moved rock, as an older save can leave it, ghosts the rock and takes no impact from it.
- The 50 km drop clears every rock at every drift phase; the frame is acquired at the arrival point.

**Save migration, on a real save.** `tests/fixtures/save-field-generator-v1.json` was written by the code at `625e2227` through `serializeSave`, with six deposit rows in two fields and a discovered rare field. It loads with its deposits dropped (#951 D5, every field's fingerprint changed) and discovery, clock, credits, hull, loadout, ladders, flight and the other seven galaxies unchanged, and it survives a round trip. The fingerprints are pinned anew.

The browser gate, CI and sage rounds are recorded on the PR that carries this receipt, because recording them here would change the head they cover.

## Canonical views

Twelve new rows, lever #1209. `asteroid-field-{charted,rare}-{far,side,overview,dense}` stand at the approved study's cameras with the hull hidden; `asteroid-field-{charted,rare}-close-{chase,cockpit}` show the hull and cabin beside a rock, which is where the shadow-only gate shows. Paths and the before and after runs are on the PR and the node. **The principal's yes is still owed.**

## Spike note

`spikes/field-shape-1043` now reads `latticeRocks`, so the study layout still reproduces. Its `collision-worker.ts` and `anchor-query.test.ts` compared against the old lattice broadphase, which no longer exists; their figures remain valid at the revisions the #1043 receipt names.

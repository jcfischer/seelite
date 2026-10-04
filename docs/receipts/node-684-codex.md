# Node 684 implementation receipt (Codex worker)

This is an implementation handoff, not a checkpoint close. The supervisor owns publication and Sage rounds. The principal still owes the explicit yes on the canonical sheet, including the 2–20 km annulus, and approval of the proposed changelog sentence.

## Contract and verification

`src/inter-system-traffic.ts` owns static vocation/eligibility, conservative distance and time bounds, integer cycle multiples, destinations, jump anchors and inbound enumeration. The local Traffic and route modules import no inter-system module. Both lane legs use the existing cruise and station terminal composition; lane targets have no parent. Game retains only the current system's actors, caches and presentation.

The headless acceptance lives in `tests/inter-system-traffic.test.ts` and its companion controls. The parent suite actually launches three child runs which exit 1 on the rejected crossing-eligibility, current-seed identity and no-contention timing controls. The crossing control uses a distant circular station fixture, and a committed player lane produces its delayed departure clock. The shipped static destination remains unchanged. Existing world-state goldens keep the generator at version 8 and schema 3; the old repair fixture rejoins at its next hauler departure.

A live continuity run exposed an incorrect derivative on the final lane approach; it is corrected. One other apparent rewrite was reproduced in pure direct and cached replay at seed 54, system 232, carrier `station-trade/traffic-05`, 1357.2 s: both positions agree. It is a first powered cruise step decelerating from a high substep speed to 3325 km/s after steering at zero, covering 1178 km. The continuity instrument now also reads the peak speed actually integrated by `advanceCruise`'s `onSegment`, including fractional steps, instead of estimating that step from ending speeds alone. No cruise speed or collision law changed.

## Capacity instrument (input for node 677)

Run by hand: `bun scripts/measure-inter-system-traffic.ts`. World seeds **1, 47, 1234 × all 8 galaxies = 24 galaxies**; **9,521 stations**. Each station samples 2,880 clocks, 30 s apart, over the second game day. These are sampled maxima, not a full-station departure bound or a measured queue wait.

The complete per-station report is [node-684-capacity.csv](node-684-capacity.csv). The galaxy rows and corpus summary are [node-684-capacity-summary.json](node-684-capacity-summary.json).

| Quantity | Minimum | Median | Maximum | Mean |
| --- | ---: | ---: | ---: | ---: |
| Realised hauler share of non-signature slots (24 galaxies) | 30.596% | 32.568% | 33.934% | 32.373% |
| Station sampled maximum inbound / Traffic capacity (9,521 stations) | 0 | 0.600 | 3.000 | 0.719 |
| Galaxy maximum of that station ratio (24 galaxies) | 1.667 | 2.333 | 3.000 | 2.250 |

Nominal draw share is 1/3. Signature slots and failed eligibility reduce the realised share. Every station row records its capacity, candidates, sample count, mean inbound, maximum inbound and ratio. No inbound cap or role-specific share was introduced.

Cold inbound query, including both hops of contents generation, seed 47 / galaxy 0 / system 0, seven independent cold runs per age:

| Clock age | Min ms | Median ms | Max ms | Distinct generated systems |
| --- | ---: | ---: | ---: | ---: |
| 1 game day | 11.472 | 12.456 | 17.618 | 33 in every run |
| 365 game days | 12.581 | 13.262 | 13.821 | 33 in every run |

These CPU timings are local measurements, not thresholds. The test holds the generation-work count and reports elapsed time, rather than gating wall-clock performance.

## Browser and views

Hardware lane: **ANGLE Metal / Apple M1 Pro**. The new probe follows **CEQULEUS**, `0:station-refinery/traffic-01`, a prospector, from system 0 to 211 in seed 47. It checks the berth departure, early lane hold, wind-up, contact removal at the anchor, same name/hull on arrival, both painted rings against a ring-disabled pixel control, shared destination queueing, and offline stereo energy for the spatialised arrival sound arm.

The canonical set has close NPC departure/arrival frames plus two companion frames from the player's exact, un-offset lane point. The close frames judge the rings; the player-lane pair judges the annulus and its apparent range. The NPC rings reuse ArrivalRift and apply no player lens.

The required `probe:select` call selected **all** because `src/main.ts` is a shared-runtime risk. Running `probe:pr` with that selection would run the full suite, which the worker contract explicitly reserves for the supervisor. This worker instead runs the affected Traffic probes and an explicit contact/identity/cruise/audio/witchspace subset. This is partial browser evidence, never a full-suite pass.

Canonical capture: `view-set/index.html`, run `view-set/node-684-codex/`, **67 views at 1440×900**. Images and the manifest are intentionally gitignored, so they remain local handoff artifacts. All four new PNGs were opened and inspected. The departure frame has the ring and no ship; the arrival frame has the ring and the same prospector. The player-lane pair stands 16.643 km from the lane point. At that distance the ring is tiny; its legibility and the annulus remain questions for the principal, not a numeric acceptance supplied by this worker.

Inspection caught a capture-fixture error: the preceding Shipyard rows and follow-jump could restore a saved system, and a later departure row reused the arrival system. Each NPC row now boots fresh and refuses a missing or wrong-kind ring. The final capture completed after that repair.

The eleven affected probes passed: `docking-traffic`, `inter-system-traffic`, `station-route-traffic`, `traffic-continuity`, `traffic-engagement`, `traffic-mouth`, `audio-cues`, `carrier-scan`, `cruise`, `display-contacts`, and `witchspace`. Earlier failed runs led to the continuity correction above and a scanner fixture correction: the scan probe now chooses a present home carrier instead of an absent foreign candidate. Source edits during an early long probe run also produced import-fetch failures; the successful reruns used a fixed serving tree.

Earlier full test runs hit existing five-second music/docking sweep timeouts under load. One isolated run reported 4,898 passed and only the music test's timeout at 5.449 seconds. No timeout or assertion was loosened. Final gates are recorded below.

## Final worker gates

- `npm test`: **4,899 passed, 0 failed**, 269 files, 291.41 seconds.
- Final build exposed a test-only API type mismatch: the delayed committed visit now uses `projectSystemTrafficAuthority`, the correctly typed wrapper over the same projector. After that correction the focused inter-system suite, including all three child failing controls, passed **19/19**.
- Focused Traffic, route, cruise, world-state and contact corpus: **308 passed, 0 failed**. Persistence suites also ran in the full test gate.
- `npm run format:check`: passed, 760 files. `npm run lint`: passed, 201 scripts. `npm run build`: passed (`tsc --noEmit` and Vite).
- Eleven affected hardware probes and the complete 67-view capture passed as recorded above. The supervisor still owns the full browser suite and Sage review.

The proposed changelog sentence is: “Haulers now jump between nearby systems: follow one through hyperspace and meet the same ship arriving at its next station.” It remains subject to principal approval. No graph checkpoint is claimed satisfied by this receipt; `cp-seelite-inter-system-traffic-implementation` remains under principal control.

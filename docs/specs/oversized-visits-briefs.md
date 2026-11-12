# Oversized visits: follow-up build briefs

> Companion to [oversized-visits.md](oversized-visits.md), prepared under node
> [#1239](https://github.com/jcfischer/seelite/issues/1239). Each section is one
> independently verifiable slice, in the orienteer build-brief shape. I cannot
> file graph nodes from the worker lane (no graph writes), so these are the
> bodies to file. Section and Q numbers refer to the proposal.

## Dependency chain and readiness

| Brief | Blocked by | Ready to file as `kind: build`? |
| --- | --- | --- |
| B1 Frozen Traffic identity baseline | none | yes |
| B2a External berth catalogue (pure geometry) | none | yes |
| B2b NPC external visit lifecycle | B1, B2a | yes |
| B5 Visual-only shuttle | B2a, B2b, Q6 | yes, once Q6 closes |
| Q1–Q5 player decisions | none | file as `grilling` nodes |
| B3 Player external docking | B1, B2a, B2b, Q1, Q2, Q3, Q4 | **no**: skeleton only; each Q below decides one line |
| B4 Save and restore of an oversized commander | B3, Q4 | **no**: skeleton only |
| Q6–Q11 shuttle decisions | none | file as `grilling` nodes; authoritative shuttle is not briefed |

**Required blocking edges on #1035 (action A1).** `soma graph node 1035` currently shows `blocked by:
1034 (closed), 1239 (open)`. Before #1239 closes, #1035 (or the slices it is split into, if the
principal approves a split) needs `--blocked-by` edges as follows, or closing #1239 will unblock the
integration with none of this built:

- the Pilgrim's integration: B1, B2a, B2b, B3, B4 and, transitively, Q1 to Q5;
- the Warden, Shiv and Sluice integration, if split out: nothing from this chain, but it carries
  B1's fingerprint assertion in its own tests;
- Bastion and Rampart: nothing from this chain unless Q5 says they visit stations (then B2b).

---

## B1. Assign Traffic hulls against a frozen identity baseline

## Deliverable

`stationTrafficRoster` picks each actor's hull from a named, frozen table of the generator-11
envelopes, so installing any envelope in `HULL_SPECS` changes no Traffic key, hull, callsign,
schedule or fingerprint.

## Settled by

Principal's D1/D2 on #1035 (2026-11-10): preserve carrier keys, hull assignments and history; do not
silently reshuffle unrelated Traffic actors. Proposal §3 (the reshuffle, measured) and §4.1.

## Acceptance criteria

- Given the six measured envelopes of `scripts/measure-oversized-hulls.ts` installed in
  `HULL_SPECS`, when every roster in all 8 galaxies at seed `0x5ee11e` is built, then 0 of 19,114
  actors differ from base in hull, callsign or schedule, and `carrierBaselineFingerprint` equals the
  eight goldens in `tests/world-state.test.ts`.
- Given the baseline table, then it has one row per `HULL_IDS` entry, each equal to
  `HULL_SPECS[id].env` as it stands at base, and a test fails if a row is added to `HULL_IDS`
  without one.
- Given a pool whose signature hull fits no berth *under the baseline*, when a roster is built,
  then it throws as it does today (`Traffic signature … fits no … berth`).
- Failure case: given a hull whose live envelope fits no internal berth, when `buildHaulerPlans` or
  a local route reads that actor, then it does not throw and does not draw the hull in an internal
  berth; it reports "no internal berth" through a named predicate (`needsExternalBerth(actor)`)
  that B2b consumes. Until B2b lands, the predicate has no caller in game paths.
- `WORLD_GENERATOR_VERSION` stays 11 and `WORLD_SCHEMA_VERSION` stays 4. A test fails if either moves.

Test seam: `stationTrafficRoster`, `carrierBaselineFingerprint`, `enumerateCarriers`,
`buildHaulerPlans`. The existing `tests/oversized-roster-baseline.test.ts` is the model; it should
be extended, not duplicated.

Live probe: `bun scripts/measure-oversized-traffic.ts --haulers` prints 0 changed hulls and 0
vocation flips. Headless only: no rendered behaviour changes, so no browser probe applies. The
change is confined to `src/` and `tests/`, so it is not doc-only; run `npm test` and `npx tsc --noEmit`.

## Touches

`src/station-traffic.ts`, `src/hull.ts` (the table), `src/inter-system-traffic.ts`,
`src/station-route.ts` (the home-berth predicate only), `tests/`. Read
`docs/specs/persistent-world-state.md` §2 and `docs/specs/station-traffic.md`.

## Assumptions

- Only the Pilgrim's fit changes among the six (proposal §1.4). If a different hull changes fit when
  its authored envelope is installed, stop and escalate on the node.
- The baseline is the base's `HULL_SPECS` envelopes. If a hull's envelope changed after generator 11
  shipped, name that revision in the table and escalate.

## Out of scope

- External berths, any rendering, the player's hull, saves. Installing the new envelopes.

---

## B2a. The external berth catalogue

## Deliverable

A pure, Three-free function returns, for a station and a hull, the external berths in the station's
non-rotating frame, each outside the rotation cylinder, the docking corridor and every other
berth's bounding sphere.

## Settled by

Principal's D2 on #1035 (oversized ships dock externally; small shuttles ferry). Proposal §4.2's
geometry rule: centre ≥ `silhouetteKm + 2R + 0.1 km` from the station centre, lateral to the lane
by the corridor radius plus R.

## Acceptance criteria

- Given every form of every role in `STATION_FORMS`, when berths are built for the Pilgrim, Bastion
  and Rampart envelopes of §1.2, then each berth centre is ≥ `stationSilhouetteKm + 2R + 0.1 km`
  from the station centre, outside the 3 km aperture-frame corridor by ≥ R, and ≥ `R_a + R_b +
  0.1 km` from every other berth; the table prints the minimum margin per rule.
- Given a station spinning at the top of `SPIN_RPM_RANGE`, then the berth's pose in the non-rotating
  frame is identical at two game times, and its velocity equals the station's translation velocity
  (`FrameMotion`, #529), not an inertial one.
- Given a capacity parameter n in {1, 2, 3} per role, then the catalogue has n berths, all satisfying
  the first criterion. The shipped n is a **provisional constant, 1 per role**, mirroring
  `VISITOR_BERTHS_PER_STATION`; nothing in the code depends on its value, and Q3 may retune it
  without a structural change.
- Failure case: a hull small enough to fit an internal berth returns an empty catalogue; a
  non-finite envelope or silhouette throws.

Test seam: the new module's function over `STATION_FORMS` and `HULL_SPECS`; margins as a printed
instrument (`scripts/measure-external-berths.ts`), thresholds asserted exactly, not with
`toBeGreaterThan`.

Live probe: `bun scripts/measure-external-berths.ts` prints the margins; no browser tier because
nothing is drawn. Headless only.

## Touches

New `src/external-berth.ts` (imports `station.ts`, `station-mesh.ts` reach only through a leaf, per
the display-reach rule in the map's #28 constraint), `src/docking.ts` (read the corridor radius),
`tests/`. Read `docs/specs/docking.md` §3 and §13.

## Assumptions

- The corridor radius is the shipped #419 constant. If the corridor is not a single radius, stop
  and escalate.

## Out of scope

- Routes, reservation, rendering, the player, saves. Choosing the capacity.

---

## B2b. NPC external visit lifecycle

## Deliverable

A Traffic actor whose hull fits no internal berth visits a station by approaching, holding,
reserving an external berth, parking outside, and departing, and a blocked arrival falls back to
`abstract-away`.

## Settled by

Principal's D2 on #1035; proposal §4.2 (lifecycle), §4.1 D2 (three facts).

## Acceptance criteria

- Given a roster actor with `needsExternalBerth` (B1) at its home station, when the schedule says
  parked, then its projection is the external berth's pose (B2a), not an internal berth, and its
  home affiliation, key and callsign are unchanged.
- Given the external berth is held by another carrier, when an oversized actor arrives, then it
  stays at its hold, and after the bounded window the visit becomes `abstract-away`. Given the
  player's request for the same berth, the existing arbitration order decides (`compareStationTurns`).
- Given the actor departs, then its reservation is released at the hold, and a following actor
  is granted that berth in a deterministic order.
- Given 466 of 1,333 affected systems have a single station (proposal §3), when an oversized local
  actor has no fitting destination, then it routes to its own home's external berth or
  `abstract-away`, never to an internal one.
- Given the haulers of proposal §3 (662 Pilgrim haulers in 8 galaxies), when `buildHaulerPlans`
  runs under the real envelopes, then it does not throw and the eligible destination stations are
  those with an external berth.
- Failure case: given an actor with no external berth available at its home *and* nowhere to go,
  then the route is `abstract-away` and no projection is emitted. Never a ship drawn in an internal
  berth it does not fit.
- `route` and projection seams stay pure functions of schedule, clock and state, as in
  `in-system-route-traffic.md` §5; `collision` corpus row: no external-visit path enters a station
  proxy or another berth.

Test seam: `station-route.ts`'s route projection and `buildHaulerPlans`; corpus over the eight
galaxies in the manner of `scripts/measure-traffic-collision.ts`.

Live probe: a new `scripts/probe-external-berth.mjs` driven through `control-seelite` on a seed with
an oversized resident, showing the ship held at the berth; run only the probes `npm run
probe:select -- --base origin/main --head HEAD` picks plus the new one. Do not claim a full-suite
pass.

Principal visual approval: **yes** (`ranger:needs-eye`). The principal looks at an oversized
ship parked beside each station role and says yes; the agent does not stand in for it.

## Touches

`src/station-route.ts`, `src/station-traffic.ts`, `src/inter-system-traffic.ts`,
`src/external-berth.ts`, tests, the probe. Read `docs/specs/station-traffic.md`,
`in-system-route-traffic.md`, `inter-system-traffic.md`.

## Assumptions

- An oversized actor is only ever the Pilgrim (proposal §1.4). If a capital becomes a Traffic pool
  member, stop and escalate on Q5.

## Out of scope

- The player's Pilgrim, services, the shuttle, saves, the number of external berths.

---

## B5. A visual-only shuttle at an external berth (LABELLED VISUAL ONLY)

## Deliverable

While an oversized ship is parked at an external berth, a small ship is seen leaving the station,
reaching the berth and returning. **It carries nothing and moves no goods, passengers or credits**,
and its interface, its code and its receipt say so.

## Settled by

Principal's D2 on #1035 (shuttles ferry); Q6 must close first with "visual only is acceptable as a
first slice". Not an authoritative transfer.

## Acceptance criteria

- Given an oversized Traffic ship berthed (B2b), when the clock runs, then the shuttle's pose is a
  pure function of clock, station frame and berth, with no persisted state and nothing in the save.
- Given the player is within `TRAFFIC_MATERIALIZE_KM`, then the shuttle is drawn at the game's distance
  levels and is not targetable, not a trade partner and has no cargo field in its type.
- Given the berth is released or the parent departs mid-cycle, then the shuttle's cycle ends at the
  station on the next lane gap, never in flight with nothing to return to (Q11's interim answer, slice 1
  only, and recorded as such).
- Failure case: given the lane is busy, then the shuttle waits; it does not take the lane from a
  carrier or the player (`compareStationTurns`).
- Collision corpus row: the shuttle path enters no station proxy and no ship box (`collision.md`,
  Traffic is collidable).

Test seam: the shuttle's pure pose function and the lane arbitration.

Live probe: `npm run views` rows before and after at the oversized ship's berth, captured headed.
Principal visual approval: **yes**. No claim that goods moved is made anywhere.

## Touches

`src/external-berth.ts`, a new `src/shuttle-visual.ts`, the Traffic projection, view set.

## Assumptions

- Q6 closed as "visual only first". If it closed otherwise, this brief is void.

## Out of scope

- Dispatch, access, rendezvous, cancellation, parent destruction (Q7–Q11), settlement of cargo or
  passengers, prices, trade, combat.

---

## B3. Player external docking (SKELETON: not ready)

Not fileable as a build node until Q1–Q4 close; filing it earlier would hand a player-facing choice to
the worker. What each Q decides:

- Q1 decides how an oversized hull is bought (the replacement for `deliverHull`'s `on-launch` for a
  hull that fits nothing).
- Q2 decides what an external berth gives: console, market, fuel, drive charge.
- Q3 decides capacity and which roles the player may use.
- Q4 decides how an old docked Pilgrim save is placed (B4).

Fixed already: `requestClearance`'s `denied: no berth that fits` (`docking.ts:876`) becomes a grant
of an external berth for an oversized hull, under the same reservation rules; `DOCKABLE_HULL_IDS`
semantics stay (capitals and the Pilgrim are not internally dockable). Dependencies: B1, B2a, B2b.
Failure: no free berth queues the player, with the existing lane-wait message. Headless seam:
`requestClearance` and `deliverHull`. Browser acceptance: a docking probe flown with a Pilgrim.
Principal visual approval: yes.

## B4. Save and restore of an oversized commander (SKELETON: not ready)

Blocked by B3 and Q4. Fixed already: no schema or generator bump (proposal §5); oversize is derived
from `commander.hull`; the restore goes through the same protocol as `restoreDockedAt`
(`main.ts:21001`); `hullOnLaunch` is defined before an oversized hull can be sold (it is not saved
today). Evidence it owes: save, load, save round trip for a Pilgrim docked externally; an old fixture
(Pilgrim docked inside, save envelope 18, generator 11) loading to Q4's state; a destroyed-explorer
deviation row still projecting an explorer; a death wreck of an explorer and of a capital round-tripping
with the offset read verified (proposal §5 left it unverified). Failure: a load Q4's policy cannot
place refuses with a named reason and drops no `dockedAt`.

---

## Grilling nodes to file (the unsettled player-facing choices)

- **Q1** How is an oversized hull bought? (O1 buy only at an external berth; O2 trade in inside, board
  by shuttle at the shipyard berth; O3 not purchasable until the shuttle exists. Recommendation: O2,
  with O3 as the interim.)
- **Q2** What does an external berth give: console, market, fuel, drive-charge refill?
- **Q3** External berths per station, a capital-sized berth at shipyards, and which roles the player's
  Pilgrim may berth at.
- **Q4** Old saves with a Pilgrim docked inside: re-place externally, leave beside the station, or refuse.
- **Q5** Do capitals visit stations in v1?
- **Q6** Is a visual-only shuttle acceptable as a first slice, and is a transfer visible only or authoritative?
- **Q7** Station-side access for a shuttle. **Q8** Dispatch and concurrency. **Q9** Rendezvous.
  **Q10** Return and cancellation. **Q11** Parent departure and destruction.

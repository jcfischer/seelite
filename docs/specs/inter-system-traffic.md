# Inter-system traffic

> Decision contract for work-graph node
> [“Inter-system traffic: derived hyperspace departures and
> arrivals”](https://github.com/jcfischer/seelite/issues/262). D1–D16 are the
> principal's rulings from the grilling recorded on that node; this document
> states them as law and adds nothing they did not decide, except where a
> section says it derives a consequence.

## 1. A hauler is a home-owned Traffic actor that leaves the system (D1, D2, D3)

An inter-system journey is one more kind of `away` interval. The actor leaves
its home system, docks at a station in a neighbouring system, and comes home.
Its Carrier slot, `CarrierKey`, saved row and schedule stay at home the whole
time, exactly as `in-system-route-traffic.md` §1 keeps them for an in-system
visit. No roster ever adopts a visitor, and nothing transfers between systems.

Every Traffic roster slot has a fixed **vocation**, decided when the roster is
built:

- a **local** keeps `in-system-route-traffic.md` unchanged: in-system visits,
  or #148's abstract away interval where it has no eligible destination;
- a **hauler** flies every away interval to a station in another system.

The role's signature slot — ordinal 0, the hull `TRAFFIC_ROLE` forces into
every roster — is always local, so a station's signature ship is the one
always seen in its own system. Every other slot is a hauler when two things
hold: its vocation draw falls under the hauler share (§10), and its static
eligible set (§2) is not empty. Otherwise it is a local. The draw uses the
roster's existing idiom, `fnv1a(`${localCarrierId}|vocation|${berthSeed}`)`,
so a slot's vocation is independent of every other slot and of visit order.

Rejected: transferring an actor to the destination's roster (it breaks the
home-slot persistence key and #261's "never transfers between rosters"), and
derived arrivals with no actor crossing (a ship tagged at the departure point
would never be seen at the other end).

## 2. Destinations are static (D4, D13, D15)

A hauler's **eligible set** is fixed at roster build and never re-evaluated
from the clock, a position or a detour plan. A station `s` in system `B` is
eligible for a hauler homed in system `A` when:

1. `B` is in the same galaxy as `A`, `B ≠ A`, and the distance between their
   galaxy positions is at most the hauler's `HULL_SPECS[hull].tankLy` — one
   jump, never a chain (#185: reach is a fact about the flown hull);
2. `s` has at least one Traffic Berth that fits the hauler's hull; and
3. the **static charge bound** of both in-system legs fits the hull's full
   `chargeAu`: `dHome + dAway ≤ chargeAu`, where each `d` is §5's distance
   bound from that system's lane point to the station.

The eligible set is sorted by `(systemIndex, station.id)`, both ascending, with
`station.id` compared as #261 §1 compares it. For the away interval with
ordinal `awayOrdinal` the destination is
`eligible[(actorOrdinal + awayOrdinal) mod n]` — #261's rotation over one flat
list, so a neighbour with more stations receives proportionally more visits.

Clause 3 is why no charge refill happens at a jump: cruise charge refills only
at a dock (`in-system-route-traffic.md` §6), and a hauler arrives in `B` with
what the home leg left it. Hyperspace fuel is implicit — clause 1 is the tank's
range check, the tank refills free at every dock like the charge, and it adds
no saved row.

A system with no station drops out by clause 2. #23's unreachable systems are
therefore never destinations, and nothing here assumes every system is
dockable.

This amends `in-system-route-traffic.md` §1 **for haulers only**. A local still
takes #261's eligibility snapshot at its outward crossing. A hauler cannot,
because its crossing time depends on contention in its home system, and a
destination chosen from it would make `B`'s inbound set depend on `A`'s queues
(§4).

Live flight still uses #261 §4.2 in full: moving-body guards, detours and
charge-exhaustion recovery can make a hauler late. They never change its
destination.

## 3. Lane points (D5, D6)

A hauler leaves and enters systems at the place the player does.

- **Departure.** It cruises to its home system's arrival point *for the
  destination*: `arrivalPoint(homeRecord, homeContents, destPos, t)`, 1 AU from
  the star on the bearing toward the destination, pushed outward past any body
  as `galaxy-generation.md` §7.4 rules. There it drops to normal flight, flies
  the 3 s wind-up (`JUMP_CHARGE_S`), and jumps.
- **Arrival.** It appears at rest at `arrivalPoint(destRecord, destContents,
  homePos, tJump)`, the point the player's own jump from home would use, and
  flies #261's route from there: cruise to the destination's Traffic hold,
  Clearance queue, Transit lane, arrival traversal.

The two points pair up. Haulers leaving `A` for `B` wait at the point where
haulers and the player arriving in `A` from `B` appear. Lanes form at real
places that a pilot can fly to.

Each hauler's actual lane point is the exact point plus an offset in the plane
perpendicular to the bearing: a point in an annulus (§10) drawn from
`fnv1a(`${carrierKey}|lane|${awayOrdinal}`)`. The same offset serves both ends
of one voyage. The player keeps the exact point, so no hauler is ever placed on
a player's arrival. Two haulers can still overlap by rare chance, and a hauler
can overlap a player who flew onto its point. That is `collision.md` §4.3's
placement case: the pair is not tested until it separates. This spec adds no
push-out.

The lane point is a star-centric cruise target: `advanceCruise`'s `target` is a
point with a radius, and `targetParentId: null` is its declared star-centric
case. No second cruise law is introduced.

## 4. The jump slot (D7)

The jump instant is anchored to the schedule, not to the hauler's physical
progress:

```
tOut  = awayBoundaryS   + nominalOutS(home)  + slackS   // home → destination
tBack = parkedBoundaryS + nominalOutS(dest)  + slackS   // destination → home
```

`awayBoundaryS` and `parkedBoundaryS` are the boundaries `trafficScheduleAt`
already returns. `nominalOutS(system)` is §5's static upper bound on the
uncontended time from that system's Berth to its lane point, wind-up included.

- A hauler that reaches its lane point before its slot holds there and times its
  wind-up so the jump fires at the slot. Ships idling at lane points are
  therefore normal, and visible.
- The far side always sees the jump at the slot. `B` derives an inbound hauler
  from `A`'s *schedule* alone, never from `A`'s queues, lane or player history.
  That is what removes the recursion: `A`'s queues hold visitors from `C`, whose
  departures would depend on `C`'s queues, and so on across the galaxy. With
  slots, every inbound time is a pure function of seed, schedule and overlay,
  and each system's laws govern only its own side.
- **The accepted inconsistency.** Contention in the *observed* system can make a
  hauler late there, and it then jumps late. The unobserved side keeps the slot.
  A player who watches a late jump and follows at once can find the hauler
  already in `B`, earlier by up to its lateness. Nothing reconciles the two. The
  ruling accepts it because only a pilot chasing that one ship can see it.

The world-state overlay is the one input from `A` that `B` reads: a hauler
whose row is `destroyed`, or `repairing`, is absent from `B` (§8). Rows are
keyed by `CarrierKey` in the per-galaxy overlay, so `B` reads them directly and
evaluates nothing in `A`.

## 5. The hauler cycle and its bounds (D8, D16b)

Cold queries stay independent of epoch age (`in-system-route-traffic.md` §8.1
row 10). A cycle whose length varied per interval would need a sum over every
past interval, so a hauler's cycle is fixed per actor.

**Distance bound.** A body's distance from its star has a time-independent
upper bound (its orbit, plus its parent's for a moon or a station), written
`r̂(body)`. `arrivalPoint` starts at `ARRIVAL_DISTANCE_AU` and only ever pushes
outward to the far edge of a body's clearance sphere, so its distance is at most
`âS = max(ARRIVAL_DISTANCE_AU, max over bodies of r̂ + ARRIVAL_CLEARANCE_AU)`.
The distance from a lane point to station `s` is then at most `âS + r̂(s)`.
This is the `d` of §2 clause 3 and of the time bounds below. The implementation
must pin `âS` in a test over seeds and clock values. The bound is derived here
from `system.ts`'s solver and has not been measured.

**Time bound.** `nominalOutS(system)` is the sum of:

- the reversed arrival traversal's duration for the slowest Berth that fits the
  hull at that station (a function of berth geometry);
- #261 §3's local departure through the 5 km bubble under the 0.10 km/s
  aperture gate, and the 0.5 km clearance beyond it;
- the cruise spool;
- `in-system-travel.md`'s pacing law evaluated at the distance bound (the
  law's time grows with distance, so a distance bound is a time bound);
- `JUMP_CHARGE_S`.

`nominalInS(system)` is the mirror: cruise from the lane point at the distance
bound, local approach to the Traffic hold, the hold-to-aperture tunnel at the
aperture gate, and the arrival traversal for the slowest fitting Berth.
Clearance and lane are counted as immediate, the uncontended case. Detours are
not in either bound. `slackS` absorbs them, and when it does not, the hauler is
late (§4).

**Cycle.** For the hauler's worst eligible destination (the maximum over its
static set, which §1 guarantees is not empty), the cycle must fit:

```
awayNeedS   = nominalOutS(home) + slackS + nominalInS(dest) + DWELL_S
parkedNeedS = nominalOutS(dest) + slackS + nominalInS(home) + DWELL_S
```

`DWELL_S` is #261 §3's thirty visible seconds of refill at a dock. The away
interval covers the outbound voyage and the stay. The return leg starts at the
`parked` boundary (#261 §2) and is covered by the parked interval. The hauler
keeps its station's `departureAtS` and `parkedDuty`. Its cycle is
`m × cycleS`, the smallest integer multiple of its station's cycle for which
`m·cycleS·(1 − parkedDuty) ≥ awayNeedS` and `m·cycleS·parkedDuty ≥ parkedNeedS`.
The hauler stays on its ordinal's slot in the station's departure grid and flies
on every m-th pass. `trafficScheduleAt` and `nextTrafficDepartureAtS` apply
unchanged.

A hauler parks less often per hour than a local. That is intended: it reads as
long-haul.

## 6. Destination capacity (D9)

An inbound hauler is an ordinary visiting Carrier at its destination. It goes
through the shared Clearance queue and Transit lane, and it can only be dealt a
Traffic Berth (`docking.md` §6.1, #277). The visitor berth stays the player's,
so inbound haulers can never queue the player out of a station.

When more haulers arrive than a station has free Traffic Berths, the extras
queue at their Traffic holds under the shared oldest-ready policy. A queue at a
busy station is a designed state. It needs no cap, and it makes the hauler late
on the observed side only (§4).

Hubs are the risk. A leaf system with one neighbour in reach sends all its
haulers to that neighbour. The build owes an instrument that reports, over N
galaxies × world seeds with the spread stated:

- per-station inbound against capacity; and
- the *realised* hauler share after §2's reach and charge filters, beside the
  nominal share.

If hubs overload past a threshold the principal sets from that report, the
hauler share (§10) goes down. Neither figure is predicted here.

## 7. Identity crosses with the ship (D10)

Every draw that makes a carrier *that* carrier uses its **home** system's seed:
`systemSeedFor` of the galaxy and the `systemIndex` its `CarrierKey` names. This
covers the name, callsign, hull variant, manifest and standing. The manifest's
`government` input is the home system's too. A hauler scanned in `A` and in `B`
on one voyage shows one name and one manifest. `carrier-identity.md` §2 states
the seed rule.

How a destination's law treats a foreign carrier — its legal status, its
standing there, whether a patrol may cross borders — is fiction, and belongs
to #460.

## 8. Strikes and losses away from home (D11)

`civilian-combat.md` H1 and H3 apply unchanged, and "home" means the home
system.

- A hauler struck away flees under H3 while materialized. After it leaves the
  band, it projects as parked at its home Berth until `completesAt`, as H3c
  rules. A player who jumps straight to the home system finds it already
  docked. In-system diverts behave the same way today.
- A hauler destroyed away is replaced at home under H1.
- In every inbound query, a hauler whose row is `destroyed` or `repairing` is
  absent.

No row, transition or schema term is added.

## 9. Presentation (D12)

A jump is drawn at both ends with `arrival-rift.ts`'s ring, sized from the
hauler's hull reach as for the player. NPC rifts have no lens
(`arrival-rift.ts`: the witchspace pass carries one lens, the player's).

- **Arrival:** at `tJump` the ring opens one reach behind the ship's nose, the
  ship is there at rest, and the ring closes on `WITCHSPACE`'s exit timeline.
  This is `arriveWitchspace()`'s exit with no entry.
- **Departure:** after the wind-up the ring opens one reach ahead of the nose.
  When it closes, the ship is gone.

Both are drawn only while the lane point is inside the Traffic band (10,000 km
to materialize, retained to 12,000 km). The `DisplayContact` appears or goes on
the jump tick. The existing arrival sound arm plays, spatialised.

Visual work closes on the canonical view set and the principal's yes. This node
owes view rows for an NPC arrival and an NPC departure at a lane point, and
the annulus radii (§10) are judged on them.

## 10. Starting dials (D14)

| Dial | Start | Tuned by |
| --- | --- | --- |
| Hauler share of non-signature slots | 1/3 | §6's instrument |
| `slackS` | 60 s | lateness against idle time at lane points |
| Lane annulus | 2–20 km | the view rows of §9 |

One share for every station role. A per-role share would say what each role is
*for*, which is #460's to decide.

## 11. Persistence

Nothing routine is saved. A hauler's vocation, eligible set, destination, slot,
phase, charge and fuel are all derived from seed, schedule and `gameTime`.

The generator version does not move. `persistent-world-state.md` §2 ties it to
a carrier's identity, type, parent and generated placement, and a vocation
changes none of them. A saved `completesAt` is an absolute instant, so a slot
that becomes a hauler under an old save still completes its repair at that
instant and rejoins at its next hauler departure.

## 12. Ownership and seam

- This spec owns vocation, static eligibility, lane points, jump slots, the
  hauler cycle and the inbound query.
- `in-system-route-traffic.md` keeps every in-system leg a hauler flies; a
  hauler's in-system legs are #261 routes with a lane point at one end.
- `station-traffic.md` keeps rosters, schedules, holds, queues and the lane.
- `hyperspace.ts`, `system.ts`'s `arrivalPoint` and `arrival-rift.ts` are
  consumed, not changed in law.

The implementation is pure and imports no Three.js. It extends
`src/station-traffic.ts` (vocation, cycle) and `src/station-route.ts` (the
lane-point legs and slots) and adds an inbound query. That query, given a
system and `gameTime`, enumerates the haulers of every same-galaxy system
within the largest Traffic `tankLy` (derived from `TRAFFIC_HULL_POOLS` and
`HULL_SPECS`, never restated) whose current voyage names one of its stations.
`Game` owns only current-system caches and presentation, as #261 §7 rules.

## 13. Acceptance

### 13.1 Headless

1. Vocation is independent of visit and collection order. The signature slot is
   always local. A slot with an empty static set is local.
2. The eligible set and destination depend on no clock, position or detour. A
   control that recomputes eligibility at the crossing must give a different
   inbound set under injected home contention, and the shipped path must not.
3. Direct and canonical stepped evaluation agree, as #261 §8.1 row 3 requires,
   across a jump in both directions.
4. `B`'s inbound set at `t` is identical whether `A` was visited, unvisited, or
   visited with injected player contention.
5. A hauler early at its lane point jumps exactly at its slot. A hauler made
   late by injected contention on the observed side jumps late there, and the
   far side still sees the slot.
6. The cycle is an integer multiple of the station cycle with `departureAtS`
   unchanged, and an uncontended voyage to the worst destination fits both
   intervals.
7. `âS` holds over seeds × clock values, and `dHome + dAway ≤ chargeAu` holds
   for every eligible pair.
8. Identity: the name, manifest and standing of one hauler are equal in its home
   and destination systems. A control seeded on the current system must fail.
9. A `destroyed` or `repairing` row removes the hauler from every inbound
   query.
10. Canonical save output contains no routine hauler row. The generator version
    and the carrier fingerprints are unchanged. An old-save fixture holding a
    repairing slot that becomes a hauler loads and rejoins at its next hauler
    departure.
11. A measured cold-cost row for the inbound query at one and 365 game days,
    independent of epoch age.

### 13.2 Instrument

§6's report, with N and the spread, run by hand and stated in the build's
receipt.

### 13.3 Browser

A deterministic fixture shows one named hauler:

1. leaving its home Berth and holding at its lane point until its slot;
2. jumping through the departure ring, after which its contact is gone;
3. after the player follows, arriving at the destination lane point through
   the arrival ring with the same name and hull;
4. reaching the destination Traffic hold and entering the live queues without
   privileging itself or the player.

### 13.4 Views

NPC arrival and NPC departure rows in `scripts/lib/view-set.mjs`, and the
principal's yes on the sheet.

## 14. Known risks

- The inbound query generates every neighbour system's stations to rebuild its
  rosters. §13.1 row 11 measures that cost. A current-galaxy cache is
  acceleration only and may not make visit order observable.
- `station-traffic.md` §2's full-station departure bound is false today and its
  test cannot fail (F1). #677 owns it. Hauler cycles do not change that answer.
  They only add slots that fly less often.
- `arrivalPoint` takes the galaxy-space bearing as a system-frame direction. The
  game ships that law, and both ends here use it, so they agree. #100's missing
  galactic-frame transform would move every lane point if it ever changed that
  law.

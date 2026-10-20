# Inter-system traffic

> Decision contract for work-graph node
> [“Inter-system traffic: derived hyperspace departures and
> arrivals”](https://github.com/jcfischer/seelite/issues/262). D1–D16 are the
> principal's rulings from the grilling recorded on that node; this document
> states them as law. A section or paragraph marked *(derived)* is a consequence
> drawn from those rulings and the shipped specs, not a ruling itself.

## 1. A hauler is a home-owned Traffic actor that leaves the system (D1, D2, D3)

An inter-system journey is one more kind of `away` interval. The actor leaves
its home system, docks at a station in a neighbouring system, and comes home.
Its Carrier slot, `CarrierKey`, saved row and schedule stay at home the whole
time, exactly as `in-system-route-traffic.md` §1 keeps them for an in-system
visit. No roster ever adopts a visitor, and nothing transfers between systems.

Every Traffic **Carrier slot** has a fixed **vocation**, decided when the roster is
built:

- a **local** keeps `in-system-route-traffic.md` unchanged: in-system visits,
  or #148's abstract away interval where it has no eligible destination;
- a **hauler** flies every away interval to a station in another system.

The role's signature slot — ordinal 0, the hull `TRAFFIC_ROLE` forces into
every roster — is always local, so a station's signature ship is the one
always seen in its own system. Every other slot is a hauler when two things
hold: its vocation draw falls under the hauler share (§10), and its static
eligible set (§2) is not empty. Otherwise it is a local. The draw uses the
roster's existing idiom, ``fnv1a(`${localCarrierId}|vocation|${berthSeed}`)``,
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
4. `s` is on the hauler's home's side of `STATION_LAWFUL` (node #491): a
   lawful station's hauler is never sent to a raider outpost, as a local leg
   never is (`station-types.md` §5.5). An outpost rosters one carrier at
   ordinal 0, which never hauls, so today the clause only removes outposts
   from lawful sets.

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

- **Departure.** It cruises to the arrival point, in the system it is leaving,
  for the system it is going to: 1 AU from the star on the bearing toward that
  system, pushed outward past any body as `galaxy-generation.md` §7.4 rules.
  The point is evaluated once, at the jump instant the leg ends on (§4), and is
  the leg's fixed cruise target. There the hauler drops to normal flight, flies
  the 3 s wind-up (`JUMP_CHARGE_S`), and jumps.
- **Arrival.** It appears at rest at the arrival point, in the system it is
  entering, for the system it came from — the point the player's own jump on
  that pair would use — evaluated at the same instant. It then flies #261's
  route: cruise to the Traffic hold, Clearance queue, Transit lane, arrival
  traversal.

Outward, the two ends are `arrivalPoint(homeRecord, homeContents, destPos,
tOut)` and `arrivalPoint(destRecord, destContents, homePos, tOut)`; on the
way home they are the same pair with the roles swapped, at `tBack`.

The two points pair up. Haulers leaving `A` for `B` wait at the point where
haulers and the player arriving in `A` from `B` appear. Lane points are real
places that a pilot can fly to.

Each hauler's actual lane point is the exact point plus an offset in the plane
perpendicular to the bearing: a point in an annulus (§10) drawn from
``fnv1a(`${carrierKey}|lane|${awayOrdinal}`)``. The same offset serves both ends
of one voyage. The player keeps the exact point, so no hauler is ever placed on
a player's arrival. Two haulers can still overlap by rare chance, and a hauler
can overlap a player who flew onto its point. That is `collision.md` §4.3's
placement case: the pair is not tested until it separates. This spec adds no
push-out.

The lane point is a star-centric cruise target: `advanceCruise`'s `target` is a
point with a radius, and `targetParentId: null` is its declared star-centric
case. No second cruise law is introduced.

## 4. The jump instant (D7)

The jump instant is anchored to the schedule, not to the hauler's physical
progress:

```
tOut  = awayBoundaryS   + nominalOutS(home)  + slackS   // home → destination
tBack = parkedBoundaryS + nominalOutS(dest)  + slackS   // destination → home
```

`awayBoundaryS` and `parkedBoundaryS` are the boundaries `trafficScheduleAt`
already returns. `nominalOutS(system)` is §5's static upper bound on the
uncontended time from that system's Berth to its lane point, wind-up included.

- A hauler that reaches its lane point before its jump instant holds there and
  times its wind-up so the jump fires at that instant. Ships idling at lane points are
  therefore normal, and visible.
- The far side always sees the jump at the jump instant. `B` derives an inbound hauler
  from `A`'s *schedule* alone, never from `A`'s queues, Transit lane or player history.
  That is what removes the recursion: `A`'s queues hold visitors from `C`, whose
  departures would depend on `C`'s queues, and so on across the galaxy. With
  anchored instants, every inbound time is a pure function of seed, schedule and overlay,
  and each system's laws govern only its own side.
- **The accepted inconsistency.** Contention in the *observed* system can make a
  hauler late there, and it then jumps late. The unobserved side keeps the jump instant.
  A player who watches a late jump and follows at once can find the hauler
  already in `B`, earlier by up to its lateness. Nothing reconciles the two. The
  ruling accepts it because only a pilot chasing that one ship can see it.
- **The inherited inconsistency.** A hauler struck away is projected parked at
  its home Berth as soon as it leaves the band (§8, H3c), sooner than it could
  fly home. This spec adds nothing to that: it is H3c's rule for every struck
  carrier, and an in-system divert shows the same jump today.

The world-state overlay is the one *mutable* input from `A` that `B` reads: a
hauler whose row is `destroyed`, or `repairing`, is absent from `B` (§8). Rows
are keyed by `CarrierKey` in the per-galaxy overlay, so `B` reads them
directly. Everything else `B` needs from `A` — its seed, contents, rosters and
schedules — is regenerated from the seed. `B` never evaluates `A`'s queues,
Transit lane or history.

### 4.1 Overrun *(derived)*

On the observed side a hauler obeys `in-system-route-traffic.md` §2 like any
Traffic actor; the jump instant adds no exception to it.

- A late hauler completes the leg it is on. It never speeds up, skips a queue
  or reverses a leg to make up its jump instant.
- At most one movement intent is pending, with the original boundary as its
  `readyAt`. A boundary that passes while the hauler is still on an earlier
  voyage coalesces into the current desired state and is not queued behind it:
  a voyage whose interval ends before the hauler is free to fly it is skipped,
  and its `awayOrdinal` is never renumbered. The voyage it does fly is the one
  for the interval it is free in, flown late.
- A hauler still queued at `B` past `tBack` stays in `B` under `B`'s laws and
  jumps when it is free. The unobserved home side meanwhile shows it on its
  anchored schedule (§4).
- This live divergence is current-system state, like every routine delay in
  #261 §4.1. When the player leaves the observed system, or reloads, the hauler
  is derived from its anchored schedule again.

## 5. The hauler cycle and its bounds (D8, D16b)

Cold queries stay independent of epoch age (`in-system-route-traffic.md` §8.1
row 10). A cycle whose length varied per interval would need a sum over every
past interval, so a hauler's cycle is fixed per actor.

**Distance bound.** A body's distance from its star has a time-independent
upper bound (its orbit, plus its parent's for a moon or a station), written
`r̂(body)`. `arrivalPoint` starts at `ARRIVAL_DISTANCE_AU` and only ever pushes
outward to the far edge of a body's clearance sphere, so its distance is at most
`âS = max(ARRIVAL_DISTANCE_AU, max over bodies of r̂ + ARRIVAL_CLEARANCE_AU)`.
The distance from a lane point to station `s` is then at most
`âS + annulusMaxAU + r̂(s)`, where `annulusMaxAU` is §10's outer annulus
radius in AU, because the offset is perpendicular to the bearing and adds at
most its own length.
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
Clearance and the Transit lane are counted as immediate, the uncontended case. Detours are
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
The hauler keeps its ordinal's place in the station's departure grid and flies
on every m-th pass. `trafficScheduleAt` and `nextTrafficDepartureAtS` apply
unchanged, because both read only the actor's own `cycleS`, `departureAtS`
and `awayS`: a hauler's schedule is the same shape with `cycleS` set to `m`
station cycles, and its departures `departureAtS + k·m·cycleS` are a subset of
the station grid's `departureAtS + j·cycleS`.

A hauler parks less often per hour than a local. That is intended: it reads as
long-haul.

## 6. Destination capacity (D9)

An inbound hauler is an ordinary visiting Carrier at its destination. It goes
through the shared Clearance queue and Transit lane, and it can only be dealt a
Traffic Berth (`docking.md` §6.1, #277). The visitor berth stays the player's,
so inbound haulers can never queue the player out of a station.

*(derived)* They can delay the player in the Transit lane. Oldest-ready
arbitration (`station-traffic.md` §5) runs every traversal promoted before the
player first. That wait has a bound: a hauler that is waiting for a Berth
holds no lane claim, so only requests that already reserved a Berth are
ahead, and those are at most the station's Traffic Berths plus its pending
launches. The cockpit's `WAIT · <reason> · ~Ns` readout (#521) already
reports it.

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
covers the name, manifest and standing; the manifest's `government` input is
the home system's too. The callsign and hull variant need no rule: they come
from the home station's roster build (`stationTrafficRoster`), which only ever
runs for the home station. A hauler scanned in `A` and in `B`
on one voyage shows one name and one manifest. `carrier-identity.md` §2 states
the seed rule.

How a destination's law treats a foreign carrier — its standing there, whether a patrol may cross borders — is fiction, and belongs
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

A jump is drawn at both ends with `arrival-rift.ts`'s ring. Its full-strength
radius is `ARRIVAL_RIFT.radiusReaches` times the hauler's `HULL_REACH_KM`, with
no minimum radius; the player's ring uses the same law. NPC rifts have no lens
(`arrival-rift.ts`: the witchspace pass carries one lens, the player's).

What is drawn is **the crossing** (`CONTEXT.md`; `src/witchspace-crossing.ts`
owns its `CROSSING` clock), and its beats are keyed to the scheduled jump
instant — not to when anyone docks. Before #1006 both ends were
the same half-second-after-the-instant frame, which is why a watcher never saw a
ring open or close:

- **Arrival:** the ring tears open `CROSSING.openS` **before** the instant and
  brightens over it, with the hauler still in the other system — the projection
  carries the imminent `arrival` jump while `present` is false, so the ring is on
  screen and the hull, its **DisplayContact** and its collision are not. At the
  instant it is at full strength and the hull stands `crossingDistanceKm`
  aft of the **Lane point**. The ring stands one display reach aft of that
  point; over `CROSSING.crossS` the hull eases through it to rest on
  the **Lane point**, where the hold hands the next leg the state it always
  handed it. The ring then holds, and seals over `CROSSING.sealS` — collapsing
  toward a point with a flare — and is gone at `CROSSING.windowEndS`.
- **Departure:** the ring opens on the same clock ahead of the instant; the
  hauler leaves the **Lane point** it held through its wind-up and eases into
  the ring over `CROSSING.crossS`. The ring stands one display reach ahead of
  that point; the hull ends `crossingDistanceKm` ahead of the point and is gone
  at the instant: **swallowed, not deleted**. The `hyperspace-away` pose that
  follows is absent — not drawn, not collided — and stays where the crossing
  left the hull, so the route steps neither at the instant nor when the return
  comes through. The ring seals behind it on the same timeline. `crossingDistanceKm` is `CROSSING.emergeRadii` times the
  measured envelope's farthest corner from the hull origin, including its
  `envCentre` offset; it is not a multiple of the ring radius.

The flare is the same `CROSSING` curve on both sides — peaking at the jump
instant, and again as the ring closes — and it is a separate shader term
(`uFlare`) from the ring's size (`uStrength`), so a flare cannot resize the
annulus out of the frame. The player's own world-anchored ring flares and seals
by the same clock; its **unfurl** and **unfold** ahead of the instant are #532's
and unchanged, and `WITCHSPACE.riftEndS` — the screen-space clock, the jump
cue's length and `audio.ts`'s overlap guard — stays 7.5 s, because widening it
would change how often a jump is heard over the ambience, which is #1004's voice.

Both are drawn only while the lane point is inside the Traffic band (10,000 km
to materialize, retained to 12,000 km). The `DisplayContact` appears or goes on
the jump tick — the crossing's opening is a ring, never a contact. The existing
arrival sound arm plays, spatialised, and it now starts with the **opening**
rather than with the ship, since that is when the ring first appears.

Visual work closes on the canonical view set and the principal's yes. This node
owes view rows for an NPC arrival and an NPC departure at a lane point, and the
annulus radii (§10) are judged on them. #1006 adds four rows beside those, one
frame per beat — `npc-arrival-opening`, `npc-arrival-crossing`,
`npc-departure-swallow`, `npc-departure-seal` — sampled at the phases named by
their `phaseS`, because the two rows this section already had were both taken
half a second **after** the crossing and so could show neither the opening nor
the closing.

## 10. Starting dials (D14)

| Dial | Start | Tuned by |
| --- | --- | --- |
| Hauler share of non-signature Carrier slots | 1/3 | §6's instrument |
| `slackS` | 60 s | lateness against idle time at lane points |
| Lane-point annulus | 2–20 km | the view rows of §9 |
| `CROSSING.openS` — how long the ring tears open before anything is in it | 1.5 s | the `npc-arrival-opening` frame, and the principal's yes (§9) |
| `CROSSING.crossS` — how long the hull takes to come through the plane | 1.2 s | the `npc-arrival-crossing` and `npc-departure-swallow` frames (§9) |
| `CROSSING.holdS` + `CROSSING.sealS` — how long the ring stays after the instant, and how fast it seals | 3.6 s + 1.2 s | the `npc-departure-seal` frame; the seal may outlast the wind-up. `openS` and `crossS` each fit inside `JUMP_CHARGE_S` (`src/hyperspace.ts`), as asserted in `tests/witchspace-crossing.test.ts` |
| `CROSSING.emergeRadii` — hull motion from the lane point, measured by `crossingDistanceKm` | 2 envelope-corner extents | the two crossing frames; `tests/witchspace-crossing.test.ts` holds the lead long enough to clear both the ring standoff and the hull's extent |
| `ARRIVAL_RIFT.radiusReaches` — full-strength ring radius in hull display reaches | 1.6 | the view rows of §9; `tests/arrival-rift.test.ts` checks the radius law for every hull, with no minimum floor |

One share for every station role. A per-role share would say what each role is
*for*, which is #460's to decide.

## 11. Persistence *(derived)*

Nothing routine is saved. A hauler's vocation, eligible set, destination, jump instants,
phase, charge and fuel are all derived from seed, schedule and `gameTime`.

The generator version does not move. `persistent-world-state.md` §2 ties it to
a carrier's identity, type, parent and generated placement, and a vocation
changes none of them. A saved `completesAt` is an absolute instant, so a slot
that becomes a hauler under an old save still completes its repair at that
instant and rejoins at its next hauler departure.

## 12. Ownership and seam *(derived)*

- This spec owns vocation, static eligibility, lane points, jump instants, the
  hauler cycle and the inbound query.
- `in-system-route-traffic.md` keeps every in-system leg a hauler flies; a
  hauler's in-system legs are #261 routes with a lane point at one end.
- `station-traffic.md` keeps rosters, schedules, holds, queues and the Transit
  lane.
- `hyperspace.ts`, `system.ts`'s `arrivalPoint` and `arrival-rift.ts` are
  consumed, not changed in law.

The implementation is pure and imports no Three.js. Everything that needs
another system's stations lives in a new inter-system module that takes the
galaxy and the contents it needs as input: vocation, static eligibility, the
cycle multiple, the `nominalOutS` and `nominalInS` bounds, each voyage's
destination and its two jump instants, and an inbound query. The system-local
modules receive those as inputs and import nothing from it.
`src/station-traffic.ts` receives each slot's vocation and cycle multiple and
builds the schedule from them. `src/station-route.ts` receives a voyage's lane
points and jump instants and flies the legs between them under #261's laws.
The inbound query, given a system and `gameTime`, enumerates the haulers of every same-galaxy system
within the largest Traffic `tankLy` (derived from `TRAFFIC_HULL_POOLS` and
`HULL_SPECS`, never restated) whose current voyage names one of its stations.
`Game` owns only current-system caches and presentation, as #261 §7 rules.

## 13. Acceptance *(derived)*

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
5. A hauler early at its lane point jumps exactly at its jump instant. A hauler made
   late by injected contention on the observed side jumps late there, and the
   far side still sees the anchored instant.
6. The cycle is an integer multiple of the station cycle with `departureAtS`
   unchanged, and an uncontended voyage to the worst destination fits both
   intervals.
7. `âS` holds over seeds × clock values, and `dHome + dAway ≤ chargeAu` holds
   for every eligible pair, measured from the offset lane point rather than
   the exact one.
8. Identity: the name, manifest and standing of one hauler are equal in its home
   and destination systems. A control seeded on the current system must fail.
9. A `destroyed` or `repairing` row removes the hauler from every inbound
   query.
10. Canonical save output contains no routine hauler row. The generator version
    and the carrier fingerprints are unchanged. An old-save fixture holding a
    repairing slot that becomes a hauler loads and rejoins at its next hauler
    departure.
11. A measured cold-cost row for the inbound query, two hops of generation
    included, at one and 365 game days, independent of epoch age.

### 13.2 Instrument

§6's report, with N and the spread, run by hand and stated in the build's
receipt.

### 13.3 Browser

A deterministic fixture shows one named hauler:

1. leaving its home Berth and holding at its lane point until its jump instant;
2. jumping through the departure ring, after which its contact is gone;
3. after the player follows, arriving at the destination lane point through
   the arrival ring with the same name and hull;
4. reaching the destination Traffic hold and entering the live queues without
   privileging itself or the player.

### 13.4 Views

NPC arrival and NPC departure rows in `scripts/lib/view-set.mjs`, and the
principal's yes on the sheet.

## 14. Known risks *(derived)*

- The inbound query is **two hops** of generation: `B` rebuilds the rosters of
  every system in Traffic reach, and each of those rosters' vocations needs the
  contents of *its* systems in reach. §13.1 row 11 measures that cost. A current-galaxy cache is
  acceleration only and may not make visit order observable.
- `station-traffic.md` §2's full-station departure bound is false today and its
  test cannot fail. #677 owns it, and haulers bear on its answer in two
  directions. A hauler parks less often than a local, but inbound haulers take
  a destination's free Traffic Berths and, with no cap (§6), queue at its holds,
  so a hub is full more often and its visitors wait longer. Whatever bound #677
  rules must count inbound haulers, and §6's instrument is its input.
- `arrivalPoint` takes the galaxy-space bearing as a system-frame direction. The
  game ships that law, and both ends here use it, so they agree. #100's missing
  galactic-frame transform would move every lane point if it ever changed that
  law.

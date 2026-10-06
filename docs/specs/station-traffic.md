# Station traffic

> Resolved contract for work-graph decision
> [#148](https://github.com/jcfischer/seelite/issues/148).

## 1. Traffic identity and population

Each station owns a finite, deterministic **Traffic roster**. Every actor in it
occupies a stable **Carrier slot**, so the same ship remains identifiable across
departures, arrivals and time outside the player's view. Routine schedules and
positions are derived from the station and authoritative game clock; only an
exceptional operational consequence such as destruction or repair enters the
sparse saved world-state overlay.

There is one Traffic actor per berth:

| Station role | Berths | Traffic actors |
| --- | ---: | ---: |
| Trade | 8 | 8 |
| Shipyard | 6 | 6 |
| Refinery | 4 | 4 |
| Outpost | 2 | 2 |

Roster size is the station's population ceiling, not its constant occupancy.
Each actor has its own **Traffic schedule** with parked and away intervals.

Hull assignment is a deterministic draw from a role-specific pool. It uses the
station identity and actor ordinal, keeps every result compatible with that
station's berth envelope, and guarantees the role's signature hull:

| Station role | Compatible Traffic hull pool | Signature guarantee |
| --- | --- | --- |
| Trade | Courier, Freighter, Miner, Explorer, Tug, Prospector | At least one Freighter |
| Shipyard | Interceptor, Patrol, Courier, Tug | At least one Patrol |
| Refinery | Miner, Prospector, Freighter, Tug | At least one Miner or Prospector |
| Outpost | Courier, Prospector, Tug, Interceptor | At least one Courier |

The pool may repeat hulls. Raider hulls remain encounter actors rather than
routine station traffic, and capital hulls cannot dock, so neither enters these
rosters.

### 1.1 Carrier namespace

Each roster ordinal extends its home station's `localCarrierId`, producing IDs
such as `station-trade/traffic-00`. The station-qualified ordinal is the actor's
stable Carrier-slot identity; hull type, variant and callsign may all change in
a future generator version without becoming persistence keys.

> **Both strings are here since #364.** Every carrier now carries a **drawn
> proper name** and the composed **registry**, and the cockpit reads them by
> where they are read: the Target instrument names its target with the drawn
> name, the Flight console shows both. **What does not read the drawn name yet**
> is the kill feed and the raider log, which still cite the registry — a bounty
> is filed against a registration number, and retaking that display is a node of
> its own, recorded on the map rather than quietly taken here.
> `carrier-name.ts` owns both halves: it draws the name from its own
> `DOMAIN.CARRIER_NAME` stream and composes the registry the Traffic roster used
> to compose itself. **The rule above is unchanged and is what the module is
> built around**: neither string keys, saves or looks anything up, so a name
> re-drawn by a later generator orphans no market memory.

Traffic slots join `enumerateCarriers()` so exceptional objective condition can
use the existing sparse world-state domains. Adding those generated carriers
changes the pinned baseline and therefore requires the implementation to bump
`WORLD_GENERATOR_VERSION` from 3 to 4 and refresh the per-galaxy carrier
fingerprints. It does not add routine schedule rows to a save.

## 2. Schedule and activity

Traffic schedules derive from station identity, actor ordinal and `gameTime`.
Seeded actor phases keep the rhythm non-metronomic and make the result
independent of visit order.

The nominal station-wide interval between scheduled arrivals or departures,
before Transit-lane queueing, is:

| Station role | Movement interval |
| --- | ---: |
| Trade | 20–40 s |
| Shipyard | 30–60 s |
| Refinery | 45–90 s |
| Outpost | 60–120 s |

Cadence does not also encode occupancy. Each actor draws a deterministic parked
duty within its station role's band, then receives its own seeded phase:

| Station role | Parked duty |
| --- | ---: |
| Trade | 55–75% |
| Shipyard | 65–85% |
| Refinery | 60–80% |
| Outpost | 25–55% |

These are long-run duty bands rather than instantaneous occupancy limits. A
station can therefore become completely full or empty as its actors' phases
overlap.

Full occupancy is allowed, but for every station seed and game-clock position
it implies a real scheduled departure within 60 seconds. The player's presence
never creates, accelerates or reschedules that departure. The implementation
must sweep seeds and clock positions to verify the bound.

### 2.1 Delay and reconciliation

The base schedule supplies an actor's desired `parked` or `away` state at any
`gameTime`. If berth or Transit-lane contention prevents that transition, the
actor holds one pending movement intent with the original scheduled boundary as
its `readyAt` time. That timestamp remains its place in the shared queues.

A carrier struck mid-leg is the one case where the schedule and the row disagree
on purpose, and the disagreement is settled by the overlay rather than here
(`civilian-combat.md` H3b, #365): the ship is held at its home berth while the
repair runs, whatever this section's clock says it should be doing. It holds no
pending intent and accumulates no backlog for the absence, because the repair is
booked to complete at the **first departure the schedule makes at or after its
floor** — so the berth empties on the frame the schedule takes the ship away, and
the leg it flies is the next one rather than the one it was pulled off mid-way.

Later schedule changes coalesce into the actor's current desired state; they do
not accumulate a movement backlog. Once a traversal finishes, that actor cannot
move again until the next station movement opportunity. Clearing congestion
therefore resumes visible traffic without a catch-up burst.

Routine pending intents, queue positions and traversal progress are transient
current-system state that can be rederived from the station seed, Carrier
identity and `gameTime` when the system loads. The player's current reservation
or berth occupancy is then applied and may delay Traffic actors normally. Only
exceptional Carrier consequences such as destruction or repair enter the sparse
world-state overlay.

## 3. Local materialization

Every Traffic actor in the current system has lightweight schedule state. That
state is derived directly from station identity, actor ordinal and `gameTime`;
it does not need a per-frame simulation while the actor is outside the player's
view or while its system is unvisited.

A Traffic actor gains a simulation-owned ship mesh and `DisplayContact` only
while its derived state has a local position — parked, performing a
station-local sequence, or following an eligible Traffic route — and only
within the player's existing 10,000 km scanner range. Its Carrier identity
remains stable when the presentation object is absent.

After clearing the aperture outward, an actor with no eligible in-system
destination enters its abstract away interval and has no local position or
contact. It reappears at a **Traffic hold** for its scheduled return. An actor
with an eligible destination instead follows the home-owned **Traffic route**
in `in-system-route-traffic.md`: the route supplies a real position and contact
inside scanner range without transferring roster ownership. That abstract
interval is now a **local's** only: a **hauler** flies every away interval to a
station in another system and back (`inter-system-traffic.md`, #262), so it has
a real position at both ends of its voyage.

Unvisited systems require no background ticking. Loading the same system seed,
world-state overlay and `gameTime` produces the same actor states regardless of
visit order.

### 3.1 Terminal movement

A scheduled arrival materializes at a deterministic station-relative Traffic
hold outside the docking cone. Holds are distributed off-axis by Carrier
identity, keeping both the aperture axis and the player's approach corridor
clear. The actor requests a compatible berth there and remains at its hold
while queued.

Once a berth is reserved, the actor remains at its Traffic hold until it wins
Transit-lane arbitration. The lane reservation covers the complete terminal
movement: the actor leaves its Traffic hold, moves to the existing 3 km
docking-computer standoff, aligns with the aperture axis, runs in below the
existing entry-speed gate, then crosses directly into the exact three-leg
arrival law in `arrival.ts`, including its route-length-derived 6–9 second
duration. Launch runs that same law in reverse. Its outward crossing releases
the berth and starts the actor's away interval.

A home-station arrival materializes at its hold before requesting Clearance.
For an in-system Traffic-route destination, the cruise leg has already brought
the actor to that destination hold before the same request and wait begin.

The hold-to-plane approach is a pure `gameTime` position law. Reserving the lane
before it begins prevents a Traffic actor and the player from converging on the
single aperture together, while still keeping external holds distinct from
interior lane occupancy.

Traffic actors added no collision or combat physics in #148. #362 has since
added combat (`civilian-combat.md`). #75 decided collision and `collision.md`
specifies it; node #664 built it for Traffic. A carrier collides in every
normal-flight phase of its route, and is exempt while parked, launching or
arriving (`collision.md` §5, `trafficCollisionClass` in `src/station-route.ts`).
A projected carrier is met by the ships that are flown, and a meeting hands it
to flight; its route is never swept against the world at runtime, which is
what `collision.md` §6's corpus row measures instead. A materialized
actor's pose and velocity come from the station frame and the same traversal
law as the player's; deriving progress from `gameTime` means an actor first
seen midway through a movement appears at the correct point rather than
restarting it.

### 3.2 Contact identity

A Traffic actor's Carrier identity deterministically selects its hull variant
without consuming a mutable generator stream. Its visible station-local
callsign combines that model name, a station-role code and roster ordinal, for
example `Kestrel TR-03` — composed by `carrier-name.ts`'s `trafficRegistry` since
#364 gathered both display strings into one module, which is what stopped the
roster and the raider path composing the same shape two ways. The callsign is
presentation; the Carrier key remains the persistence and arbitration identity.

Every materialized actor is a normal targetable `DisplayContact` carrying its
actual pose, velocity and hull type. Routine hulls report `CIVILIAN`; Patrol
reports `UNKNOWN` until `combat-model.md` defines a security or legal scanner
classification. Traffic contacts carried `legalStatus: null` in #148; #364 renamed the member `standing` and it now holds the reading the pilot recorded, or `null` for a carrier never scanned.

## 4. Clearance queue

The player has no privileged or reserved berth. Player and Traffic actors use
one station-local **Clearance queue**, ordered by request time with stable
Carrier identity as the deterministic tie-break.

Whenever capacity changes, the queue promotes the oldest request for which a
fitting berth is currently free. The existing best-fit allocator chooses that
request's berth. This preserves FIFO where geometry permits without letting one
incompatible request block ships that fit other berths. A queued ship advances
only because a real departure releases capacity.

The docking director reports the player's live one-based place as
`HOLD · CLEARANCE QUEUE · POSITION n`. Once a berth is reserved, waiting for the
Transit lane is reported under the live grant as `WAIT · <reason> · ~Ns` (#521):
the reason is `playerLaneWait`'s, and the figure is the time until the last
route ahead gives the lane back, read off each route's own `laneEndsAtS`, plus
the time the turn takes to land (`LANE_TURN_LATENCY_S`, two authority ticks and
one of margin), rounded
up to 5 s. It is an estimate — a collision can interrupt a route — and
when Traffic cannot say, no figure is shown. A held launch carries the same
figure after its reason.

## 5. Transit-lane arbitration

The **Transit lane** admits one ship at a time. A traversal is non-preemptive;
after it finishes, the oldest ready arrival or launch proceeds. Stable Carrier
identity breaks ordinary ties. When an arrival and launch become ready at the
same instant, the launch goes first because it releases a berth. Player and
Traffic actors use the same arbitration.

**The player's arrival turn keeps its first stamp from the moment it is owed
(#521).** Under
a live grant and inside the director's range, the game registers the pilot's
arrival turn and keeps its first stamp — hand-flown or on the docking computer
— so a carrier that becomes ready later queues behind it. It ends on a dock, a
lapsed grant, or leaving that range; a bounce at the plane keeps it. Before
#521 only the computer registered a turn, a hand-flown ship was asked as of the
current frame every frame, and any later carrier went first.

Transit-lane occupancy remains separate from berth occupancy and from the
external approach corridor.

The 600-second entry window starts at the grant, not at the lane award (#521;
`docking.md` §13.2 says why), and the director reports `CLEARED · <time> left`
once the lane is the player's. Crossing the aperture with a reserved berth but
before the lane award is repelled without hostility: it violates the lane
order, but is not barging without clearance.

## 6. Ownership boundaries

Station traffic reuses berth fit, reservations, clearance and Transit-lane
occupancy from `docking.md`; it does not create a second docking model. Combat
AI and interdiction remain `combat-model.md`'s. In-system Traffic journeys are
specified in `in-system-route-traffic.md` by
[#261](https://github.com/jcfischer/seelite/issues/261), and inter-system
journeys in `inter-system-traffic.md` by
[#262](https://github.com/jcfischer/seelite/issues/262).

## 7. Implementation seam

The build should put pure roster generation, desired schedule state, pending
intent reconciliation, queue and lane arbitration, station-relative terminal
laws, and contact projection in `src/station-traffic.ts`. That module may consume
hull, station-interior, docking, Carrier-key and clock types; it must not import
Three.js or own a second berth-fit or traversal implementation. Each slot's
vocation and hauler cycle multiple are inputs it receives from the inter-system
module (`inter-system-traffic.md` §12), which owns everything that reads
another system; this module stays system-local.

`Game` owns the transient runtime for the current system and materializes the
pure projection as ship meshes and `DisplayContact`s. Rendering mirrors those
simulation poses. `src/docking.ts` remains the owner of shared player and Traffic
clearance states, berth reservations, entry validation, and Transit-lane
availability.

## 8. Implementation acceptance

### 8.1 Headless

1. Every station role produces exactly its berth-count roster, only from its
   compatible hull pool, with its signature guarantee. Every selected hull fits
   at least one berth in that station's generated interior.
2. Equal seed and Carrier identity produce equal local IDs, hull variants,
   callsigns, schedules and actor states regardless of collection order or
   visit order. Traffic IDs are unique across the eight-galaxy Carrier
   namespace, and the version-4 baseline fingerprints are pinned.
3. A seed-and-clock property sweep proves the role cadence and parked-duty
   bands and the invariant that a fully occupied station has a real departure
   ready within 60 seconds. A control with the bound exceeded must fail.
4. Capacity promotion is oldest-compatible-first, uses the existing best-fit
   allocator and gives player and Traffic actors identical ordering. Stable
   Carrier identity breaks exact request-time ties.
5. Transit-lane traversals never overlap. Oldest ready wins, exact
   arrival-launch ties launch first, and a player receives a live entry window
   only after winning the lane. Early entry with a reservation repels without
   hostility; true barging remains hostile.
6. Direct evaluation at time `t` matches a stepped simulation at `t` for holds,
   terminal approaches, traversals and parked poses and velocities. A delayed
   actor carries only one intent and congestion release produces no catch-up
   burst.
7. Materialization is inclusive at 10,000 km and absent beyond it or during an
   abstract away interval. Contacts are targetable, retain stable callsigns and
   variants across disappearance, and use the agreed scanner classifications.
8. Canonical save output contains no routine roster, schedule, queue or motion
   rows. An exceptional objective transition addressed to a Traffic Carrier key
   round-trips through the existing sparse overlay.

### 8.2 Browser

A deterministic traffic fixture shows, in normal cockpit and chase rendering:

1. all four station roles with their expected typical occupancy;
2. distinct parked hulls in the generated berth poses;
3. one queued arrival at a Traffic hold and one actor moving through the
   terminal sequence without entering station geometry;
4. stable target name, hull designation, scanner status, range and velocity;
5. the player's clearance-queue, lane-wait and `CLEARED` messages; and
6. no duplicate ship mesh or contact while repeatedly crossing the 10,000 km
   materialization boundary.

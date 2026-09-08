# In-system route traffic

> Decision contract for work-graph node
> [“In-system route traffic: one carrier from departure berth to arrival
> queue”](https://github.com/jcfischer/seelite/issues/261).

## 1. One home-owned visit

A **Traffic route** is one home-owned Traffic actor visiting another station in
the current system and returning home. The actor never transfers between
Traffic rosters: its Carrier slot stays in the home roster as the persistence
and schedule source. That slot's system-wide `CarrierKey` identifies the actor
for arbitration and presentation while it travels, queues and occupies a
destination Berth; the destination never acquires the slot.

Each `away` interval has a stable ordinal derived from its zero-based position
in the actor's base schedule. Contention can delay a visit but cannot renumber
that interval; the ordinal never counts completed trips, materializations or
system visits. At the outward aperture crossing that begins its away interval,
the actor derives the eligible destinations in canonical station-ID order:
ascending stable `Station.id`, using
`a.id < b.id ? -1 : a.id > b.id ? 1 : 0`. A destination is eligible when it:

1. is not the home station;
2. has at least one Berth that fits the actor's hull; and
3. has a bounded cruise plan whose complete planned distance fits the actor's
   full hull-specific drive charge.

The eligibility plan is a bounded snapshot at that outward crossing. For each
candidate hold, call `cruiseRouteBlocker` from the actor's crossing pose against
masses evaluated at that `gameTime`. No blocker yields the one-segment chain
`[from, hold]`. A blocker is passed once to `planCruiseDetour` with no retained
side; `null` makes that destination ineligible, while a plan yields
`[from, waypoint0, waypoint1, hold]`. The planned distance is the sum of the
Euclidean lengths of adjacent chain segments. It includes the initial detour
but is not a promise about later moving-body replans, which §4.2 handles.

Let `n` be the eligible-list length, `actorOrdinal` the zero-based ordinal of
the actor in its home Traffic roster, and `awayOrdinal` the zero-based ordinal
of this actor's away interval. The destination is
`eligible[(actorOrdinal + awayOrdinal) mod n]`. Two-station systems therefore
select the only other station; three-station systems rotate successive visits
through the eligible alternatives without a mutable random stream.

A one-station system, or an actor with no eligible destination, keeps #148's
abstract-away behavior. It may perform the existing visible home launch and
scheduled return, but #261 invents no hidden station, local waypoint, or
impossible route. Inter-system destinations remain #262's.

## 2. The schedule expresses intent

The Traffic schedule remains a home-state schedule. `away` and `parked` are
desired states, not timetable promises:

- `away` while parked at home creates a launch intent;
- reaching the destination while `away` remains desired leaves the actor
  docked there;
- `parked` while away creates the return-home intent; and
- arriving home satisfies `parked`.

Physical traversal, cruise, charge and station contention decide when those
transitions finish. A traversal or cruise leg is non-preemptive. If the desired
state changes while one is active, the actor retains the one pending intent
with the original schedule boundary as `readyAt`; later changes coalesce as
specified by `station-traffic.md` §2.1. It never speeds up, teleports, skips a
queue or reverses a live leg to catch a timetable.

An actor whose return became due during its outbound leg still completes the
destination arrival. It docks, refills, and presents the pending return intent
at the next station movement opportunity; a late leg cannot turn one arrival
into an immediate unarbitrated launch.

## 3. Terminal-to-terminal lifecycle

The route composes the existing laws in this order:

| Phase | Authority and exit |
| --- | --- |
| `parked-home` | The actor occupies its home Berth. Desired `away` creates a launch intent with the schedule boundary as `readyAt`. |
| `launch-queued` | The shared station Transit-lane arbitration orders the launch with player and Traffic arrivals and launches. |
| `departing` | `arrival.ts` runs the reserved Berth's three-leg traversal in reverse. The home Berth remains occupied until the outward aperture crossing, where the reservation and grant are spent. |
| `local-departure` | In normal flight, the actor aligns toward the selected destination Traffic hold and remains in the translating station frame while traversing an 8 km exclusion bubble at 1 km/s. Cruise cannot take over until the actor is physically clear. |
| `cruise` | The pure Traffic guidance controller flies the existing cruise, detour, guard and charge laws toward the moving destination hold. |
| `local-approach` | Cruise drops into the destination frame; normal-flight guidance reaches the exact Traffic hold with zero station-relative velocity. |
| `clearance-queued` | Only after reaching the hold does the actor request a fitting destination Berth through the shared Clearance queue. |
| `lane-queued` | A promoted request reserves its Berth and waits at the hold for the shared Transit lane. The grant window has not started. |
| `arriving` | Lane award covers a readable fourteen-second hold-to-aperture transit, including standoff guidance, axis alignment and entry below the speed gate, followed by the existing three-leg arrival traversal. |
| `docked-away` | The actor occupies the destination Berth and refills its drive charge. Desired `parked` creates the mirrored return-home intent. |

The destination Traffic hold is the cruise target, not the station centre. Its
position and velocity are evaluated in the moving station frame at the same
game-clock instant as every cruise mass. That leaves the actor outside the
docking cone and prevents a route from becoming an early clearance grant.

The destination station treats the visitor as an ordinary Carrier in its
Clearance queue, Transit lane and occupied-Berth set, but does not adopt it into
its Traffic roster. The stable system-wide `CarrierKey` supplies every tie-break.

The home Berth is free immediately after the outward aperture crossing and may
be allocated normally while the actor is away. The returning actor requests
any fitting home Berth through the normal Clearance queue; it has no claim on
the Berth it departed from.

## 4. One cruise law

Traffic travel uses `advanceCruise`; it does not interpolate along a timetable.
The implementation extracts the current automatic-detour nose controller from
`Game` into a Three.js-free pure seam so player automation and Traffic route
guidance cannot drift. That controller supplies the visible nose, turn hold and
waypoints; `advanceCruise` remains the authority for speed, arrival, moving-body
guards, proximity exits and travelled distance.

### 4.1 Canonical replay

Route progress advances on canonical 0.1-second ticks from the leg's physical
start, plus one final fractional tick when queried between boundaries. Render
frames consume the resulting projection; their `dt` never becomes route time.
For equal system seed, `CarrierKey`, schedule boundary, world-state overlay,
player-input timeline and `gameTime`, direct evaluation at time `t` must equal
stepping to `t`.

The **player-input timeline** is the time-ordered sequence of the player's
Clearance requests and grants, Berth occupancy, and Transit-lane claims that
the shared station laws consume. Both direct and stepped evaluation receive
the same sequence through the queried `gameTime`.

The implementation must expose that sequence as an explicit typed input to the
pure route evaluator before integrating Traffic routes. Headless checks inject
fixture sequences; `Game` supplies the live current-system session events at
the same transitions. This is a transient evaluation seam, not routine save
history. A reload without such a supplied history reconstructs the seed-only
route and then applies the player's current reservation or occupancy as below.

Current-system caches may retain the last canonical state to avoid replaying a
leg from its start every frame. They are disposable acceleration only. An
unvisited system receives no background ticks; loading it reconstructs its
Traffic routes from the same inputs.

Player occupancy is an explicit live input, not visit history. It may delay a
Traffic actor through the shared queues exactly as #148 requires. Routine queue
and route delays remain transient: on reload they are rederived and the current
player reservation or occupied Berth is applied, rather than saving a second
world history merely because the player once looked at a system. A stepped run
that includes a past player intervention is compared only with a direct run
given that same intervention timeline; the seed-only baseline does not pretend
the intervention never happened.

### 4.2 Detour and recovery

Every powered segment remains subject to the existing moving-body guard. A
blocked direct leg uses the existing bounded two-waypoint station detour while
keeping the Traffic hold selected. If a replan has no safe side, the actor
drops to normal flight in the blocker's frame and retries on canonical route
ticks; it neither changes destination nor pretends the obstruction is absent.

No planned leg begins unless §1's complete eligibility chain fits the actor's
full drive charge. A later moving-body replan can make that snapshot stale. If
the actual metered travel exhausts charge, the actor drops to normal flight,
regenerates at the existing passive rate, and retries when the remaining route
is charge-reachable. The delay is ordinary schedule reconciliation, not saved
exceptional state.

## 5. Presentation is not authority

The pure route projection owns the actor's phase, pose and velocity at every
distance. Presentation uses range hysteresis: an absent actor materializes at
the inclusive 10,000 km scanner boundary, while an already-visible actor remains
materialized until it leaves 12,000 km. Inside that retained band, `Game` keeps
one ship mesh and one targetable `DisplayContact` from the projection.

Crossing the boundary never starts, pauses or restarts motion. Re-entering range
reconstructs the same Carrier, hull variant, callsign, pose, velocity and
scanner classification at the queried `gameTime`. Repeated crossings cannot
produce duplicate meshes or contacts.

A visible Traffic route adds no collision or combat physics. A future combat or
interdiction decision may explicitly interrupt the pure projection and create
an exceptional Carrier consequence; mere visibility does not perform that
authority handoff.

## 6. Drive charge

Traffic actors use `HULL_SPECS[hull].chargeAu`. `advanceCruise` already meters
actual powered distance through the existing distance-based consumption law,
but today's regeneration and docking call sites cap every ship at the player's
`CHARGE_CAPACITY_AU`. Implementation must parameterize those capacity/refill
seams with an explicit `capacityAu`, defaulting to `CHARGE_CAPACITY_AU` so the
player retains the current 12 AU behavior; Traffic passes its hull's
`chargeAu`. Every completed dock then refills to that capacity for free, at home
or away. Normal flight uses the same passive rate and cruise consumes no
invented NPC reserve.

Charge is routine derived route state. It is reconstructed from the last
completed dock and metered canonical segments and does not add a save row.
Cargo is likewise presentation-only here: a Traffic route does not buy, sell or
mutate either station market.

## 7. Ownership boundaries

- `station-traffic.md` owns rosters, schedules, Traffic holds, queues, lane
  arbitration and local terminal laws.
- `in-system-travel.md` and `cruise.ts` own cruise dynamics, charge, detours and
  moving-body safety.
- This spec owns Traffic destination selection, the route lifecycle, canonical
  replay and the composition between those two domains.
- `display-contact.ts` remains the presentation shape; route identity is the
  home slot's `CarrierKey`.
- Hyperspace, combat AI, faction simulation and NPC market mutation remain out
  of scope.

The implementation seam is a pure `station-route` module consuming Traffic,
cruise, hull, station and clock data without importing Three.js. `Game` owns
only current-system caches and presentation objects. The build must extract
shared pure cruise guidance rather than copy the controller out of `Game`, and
must not implement another berth allocator, queue, traversal, collision guard
or speed law.

## 8. Implementation acceptance

### 8.1 Headless

1. One-station systems and actors with no fitting charge-reachable destination
   retain abstract-away behavior. Two-station systems select the other station;
   three-station systems cycle deterministically through eligible alternatives.
2. Destination selection is independent of collection and visit order, never
   selects home, and never selects a station whose catalogue fits no Berth.
3. Equal direct and canonical stepped evaluation produces the same phase, pose,
   velocity, destination, charge, pending intent and queue request at time `t`.
   Both arms receive the same player-input timeline. A render-`dt` control must
   fail if frame cadence leaks into route progress.
4. The phase sequence follows §3. The origin Berth releases only at outward
   crossing, is then allocatable to another Carrier, and receives no implicit
   return reservation. The destination receives no request before the exact
   Traffic hold endpoint.
5. Destination capacity and lane contention use the shared oldest-compatible
   and oldest-ready policies. A visiting actor contributes to occupancy without
   joining the destination Traffic roster.
6. The pure guidance path calls the production cruise speed, detour, moving-body
   guard and distance-consumption functions. Regeneration and docking-refill
   checks pass an explicit hull capacity while a player control remains capped
   at 12 AU. A control using straight timetable interpolation must fail the
   obstruction fixture.
7. A full charge covers every initially selected planned polyline. Unexpected
   exhaustion follows normal-flight regeneration and deterministic retry, and a
   completed dock restores the actor's hull-specific capacity.
8. Canonical save output contains no routine destination, route phase, replay
   cache, queue, charge or motion row.
9. Materialization is inclusive at 10,000 km and an existing presentation is
   retained through 12,000 km. Repeated threshold crossings keep one
   `CarrierKey` and never duplicate a contact.
10. Cold phase-equivalent queries at one and 365 elapsed game days perform work
    independent of epoch age. Completed schedule intervals, stationary waits
    and finished legs are skipped analytically; canonical stepping is bounded
    to at most the one currently active non-stationary leg per actor.

### 8.2 Browser

A deterministic two- or three-station fixture shows one named Traffic actor:

1. launching from its occupied home Berth through the live Transit lane;
2. retaining the same target name and hull while leaving and re-entering scanner
   range;
3. appearing on the scanner in local flight and cruise from its projected pose
   and velocity;
4. reaching the destination Traffic hold without crossing station geometry;
5. entering the live Clearance and Transit-lane queues without privileging
   either the actor or the player; and
6. arriving at the reserved destination Berth with no duplicate mesh or contact.

## 9. Known integration risks

- A literal fixed-step reconstruction from a very old game-clock epoch grows
  with elapsed play time. Cold work must instead be independent of epoch age:
  locate the current base-schedule interval arithmetically, skip completed or
  stationary segments analytically, and canonical-step at most the one active
  non-stationary leg per actor. Current-system memoization may accelerate that
  same projection, but remains disposable and may not become routine save
  authority or make visit order observable.
- Canonical replay depends on applying the same player-input timeline to the
  shared station laws. Implementation acceptance must exercise delayed queue,
  Berth and Transit-lane inputs rather than only an uncontended seed fixture.
- The shared pure cruise guidance seam does not exist yet. Extraction must pin
  player-cruise behavior before Traffic consumes it so integration cannot make
  the two controllers drift together unnoticed.

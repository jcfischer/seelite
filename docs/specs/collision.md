# Spec: collision

**Status:** written from a resolved decision node —
[#75](https://github.com/jcfischer/seelite/issues/75) (C1–C6, 2026-09-13), by
[#302](https://github.com/jcfischer/seelite/issues/302)
**Date:** 2026-10-03
**Inputs:** [#73](https://github.com/jcfischer/seelite/issues/73) (`docking.md`
§12.3, E6 — the boundary), [#8](https://github.com/jcfischer/seelite/issues/8) /
[#324](https://github.com/jcfischer/seelite/issues/324) (`combat-model.md`, the
pools), [#181](https://github.com/jcfischer/seelite/issues/181) (hull envelopes),
[#529](https://github.com/jcfischer/seelite/issues/529) (the frame law),
[#362](https://github.com/jcfischer/seelite/issues/362) /
[#365](https://github.com/jcfischer/seelite/issues/365) (`civilian-combat.md`,
the divert), [#10](https://github.com/jcfischer/seelite/issues/10) /
[#30](https://github.com/jcfischer/seelite/issues/30) (cruise's keep-out),
[#619](https://github.com/jcfischer/seelite/issues/619) (`flight-model.md` §4,
rotation can tunnel)
**Binds:** [#303](https://github.com/jcfischer/seelite/issues/303) (the build),
Traffic (`station-traffic.md`, `in-system-route-traffic.md`), the NPC
controller (`combat-enemy.ts`)

#75 decided six things with the principal. #302 put three further questions to
the principal on 2026-10-03, because #75 left them open and each one changes
what a pilot feels: the ship's own shape against a body, the scrape threshold
and bounce, and which constant carries the damage scale. Their answers are
**P1–P3** below. Every other rule that #75 did not state is marked
**derived**, so a later reader can tell a choice from a consequence.

---

## 0. What this owns, and what it does not

**Owns:** which objects are solid and in what shape; what an impact does to
speed, position and condition; how an impact is found within one tick; and the
order of an impact and the aperture plane inside one tick.

**Does not own:**

| Fact | Owner |
|---|---|
| The boundary between docking and collision, including the exempt states | `docking.md` §12.3 — the authority. §5 below reads it and does not copy it. |
| The aperture rectangle at the plane: the six checks and the failed entry | `docking.md` §2, §3 |
| The pools, `applyDamage`, the side a hit selects | `combat-model.md` §2, `src/ship-condition.ts` |
| The damage scale's figure | `docking.md` §10 and #8 — shared under P3 |
| What a struck carrier does, and what a hull strike diverts | `civilian-combat.md` H2, H3, H3b–H3d |
| Whether an impact is an **offence** (heat, witnesses, hostility) | Not decided. See §10. |
| Cruise's keep-out and drop-out | `in-system-travel.md` §11.4, §12.1, `cruise.ts` |
| What the pilot is told about an impact | `hud-and-scanner.md` §3 (the prompt line). See §10. |

---

## 1. The code this is written against

As of `origin/main` at `cfb9e1b`. Each fact was read in the file, not
remembered.

- `MAX_DT = 0.1` s (`src/units.ts`). At the 2 km/s assist cap a tick is 200 m,
  and assist-off flight has no speed cap.
- `src/sim.ts` must not import Three.js, so the sim cannot ray-cast a drawn
  mesh. Everything collision reads is authored without Three.
- `collisionExempt(phase)` (`src/dock-session.ts`) is `phase !== "flying"`.
  It is §12.3's third row as a predicate, and today nothing reads it.
- The pools have shipped (#324). `ShipCondition` carries fore and aft shields
  and hull; `applyDamage(c, amount, side)` is the one writer of hull;
  `sideStruck(nose, toSource)` selects the side; `headOnPool` is fore plus
  hull. #75's receipt named `INTERIM_DAMAGE_SCALE` and `Game.interimCondition`.
  Neither exists now, and nothing in this spec refers to them.
- `DOCKING_DAMAGE_SCALE = 40` (`src/docking.ts`), asserted by
  `tests/ship-condition.test.ts` against a quarter of every hull's head-on
  pool. `V_GATE_KMS = 0.10`.
- `HULL_SPECS[id].env` (`src/hull.ts`) is the selected variant's measured box,
  rounded **up** to 0.1 m (#181).
- `STATION_FORM_POOL` (`src/station.ts`) names the forms each role may be
  built in, and each system draws one per station (`Station.formId`, node
  #717); the proxy is the station's own form's. The trade pool holds one
  form, the shipyard's three (node #746) and the refinery's four (node #745).
  The refinery's Works (`d`) is a **solved** form: its shape comes from
  `Station.assemblySeed` through `placementsOf`, and its berth side from the
  berth seed. The solve (`src/wfc.ts`, `src/station-modular.ts`) imports no
  Three.js. The outpost's is the Salvage (`e`), also a function of the
  assembly seed but **grown, not solved**: `buildOutpostSalvage` accretes its
  pieces from its own draw, and that plan exists only inside the renderer's
  builder.
- `corridorRadiusKm` and `interiorAxialSpanKm` (`src/station-interior.ts`)
  are the pad corridor's radius and the interior's axial span. Both are
  Three-free.
- A frame handed to flight is a `FrameMotion` (`src/sim.ts`, #529): the
  frame's velocity at both ends of the step.
- A struck carrier already leaves its projection
  (`civilian-combat.md` H3, H3b): while materialized it is flown from the pose
  it is drawn in, and a hit that reaches hull diverts it home (H3d).

---

## 2. What is solid, and in what shape

### 2.1 Bodies: a sphere at the radius (C1)

A star, a planet and a moon collide as a sphere at `radiusKm`. A planet's ring
is not solid. A belt is not a body and has nothing to collide with.

### 2.2 Stations: a declared proxy per form (C1)

A station collides on a **proxy**: a small set of convex primitives — spheres,
capsules and oriented boxes — in the station's own frame, in kilometres.

- **Where it lives.** A Three-free module beside `STATION_GEOMETRY` and the
  interior catalogue. The renderer never reads it. The build names the module:
  `src/station-proxy.ts` (node #662), measured by `tests/station-proxy.test.ts`
  and, over a wider seed spread by hand, `scripts/measure-station-proxy.ts`,
  whose last run `docs/findings/station-proxy-wide-sweep.md` records.
- **What it is a function of.** `(type, form, berthSeed, assemblySeed)`. What
  a seeded form's proxy reads depends on where its plan lives:
  - A form solved by `placementsOf` (the Works) has its proxy derived from
    **the same placement solve the mesh reads**, cell by cell. It is never a
    second copy of the plan.
  - A grown form (the Salvage) has no Three-free plan to read. Its proxy is
    **one seed-independent envelope** sized to contain the plans it was
    measured over. It does not follow a plan, so it is only as good as that
    measurement: gated on `ASSEMBLY_SEEDS`, measured over a wider spread by
    hand, and a plan outside both is not measured. Making it follow its plan
    means moving the Salvage's plan out of the renderer first.
  - An **authored** form (the shipyards, node #818) has its proxy fitted to
    the authored model, generated into `src/shipyard-proxies.ts` with the
    model's hash. The sim collides with it **whatever is drawn** (principal,
    2026-10-12): until the model installs, the procedural stand-in draws and
    may lie outside it, and is not solid. At most 10 m of empty space within
    it collides (the principal's rule, the same day); `tests/shipyard-flight.test.ts`
    measures that, and that every vertex of the model lies within 1.5 m of it.
- **What it turns with.** The proxy is stated in the spinning member's frame,
  as the drawn interior is (`docking.md` §13). Static structure — the
  shipyard's keel — is stated in the static frame.
- **The openings.** On a **slot** role, the proxy leaves open (a) the prism
  that the aperture rectangle sweeps outward from the plane, and (b) the
  interior volume over `interiorAxialSpanKm`. On a **pad** role, the opening is
  the corridor cylinder at `corridorRadiusKm`, extended outward from the plane.
  That is the corridor row's own cylinder. It is read, not restated. A pad's
  berths and booms stand outside it and are solid.
  **Derived for the hull-box build (node #663):** the pad opening also runs <!-- glossary-ignore: pad -->
  below the plane into a landing well. Otherwise the nose meets the deck
  before the centre can cross, so C3 prevents every pad entry. The well's <!-- glossary-ignore: pad -->
  depth (`padWellDepthKm`, `src/station-proxy.ts`) is the largest box
  half-diagonal plus its origin offset over hulls the role's berths admit.
  This clears a centred hull up to the plane without exempting the approach;
  an off-axis hull can still meet the deck. The change and its measured
  depths are handed to the principal with §9.1.9's table.
- **Which forms need one.** Every form in a pool (`formsInPlay`: each role's
  pool, and the outpost's one form), because only they can be drawn by a
  running game. A workbench alternate may have no proxy. A row refuses a
  **pooled** form that has none, so node #717's pools (a form per station,
  drawn from the system's seed) cannot grow by accident.

**The budget, declared first and then measured (derived).** A proxy is written
down before it is checked against the mesh. A proxy generated from the mesh
would pass any check against that mesh by construction. Two rows hold it, as
`stationSilhouetteKm` holds `reachKm` (#28):

1. **No drawn vertex outside the proxy.** Every vertex of the built station
   lies inside the proxy, or within a stated tolerance of its boundary. The
   bay's walls are the boundary of the open interior volume, so they pass on
   the tolerance. Every vertex inside the open volume belongs to the interior
   group.
2. **No proxy outside the reach.** Every primitive lies inside `reachKm`.

For a seeded form, solved or grown, both rows run over `ASSEMBLY_SEEDS`. A row
on a seeded form at seed zero checks one plan (#257).

What the budget does **not** prove is that the proxy is tight. A proxy can
pass row 1 and still be an invisible wall wherever a form is sparse. #75
rejected the reach sphere for that reason. Whether a proxy is too generous is
checked by flying it (§9.2).

### 2.3 Ships: the hull box (C4b, P1)

**P1 (principal, 2026-10-03): a ship meets everything on its hull box.** That
includes another ship (C4b, decided by #75), a station and a body. The box is
`HULL_SPECS[id].env`, in the ship's body frame, turning with its attitude.

The alternative was the ship's centre as a point. It was declined because a
point lets a hull sink half its length into a station, and lets the cockpit
camera enter structure. Keeping the camera out of a surface is what
`SURFACE_MARGIN` and `HOST_CLEARANCE_KM` exist for.

**What P1 costs, named here so it is not rediscovered in play.** Under C3 a
wing that touches the slot's rim before the ship's centre crosses the plane is
an impact. So the aperture is now a **physical fit** as well as §3's six
checks:

- **Roll.** At check 4's 50° limit, the tightest hull clears a slot by 6.6 m
  (the miner, `tests/aperture-fit.test.ts`). A centred entry within the limit
  still fits. An entry off centre by more than the margin does not.
- **Pitch and yaw.** `tests/aperture-fit.test.ts` measures a hull whose nose
  is on the axis. A hull pitched against the axis is wider in the slot's short
  dimension, so a long hull may clip the rim inside check 2's 35°. **This was
  not measured when P1 was chosen.** §9.1.9 owes the table and §11 records it.

The box is centred on the ship's sim position. If a selected mesh's box is not
centred on its origin, the build either carries the offset or shows the error
is inside the 0.1 m rounding. A row decides which (§9.1.10).

**A deployed cutter is a second ship primitive (#949 D3, #956 Q3–Q4, node
#959).** The miner's cutter is a box in the ship's frame, `HULL_SPECS.miner.cutter`:
±5.5 m across, −8.91…+2.09 m high, from the bow plane at 42.2 m to 52.8 m. While
it is deployed, `shipPrimitives` puts it on the ship's list beside the hull box,
and the sweep meets everything with both: rocks, stations, ships and
canisters. Every impact names the part that met the surface, `hull` or
`cutter` (`Impact.part`; `partA` and `partB` on a ship pair). Stowed, the list
is the hull box alone. Whether the cutter is deployed is an input to the sweep,
and Drill interaction (#920) owns where it comes from. What a cutter strike
costs, and which side it bills, is #920's or the fiction map's.
`tests/collision-cutter.test.ts` holds the rows.

### 2.4 What does not collide

| Object | Collides? | Why |
|---|---|---|
| The player, a raider, a relay defender, a Traffic carrier | Yes | C4a, C4b, `combat-model.md` §1 |
| Any ship whose phase is exempt (§5) | No | `docking.md` §12.3 |
| A cargo canister or a wreck canister | No (derived) | It is scooped when the ship reaches it. A bounce would make it unscoopable. |
| A laser beam or a missile | No | Weapons have their own hit test (`combat-model.md` §2.1) |
| The pirate relay, Rama, Voyager | No, until each declares a proxy | No decision has given any of them a solid shape. Adding one adds a row here. |
| A drawn object with no sim entry (`?fleet`, the workbench) | No | Collision is a sim-tier law. `ship-visuals.md` §2 gives the scaffold no sim entry. |

---

## 3. What an impact does (C2, P2, P3)

**One law for every body, with a bounce.** At an impact, let `n` be the
surface's outward normal and `p` the impact point.

```
u     = v_ship(p) − v_surface(p)          relative velocity of the two points
v_n   = max(0, −dot(u, n))                 closing speed
damage = DOCKING_DAMAGE_SCALE · max(0, v_n² − V_SCRAPE²) / V_GATE²
```

- **`v_surface(p)`** is the body's velocity from the **same `FrameMotion` the
  step moved the ship on** (#529), plus `ω × r` where the body spins. That is
  the map's Constraint *"closing speed is relative to the body met, in its
  rotating frame where it spins"*. It is not an inertial velocity: a ship
  parked beside a station is not struck at 30 km/s.
- **The side** is `sideStruck(nose, p − shipPosition)`, and the damage goes
  through `applyDamage`. Shields first, hull after. Nothing else writes hull.
- **The bounce.** The normal component of `u` is reversed and multiplied by
  `RESTITUTION`. The tangential component is kept. The ship is placed just
  outside the surface, by a separation small against every primitive. Attitude
  and angular velocity are unchanged (derived — a bounce imparts no spin,
  which keeps the law to one number).
- **Destruction.** A hull at zero is a destroyed ship, through the same path a
  kill by fire takes.

**P2 (principal, 2026-10-03): `V_SCRAPE = 0.05` km/s, `RESTITUTION = 0.5`.**
Both are chosen and nobody has flown them yet.

- 0.05 km/s is half the docking gate. Below it an impact costs nothing.
- The damage uses `v_n² − V_SCRAPE²`, not `v_n²` behind a threshold. So
  damage rises from zero at the threshold, with no step at it (derived).
- 0.5 is `docking.md` §2.0's repel, which reverses `v_axial` and halves it.
  The game then has one meaning for "bounced".

**Why a threshold where docking has a floor.** `docking.md` §2.1 has a floor
so that a crawling pilot cannot fail checks for free. A ship can rest against
a surface and touch it every tick, and a floor would bill it every tick.
The threshold is the inverse of a floor. This is #75's reason, unchanged.

**P3 (principal, 2026-10-03): collision reads `DOCKING_DAMAGE_SCALE`.** There
is one constant for what meeting a surface costs. A retune of docking's scale
retunes collision, on purpose. The constant keeps its docking name and its
home in `src/docking.ts` on purpose: renaming a shipped constant is a code
change, and the sharing is the decision rather than the name. If #303 finds
the import direction awkward, moving it to a neutral module is a rename that
changes no figure. Two bounds hold the **exported** constant, as
`docking.md` §10 requires for docking:

1. **Survivable at the gate.** An impact at `V_GATE` costs at most a quarter of
   the smallest hull's head-on pool. Today that is 30 against 46.75, on the
   raider.
2. **Lethal at combat speed.** An impact at the 2 km/s assist cap costs at
   least the largest hull's head-on pool. Today that is about 15,990 against
   2,741, on the carrier. This is C2's argument made checkable: a planet met
   at combat speed kills without a second rule. Capitals do not dock (#56),
   but they collide, so they are in the bound.

The figures above are a reading of today's constants, not a second copy. The
test owns them.

**Ship against ship (C4b).** `u` is the relative velocity of the two impact
points. Both ships take the same `damage`, each on the side `sideStruck` gives
it. The bounce is an impulse along `n` that conserves momentum, so it is split
by `massT` (derived). After the bounce the normal relative velocity is
`−RESTITUTION · v_n`. A courier that hits a carrier moves; the carrier barely
does.

**What a spinning station does to a ship holding beside it (consequence).** A
point on a 3 rpm station at 0.6 km moves at about 0.19 km/s, which is almost
twice `V_GATE`. A ship that holds still while a Coriolis corner turns into it
is struck at that speed. That follows from the rotating-frame Constraint. It is
named here so that it is a known behaviour and not a reported bug.

### 3.1 Resting on a surface, at any dt

The closing speed is read at the **time of impact within the step**, not at
the end of the step. The step's velocity change is spread over the step, so a
ship that starts a gap `g` from a surface and accelerates at `a` meets it at
about `sqrt(v0² + 2·a·g)`, whatever dt is.

A pair that is already **touching** at the start of a step is a **resting
pair**. Touching means a separation no larger than the placement separation
the bounce uses, so a ship the bounce has just placed is touching on the next
step. A resting pair is **still swept and still resolved**; it is never
handed to §4.3's ghost rule. Two things differ for it (derived):

- **Its closing speed is read at the start of the step**, before this step's
  own acceleration — thrust and the frame's — is applied. A ship that the last
  step stopped at the surface starts this step with no inward speed, so thrust
  pressing it in costs nothing at any dt. "No inward speed" is read to a
  rounding floor, `RESTING_CLOSING_FLOOR_KMS` (1 nm/s): the pair solver
  leaves a resolved pair's relative velocity with residues of order 1e-17
  km/s, and an exact `> 0` billed one as a resting impact of zero damage
  once node #812 changed the courier's box. A surface that is itself moving in
  is still billed: a Coriolis corner turning into a ship that already touches
  a face meets it at `ω × r` at the start of the step, and §3's law charges
  that.
- **Its inward motion during the step is stopped at the surface.** Whatever
  the step adds — thrust, the frame, the ship's own rotation carrying a corner
  of its box in — the ship ends the step at the placement separation, outside
  the surface. Rotation into a surface is resolved by moving the ship out, not
  by stopping its rotation, so §3's "a bounce imparts no spin" stands. The
  bounce applies only when the start-of-step closing speed is above
  `V_SCRAPE`; below it the inward normal velocity is removed.

So every resolved impact, resting or not, ends with the pair apart by the
placement separation, and a pair can only overlap at the start of a step by
being placed there (§4.3). A ship held against a surface by thrust stays at
the surface on every step at no cost, and a ship that bounces off returns at a
lower speed each time until it is a resting pair.

---

## 4. How an impact is found within one tick (C3)

### 4.1 Swept, never point-in-volume

The map's Constraint: a test at `MAX_DT` is swept. The sweep runs in the
**body's own frame** — rotating where it spins — between the ship's pose at the
start of the step and its pose at the end. Both ends come from the step's
`FrameMotion`.

**Rotation can tunnel too** (`flight-model.md` §4). Under P1 the ship is a box,
so turning is motion. Angular rates are not capped, and a spinning station's
surface moves as well. The requirement (derived):

> Within a sub-step, no point of the ship's box moves more than the thinnest
> primitive in the proxy it is tested against. That motion includes
> translation, the ship's rotation (at the box's half-diagonal), and the body's
> spin (at the impact radius).

The build chooses how to meet it: conservative advancement, or a sub-step count
from that bound. The thinnest primitive is a declared figure in the proxy
module, and a row asserts it. A pair whose bounding spheres the swept motion
does not reach is not tested. The bounding spheres are `reachKm`, `radiusKm`
and the box's half-diagonal.

### 4.2 The earliest impact owns the tick (C3)

On the tick's swept motion, the **earliest** event in time wins. The events are
a proxy impact, a body impact, a ship impact, and the ship's **centre**
crossing the aperture plane inside the rectangle.

- **The plane first:** `docking.md` §3's six checks run at the crossing, and
  §12.3's ordering is unchanged. A pass is exempt from the next tick. A failure
  is §2's in full.
- **An impact first:** this spec's law runs, and the plane is not crossed this
  tick.
- **Another ship first** (node #664): the pair is met by C4b's law, the plane
  is not crossed, and the ship meets the world afterwards on the motion the
  meeting left it, swept from the tick's start to its corrected end. A world
  impact the bounce prevents is not billed. Each ship's first meeting is read
  on the tick's unresolved motions, so a meeting its partner never reaches
  only defers the world sweep; it cannot lose a world impact.
- **An exact tie:** the impact wins (derived). A surface is a promise to keep
  out, so it beats an inclusion promise. `cruise.ts` makes the same ruling for
  a surface and an arrival.

Two orders were rejected by #75. "Docking first" treats a ship that clips a rim
bar on its way in as a clean entry. "Collision first" bounces an entry that
crossed the plane properly and would only have met structure later in the
tick. Time of impact is the only order that matches what was flown.

### 4.3 A tick that starts inside (derived)

The map says a sweep that starts inside a volume owes the case its own answer
(#30). **A pair that overlaps at the start of a tick is not tested until it has
separated.** There is no damage and no push-out.

A flying ship can only start inside a proxy by being placed there:

- a spawn, a hyperspace arrival or a cruise exit;
- a save restored in flight (#293);
- the end of a launch. At the tick the exemption ends, the centre has just
  cleared the plane and the rear of the hull has not. On a slot the bay is
  open in the proxy, so a hull that fits the aperture overlaps nothing. On a
  pad, or with a hull near its fit margin, it may.

A push-out would throw a restored ship through a hull, and would bill or bounce
a launch off the station it is leaving. A ghost lets the ship fly out the way
it came. Ghosting is **per overlapping box**, not per station: any other
heading may meet the next box of the same structure, which is struck and
billed by §3. The way out can be held for **one step, unbilled**, by a neighbour
the ship passed inside the contact distance (principal's ruling, 2026-10-15).
Node #963's full-proxy row in `tests/collision-stations.test.ts`, “a shallow
restore reverses out with every neighbour present”, measures **2 of 1,678
overlapping placements held**, each for one step, with no reverse impact
billed and every placement clear within five `MAX_DT` ticks. It marches 40
seeded rays per hull (courier, freighter) on each authored shipyard a–c and
refinery a–d in a still frame, at 0.5 m a step to first overlap, bisects the
boundary to 1 cm, and places the ship 0.1, 0.5 and 2 m past the last clear pose.
Every sweep at 100 m/s includes every primitive; the row prints overlaps and
held placements per form and hull. Two grazing placements no longer overlap
at their depth and are counted out. §11.7 records the limits of this claim.
§9.1.7 counts how often each placement path starts a ship inside, so whether
launches ever do is measured rather than assumed.

---

## 5. The exemption

`docking.md` §12.3 owns it, and this section reads it.

- **The player** is collidable exactly when `collisionExempt(phase)` is false.
  That is `flying`.
- **A Traffic carrier** is exempt in the states that mirror those three: its
  scripted hold-to-plane and traversal, and parked in a berth. It is keyed on
  its route phase (derived — #75's C4a makes Traffic collide like the player,
  so it gets the player's exemption). The same argument applies: a position law with a known
  start and end, inside a lane that `docking.md` §6's clearance protocol keeps
  clear of other ships.
- **The boundaries in time** are §12.3's. The exemption starts on the tick
  after the six checks pass, and ends when the launching ship's centre clears
  the plane outward. §4.3 covers the hull that is still in the throat at that
  tick.
- **As Traffic's route phases** (node #664, `trafficCollisionClass` in
  `src/station-route.ts`). Exempt: `parked-home`, `launch-queued` and
  `docked-away` (parked), `departing` (the launch, which releases twenty
  metres past the plane, so the centre has cleared it) and `arriving` (from
  the tick the lane is granted at the hold, through the traversal). Collidable:
  `local-departure`, `local-approach`, the two queues' holds, and a hauler's
  `lane-point-hold` and `jump-windup`. `cruise` and `regenerating` are the
  cruise regime and are C5's (derived: the player's two regimes, applied to
  Traffic). `tests/collision-traffic.test.ts` holds the table and reads the two
  boundaries off the route law.

---

## 6. Traffic and the NPCs (C4a, C4b)

**A Traffic carrier collides like any ship.** It has a `ShipCondition` (H2), so
§3's law applies unchanged.

**What an impact does to a carrier's route.** An impact is a landed hit as
`civilian-combat.md` uses the term, for its mechanics and nothing else:

- While materialized, the carrier is flown from the pose the bounce left it in,
  with its H3 intent toward the pilot when the pilot was a party to the
  meeting; one met only by another ship or by the world runs, as a civilian
  does, until the pilot's fire lands on it or their hull meets it. A projected
  pose cannot express a bounce.
- An impact that reaches hull is H3d's trigger, and H3c records it: `disable`,
  then `repair-start`. That is the saved Carrier deviation #75 asked for. The
  route already exists; this spec does not add a second one.
- An impact that spends only shields writes nothing, as a shot that spends
  only shields writes nothing (H3d).

The map's Constraint says *"a contact is a saved Carrier deviation"*. Read with
H3d, only an impact that reaches hull is saved. §10 lists the change to that
line.

**Owed, and not built by this spec:**

1. **Traffic must not hit its own world.** A route that can be interrupted by an
   impact needs one of two things: avoidance in the route law, or a corpus row
   proving that no projected route outside its exempt phases brings a carrier's
   box into a proxy, a body's sphere, or another carrier's box. Without either,
   Traffic damages itself on its own stations and diverts itself home. #303
   builds the row first, and avoidance only if the row is red.
   **The row is red** (node #664, `docs/findings/traffic-collision-corpus.md`).
   Over 40 systems of seed 47 it finds a local approach whose straight line
   runs through a trade station at up to 8.96 km/s, and touches under
   `V_SCRAPE` at a launch's aperture and at the shared release point. The
   avoidance is owed by a node below #664, not built past it. Until then a
   projected route is not swept against the world at runtime — it is met only
   by the ships that are flown — so the defect costs Traffic nothing it can
   see, and the row is what keeps it visible.
2. **The NPC controller steers clear of bodies and stations** (node #665).
   `combat-model.md` §1 forbids exempting an NPC, so the avoidance is the
   controller's: `avoidSolids` in `combat-enemy.ts` bends every phase's
   heading, a rout's and a civilian's included, and both the raider's duel
   and an engaged carrier fly through it.
   - **What it avoids.** Each star, planet and moon at its radius, and each
     placed station at its proxy's reach: one bounding sphere per solid,
     from `avoidanceSolids` in `sim.ts`, which reads the sets `worldSolids`
     sweeps. Around each it keeps `AVOID_CLEARANCE_KM`, an absolute 0.5 km
     and never a fraction of the body (the #30 Constraint). **Not other
     ships:** the pilot is the fight's target and the merge break already
     keeps off them, and a meeting between two fleet ships is §3's bounce.
   - **How it reads a threat.** Both the path the ship is on and the one its
     assist is about to put it on, `frame + heading · speed`, each as a
     velocity relative to the solid (#362). A threat is a path that enters
     the keep-out inside the hull's own horizon (`avoidanceHorizonS`), and
     only the earliest is answered. A threat beyond the horizon moves
     nothing.
   - **What it does.** When the ship is running at a pilot inside the
     keep-out — at the station's mouth — and the solid is at rest in the
     frame, it **holds off**: the nose stays on the run and the speed is
     capped at what half the hull's retro can stop from before the keep-out.
     Otherwise it **goes round**: the heading nearest the bearing that clears
     the keep-out's cone, on the side the ship is already sliding to. While
     the present path is still inside the cone, it aims past the edge by as
     much as that path is inside. Inside the keep-out it steers outward. The
     assist thrusts along the nose rather than along the heading it is
     turning to, so while the nose still points into the solid the throttle
     is cut and the assist brakes.
   - **The three regimes.** The controller always flies its own assist on;
     the regimes are the pilot's, and the law reads only relative motion.
     In cruise the duel is over, and an engaged carrier is still held in
     the pilot's frame. When that frame becomes the star's, the carrier is
     braked toward star rest and the station's orbit drags it back into the
     station, which the avoidance meets as a fast solid: when no heading
     clears, it takes the one that closes least.
   - **A duel beside a station stays a duel.** The widest station keep-out
     is under half of `GUN_RANGE_KM`. Against a pilot sitting just outside
     a station, the raider fires on about 70% as many frames as it does in
     open space with the pilot's assist on (0.191 against 0.271), and on as
     many with it off (0.168 against 0.169). Against a pilot at the mouth,
     the raider, a patrol and an interceptor holding off fire on as many
     frames as in open space (0.277 against 0.287, 0.298 against 0.296,
     0.295 against 0.291). Gone round instead, they fired on under 0.05.
   - **The figures are measured, not derived.** They were read off
     `tests/combat-enemy-avoidance.test.ts` at node #665, which flies the
     production steps beside real stations and meets the world through
     `stepFleet`. Blind, its 39-run corpus met the station in 39 runs with
     the pilot's assist on, 27 with it off and 39 in cruise; avoiding, in
     none. A body is flown on one row per kind — a star, a planet and a
     moon, 15 runs each — with a routed raider fleeing straight down at it
     in the body's frame: blind every run meets the body, avoiding none
     does. **No body row flies an attacking raider, the pilot's assist off
     or cruise**: the law reads only motion relative to the solid, so those
     cases are covered beside a body by the station rows' argument, not by
     a run. The test gates the shape rather than the counts: blind more than
     half, avoiding zero, and the fire share beside a station above 0.6 of
     the open-space share, with no run under 0.05 (at the mouth, above 0.8
     and no run under 0.15).

---

## 7. Cruise (C5)

**Collision sits under `SURFACE_MARGIN`.** Cruise keeps its keep-out and its
drop-out unchanged. Collision is evaluated in normal flight only, with the
assist on and with it off. At 20 c a tick covers 600,000 km, so an impact under
§3 would always kill. Cruise's guards exist so that cruise never reaches one.
Two regimes give two answers, each one right for its speed.

**What C5 does not cover (derived).** Cruise guards stars and planets, and
`HOST_CLEARANCE_KM` guards a target's host. It has **no station keep-out**. A
leg that passes through a station other than its target goes through it, as it
does today. That is accepted under C5's "two regimes" and is recorded in §11.
§9.1.12 measures how often it happens.

---

## 8. What the pilot sees and hears

Not decided here. An impact is a new event the pilot must be told about, as a
failed entry is told on the prompt line (#597). The words, the tone and the
sound belong to `hud-and-scanner.md` §3 and the audio owner. §10 hands it on.
Until it is built, an impact shows as a change in condition and a change in
velocity, and nothing else.

---

## 9. Verification obligations

Two tiers. Anything arithmetic gets a headless test. Anything spatial gets a
browser probe.

### 9.1 Headless (`bun`)

1. **The law, table-driven.** Closing speed is the normal component of the
   relative velocity of the two points. It is zero for a ship moving away and
   zero at a purely tangential graze. Damage is zero at `V_SCRAPE`, positive
   above it, and continuous through it. The bounce reverses the normal and
   multiplies it by `RESTITUTION`, and keeps the tangential.
2. **The frame regression.** A ship co-moving with a station at 30 km/s,
   touching at 0.03 km/s relative, takes no damage. A ship at rest in star
   coordinates that meets the same station is struck at about 30 km/s.
   A third row: a ship at rest beside a spinning station, met by its turning
   surface, is struck at `ω × r`.
3. **The scale bounds, on the exported constant** (P3). At `V_GATE` the damage
   is at most a quarter of the smallest `headOnPool`. At the 2 km/s assist cap
   it is at least the largest. The rows read `DOCKING_DAMAGE_SCALE` and the
   hull table, not a parameter.
4. **Thrust against a surface pays nothing, the ship stays outside it, and dt
   does not change either** (§3.1). A hull holding full thrust into a surface for
   ten seconds takes zero damage at `dt` = 1/144, 1/60 and `MAX_DT`, **and at
   the end of every step its box is outside the surface**. The same holds for
   a hull resting on a surface while turning at its largest rate. **A moving
   surface is the exception, and it is billed:** a ship touching a station
   face while a corner turns into it takes §3's damage at `ω × r`. A red build: a resolver that hands a
   resting pair to §4.3's ghost rule passes the damage half and fails the
   outside half. A ram at 0.5 km/s costs the
   same damage at all three, within a stated tolerance. The interceptor
   accelerates at 2.8 km/s², so one tick of its thrust at `MAX_DT` is
   0.28 km/s. A law that read the end-of-step velocity would bill that every
   tick and would depend on dt. This row forbids that design.
5. **No tunnelling.** At the 2 km/s cap and at assist-off speeds above it, a
   box swept at a primitive thinner than one tick's travel makes an impact. A
   box turned through a thin boom in one tick at a rate above any hull's makes
   an impact (§4.1). A red build: a point-in-volume test fails both rows.
6. **The earliest impact owns the tick** (C3). A segment that clips a rim
   primitive and then crosses the plane inside the rectangle is an impact, and
   the six checks do not run. A segment that crosses the plane first and would
   meet structure later in the tick runs the checks. An exact tie is an impact.
7. **A tick that starts inside** (§4.3). An overlapping pair is not tested
   until it separates. A launch on every slot and pad role, for every hull its
   berths admit, flies out without an impact. Each placement path is counted.
8. **The exemption honoured** — `docking.md` §12.6 obligation 8's physical
   half. Fly the arrival, the parked interval and the launch on every role,
   for every hull its berths admit, with the exemption in place, and assert no
   impact. The red build differs by aperture kind, because §2.2 leaves a
   slot's bay open in the proxy:
   - **Pad roles:** the deck and the berths are solid. Removing the exemption
     must make impacts. That is the red build.
   - **Slot roles:** removing the exemption may make **no** impacts, because
     the open bay already keeps the traversal clear. That outcome is not a
     pass of the exemption; it is a check that every traversal's swept box
     stays inside the open volume, and the row asserts exactly that. Its red
     build closes the bay in the proxy, which must make impacts. On a slot
     the exemption is defence in depth, as check 5 is at the plane.
   - **What the open bay does not cover:** a berth's own fixtures inside the
     bay are not in the proxy. A ship flying in the bay — only a placement
     can put it there (§4.3), such as #293's restore — passes through them.
     §11 records it.
9. **The aperture as a physical fit** (P1). For every ordinary hull, print the
   largest check-2 angle (pitch and yaw separately) at which a centred entry,
   rolled to check 4's limit, clears the proxy. Assert that every hull clears
   at zero angle and at the 50° roll limit, which is what
   `tests/aperture-fit.test.ts` already holds against the slot. The angle
   table is printed for the principal to judge (§11).
10. **The box is where the ship is.** Each selected mesh's box centre lies
    within the 0.1 m rounding of the ship's origin, or the box carries the
    offset.
11. **The proxy budget** (§2.2). No drawn vertex outside the proxy, within the
    declared tolerance. No primitive outside `reachKm`. The pad opening is the
    corridor row's cylinder. A selected form with no proxy is red. Seeded forms
    run over `ASSEMBLY_SEEDS`; a grown form's envelope is measured wider by
    hand (§2.2). The thinnest-primitive figure is asserted.
12. **Cruise never reaches a proxy** (C5). Every cruise keep-out sphere
    contains its body's collision sphere. No cruise exit places a ship inside a
    proxy, over the corpus `in-system-travel.md` measures. The count of legs
    whose swept path crosses a non-target station's proxy is printed, with its
    N.
13. **Ship against ship** (C4b). Momentum is conserved. Both ships take the
    same damage, each on its own side. A courier against a carrier moves the
    courier.
14. **Traffic** (§6). A hull-reaching impact on a carrier writes `disable`
    then `repair-start`, as a shot would. A shield-only impact writes nothing.
    The corpus row of §6, item 1, is green, or avoidance exists.
15. **The docking computer makes no impact.** `docking.md` §9.1.11's run, from
    the vicinity to docked, asserts that no impact occurred as well as that no
    check was broken.

### 9.2 Browser probe (Playwright)

1. **A ship stops at a hull.** A scripted approach at a station's face stops
   at the proxy, bounces and survives when it meets the face at `V_GATE`,
   which bound 1 of §3 makes survivable for every hull. This
   replaces `docking.md` §9.2.4's subject (§10).
2. **A ship stops at a pad berth** and at a shipyard boom, which are the
   sparse forms where a too-generous proxy would show as an invisible wall.
3. **A ship stops at a planet's surface** in normal flight, and the cockpit
   camera is still outside the surface on the frame of impact.
4. **A docking run still docks** — `docking.md` §9.2.3, re-run with collision
   live.

Per the map, the probes do not run in CI. Running them is the author's job
before merge.

---

## 10. What this makes false, and where it is amended

Each spec line is amended in this change, except where its own table says otherwise. A code line is amended by #303.

| Rule | Owner | Change |
|---|---|---|
| Check 5's paragraph: "once the hull is solid … must be re-pointed" | `docking.md` §3 | Points here; the probe's re-pointing is §9.2.4's |
| "A hull-face approach is refused" — check 5 as the probe's subject | `docking.md` §9.2.4 | Re-pointed: the browser row becomes §9.2.1 here, under a collision name. Check 5 keeps its headless row, §9.1.1. Renaming the probe is #303's. |
| §12.3's hand-off to "the collision system" | `docking.md` §0, §12.3 | Points here, and keeps the boundary table |
| Obligation 8's other half "inherited by #75" | `docking.md` §12.6 | Addressed to §9.1.8 here, built by #303 |
| Joints 3 and 5: "collision is decided and unbuilt", "obligation 8 cannot fail" | `docking.md` §12.7 | Specified here, built by #303. Still green for a dead reason until #303 lands. |
| "#75 made Traffic collidable" with no law behind it | `in-system-route-traffic.md` §5 | Points here; an impact is a landed hit (§6) |
| "#75 and #362 have since added both" | `station-traffic.md` §3.1 | Collision is decided, not added. #303 builds it. |
| "Swept collision at `MAX_DT` — the collision spec owed by #302" | `flight-model.md` §1, §4 | Points here; §4.1 answers the angular case |
| The false-rules table's first row | `civilian-combat.md` | Not here. That table is amended by the change that builds its rows, so #303 adds that an impact uses H3d's route. Done by node #664. |
| "A contact is a saved Carrier deviation" | Map #1 Constraints | Only a hull-reaching impact. Amended on the map when this merges. |
| `collisionExempt`'s comment: "#75 inherits the other half of obligation 8" | `src/dock-session.ts` | §9.1.8 here. A code comment, so #303 amends it. |

**Handed on, and not decided:**

- **Whether an impact is an offence.** Ramming a carrier spends its hull. Who
  was at fault, whether it costs heat, and whether a witness hears it is
  `civilian-combat.md`'s (H4–H6) and the fiction map's (#460). Until that is
  decided, an impact writes no heat and no witness.
- **What the pilot is told.** `hud-and-scanner.md` §3 and the audio owner (§8).
- **The NPC controller's avoidance** (§6, item 2). Built by node #665.

`combat-model.md` §1 needs no change. It already requires the same collision
rules for every combat ship.

---

## 11. Weak joints, recorded and not reopened

1. **Two figures are chosen and nobody has flown them** — `V_SCRAPE` and
   `RESTITUTION` (P2). They are where this spec is most likely to be wrong.
   §9.2 is where that shows.
2. **P1 makes docking harder, and the pitch half was not measured when it was
   chosen.** The roll half was known: 6.6 m on the miner at 50°. Whether a
   long hull can still use check 2's full 35° is §9.1.9's table. If it cannot,
   the principal decides whether that is the intended skill tax or a reason to
   revisit P1. It is not a reason to cut the rim out of the proxy.
3. **Cruise passes through stations that are not its target** (§7). C5
   accepts it, and §9.1.12 counts it.
4. **Traffic and NPCs are collidable before they can avoid anything** (§6).
   Until #303's corpus row is green, or avoidance exists, a carrier on its
   route can divert itself on its own station. The flown ships — the duel's
   raider and an engaged carrier — steer clear of stations and bodies since
   node #665 (§6 item 2). They still meet what that law does not read:
   another ship, and a solid that closes faster than the hull can leave its
   path. Node #664 found the row red and recorded it
   (`docs/findings/traffic-collision-corpus.md`); a carrier on its projection
   is not swept against the world, so only a flown one — engaged, or handed to
   flight by a meeting — can divert itself today.
8. **An impact's divert discounts a later strike** (node #664). An impact
   writes H3c's pair under a `collision` cause, never `PLAYER_KILL`, but
   `strikeClock` reads presence and not provenance: a carrier standing in its
   berth for an impact reads, to `chargeOffence`, as a carrier the player has
   already been charged for striking. And a carrier an impact has diverted is
   no longer `operational`, so the gun's later hull strike writes no divert and
   charges no `struck`. Both are the offence's to settle, which is #675's.
9. **A bump hands a carrier to flight, and to its H3 intent** (node #664).
   §6 has a projected carrier leave its projection on any meeting, because a
   route cannot express a bounce — including a touch under `V_SCRAPE` that
   costs nothing. A civilian then flees. An armed hull (patrol, interceptor)
   takes the attacker's intent **only when the pilot was a party to the
   meeting**, because that intent is toward the pilot: a patrol a raider rams,
   or one that met a station, runs instead, and turns on the pilot only when
   the pilot's fire lands on it or their hull meets it (`provoke`). So a pilot
   who nudges one at 0.01 km/s has still started a fight, which reads against
   H3's "never starts a fight". Built as §6 is written; whether a costless
   touch should engage at all is the principal's to rule.
10. **A raider's kill by impact pays only the player's own ram** (node #664).
    A raider that a collision finishes dies in the same tick, through the end
    a kill by fire takes — so a ram that kills the pilot as well, and holds
    the clock, still destroys its Raider slot and schedules its <!-- glossary-ignore: slot -->
    replacement — named for the meeting that did the most damage: the player's ram is a direct cause and pays bounty and ladder as
    the gun does; a raider that flew into a station or planet alone names what
    it met and pays nobody (`tests/collision-traffic.test.ts`).
5. **The proxy is checked as a container and not as a fit** (§2.2). A proxy
   that wraps a sparse form in a box passes every headless row. Only flying
   it (§9.2.2) shows the invisible wall.
6. **Berth fixtures inside a slot's bay are not solid** (§9.1.8). Only a
   ship placed in the bay can reach them, and it passes through them.
7. **A ship placed inside ghosts only the boxes it overlaps** (§4.3). Node #663's
   `tests/collision-stations.test.ts` counts spawn, hyperspace, restore <!-- glossary-ignore: Spawn -->
   fallback, cruise exit and launch placements. A saved flight pose can be
   arbitrary; its deliberately inside restore row on every role isolates one
   pair to test escape and collision becoming live again after separation.
   Node #963's row, “a shallow restore reverses out with every neighbour
   present”, keeps **every primitive** of each authored proxy in the sweep:
   shipyards a–c, refineries a–d, courier and freighter, 40 seeded rays each,
   a march of 0.5 m, boundary bisected to 1 cm, depths 0.1 / 0.5 / 2 m,
   reverse flight at 100 m/s over consecutive `MAX_DT` steps. Of 1,680 depth
   placements, **1,678 overlap**; all escape unbilled within five ticks, with
   **2 held for one step, unbilled** by a neighbour passed inside the contact
   distance. The row pins and prints those counts, rejects a longer hold or
   billed reverse contact, and requires a billed inward strike from inside
   on every form as its control.

   This is the **way it came in**, not a promise about any outward heading.
   Another heading may meet the next box of the same structure and is struck
   and billed. Spike #962 (`spikes/station-ghost-962/rows.test.ts`, `shallow`,
   on `spike/station-ghost-962`) measured other outward headings struck in
   **11–15%**, inward in **70–76%**, on its restore-after-refit placement.
   Its longer heading trials are distinct from this row's five-tick inward
   control. The principal's 2026-10-15 ruling permits the one-step unbilled
   hold: the first node #963 run measured 4 of 1,680 such placements, and
   finer marches retained those 4. The shipped corpus above is measured
   separately. This claim is **still-frame only**: a turning drum moves the
   reverse path away from the path in; the spike saw a strike in about 1 in
   300 reverse placements at 3 rpm. A deep arbitrary placement likewise has
   no reverse-escape guarantee. Counting placement paths makes it visible.

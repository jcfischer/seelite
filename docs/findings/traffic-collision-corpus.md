# Traffic against its own world: `collision.md` §6 item 1's corpus row, measured

Node #664, measured 2026-10-04. `collision.md` §6 item 1 owes one of two
things before Traffic is collidable: avoidance in the route law, or a corpus
row proving that no projected route outside its exempt phases brings a
carrier's box into a station proxy, a body's sphere, or another carrier's
box. The node builds the row first, and if the row is red the avoidance is
filed below the node rather than built past it. **The row is red.** This file
records what it found. It records data, the mechanism behind each class as
read off the route law, and nothing decided.

## What was run

On committed revision `67e4d07578bc238e068e017bceee25da5785c5c8` ("Wire ships
and Traffic into the game's step…"), with only prose and code comments changed
in the working tree. Headless bun on Apple silicon, one run after another:

```
bun scripts/measure-traffic-collision.ts 40 1800          # 176.5 s
bun scripts/measure-traffic-collision.ts 10 1800 47 0 red # the red build
bun scripts/measure-traffic-collision.ts 10 1800          # its control, 57.1 s
```

The instrument is `scripts/measure-traffic-collision.ts`. Its sweep,
projection and classes are `tests/helpers/traffic-collision-corpus.ts`, which
`tests/collision-traffic.test.ts` also reads, so the gated row and the wide run
measure the same thing:

- **Every roster and inbound actor** of a system (`buildHaulerPlans`,
  `inboundCandidates`) is projected by the shipped route law
  (`projectSystemTrafficAuthority`) on one clock at 0.5 s, with the hauler
  voyages `Game` hands it.
- **In `Game`'s order.** Each tick projects a baseline, sorts by
  `compareStationTurns`, then projects each actor against the lanes the ones
  before it have won (the carrier timeline), carrying each visit from the tick
  before. Left out: the player, berth occupancy (berths are exempt), and the
  authority's re-anchoring of a visit to the tick a queue promotes it. A first
  version that sorted by the previous tick's projection let two carriers
  launch 1.2 s apart down one lane, which the game forbids. That was an
  artifact, and it is gone.
- **Swept, not sampled.** Each carrier's box is swept from one sample to the
  next against `worldSolids` (bodies and station proxies, the builder the
  player's step uses) and against every other collidable carrier. Its velocity
  is the interval's displacement. A projection's `vel` is the velocity of the
  law it interpolates, and on a smoothed local approach it read 0.082 km/s for
  a step that moved several kilometres.
- **A ghost counts as a meeting.** `sweepShip` fails open on a pair that
  overlaps at the start (§4.3). §4.3's one sanctioned case is the end of a
  launch, and it is counted apart.
- **An encounter is the first step of each meeting.** A projection does not
  respond, so a carrier that meets something stays met until its phase ends.

## The row: 40 systems of seed 47, galaxy 0, 1,800 s each

934 actors. Carrier-steps swept per phase, 0.5 s each, which is the N behind
each bucket:

| Phase | Steps |
|---|---|
| `cruise` (C5, counted not judged) | 100,589 |
| `lane-queued` | 96,322 |
| `local-departure` | 87,217 |
| `local-approach` | 36,984 |
| `lane-point-hold` | 16,620 |
| `jump-windup` | 930 |

182,639 carrier pairs were tested on a shared step. There were 0 launch ghosts.

**Collidable phases: 55 encounters.**

| Class | Phase | Met | n | Worst closing | Billed (> `V_SCRAPE`) |
|---|---|---|---|---|---|
| `launch-throat` | `local-departure` | a trade station | 35 | 0.005 km/s | 0 |
| `release-point` | `local-departure` | a carrier in `local-departure` | 17 | 0.028 km/s | 0 |
| `approach-through` | `local-approach` | a trade station | 2 | 8.959 km/s | 2 |
| `other` | `lane-queued` | a carrier in `local-approach` | 1 | 0.939 km/s | 1 |

**Cruise phases: 3 encounters**, all at a trade station, two of them billed
(31.502 and 21.350 km/s). They are counted and not judged, because C5 leaves
cruise to its own guards.

The billed encounters, one per line:

| Kind | System | Carrier | Class | Met | Closing | At |
|---|---|---|---|---|---|---|
| collidable | 9 | `9:station-trade/traffic-01` | `approach-through` | `station-trade` | 8.959 km/s | 1,122.0 s, 23.5 s into the approach |
| collidable | 18 | `18:station-refinery/traffic-00` | `approach-through` | `station-trade` | 7.428 km/s | 562.5 s, 23.5 s in |
| collidable | 35 | `35:station-trade/traffic-05` (holding) | `other` | `1:station-refinery/traffic-01`, approaching | 0.939 km/s | 1,063.5 s |
| cruise | 3 | `3:station-trade/traffic-04` | `other` | `station-trade` | 31.502 km/s | 937.5 s, on cruise's first step |
| cruise | 17 | `14:station-trade/traffic-01` | `other` | `station-trade` | 21.350 km/s | 1,670.5 s, on cruise's first step |

## The classes, and what each one is in the route law

1. **`launch-throat`: the hull is released in a spinning slot.** Traffic's
   launch releases twenty metres past the plane (`beginLaunch` with `clearKm`
   0; #408 moved only the player's release out by `LAUNCH_CLEAR_HULL_LENGTHS`).
   A hull longer than about forty metres still has its rear inside the slot.
   From that tick on, `local-departure` holds the carrier's `up` fixed while
   the slot keeps turning, so the slot's walls rotate into the box. The
   meeting is a touch at up to 0.005 km/s, a tenth of `V_SCRAPE`, and costs
   nothing. Every case was at a trade station, the role whose slot spins.
2. **`release-point`: every launch from a station ends at one point.**
   `local-departure` runs from the release along the station's axis to
   `TRAFFIC_STATION_EXCLUSION_KM + TRAFFIC_STATION_RELEASE_MARGIN_KM`, 5.5 km,
   and decelerates to rest there. A hauler bound for its lane point then holds
   at that point for `JUMP_CHARGE_S`. The next launch from the same station,
   one lane traversal behind on the same smoothstep, reaches the point while
   the hauler is still charging. Measured at system 6: the hauler holds at
   5.500 km from 457.5 s to 460.5 s, and the next carrier closes from 5.42 km.
   The meeting closes at under 0.03 km/s, which is a touch.
3. **`approach-through`: the approach's straight line runs through its
   station.** `local-approach` interpolates from the cruise drop to the hold
   in a straight line. Where the drop is on the far side of the destination,
   the line passes through the station. At system 9 the drop is 266 km out,
   and the line passes 1.6 km from the station's centre at 8.96 km/s of
   displacement. The approach's guard is for the station-zone legs, and this
   leg is longer than that. A flown carrier meeting a station at 8.96 km/s is
   killed outright: bound 2 of §3 makes 2 km/s lethal to every hull.
4. **`other`, `lane-queued` met by an approach.** A carrier holding in a lane
   queue stands at its key-hashed hold point, 5 km out and 1.5–3 km off the
   axis (`trafficHoldProjection`). Another carrier's approach line toward its
   own hold point passed through it. One case in 96,322 hold-steps.
5. **Cruise, on its first step out of a station.** A carrier's first cruise
   interval after `local-departure` met the station it had just left, at
   21–32 km/s. These are C5's to answer, and `collision.md` §7 already records
   that cruise has no station keep-out.

## The red build: the exemption does work

The same corpus over 10 systems, with the exempt phases swept as well
(`red`), finds 724 encounters, most of them in the exempt phases: `parked-home`,
`launch-queued` and `docked-away` meeting their own berths' structure, and
`departing` and `arriving` meeting the refinery's deck and the trade station's
bay. The green run over the same 10 systems finds 15. So the exemption is what
keeps the parked and scripted intervals out of the row, and the row can go red
without it. The gated test holds one pad case of this (system 0, 600 s).

## What is gated in `npm test`

`tests/collision-traffic.test.ts`, about 13 s. The corpus row there is
**pinned red**: it asserts exactly what this run found on two systems, so a
change that moves a route, mends a class or opens a new one turns it red.

- **System 9, 1,800 s:** one `approach-through` at more than 8.9 km/s.
- **System 0, 1,800 s:** three `launch-throat` and one `release-point`, both
  under `V_SCRAPE`, and nothing in cruise.
- **The red build, system 0, 600 s:** an exempt phase meets the refinery.

## Owed, and not built here

The node's ruling is that avoidance is filed below #664, not built past it.
This node files nothing on the graph. What a later node would take from here:

- **`approach-through`** is the class with a cost. It is a route-law fix: an
  approach that does not cross its own station, or a guard around the
  destination's proxy on the drop-to-hold leg.
- **`release-point`** and **`launch-throat`** cost nothing under §3, but they
  are what the row asks about. They also point at a shared release point per
  station and at Traffic's release distance, which #408 changed for the player
  only.
- **The queue hold** that an approach crossed is one case and is billed.

One consequence of building §6 as written goes to the principal with this:
a touch under `V_SCRAPE` costs nothing, yet it still hands a projected carrier
to flight with its H3 intent, so a gentle bump starts a fight with a patrol or
interceptor (`collision.md` §11, joint 9).

Until then, a carrier on its projection is not swept against the world at
runtime. Only a flown one is: engaged by the gun, or handed to flight by a
meeting with a flown ship. So the defects above cost Traffic nothing in play
today, and this row is what keeps them visible.

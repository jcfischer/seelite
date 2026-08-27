# Spec: the galaxy map

**Status:** ratified design decision — [#11](https://github.com/jcfischer/seelite/issues/11)
**Date:** 2026-08-27
**Context:** [#6](https://github.com/jcfischer/seelite/issues/6) settled a
globular volume, [#70](https://github.com/jcfischer/seelite/issues/70) settled
that every screen lives in the cockpit, and `hud-and-scanner.md` §2 gives the
left Navigation console the system-scale discovery this is one scale above.

---

## 0. Scope

How the player reads and navigates a three-dimensional galaxy: the projection,
the jump range, target selection and its record, multi-hop routing, the density
gradient, and what happens to the other seven galaxies.

It does **not** own the cockpit panel that carries the map — that is
[#69](https://github.com/jcfischer/seelite/issues/69)'s panel hierarchy — nor
the hyperspace jump itself, which is `galaxy-generation.md` §8, nor the market
and equipment screens, which are #70's station console.

`?galaxy-map` is the workbench this was decided on. It is a chart surface, not a
second game mode: it builds no `Game`, and `src/main.ts` gates it alongside the
other query-gated workbenches.

---

## 1. Where the map lives

**A tab on the left Navigation console.** Not a full-screen mode, not a fifth
panel, not an application.

#70 ratified that there is no second UI grammar: the player is in the cockpit
and a screen answers *which wall or which tab*, never *which application*.
`hud-and-scanner.md` §1 gives the left panel Navigation and Communications, and
§2 sends "system-scale discovery, filtering, and target records" there
explicitly. A galaxy map is one scale up from that and belongs to the same
console, reached by the same head turn.

The consequences are §1's, inherited rather than restated: the game continues
while the panel is open, there is no pause and no time compression, and an
explicit close returns to an unobscured cockpit.

---

## 2. The projection: a freely orbited cluster

The 256 systems are drawn as points in a freely orbitable 3D cluster. One light
year is one world unit, so the cluster is 44 units across and a radius read off
the scene is a radius in light years with no conversion.

- **Drag orbits, wheel zooms.** The camera stays on one axis and the *cluster*
  turns, so the projection is a pure function of two angles and a distance.
- **The vertical axis is galaxy-space `y`, and the reference plane is `y = 0`.**
  Arbitrary — `systemPosition` draws an isotropic direction, so the cluster has
  no intrinsic equator — and stated because it is arbitrary. The plane, the
  drop-lines and the anchor discs must all use the same axis or the depth cue
  means nothing.
- **A circular reference plane, not a square grid.** Three faint rings at
  `R/3`, `2R/3` and `R`. A square grid would imply an extent the cluster does
  not have.

The alternatives are recorded because they were live: a fixed-tilt plan view
with a mast per system (which reuses the compact scanner's depth language most
directly, and thickets in the core), and a scrubbed depth slab (which removes
ambiguity by removing the geography). Free orbit was chosen for being honest to
the sphere §2 of `galaxy-generation.md` actually generates.

### 2.1 Depth cues: drop-lines on the selection only

Two systems 15 LY apart can touch on screen, and parallax needs motion the
player does not always have to spare. So:

- **The current system and the selected system each drop a line to the
  reference plane**, ending in an anchor disc — the compact scanner's mast-and-
  disc language (`hud-and-scanner.md` §2), applied to the one pair whose
  separation the player is actually asking about.
- **Nothing else drops a line.** A full mast field over 256 systems in a
  3:1-concentrated ball is a thicket, and the two systems that matter are the
  two the player has already named.
- Everything else reads depth from size, brightness and the orbit itself.

---

## 3. Reachability: the 7 LY shell

- A **wireframe sphere of radius `JUMP_RANGE_LY`** is drawn around the current
  system. Wireframe rather than a translucent solid: a solid ball 7 LY across,
  inside a 22 LY cluster, tints every system behind it — which is the one thing
  a chart must not do to the points it is about.
- Systems inside it are **lit** (cyan); everything else is **dim**. The
  current system is green and the selection amber, per `hud-and-scanner.md`
  §4's palette.
- The shell gives the 7 LY figure a body the player can judge other distances
  against; the lighting survives when the shell is edge-on.

Expect **≈17 lit at the core, ≈8 at the mean radius, ≈3 at the rim** —
`galaxy-generation.md` §4's table. That gradient is the map's geography, and §6
is about whether anything else should carry it.

---

## 4. Routing: fewest jumps, then shortest

The map plans. Selecting any system computes a chain and shows it; the range
shading is always on, the route appears on selection.

**The objective is fewest jumps, then shortest total distance.** Not shortest
distance: a jump is a wind-up with a vulnerability window
(`galaxy-generation.md` §8) and an arrival 1 AU out that has to be crossed
(§7.4), so an extra hop costs the player far more than the ~2 Cr of fuel
separating two equal-length chains. **Fuel is the tie-break, not the goal.**

Implemented as lexicographic Dijkstra over `(jumps, ly)` in
`src/galaxy-route.ts`, which imports no Three.js. The chart draws what it
returns.

A route is **null** when there is none, and never an empty chain. A
§5-connected layout means this can only fire on a graph the generator did not
produce — but if it ever does, the map must not display a course it cannot
complete.

### 4.1 Fuel is 2 Cr per LY

`jumpCost(7) === 14 Cr`, per `economy-trade.md` §6.1 and Elite's PRXS table.

`src/galaxy.ts` carried `FUEL_COST_PER_LY = 0.2` until this node — Elite's
per-0.1-LY figure with the tenth dropped, the exact transcription error #7
corrected in the specs. The correction's stated check was a repo-wide grep for
`0.2 Cr`, which is a search for *prose* and cannot see a bare literal on a
differently-named constant; `market.ts` had the right number under
`FUEL_CR_PER_LY = 2` and the two disagreed by a factor of ten.

Nothing was mispriced by it, and that claim is about the **constant**, not only
about `jumpCost`: at the time of the change `FUEL_COST_PER_LY` had exactly two
readers in the repo — `jumpCost` on the next line, and the new test — and
`jumpCost` itself had none outside that test. The route panel is the first
consumer either way, and it would have quoted a 22 LY crossing at 2.7 Cr. The
check is `grep -rn FUEL_COST_PER_LY src/ tests/ scripts/`, and it is the check
because a 10× change to an exported constant is only safe to the extent its
importers are known.

`tests/galaxy-route.test.ts` pins **each figure absolutely and then their
agreement**: `FUEL_TANK_LY === 7`, both per-LY constants `=== 0.2 / 0.1`,
`jumpCost(7) === 14`, and the two constants equal to each other. The equality
alone would have been the weaker check it first looked like — it proves the two
match, not that either is right, so an edit moving both in the same direction
passes it, and `jumpCost(7) === 14` leans on a tank size nothing was asserting.
Four assertions, because the failure being guarded against is a transcription,
and a transcription can land in any one of them.

---

## 5. Selection and the record

Clicking a system selects it. An **inline card beside the selected point**
carries name, economy, government, tech level, population, direct distance, the
planned chain, and the generated description — the node's "without leaving the
map" read literally.

**Picking is screen-space, not a raycast.** A `Points` raycast tests a threshold
in world units, so one threshold picks a fat target zoomed in and a tiny one
zoomed out — and the core, at three systems per LY, is exactly where that
matters. The pick radius is **14 px at every zoom**, and that constancy, not the
number, is the property: it is what makes the target the size the player sees.
§9.2 checks it at the boundary rather than at a point's centre, because a centre
click cannot tell the two implementations apart.

**A drag is a camera move, not a selection** — over a 4 px slop, accumulated
rather than measured press-to-release, so a circular drag ending where it
started still counts as a drag. Zero slop was the first implementation, and a
mouse drifting a single pixel then cancelled the click silently.

**Wheel zoom reads `deltaMode`.** A browser reporting lines rather than pixels
sends ≈3 per notch, which would move the camera 0.15 LY across a 12–140 LY
range — and §5.1's whole answer to crowding is that zooming resolves the
cluster. The probe tier is Chromium only, so nothing in the suite would catch
it; the conversion is in the handler instead.

### 5.1 The chart reads; the list finds

**Measured, and it is the cost of choosing a free orbit.** The share of systems
whose nearest on-screen neighbour falls inside the 14 px pick radius, against
camera distance, at 1280 × 760 and the default framing (`DEFAULT_YAW`,
`DEFAULT_PITCH`). Both filters matter: a system behind the camera *or* outside
the viewport is not counted, because a pair the player cannot see is not
crowding.

| camera | crowded | on screen |
|---|---|---|
| 140 LY | 90.2% | 256 |
| 120 LY | 84.0% | 256 |
| 100 LY | 73.4% | 256 |
| 86 LY | 63.7% | 256 |
| 74 LY | 53.5% | 256 |
| **62 LY** (the default; whole cluster) | **40.2%** | 256 |
| 52 LY | 33.6% | 253 |
| 44 LY | 29.0% | 241 |
| 38 LY | 25.1% | 231 |
| 32 LY | 19.7% | 208 |
| 26 LY | 14.5% | 166 |
| 22 LY | 15.5% | 148 |
| 18 LY | 13.3% | 128 |
| 14 LY | 8.8% | 91 |
| 12 LY | 10.7% | 75 |

**There is no distance that both frames the whole cluster and lets you pick.**
Crowding never falls below about 9%, and it only gets there at 14 LY, where 91
of 256 systems are on screen — a third of the galaxy, and the rest off the
edges. Below that it rises again as the framing tightens onto the dense core.
No point-size tuning changes this: it is 256 points in a ball whose core is
three times as dense as its rim, and the metric is a function of the projection
and the pick radius alone.

So the chart is the **reading** surface and Navigation's filterable list is the
**finding** surface — which is what `hud-and-scanner.md` §2 already says
("Navigation is authoritative for target selection and filters"). Selecting a
named system goes through the list; the chart answers *where is it, and what is
between here and there*. **A galaxy map with no list is not a shippable map**,
and #69 owes that list.

The 62 LY figure is **asserted**, not merely recorded: `probe-galaxy-map.mjs`
resets to the default framing and requires it inside a 25–60% band, so a change
to the projection or the pick radius that moves it has to answer for the move.
The rest of the table is a recorded sweep. Two things the band deliberately does
*not* cover, so the claim is not read wider than it is. The metric is blind to
point size. And it is viewport-dependent: a 390 × 844 column frames 194 of the
256 at 62 LY and measures **38.7%**. The probe applies the one band to both
viewports, which is honest only because both measured values sit inside it —
the band is calibrated on the desktop figure and merely *accommodates* the
narrow one, so its discriminating power at 390 px is weaker than at 1280 px.
Tightening it would need a per-viewport calibration nobody has asked for yet.

**An earlier version of this table was wrong, and wrong in the flattering
direction.** It counted every system in front of the camera rather than every
system on screen, which credited the zoomed-in views with a crowding they had
only because their crowded pairs had left the viewport: 10.2% at 26 LY against
the true 14.5%, and 3.3% at 14 LY against 8.8%. The conclusion survived; the
margin it rested on did not.

## 6. The density gradient

The 3:1 core/rim ratio is carried by **point count alone** in the shipped map.

A core haze — a generated radial sprite falling off on the density profile's own
`1/(1 + (r/r_c)²)`, zeroed past the rim — is built and toggleable on the
workbench (`H`, or the `core haze` button) so the comparison can be made by
looking rather than argued. It is **off by default**, and the argument against
shipping it on is §5.1's: the view is already 40% crowded at its default
framing, and adding a luminous wash over the densest part of it is subtracting
from the one thing the chart does well.

Whatever a later pass decides, the haze must remain a **background channel**:
turning it on may not move a single projected system. `probe-galaxy-map.mjs`
asserts exactly that.

---

## 7. Galaxies: this one only

The map draws the current galaxy. The other seven are not shown, not greyed, not
indexed.

#6 ratified that galaxies are a **namespace, not geography** — all 8 exist from
the start and switching changes one index. Drawing them on a chart whose whole
subject is 3D distance would imply a spatial relationship they do not have, and
a reachability the 7 LY tank does not have either. The Galactic Hyperdrive is a
Drive-console action (`hud-and-scanner.md` §1's right panel), not a map feature.

---

## 8. The course

Committing to a destination sets a **course**, and a course **persists**.

### 8.1 A destination, never a chain

```ts
interface Course { version: number; galaxy: number; destinationIndex: number }
```

Two reasons, and the second is the one that would have bitten:

- `persistent-world-state.md` §8 says map presentation is a projection of
  generated facts and is not persisted merely because it is derivable. A chain
  is exactly that: `planRoute` recovers it from the world seed, the galaxy
  index, and where the ship is.
- **A saved chain goes wrong the first time the player jumps off it.** It
  describes a position the ship has left. A saved *destination* is still true
  from wherever the ship ends up, so an off-plan jump is a re-plan rather than
  a desync.

`courseProgress(systems, course, current)` therefore takes the ship's *current*
system and re-derives, rather than advancing a cursor into a stored list.

### 8.2 Persistence

The course is per-galaxy typed state in `persistent-world-state.md` §7's
envelope, under the player-knowledge axis: it is player intent, not world
condition.

- `COURSE_SCHEMA_VERSION` is bumped when the shape changes (§2's version
  discipline).
- **Absence is valid** — no course is not a corrupt course, and parses to
  `null`.
- **Anything else that fails to parse throws.** §7 requires a truncated or
  partially written snapshot to fail loudly rather than be reinterpreted as an
  untouched healthy value, and silently dropping an unreadable course is that
  reinterpretation.
- **An embedded `galaxy` that disagrees with its containing envelope throws.**
  §7 makes the match mandatory: it is a corrupted save, not a course in another
  galaxy.

`serialiseCourse` and `parseCourse` live in `galaxy-route.ts` for now, and that
is a temporary address rather than the right one: they implement §7's envelope
rules, and §7 belongs to #46. **When #46 lands, the envelope-matching parse moves
into the persistence module** and `galaxy-route.ts` keeps `Course` and
`courseProgress`. Leaving it here after that would author one spec's rules in two
files.

Wiring it into an actual save file belongs to
[#46](https://github.com/jcfischer/seelite/issues/46).

### 8.3 What the HUD owes it

The next hop and the jumps remaining belong on the flight floor or the
Navigation console — a course the player cannot see from the cockpit is a course
they will forget they set. #69 owns the placement.

---

## 9. Verification

Split on the repo's usual line: arithmetic headless, anything spatial in the
browser.

`src/galaxy-route.ts` memoises one jump graph per `(systems array, galaxy,
range)` — the neighbour lists and their distances — because a caller planning to
each of 256 systems in turn otherwise rebuilds the same 65,536-pair scan 256
times. It changes when the work happens, never what is returned.

### 9.1 Headless — `tests/galaxy-route.test.ts`

1. **The fuel price agrees across modules** — `jumpCost(7) === 14`, and
   `FUEL_COST_PER_LY === FUEL_CR_PER_LY` (§4.1).
2. **Reachability is the true 3D distance** — a system at `7 − 0.001` LY is
   lit, one at `7 + 0.001` is not, and a point 5 LY out in two axes at once
   (7.07 LY) is not, which is the assertion a build that dropped an axis fails.
3. **The objective is the one §4 names.** Two hand-built graphs where greedy and
   optimal *disagree*. In the first, the origin's nearest neighbour (6.08 LY) is
   a **dead end** — 8.41 LY on to anywhere — so a nearest-first walk strands
   itself while the two-jump answer takes the longer 6.90 LY first step. In the
   second, two chains of two jumps are **both legal** (13.90 LY and 12.00 LY)
   and the tie-break decides. A route planner over the real generator passes on
   almost any plausible implementation — with ~8 systems in range at every step
   a greedy walk arrives too — so the synthetic graphs are the only shape in
   which this suite could fail on a wrong objective.

   Both fixtures were wrong when first written, and the tie-break one was wrong
   in the way that matters: its "alternative" chain had a **10.82 LY** second
   leg, past the jump range, so only one two-jump route existed and the test
   passed on exactly the build it claimed to exclude. Measured after the fix, it
   fails on a planner with no distance ordering at all and *passes* on one that
   drops the tie-break from the relaxation but keeps it in the selection order —
   item 4 is what catches that half-removed case.
4. **Agreement with brute force.** 60 twelve-system clouds in a 14 LY cube,
   every simple path enumerated and ranked as §4 ranks them. The cloud was
   sized by measurement, not guess: 9 systems in a 26 LY cube connected 4 trials
   in 40, and the assertion floor on how many trials actually *compared*
   anything is what caught it. At least 30 of the 60 must connect.
5. **Every hop of every route from one origin to all 256 destinations is inside
   the jump range**, and the chain ends where it was asked to.
6. **A connected layout means no pair is unroutable** — §5 of
   `galaxy-generation.md` guarantees it, and a map that reported otherwise
   would be a worse failure than a suboptimal chain.
7. **Cross-galaxy pairs do not route and do not light** (§7).
8. **A course re-derives from an off-plan jump** and keeps its destination.
9. **Course parsing** round-trips, accepts absence, and throws on a version
   mismatch, a bad index, a non-object, and an envelope disagreement.

### 9.2 Browser — `scripts/probe-galaxy-map.mjs`

At desktop (1280 × 760) and narrow (390 × 844):

1. The chart mounts with no `Game` behind it, 256 systems, and the constants
   read off the page rather than restated.
2. **The pick radius is 14 px at 62 LY and at 18 LY.** Four verdicts: a click
   at 0.8 × the radius from an isolated system's centre selects it, and one at
   1.6 × selects nothing, at both camera distances. **The boundary is the check
   and the centre is not.** The first version clicked dead centre and asserted
   the right system came back, which a world-space raycast passes trivially —
   ray-to-point distance at the centre is ≈ 0 whatever the camera is doing — so
   it verified nothing about the claim in its own comment. A world-unit
   threshold cannot put the same pixel boundary at two zooms; one of the four
   verdicts comes out wrong.
3. The drop-line count is 1 unselected and 2 selected (§2.1), **read off the
   geometry's draw range** rather than restated from the selection — as
   `selected === null ? 1 : 2` the check was asserting the same field twice and
   could only fail on itself.
4. The record card is visible, carries the selected system's name and economy,
   and lands **inside the viewport**. The 390 px column is the case that pushes
   a 260 px card off the edge, and an off-screen record is the same as no
   record.
5. **Crowding at the default framing is inside a 25–60% band, and falls when the
   camera closes** (§5.1). Three separate faults were caught here and each is
   now a guard: the two samples must come from *different* camera distances,
   because the first version sampled before the frame loop had moved the camera
   and reported one camera measured twice; the sample must exclude systems
   outside the viewport, not only those behind the camera; and the view is reset
   to the named default framing, because crowding depends on the orientation as
   well as the distance and a figure quoted from an unnamed view is not
   reproducible.
6. **The haze does not move a projected system** (§6).
7. **A set course re-derives from where the ship actually is.** After an
   off-plan jump the remainder must equal a route planned from the ship's real
   position **and must differ from the plan-relative decrement a stored cursor
   would give**. Without that second half — which is how it was first written —
   a build that saved the chain and advanced an index passes.

   The off-plan system is **chosen to discriminate**, not taken as the first lit
   neighbour off the chain: some of those lie on an equally optimal alternate
   route, where a correct build's re-plan happens to equal the cursor's answer
   and the check goes false-red. The probe asks each candidate what a re-plan
   from it would cost and takes the first a cursor could not have produced; if
   there is none, it **fails** rather than falling back to an arbitrary jump,
   because a green that could not have gone red is the failure this whole probe
   exists to avoid.

## 10. Deferred

- **The Navigation list** — filterable, named, with type/range/ETA. §5.1 makes
  it mandatory rather than optional; #69 owns it.
- **Mounting the chart in the cockpit panel** — #69.
- **Last-known station information on the map.**
  `persistent-world-state.md` §3.1 requires the map to present carrier state as
  timestamped "last known" rather than live omniscience. The system record in §5
  is seed-derived and always knowable; the *stations inside* a system are
  carriers and are not. Nothing in this spec displays them yet, and whatever
  does inherits §3.1.
- **Whether the core haze ships.** §6 leaves it off and built.
- **Route safety, traffic, and legal status on the chart** — derived
  projections (§8 of `persistent-world-state.md`), and none of them decided.

# Spec: the galaxy map

**Status:** ratified design decision — [#11](https://github.com/jcfischer/seelite/issues/11)
**Date:** 2026-08-27
**Context:** [#6](https://github.com/jcfischer/seelite/issues/6) settled a
globular volume — re-opened and reversed by
[#107](https://github.com/jcfischer/seelite/issues/107) to a `q = 0.70` disc,
built in [#118](https://github.com/jcfischer/seelite/issues/118) —
[#70](https://github.com/jcfischer/seelite/issues/70) settled
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

`?galaxy-map` is the workbench this was decided on, and it remains one. It is a
chart surface, not a second game mode: it builds no `Game`, and `src/main.ts`
gates it alongside the other query-gated workbenches.

---

## 1. Where the map lives

**A tab on the left Navigation console.** Not a full-screen mode, not a fifth
panel, not an application. Built in
[#96](https://github.com/jcfischer/seelite/issues/96): `mountGalaxyChart` takes
a host element and returns a `dispose`, the tab mounts it on entry and disposes
it on exit, and `?galaxy-map` is a second mount of the same function rather than
a second implementation. The workbench binds `h` and `Escape` on `window`; the
tab does not, because flight controls are live while the panel is open and both
handlers would see the same key the day the game binds either. The haze and
clear controls are on-screen buttons, so the tab loses nothing.

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
- **The vertical axis is galaxy-space `y`, and the reference plane is `y = 0`
  — the disc's own plane.** `systemPosition` flattens the cluster on `y` by
  `q = 0.70` (`galaxy-generation.md` §2), so the cluster has an intrinsic
  equator and this plane is it. The plane, the drop-lines and the anchor discs
  are therefore **geography**: a system above the plane is genuinely above the
  galaxy, and a drop-line measures a real displacement rather than a distance
  from a line somebody picked. The plane, the drop-lines and the anchor discs
  must all use this same axis or the depth cue means nothing.

  This is a reversal. The cluster was a sphere until #107, and this bullet said
  the choice of `y = 0` was arbitrary *because* the direction draw is isotropic
  and the cluster has no equator. That sentence is now false, and the fact that
  it stopped being true is one of the two reasons the disc was taken at all.
- **A circular reference plane, not a square grid.** Three faint rings at
  `R/3`, `2R/3` and `R`. A square grid would imply an extent the cluster does
  not have.

The alternatives are recorded because they were live: a fixed-tilt plan view
with a mast per system (which reuses the compact scanner's depth language most
directly, and thickets in the core), and a scrubbed depth slab (which removes
ambiguity by removing the geography). Free orbit was chosen for being honest to
the shape §2 of `galaxy-generation.md` actually generates — a sphere when that
choice was made, a `q = 0.70` disc since #118. It survives the reshape: a disc
has *less* depth ambiguity than a ball, not none, and the orbit is how the
player resolves what remains.

### 2.1 Depth cues: drop-lines on the selection only

Two systems 15 LY apart can touch on screen, and parallax needs motion the
player does not always have to spare. So:

- **The current system and the selected system each drop a line to the
  reference plane**, ending in an anchor disc — the compact scanner's mast-and-
  disc language (`hud-and-scanner.md` §2), applied to the one pair whose
  separation the player is actually asking about.
- **Nothing else drops a line.** A full mast field over 256 systems in a
  3:1-concentrated disc is a thicket, and the two systems that matter are the
  two the player has already named.
- Everything else reads depth from size, brightness and the orbit itself.

---

## 3. Reachability: the 7 LY shell

- A **wireframe sphere of radius `JUMP_RANGE_LY`** is drawn around the current
  system. Wireframe rather than a translucent solid: a solid ball 7 LY across,
  inside a 24.5 LY cluster, tints every system behind it — which is the one thing
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

Nothing appears to have been mispriced by it, and the claim is about the
**constant**, not only about `jumpCost`: at the time of the change
`FUEL_COST_PER_LY` had exactly two readers — `jumpCost` on the next line, and
the new test — and `jumpCost` itself had none outside that test. The route panel
is the first consumer either way, and it would have quoted a 22 LY crossing at
2.7 Cr.

**Say how far that was checked, because the method has a known hole and this
document is the reason it is known.** Three greps: `FUEL_COST_PER_LY` by name,
`FUEL_CR_PER_LY` by name (both readers are accounted for; both constants are
now 2), and a value grep for bare `0.2` across `src/`, whose every hit is
geometry, audio or a material roughness. What none of them can see is a fuel
price re-derived at runtime or carried under a third name — which is exactly
how the original bug survived a grep for `0.2 Cr`. The honest form of the claim
is *no third copy was found by three searches of two kinds*, not *no third copy
exists.*

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

**The record does not depend on a route.** It is seed-derived and always
knowable, so only the chain line is conditional: an unroutable selection reads
"no route within range" and keeps the rest. Gating the whole card on a route was
the first implementation, and it made such a click look dead — a colour change
and nothing else.

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

**Re-measured for the `q = 0.70` disc under #118.** Every figure below described
the ball and none of them survived the reshape; the table is the disc's, taken
by the same method at the same framings.

| camera | crowded | on screen |
|---|---|---|
| 140 LY | 87.9% | 256 |
| 120 LY | 83.2% | 256 |
| 100 LY | 74.6% | 256 |
| 86 LY | 66.4% | 256 |
| 74 LY | 56.6% | 256 |
| **62 LY** (the default; whole cluster) | **44.5%** | 256 |
| 52 LY | 32.8% | 253 |
| 44 LY | 23.9% | 247 |
| 38 LY | 23.1% | 238 |
| 32 LY | 16.3% | 209 |
| 26 LY | 14.0% | 172 |
| 22 LY | 15.8% | 152 |
| 18 LY | 7.6% | 118 |
| 14 LY | 2.2% | 89 |
| 12 LY | 5.2% | 77 |

**There is no distance that both frames the whole cluster and lets you pick.**
That is the finding, and it survives the reshape: at 62 LY, where all 256 are on
screen, 44.5% of them cannot be told apart, and crowding only reaches single
digits at 18 LY, where 118 of 256 are visible — under half the galaxy, and the
rest off the edges. No point-size tuning changes it: it is 256 points in a disc
whose core is three times as dense as its rim, and the metric is a function of
the projection and the pick radius alone.

**One sub-claim did not survive, and is corrected rather than quietly dropped.**
The ball's table supported "crowding never falls below about 9%". The disc's
reaches **2.2% at 14 LY** — a zoomed-in disc genuinely does resolve, where a
zoomed-in ball still had systems stacked along the view axis. The conclusion is
unchanged because it never rested on that floor; it rests on there being no
framing that does both jobs.

**The default framing got worse, which is the cost #107 priced.** 40.2% on the
ball against 44.5% on the disc, at the same camera and the same viewport.
Flattening concentrates the points toward a plane, and a plane's
nearest-neighbour distances are shorter than a ball's at equal projected extent.
The disc was taken knowing this (`galaxy-generation.md` §2).

**40.2% and 44.5% are one galaxy, not the galaxy.** #107's finding, and this
section used to read as though the figure were a constant. Measured over all
eight galaxies at 1280 × 760 and the default framing, the disc spans
**39.8%–48.0%** (galaxy 0 is the 44.5% above); the ball spanned 37.9%–50.8%.
`probe-galaxy-map.mjs` therefore bands from the spread and not from the sample:
36–52% at 1280 × 760, and 29–55% at 390 × 844, where the eight-galaxy spread is
33.5%–50.5%. A band set from one galaxy is not a tighter band, it is an untested
one — the narrow band of 29–49% that preceded this was already outside its own
subject at galaxy 4.

**And it is worse in the cockpit than on the workbench.** The table above was
measured on `?galaxy-map`, a whole 1280 x 760 page. The shipped tab draws into a
grid cell inside the console — 1011 x 462 at that same viewport — and crowding
is a **pixel** property: the same 256 points packed into fewer pixels against an
unchanged `PICK_RADIUS_PX`. Measured there over all eight galaxies at the
default framing: **68.4%–77.7%**, against the full page's 39.8%–48.0%, with the
whole cluster still on screen. (It was 68.8% on the ball.) Sharing
`mountGalaxyChart` does not carry the figure across, so
`probe-navigation-console.mjs` measures it at the shipped framing by the same
method and bands it at **64–82%**, from that spread — narrower than the 55–80%
it replaces, which is what re-measuring rather than widening looks like when the
measurement improves. The band is calibrated on a 1280 x 760 window and a narrow
viewport would need its own; the check also asserts that all 256 are on screen,
because the fraction is taken over what is visible and a build framing fewer
systems would be a different measurement wearing the same name.

So the chart is the **reading** surface and Navigation's filterable list is the
**finding** surface — which is what `hud-and-scanner.md` §2 already says
("Navigation is authoritative for target selection and filters"). Selecting a
named system goes through the list; the chart answers *where is it, and what is
between here and there*. **A galaxy map with no list is not a shippable map**,
and #91 built it: `projectNavTargets` in `src/cockpit.ts`, rendered by the
Navigation tab with type, range and ETA per row and narrowed by a kind chip and
a name query.

The 62 LY figure is **asserted**, not merely recorded: `probe-galaxy-map.mjs`
resets to the default framing and requires it inside the per-viewport band
above, so a change to the projection or the pick radius that moves it has to
answer for the move.

**That band does not police the shape**, and is not asked to — a ball and a disc
both sit inside a 16-point window. The disc is asserted directly, by the same
probe: it drives the chart to edge-on and to face-on and measures the projected
bounding box, requiring an aspect near `q` edge-on and near 1 face-on. A ball is
square at every angle and fails both halves, and so does a build that squashes
the mesh instead of the generator. The check is skipped where the cluster does
not fit the viewport — a 390 px column crops it at every distance the chart
offers, so the span there is the phone's and not the galaxy's — and a
skipped-everywhere run fails on its own count.
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

`destinationIndex` is a `SystemRecord.index`, **not an array position**.
`generateGalaxy` returns systems in index order and
`tests/galaxy-route.test.ts` pins that, but `parseCourse` validates a loaded
index against the *range* rather than against a slot, so the map looks courses
up by field. A positional read there is a `.name` of `undefined` waiting for a
generator change.

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

1. The chart mounts with no `Game` behind it, draws 256 systems, and reports
   `galaxyRadiusLy === 22` and `jumpRangeLy === 7`. Those two **are** restated
   literals, deliberately and against the repo's usual rule: they are the spec's
   own figures, so a build that changed them should fail this rather than have
   the probe follow it. Everything else the probe compares — the pick radius,
   the viewport box, the route — it reads off the page.
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

### 9.3 Browser — `scripts/probe-navigation-console.mjs`

The chart's *mount* rather than its projection, and the list beside it.

1. **The rendered list is exactly the set the game holds as selectable.**
   Compared against `Game.selectableIds()` and not against a rule the probe
   restates — two earlier versions restated it, first as a `kind !== "moon"`
   denylist and then as the kinds read off the panel's own filter chips, the
   second being worse because both sides of the comparison then derive from the
   projection.

   **What it does not check.** `navRows()` passes `selectable()` into the
   projection, so the rows are a filtered image of that list by construction and
   a divergence between the two cannot arise here. This catches the render and
   filter path — a row dropped, duplicated, or drawn for a body the game does
   not hold. What binds a row to *selection* is item 2's click, which moves
   `targetBody()`. An earlier version of this paragraph sold the first check as
   guarding the second's failure.

   Rows are ordered by the ranges the simulation holds for those same ids —
   read from `world.system.byId`, not from the row text, because a list that
   sorted its own output and then reported that output as sorted passes on a
   build with no sort at all. Clicking a row the game is **not** already on
   moves `targetBody()`; the row that boot already selected would pass on a
   build whose rows do nothing.
2. **Both narrowings narrow, in both directions.** The name query's survivors
   are compared against the exact set the unfiltered list yields under the
   projection's own substring rule — no more and no fewer. "Matches the
   fragment, and the list got shorter" is not enough: on a seed where one row
   matches, a build that over-narrowed to a single arbitrary row satisfies both
   halves and reads as a working filter. Proved against a build that
   over-narrowed and one that leaked an extra row.

   The rule is `includes`, not `startsWith`, because `navFilterMatches` matches
   anywhere in the id and a probe asserting a prefix goes red on a correctly
   listed mid-string match. That a distinguishing fragment was found is itself a
   check, so a seed where none exists goes **red** rather than exiting green
   having tested nothing, and the failure carries the page URL and the row ids.

   The kind chip is checked against a list strictly shorter than the unfiltered
   one, and a query matching nothing renders an empty state rather than falling
   back to everything.
3. **The chart is built for the ship's galaxy and system.** The galaxy half
   discriminates — a chart built for galaxy 3 while the ship flies in galaxy 0
   fails. The system half does **not** yet: dropping `currentIndex` at the mount
   site falls back to `startSystem(galaxy)`, which is where the game also
   begins, so the defect and the fix agree and the probe stays green. Built and
   run rather than assumed. It becomes discriminating when the ship can be
   somewhere else, which is `galaxy-generation.md` §8's jump.

4. **The chart stays inside the panel.** Measured on the **canvas**, not on the
   host element: the host is a grid cell the console laid out, so its box is
   inside the panel by construction and asserting on it is asserting the
   panel's own layout. Written that way first, and it passed against a chart
   restored to the workbench's `position: fixed` — which is #70's second UI
   grammar, the thing §1 rules out. On the canvas the same build reads
   `0,0,1280,760` against a panel of `102,53,1178,669`.
5. **The tab takes the chart down.** After leaving, `__seeliteGalaxyMap` is
   null and no canvas remains in the panel — a mount without a matching dispose
   leaves a second WebGL context and a 60 Hz loop behind the flight view for
   every visit to the map.
6. **The simulation keeps running while the chart is open** — §1's no-pause
   rule, asserted as two samples of `frames` compared, the first taken **after**
   the chart is up. Wrong twice before that. As a `waitForFunction` followed by
   `check(..., true)` it reported a pass the tally never evaluated and threw
   rather than failing when the wait expired; baselined before the click it was
   satisfied by the frames rendered while the chunk loaded, so a chart that
   froze the loop on mount still passed.

**Every check here was built a red build to run against**, one at a time:
the sort removed; the chart root back to `position: fixed`; a kind dropped
from what `navRows` is handed; `onSelectTarget` made a no-op; the query ignored, over-narrowed, and
leaked an extra row; the kind chip ignored; `currentIndex` dropped and the galaxy forced to
3; `dispose` skipped; the frame loop cancelled on mount; `PICK_RADIUS_PX` cut
to 2 and the default framing zoomed to 20 LY. Each turned the check named
above it red — except the system half of item 3, which is recorded there as
not yet discriminating rather than counted as covered.

## 10. Deferred

- **Last-known station information on the map.**
  `persistent-world-state.md` §3.1 requires the map to present carrier state as
  timestamped "last known" rather than live omniscience. The system record in §5
  is seed-derived and always knowable; the *stations inside* a system are
  carriers and are not. Nothing in this spec displays them yet, and whatever
  does inherits §3.1.
- **Whether the core haze ships.** §6 leaves it off and built.
- **Route safety, traffic, and legal status on the chart** — derived
  projections (§8 of `persistent-world-state.md`), and none of them decided.

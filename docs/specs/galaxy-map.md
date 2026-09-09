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
by the same method at the same camera distances and viewport. It is **not** at
the ball table's pitch — `DEFAULT_PITCH` moved 0.35 → 0.70 rad in the same
change, and this table is quoted at the default framing, which means the new
one. See the note under it before comparing a row against a remembered figure.

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
screen, 44.5% of them cannot be told apart, and crowding first reaches single
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

**The default framing got worse, which is the cost #107 priced — and the two
figures are not a matched comparison.** 40.2% on the ball against 44.5% on the
disc, at the same camera and the same viewport but **not the same pitch**:
`DEFAULT_PITCH` moved 0.35 → 0.70 rad in the same change, and tilting toward
face-on is worth about 3 points to a disc (§2's grid). So 4.3 points is what a
player actually experiences between the old default view and the new one, and it
is the *net* of two effects pulling opposite ways.

The shape's own cost, at matched framing, is larger: `galaxy-generation.md` §2's
q × pitch grid puts the ball at 41.3% and the disc at 49.6% at 40°, and at 41.9%
against 52.6% at 20° — about **8 points either way**, with the new default pitch
handing roughly 3 of them back. Flattening concentrates the points toward a
plane, and a plane's nearest-neighbour distances are shorter than a ball's at
equal projected extent. The disc was taken knowing this.

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

So the chart is the **reading** surface and a filterable list is the
**finding** surface, which is what `hud-and-scanner.md` §2 already says
("Navigation is authoritative for target selection and filters"). Selecting a
named system goes through a list; the chart answers *where is it, and what is
between here and there*. **A galaxy map with no list is not a shippable map.**

**Which list was settled later, and it is not the Navigation one.** #86 found
that Navigation's list is system-scale — a different corpus, different columns,
a different sort — and put the galaxy-scale finder inside the Galaxy Map tab
instead. §5.2 is that surface; the paragraph below is #91's system-scale list,
which is what §2's sentence was written about.

#91 built that one: `projectNavTargets` in `src/cockpit.ts`, rendered by the
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
the wrong axis. It reaches the generator's squash and the pivot transform, and
**not** a squash baked into the point cloud's geometry buffer — that would move
pixels without moving a `pos`. The band is taken against a literal rather than
against the chart's reported `flatteningQ`, since a target read off the value
under test follows a change instead of catching it; the reported value is
asserted equal to the literal in its own check. Reaching each framing is also its
own check, so failing to orbit to edge-on cannot print as a wrong shape. The
aspect is skipped where the cluster does not fit the chart — a 390 px column
crops it at every distance on offer, so the span there is the phone's and not the
galaxy's — and a skipped-everywhere run fails on its own count.
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

### 5.2 The finder: a search-and-list panel in the same tab

Ratified in #86 and built in #115. §5.1 says the chart reads and something else
finds; this is that something, and it lives **inside the Galaxy Map tab** rather
than on a tab of its own.

**Not a fourth tab, and not a scale switch on Navigation.** The finder's corpus
*is* the chart's corpus, so putting both in one tab makes them one instrument
and answers "does a row move the chart" by construction. Navigation's list is
system-scale — bodies in the current system, ranges in kilometres, ETAs in
seconds — and one tab holding two corpora and two column sets is the shape #86
was raised to refuse.

**Collapsed by default; the collapsed form is a visible search field.** Not a
drawer behind a chevron: a load-bearing surface behind a control is one a player
may never find, and default-closed is only defensible with the field on the tab.
**Any active narrowing expands the results** — a typed query, an economy chip,
or a changed jump budget — and clearing every narrowing collapses it again. The
rule reads all three controls and not the query alone, because an expand keyed
to the text field leaves the chips dead until something is typed.

**Filters: substring on name, economy chips, a jump budget. Sort: fewest jumps,
then shortest** — `planRoute`'s own objective rather than a second one invented
for the list. Government and tech level are in the row and are not filterable;
population and description stay on the record card. The split is *finding*
versus *reading*: economy is the trader's axis and jumps are the tank's
constraint. The controls are the grammar the console already has — chips plus a
substring query, as `navFilterMatches` implements it — because one set of
controls across both lists is what stops two lists under one console reading as
two applications.

**The budget's ceiling is the galaxy's jump diameter, measured.** It was 9, on
the reasoning that a budget past the diameter admits everything — and nobody had
measured the diameter. Over five world seeds, eight galaxies each, from **every**
system as origin, the worst shortest chain is **15 jumps** (14 at the shipped
seed). At 9, real pairs sat permanently in the dimmed "beyond range" group with
no control position that could promote them, which is *filtered-out reads as
absent* — the failure the group exists to prevent. The ceiling is 16, and
§9.1a re-measures the shipped seed's eight galaxies from every origin so a
generator change that widens the galaxy goes red rather than stranding systems.

**The budget defaults to 1 jump**, which is the shell the chart already lights
(§3), so list and chart agree on first open and no unreachable system is ever in
the primary list. The widened value persists for the **session** and is not
saved: `persistent-world-state.md` §8 forbids persisting a derivable projection,
and a filter setting is presentation.

**A remembered budget therefore opens the panel.** D4 expands on any active
narrowing and D6 keeps the widened budget, so the first entry to the tab after a
widening arrives expanded — "collapsed by default" is true of a session that has
not touched the budget, and this is the case it does not cover. It follows from
the two decisions rather than working around them, and it is what a trader who
set the budget once would want. The sharp edge is the narrow console, where
expanded means *covering*: the chart arrives hidden until the budget is stepped
back. Named here rather than left for a player to discover.

**It therefore lives outside the mount, and only a remount can show that.** The
chart is disposed every time the player leaves the Galaxy Map tab
(`Game.setChartHost`), so a budget held in `mountGalaxyChart`'s closure reads as
persistent in every single-mount check and resets the moment anyone uses the
map. It was built that way first. §9.3 item 12 leaves the tab and comes back,
and asserts the **query and the chips do not** survive with it — D6 widens the
budget alone, and a check watching only the budget passes a build that persisted
the whole filter.

**A name lookup never returns a blank list.** Most of 256 systems are more than
one jump away, so a name query under the default budget would usually return
nothing — and an empty list reads as *no such system*, not as *filtered out*.
Out-of-budget **name matches** therefore show dimmed, in a "beyond range" group
below the in-budget results, each with its jump count. A chip-only narrowing
populates no such group: that is a browse rather than a lookup, and the whole
galaxy printed twice under one chip click is the failure this rule exists to
avoid wearing the costume of the fix for it.

**A row selects and nothing else.** No camera move — the drop-line and the
record card of §4 and §5 are already the "where is it" answer, and a row that
flew the camera would destroy what the player was looking at on every row they
tried. A **per-row centre control** moves the centre of rotation onto a system
and changes nothing else, because the row click already selected. **No per-row
course commit**: the chart's `set course` button stays the single owner (§8).

**The jump projection is one traversal, not 256 routes.** `projectJumps`
(`galaxy-route.ts`) runs the same lexicographic Dijkstra `planRoute` runs, from
the ship's system, with no early stop — one relaxation over the cached adjacency
labels the whole pool. The two share `relaxFrom` rather than holding two copies
of the objective; §9.1a asserts the labels equal `planRoute`'s counts anyway,
because what the two still do differently is where they stop and how they derive
the number.

**Opening it narrows the chart's cell, and that does not move the crowding
figure.** The panel takes a 268 px column, so the shipped 1011 x 462 cell
becomes 743 x 462. §5.1's 64–82% band was measured on the closed cell and could
not be assumed to carry — crowding is a pixel property, and #96 is the recorded
case of the same figure changing under a different box. Measured instead: the
live console reads **73.0% at both cells**, and `measure-galaxy-shape.ts
shipped` prints the same eight-galaxy spread to the digit for the two. The
reason is that the chart holds its vertical field of view and widens `aspect`
with the box, so a system lands at `worldX · height / (2 · z · tan) + width / 2`
— the **spacing** between two systems does not depend on the width, and only the
origin moves, by half the column the panel took. A narrower cell crops rather
than compressing. This stops holding the moment the cluster no longer fits, so
both checks assert all 256 are still on screen — the crop check asked only for
200 when that sentence was first written, a precondition borrowed from its
neighbour rather than held.

**Both figures are scoped to the population the probe reaches**, seed 42 and
galaxy 0. `measure-galaxy-shape.ts` sweeps three world seeds and reports a
higher band (75.0%-86.7%) than §5.1's probe-derived 64-82%; that gap predates
this node and is unchanged by it. What the instrument is used for here is the
**equality of the two cells' spreads** — a comparison inside one population —
which is what licenses reusing the closed cell's band for the open one.

**Closed, the panel floats over the chart's top-right corner, and nothing
§5.1 counts is under it.** D3 preserved the *cell*, which is what the crowding
band is a figure about — but a system drawn beneath an interactive control
cannot be clicked, so if any were, the band would be counting unpickable points
as pickable. Measured at the default framing: **none are**, because the cluster
does not reach that corner. That is a fact about the framing rather than about
the layout — zoom in and the cluster spreads until seven of the 152 then on
screen sit under the panel — so §9.3 item 7 asserts both, and a later control
that grew into the cluster at the default view goes red there rather than
quietly changing what §5.1's figure means.

**The drawn list is capped at 60 rows per group, and the cap says so.** A
one-character query at a wide budget matches most of a 256-system galaxy, and
every row is five elements, so an uncapped rebuild made a keystroke create about
a thousand nodes for a scroll box that shows fifteen. The cap is on the
**drawing** and never on the projection — the results carry every matching row —
and the panel prints `+N MORE`, because a list that stopped at sixty in silence
would read exactly like a galaxy with sixty matches in it.

**Opened on a narrow console, the panel covers the chart rather than taking a
column.** The column layout was written against the desktop cell, where 1011 px
less the panel is 743 and still a chart. At the 390 px the console's media query
drops to it leaves a **76 px strip** — measured, not estimated — which is the
chart ruined and the finder cramped at once. Below `FINDER_MIN_CHART_PX` (360,
set from the two cells that exist: it must admit 743 and refuse 76 — the *cell* at that viewport is 344, not
390, so the strip is 76 and not the 122 an arithmetic on the page width gives)
the expanded
panel covers the stage instead — **opaque there, unlike the floating and column
forms**, because at the translucency that reads well over a corner of the chart
the legend and the haze and course buttons come straight through the rows. Seen
by eye on a 390 px capture; no check in either tier could have failed on it,
which is the third tier's whole point. The canvas box is unchanged, so §5.1's
figure is untouched there, and the trade is that on a narrow console you read or
you find, one at a time. §9.3 items 14 and 15 measure it at the viewport it is about, including the
live resize across the threshold.

**Three modules, one per tier.** `galaxy-finder.ts` is the arithmetic and the
session budget, with no DOM; `galaxy-finder-panel.ts` is the panel, with no
Three.js and four callbacks to the chart; `galaxy-map.ts` mounts it and keeps
the selection, which stays the chart's — a row click goes through the same
`select` a click on the canvas does, so there is one selection rather than two
that have to agree.

**#86 deliberately left stations out of this filter.** They are carriers, and
`persistent-world-state.md` §3.1 requires them to read as timestamped "last
known" rather than live omniscience. #116 resolves that deferred boundary in
the subsection below.

#### 5.2.1 Facilities knowledge boundary

Ratified on #116. Generated public infrastructure is universal
galaxy knowledge: an unvisited system may show its station count, station roles,
and permanent facilities implied by those roles. This is immutable baseline
information, not a player-knowledge row.

A refinery's black-market flag remains learned by visiting, as
`station-types.md` §5.2 requires. Mutable carrier condition, prices, stock, and
other current facts are intelligence: they appear only when learned through an
approved information channel and carry `persistent-world-state.md` §3.1's
timestamped last-known semantics. Their absence must never be filled from live
objective state.

Facility filters match known structural presence, not current availability. A
system therefore continues to match a Shipyard filter when that shipyard's
last-known condition is disabled or destroyed. The condition is a separate
annotation on the result; it never silently removes the result. V1 has no
"available now" facility filter, because last-known intelligence cannot make
that promise.

Mutable condition reads as a compact condition-plus-age annotation in the
finder row: for example `OPERATIONAL · SEEN 2H AGO` or
`DESTROYED · SEEN 3D AGO`. A carrier never observed reads `STATUS UNKNOWN`.
The selected-system card exposes the exact observation time and report source.
The result row remains visually active; greying the whole row would confuse
stale intelligence with an unavailable facility or a disabled control.

Entering a system receives a public System relay report and refreshes the
operational condition of every station in that system. Docking refreshes the
docked station again and reveals its private facts, including black-market
presence. Opening the Galaxy Map is never an information channel, and v1 adds
no separate long-range scan for this purpose. The starting system receives the
same public report when the initial world is established, so its knowledge does
not depend on having completed a jump first.

Facility chips extend the existing finder controls. Finder rows carry the
compact facility and last-known annotations; selecting one fills the existing
system record card with the complete station roster, exact observation times,
and report sources. The chart's points remain a geographic surface: facility
filters add no point glyphs or colours and do not remove points from the chart.
This preserves §5.1's division: the list finds and the chart shows where.

A filter over a private fact is explicitly knowledge-scoped. The black-market
control is labelled `KNOWN FENCE`; its result area contains known positive
matches and a compact count of systems inside the current name, economy, and
jump narrowing whose private fact remains unchecked. It does not print the
unknown systems as a second galaxy-sized list. Zero matches therefore means
"no known fence", never "no fence exists".

The facility chip set is exactly `REFINERY`, `SHIPYARD`, and `KNOWN FENCE`.
There is no `TRADE` chip because every generated system has a trade station and
the control would narrow nothing. The public chips use the canonical station
roles rather than proxy labels such as `MINING` or `HULLS`; exclusive equipment
remains detail in the selected system's station roster.

Active facility chips combine with `AND` at system level: `REFINERY` plus
`SHIPYARD` means a system containing both roles, and adding `KNOWN FENCE`
requires at least one refinery there that the player knows has a black market.
Economy chips remain `OR` within their group because one system has one
economy. Name, economy, facilities, and jump budget combine with `AND` across
groups. Like every other active narrowing in §5.2, any facility chip expands
the finder; clearing it collapses only when all narrowing has returned to its
default.

Last-known intelligence never expires. Its age increases until an approved
information channel refreshes it; `STATUS UNKNOWN` means never observed, not
older than a threshold. Age never removes, greys, or reclassifies a fact.

A finder row annotates only the station roles matched by the active facility
chips, one condition and age per matched role. It never collapses mixed carrier
conditions into a system-wide status. `KNOWN FENCE` uses its refinery's
last-known condition. With no facility chip active, §5.2's existing compact row
is unchanged; the selected-system card remains the complete roster.

An observed recovery schedule is remembered intelligence, never a prediction
promoted to fact. Passing its `completesAt` does not change a finder row from
`REPAIRING`; the selected-system card shows the remembered time as
`DUE <time> · UNCONFIRMED`, then `OVERDUE · UNCONFIRMED`. Only a later System
relay, docking observation, or other approved information channel may report
the completed condition.

Docking at a refinery permanently establishes its immutable black-market flag
as known-present or known-absent. An undocked refinery is unchecked. A system
with no refinery is neither a match nor unchecked, because its public station
roles already prove that a fence cannot be generated there.

### 5.3 The hover label: naming a system without a click

Ratified in #108 and built in #112. Reading the cluster used to cost a
selection, and a selection is not free — it moves the route line and the record
card, so browsing a neighbourhood destroyed what you were looking at. The chart
labels the system under the cursor instead.

**The difficulty is §5.1, not the label.** 68.4%–77.7% of hovers in the shipped
console cell have a second system inside the 14 px pick radius — §5.1's own
eight-galaxy sweep of seed 42 at the default framing in the 1011 x 462 cell,
taken by `probe-navigation-console.mjs` and banded there at 64–82%. The figure
is not this section's and is not re-derived here; §5.1 owns the method, the
population it is scoped to, and the wider spread
`scripts/measure-galaxy-shape.ts shipped` reports over three world seeds. Plain
nearest-wins therefore names an arbitrary neighbour most of the time with
nothing telling the player, which is the failure §5.1 already ruled the chart
out as a *finder* for; and silence when contested is never wrong but is absent
about seven times in ten at the framing the tab opens on, which reads as broken
rather than as careful. The label names a system inside the pick radius and
**says how many others it could have been**: `CELAATGE 15.2 LY ○ out of range
(2 more)` reads as *this is one of three, zoom to be sure*, which is also the
instruction §5.1 says resolves the cluster.

**"The nearest" is not what the label promises, and #108's receipt says both
things.** Its summary sentence is "it names the nearest system within the
existing 14 px pick radius" and it reads the badge as *the nearest of three*;
its D1 then specifies a release radius and a switch margin, and a held system is
by construction *not* the nearest whenever that margin is doing its job. The two
cannot both hold.

**#112 resolved the contradiction toward the mechanism, and that is this node's
reading rather than a claim about what was ratified.** D1 carries the numbers,
the reasoning and the failures they answer; the "nearest" phrasing is a
one-line summary of it. So the label promises **a system inside the pick radius,
held steady**. Nothing in the built behaviour turns on this — the code is D1's
either way, and the checks pin D1 — so if the principal reads the receipt the
other way, what changes is this paragraph and not the chart. It is recorded here
because a spec that silently narrowed a ratified promise would be the worse
failure. Listing every candidate was the third option and
was declined — a 2–3 line panel is a second record card, and #70's constraint is
that there is no second UI grammar.

**This does not make the chart a finder.** The chart reads, §5.2's list finds.
The label lowers the cost of *reading* a neighbourhood; the badge is what stops
it being read as a finding surface.

**Which name, and the hysteresis.** The hover runs `pick`'s own
nearest-within-14 px search on `pointermove`, and then holds:

- the labelled system **S** is kept while its pixel distance stays under a
  **20 px release radius**, and while no other system inside the pick radius is
  nearer than S by more than a **3 px switch margin**;
- otherwise the nearest inside 14 px, and none inside 14 px is no label.

Both halves are needed and they answer different failures. The release radius
handles the cursor drifting off S — without it the label blinks off at exactly
14 px. The switch margin handles two points a pixel apart, which is the flicker
the node was raised about. **A rival must itself be inside the pick radius**,
because the click takes the hovered candidate: a rival no `pick` would return
must not become a label the click would then select.

The two numbers are **first values chosen against the 14 px pick radius, not
measured ones**, and they remain retunable. §9.3's checks pin the
*behaviour* — a 1 px step that must not move the label, a drift past the pick
radius that must not either, and a move well past the release that must — and
none of them reads a radius off the build under test.

**The click takes the hovered candidate; it does not re-run `pick`.** With
hysteresis in the label alone, the label could name S while a click selected a
nearer T — one quantity with two implementations, which is the trap #46 and #69
both record. `pointerup` falls back to `pick` — the same function with no
sticky state — in two cases, and they are not the same case:

- **when there is no hover state**, which is a pointer that has not moved since
  mount, and every pointer at all on a touch-only device, where `(hover: hover)`
  does not match and the label never runs;
- **whenever the release is a touch**, hover state or not. On a device with both
  a mouse and a screen `(hover: hover)` matches, so a mouse can leave a
  candidate parked on S while a finger taps T — and taking the candidate would
  select S. The touch fallback is therefore unconditional rather than a
  consequence of the state being empty, which is how it was written first.

So "the click selects what the label named" is a claim about a **mouse or pen**
release. A tap selects what the finger touched, which is D5's promise that the
touch path is tap-to-select exactly as it was before the label existed.

**The badge counts against the pick radius, never the release radius.** It is
the number of systems inside 14 px other than the labelled one — the radius at
which the cursor cannot tell two systems apart. The release radius is the
label's own stickiness and is a different question, so counting against it would
make the badge describe how far the label will stretch.

**What the badge means is *this position* is ambiguous, not that the click is.**
#108 words it as "a click here is ambiguous too — it predicts the click", and
that phrasing does not survive D1: once `pointerup` takes the hovered candidate,
a mouse click is the *least* ambiguous thing on offer — it deterministically
selects the labelled system, held state and all (a tap does not take the label
at all; see the two fallback cases above). What the count actually says is that a
small cursor move could have named a different system, and that the point being
read is one of several the cursor is on. That is the thing the player needs in
order to decide to zoom, which is what the badge was ratified for; "predicts the
click" was true of the design before D1 routed the click through the candidate,
and is recorded here as corrected rather than quietly dropped. One consequence
is worth stating because
it looks like a bug: a label held between 14 and 17 px can carry a badge, and
one held past 17 px never can — holding at all requires every system inside the
pick radius to be no more than the switch margin nearer, which past 17 px means
there are none.

**What it says**: name, direct distance in LY, and the 7 LY shell marker.
Economy, government and tech level stay on the record card — putting them here
would make the click redundant and turn the label into the panel this section
declines to build. The shell marker reads the same `reachable` set the lit
points are coloured from, rather than re-deriving `JUMP_RANGE_LY`, so "in range"
over a dim point is not expressible.

**Where it sits**: a **separate element** with `pointerEvents: none`, anchored
to `toPixels(hovered)` with its own clamp, offset opposite the record card's
`+18 / -12`. Anchored to the **point** and not the cursor: a label offset from
the cursor drifts away from the thing it names, and inside a 14 px radius it can
come to sit over a different system. It does **not** reuse the card's placement
code — one placement rule serving two floating elements stacks them by
construction, and two rules over one shared `toPixels` is the right seam. It is
suppressed over the **selected** system, whose card already names it with more
detail.

**The label's box is measured on its text, not on every frame.** `offsetWidth`
forces a synchronous layout, and the frame loop needs the box to clamp the
label — so reading it there costs a forced layout at 60 Hz for as long as a
label is up. The size is a pure function of the text, and the text changes a
handful of times a second at most. Measuring in the hover handler instead would
be worse, not better: that runs per `pointermove`, up to 120 Hz.

**It is suppressed while dragging**, and does not return until the pointer moves
again after release. A label chasing the cursor through an orbit is noise, and
the orbit is what the existing `pointermove` handler exists for — the hover path
is the else-branch on that handler's early return, so the drag path is
untouched. The label also clears on `pointercancel` and `lostpointercapture`,
for the reason the drag flag already does, and on `pointerleave`: a stale label
is a name under a cursor that has gone. **`pointerleave` clears the label
alone** and not the drag flag, because a capture the canvas still holds keeps
orbiting while the pointer is outside the box.

**Pointer-only**, gated on `matchMedia("(hover: hover)")`. There is no hover on
a touch screen and a tap-to-label affordance is a second selection grammar. The
touch path is tap-to-select plus the record card exactly as before, and §5.2's
list remains the finding surface for every input.

**The rule is a leaf module.** `src/hover-candidate.ts` imports nothing and
`tests/hover-candidate.test.ts` covers its boundaries; `galaxy-map.ts` holds the
three numbers and the DOM. A rule reachable only through a `pointermove` on a
mounted canvas has its boundaries checked only at whatever positions a probe
happens to drive it to.

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

### 9.1a Headless — `tests/galaxy-finder.test.ts`

The finder's arithmetic (§5.2), all of it reachable without a DOM.

1. **The whole-pool projection agrees with `planRoute`** over every system in
   the galaxy — a sample that spans one jump to unreachable by construction, and
   the span is asserted rather than assumed. The two share `relaxFrom`, and the
   check says so: what it still discriminates is the early stop and the chain
   reconstruction, which is everything the two do differently. An isolated
   system, built by hand because §5 of `galaxy-generation.md` guarantees the
   real generator has none, is **absent** from the map rather than carrying a
   sentinel. The sweep itself does **not** reach the unreachable case — §5 of
   `galaxy-generation.md` guarantees connectivity, so its `route === null`
   branch never runs and `unreachable` is pinned at 0 to say so. A second test
   asks both sides about a pool with hand-built islands in it, because a branch
   no run enters is a branch nothing checks.
2. **All three controls narrow**, so the expand rule cannot be keyed to the text
   field alone; whitespace is not a query.
3. **The name match is a case-insensitive substring**, an empty chip set means
   every economy rather than none, and chips and query are conjunctive.
4. **The order is fewest jumps then shortest, and total** — the same rows come
   back in the same order from a reversed input array, so a re-sort cannot
   reshuffle equals and make the list flicker.
5. **The default budget admits exactly the one-jump shell**, widening only ever
   adds rows, and no unreachable system reaches the primary list.
6. **Both directions of the beyond-range split.** A query whose matches are all
   in budget yields an empty group; one whose matches are all out of budget
   yields a populated group *and* an empty primary list; widening the budget
   moves a row from one to the other. A chip-only narrowing yields no group at
   all.

### 9.1b Headless — `tests/hover-candidate.test.ts`

The hover rule's arithmetic (§5.3). `src/hover-candidate.ts` is a leaf, so all
of it is reachable with no canvas, no camera and no pointer event — which is the
reason it is a module rather than a closure inside `galaxy-map.ts`: a rule that
can only be driven through `pointermove` has its boundaries checked only at
whatever positions a probe happens to visit.

1. **A fresh hover is plain nearest-wins inside the pick radius**, and the
   radius is **exclusive** — `d < 14`, matching `pick`'s own test. Two searches
   over one radius that disagreed at its boundary would be the divergence D1
   routes the click through the hover candidate to prevent, and the boundary is
   the only place they could differ.
2. **The release radius holds and lets go**: a held system at 17 px keeps the
   label, at 20 px it does not, and letting go falls back to whatever is inside
   the pick radius. A held system that has left the projection — behind the
   camera, or off an orbit — is dropped rather than kept at a stale distance.
3. **The switch margin, on both sides of its own boundary.** A rival nearer by
   exactly 3 px does not take the label; one nearer by 3.1 px does. A rival
   *outside* the pick radius never takes it, because the click takes the hovered
   candidate and must not be handed a system `pick` would refuse. The margin
   applies only against a held candidate: a first hover has no incumbent, and a
   margin applied there would be a tie-break rule nobody specified.
4. **The badge counts against the pick radius.** A system at 17 px is inside the
   release radius and outside the pick one and is not counted — counting it
   would make the badge describe how far the label will stretch, which is the
   label's own stickiness rather than a fact about what the cursor is on.
5. **The window where a held label can carry a badge is one switch margin
   wide**, and both sides of it are asserted. Holding *and* being contested
   requires every rival to be inside 14 px and no more than 3 px nearer, so the
   held distance lies in [14, 17); at 17.5 px the same rivals take the label.
   The first version of this case sat outside that window and failed on a
   correct build, which is how the property was found.
6. **It is a pure function of its arguments** — the radii come in rather than
   being owned, so the constants are retunable without touching the rule, and
   the points it is handed are not mutated.
7. **What a `pointerup` selects** (`clickTarget`): the hovered candidate over a
   fresh pick, the pick where there is no hover state, and — the case that put
   this rule in a leaf — **never** the hover on a touch tap. A hybrid device is
   not expressible in the probe tier (§9.3 records the two attempts), so this is
   the tier that binds D5's touch half. Red-built by dropping the touch branch.

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

7. **The finder's collapsed form, and what expands it** (§5.2). Closed, it is a
   field and eight chips with the results hidden and the chart holding the cell
   §5.1's band was measured on — **both dimensions**, since a check on the width
   alone would not notice a control that took a strip off the top.

   **Nothing §5.1 counts is hidden under it at the default framing**, asserted
   with the case that shows the measurement is real: zoom in and seven of the
   152 systems then on screen do go under the panel. The first half alone is a
   check that cannot fail on a build whose panel is nowhere near the cluster,
   which is every build until one is.

   **The chip case is checked before the typed one**, and from a cleared filter:
   verifying only typing passes a build whose chips are dead, which is a defect
   `live-cockpit.ts` records having shipped once already. Clearing every
   narrowing collapses it again.
8. **Both directions of the beyond-range group, in the DOM.** The two query
   names are taken from the projection at run time rather than hard-coded, and
   are chosen to sit either side of the default budget. The heading is counted
   as well as the rows, because a check that only ever saw one branch could not
   tell the grouping from a constant.
9. **A row selects and does not move the camera; the centre control moves the
   camera and does not change the selection.** Both halves, comparing the whole
   pose — yaw, pitch, distance and focus — on **both** of them. The centre half
   was written comparing focus and selection alone, which passed a build whose
   centre control also zoomed; the red build that zooms is what says so.
10. **The finder commits no course** — it carries no per-row control and the
    chart still carries exactly one (D8). This item asserts an *absence*, so it
    has no red build: the build that fails it is a feature nobody wrote.
11. **A wide budget draws a capped list and prints what it left out** (§5.2).
    The rows in the DOM are fewer than the rows in `state.finder`, the printed
    remainder is exactly the difference, and the text carries the number. Red
    with the cap raised past the galaxy.
12. **The widened budget survives a remount, and the query does not** (§5.2).
    The tab is left and re-entered, which disposes and rebuilds the chart — the
    only way the distinction is visible, since a mount-scoped budget reads as
    persistent in every single-mount check. Red twice: the budget put back in
    the closure, and the whole filter persisted rather than the budget alone.
13. **The desktop console opens the finder as a column**, checked *before* the
    wait that depends on it — a build that covered at the desktop cell would
    otherwise kill the probe on a 30 s `waitForFunction` timeout instead of
    failing the check about it, which is the failure mode item 6 already
    records. Found by red-building exactly that.
14. **The narrow console covers instead** (§5.2), asserted at 390 x 844 rather
    than from the constant: the layout reads `cover`, the canvas box is the same
    open as closed, and the panel is most of the stage. Red with the threshold
    at 0, which produces the 76 px strip the rule exists to prevent.
15. **Resizing across the threshold relayouts a panel that is already open**,
    both directions. The first version of this cleared the filter before
    resizing and so measured a fresh open at the new width — a build whose
    layout never responded to a resize passed it, which is exactly what the
    build was: `applyLayout` runs from `render`, and the chart's own
    `ResizeObserver` sets a redraw flag without calling back into the panel. The
    panel watches the chart's box itself now. Red with that watch removed —
    and note the *narrowing* half alone is not discriminating, since a build
    stuck in cover satisfies it; the pair is the check.
16. **Crowding in the open cell, measured rather than carried over.** The cell
    goes 1011 x 462 to 743 x 462 and the figure stays 73.0%, which §5.2 explains
    and this check makes falsifiable: every system's horizontal shift must be
    the *same* shift, equal to half the column the panel took, with the vertical
    positions unmoved. A build that never updated the camera's aspect produces
    the same two percentages and a shift that varies with the offset from the
    centre.

    Written the wrong way first — "every system lands on the same pixel" — which
    is false for a crop too, since the origin moves with the box. The red build
    said so: aspect frozen, the check stayed green at 0.000 px, and the shipped
    build went red at 134 px, which is the translation a crop is supposed to
    produce. A second fault came out of the same run: the "closed" projection
    was being captured while the finder was still open from an earlier item,
    so both
    reads were the same 743 px box and the comparison was 0.000 on every build.

17. **The hover label names the right system at an uncontested position**
    (§5.3), and the cursor is 60% of the pick radius **off** that system's
    projected centre. A hit test driven to a point's exact centre passes on a
    build whose radius comparison is wrong at the boundary, which is why §9.2
    finds the pick boundary rather than clicking dead centre. The label's text
    is asserted as text — name, a distance, and a range marker — while the index
    is asserted as state through `hovered()`, because a name parsed back into an
    index would make one check stand for both.
18. **The badge is a count, asserted at a contested position and an uncontested
    one** (§5.3). The crowded position carries eight other systems inside the
    pick radius and the check requires the badge to equal the number the same
    arithmetic gives over `projected()`; the quiet position must carry no badge
    and no `more)` in its text. A check that only ever saw the crowded case
    cannot tell a correct count from a constant — red-built by forcing
    `contested` to 0, which leaves the quiet half green and the crowded half
    red.
19. **Hysteresis holds and releases, and the two are separate checks** (§5.3).
    The hold: park the cursor 0.5 px on S's side of the perpendicular bisector
    of a pair 7.34 px apart, step **1 px** toward T so T is nearer by 1 px, and
    the label must still say S; then move 16 px from S with nothing else inside
    the pick radius, and it must still say S. The release: move to a spot 143 px
    away and the label must become that spot's system — and **the distance is
    asserted, with a 60 px floor**, because the release destination was at first
    any uncontested spot the planner happened to find. A near one would have let
    an ordinary switch stand in for a release. The floor is not the release
    radius: a probe that moved by the constant it was checking would pass on a
    build with any value of it. A label that never changed would pass the hold
    half alone, which is why the release is its own check.

    Red-built as the defect #108 names — `releaseRadiusPx` set to the pick
    radius and `switchMarginPx` to 0, which is nearest-wins. The 1 px step then
    moved the label to T and the 16 px drift dropped it entirely, while items
    17, 18 and 21 stayed green. Neither the release radius nor the switch margin
    is read off the page: a probe that stepped by the constant it was checking
    would pass on a build with any value of it.
20. **The click selects the system the label named** (§5.3), driven to the one
    position where the two answers can differ — the held-but-not-nearest
    position item 19 establishes. At a plain contested position the held
    candidate and a fresh `pick()` return the same system, so a build that
    re-ran `pick()` on `pointerup` would pass. Red-built exactly that way: the
    label said S, the nearest was T, and the click selected T.
21. **A drag says nothing** (§5.3), sampled four times *during* the orbit rather
    than after it — a build that drew the label through the whole drag and
    cleared it on `pointerup` passes an end-of-drag sample. The release selects
    nothing, which is §5's 4 px slop rule and not this one, and is asserted here
    because `pointerup` now reads the hover state.
22. **A zoom under a still pointer re-answers the label** (§5.3). A wheel zoom
    moves every system with the cursor motionless, and the candidate was rebuilt
    on `pointermove` alone — so the label named, and a click selected, a system
    that had slid out from under the cursor. The same hole was open for the
    centre control, `resetView` and a panel resize; the fix is one rule
    (recompute on the frame) rather than a clear on each of the four. Driven to
    the near stop, because -40 LY moved the system only 53 px and left the
    expectation inside a plausible release radius; at the stop it is 128 px and
    the assertion is against what the *new* projection puts under that cursor.
    Red-built as the pre-fix build: the label still said 5 at 128 px.

    The first version of this check skipped `resetView`, so it inherited the
    orbit item 21 leaves behind and hovered a different system from the one it
    then asserted about — it went red, which is how that was found.
23. **A system the chart does not draw is neither labelled nor selected**
    (§5.3), driven at a zoomed framing because the default one frames all 256
    and has nothing off screen to name. The position puts an off-canvas system
    13.8 px from the cursor and **nearer than anything drawn**, which is what
    makes it red on a build that skips only `behind` — and that build is what
    shipped in `pick` from #11 until #112, invisible because a click selecting a
    system nobody can see reads as a click on empty space. Red-built by
    restoring the `behind`-only filter: the label said 11 and the click selected
    11.

**Every check here was built a red build to run against**, one at a time:
the sort removed; the chart root back to `position: fixed`; a kind dropped
from what `navRows` is handed; `onSelectTarget` made a no-op; the query ignored, over-narrowed, and
leaked an extra row; the kind chip ignored; `currentIndex` dropped and the galaxy forced to
3; `dispose` skipped; the frame loop cancelled on mount; `PICK_RADIUS_PX` cut
to 2 and the default framing zoomed to 20 LY. Each turned the check named
above it red — except the system half of item 3, which is recorded there as
not yet discriminating rather than counted as covered.

The finder checks were built red builds too — items 7 to 16, both halves where
a check has two: `toggleFinderEconomy` made a no-op (item 7 red, and it is the
exact dead-chip defect the ordering is there to catch); the beyond-range group
suppressed, and then made a constant by dropping the budget test (item 8 red one
branch each way); a row click made to centre as well, then the centre control
made a no-op, then the centre control made to zoom as well (item 9 red three
ways, the third being what caught the check asserting "nothing else" while
comparing only two of the pose's four components); the session budget put back
inside the mount closure, and then the whole filter persisted rather than the
budget alone (item 12 red one way each); the cap raised past the galaxy so no row was
omitted (item 11 red); the panel forced to cover at the desktop cell (item 13
red, and that build is what showed the check had to run before the wait); and
the narrow threshold pinned at 0 (item 14 red); and the panel's own resize
watch removed (item 15 red). Item 16 was the one that paid: its red
build caught two faults in the check itself, both recorded where it is
described.

The hover checks — items 17 to 21 — were red-built too, and the builds are named
where each item is described: `updateHover` made a no-op (17, 18, 19 and 20 red,
21 vacuously green, which is what says 21 needs its own); `contested` forced to
0 (18 red on the crowded half alone); the release radius set to the pick radius
and the switch margin to 0, which is #108's nearest-wins defect (19 red both
ways, 20 red with it); `pointerup` put back on a fresh `pick()` (20 red alone,
19 green); the `dragging` suppression removed with the hover updated through the
orbit (21 red); the candidate rebuilt on `pointermove` alone rather than on the
frame (22 red); and the drawn-predicate reduced to `behind` alone (23 red).

**A second clip has no check either, and it is the honest kind of gap.** Round 5
found that `behind` (NDC depth above +1) is not the only way a system goes
undrawn: depth *below* -1 is a point in front of `camera.near`, discarded by
WebGL with `behind` still false. `drawn` tests both ends now — one comparison,
and it makes the predicate mean what its name says. **No check was added,
because none could be made to fail.** Driven to the 12 LY stop and orbited
through 20 poses, NDC depth reached **-60**, so systems certainly do cross the
near plane; not one of them ever projected *inside* the canvas box. The
arithmetic says why: at a view depth under `near` (0.5 LY) a point lands inside
the viewport only within about 0.45 x 0.2 LY of the view axis, a ~0.05 LY³
volume against a cluster of some 30,000 LY³. A green-forever check here would be
a check derived from its subject, which this file already records twice; the fix
ships with this paragraph instead.

**One decision here has no browser check at all, and that is a fact about the
tier rather than a gap left open.** D5's hybrid case — a mouse leaving a
candidate parked while a finger taps elsewhere — needs `(hover: hover)` and a
real touch pointer at once, and Chromium will not hold both. **The method, so
the claim is re-runnable rather than asserted:**

1. `browser.newPage({ hasTouch: true })`, then
   `page.evaluate(() => matchMedia("(hover: hover)").matches)` → **false**. The
   context gets `page.touchscreen.tap`, and loses the label entirely, so a check
   written on it passes vacuously — which is what the first attempt did, and it
   is why it is not in the file.
2. A plain desktop page plus CDP:
   `Emulation.setTouchEmulationEnabled { enabled: true, maxTouchPoints: 1 }`.
   `Input.dispatchTouchEvent` then produces genuine `pointerdown`/`pointerup`
   with `pointerType: "touch"` — confirmed by a document-level listener — but
   the same `matchMedia` read is **false** again.
3. The same page with `Emulation.setEmulatedMedia { features: [{ name: "hover",
   value: "hover" }, { name: "pointer", value: "fine" }] }` applied after (2):
   `matchMedia` still reads **false**. The override does not win over touch
   emulation.

A synthetic `PointerEvent` on the canvas was the remaining option and is worse
than no check: `setPointerCapture` throws on an inactive pointer id, so the
handler aborts before the branch under test and the check passes on every build.
The rule moved into `clickTarget` (§9.1b item 7) so the headless tier binds it
instead of a comment doing.

**What that leaves unchecked, stated rather than implied.** §9.1b item 7 binds
the *rule*. It does not bind the **wiring** — that `pointerup` hands
`e.pointerType` to it, and hands the right one. That is a single argument at one
call site, covered by no tier here, and a build that passed `"mouse"`
unconditionally would be green everywhere. It is a known gap of the same kind
item 3 records for `currentIndex`, not a claim of end-to-end coverage; what
would close it is a real hybrid pointer, which is the thing Chromium will not
give. A device with a mouse and a screen is the only place it can be seen.

**Item 10 has no red build**, because it asserts an absence — no per-row
course control — and the build that fails it is a feature nobody wrote. It is
numbered rather than folded into another item so that the sentence above stays
true of exactly the items it names.

### 9.4 Facilities knowledge and finder extension

The implementation spawned by #116 as #275 owes both tiers:

1. **Public infrastructure is complete without discovery.** Every generated
   system projects its station count, names, roles, and role-derived permanent
   facilities without reading objective or knowledge overlays. `REFINERY` and
   `SHIPYARD` match that structure even when condition is unknown, disabled, or
   destroyed; there is no availability filter.
2. **The chip algebra is exact.** The set is `REFINERY`, `SHIPYARD`, and
   `KNOWN FENCE`; facility chips intersect, economy chips union, and the four
   filter groups intersect. Every facility chip expands the finder under §5.2's
   existing rule. Chip-only searches retain §5.2's existing jump-budget and
   beyond-range behavior.
3. **Fence knowledge is three-valued.** A checked generated true flag is a
   match, checked false is a known non-match, and no private-fact marker is
   unchecked. The result reports the exact unchecked count inside the other
   active narrowing and never lists those systems as positive or negative.
4. **Condition presentation never predicts.** Matched roles show their own
   condition and relative observation age, or `STATUS UNKNOWN`; elapsed time
   never expires knowledge or materializes an observed recovery completion.
   The record card carries exact times, sources, and an unconfirmed due or
   overdue recovery schedule.
5. **Information channels are explicit.** Initial world establishment and a
   jump arrival refresh every local station from the System relay;
   docking refreshes that station and checks a refinery's black-market fact.
   Opening the map changes no knowledge row.
6. **The rendered ownership boundary holds.** Activating each chip produces the
   expected rows and annotations at desktop and narrow widths; selection shows
   the full station roster in the existing record card. The same system-point
   set, colours, and visibility are measured before and after facility
   narrowing, so the chart remains geography-only.

## 10. Deferred

- **Whether the core haze ships.** §6 leaves it off and built.
- **Route safety, traffic, and legal status on the chart** — derived
  projections (§8 of `persistent-world-state.md`), and none of them decided.

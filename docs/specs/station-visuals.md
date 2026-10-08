# Spec: station visual pass

**Status:** ratified — [#36](https://github.com/jcfischer/seelite/issues/36)
**Date:** 2026-08-25
**Builds on:** `station-types.md` §7 (the three silhouettes), `docking.md` §5
(display reach against dockable geometry), `hud-and-scanner.md` §4 (the colour
and attention grammar), and #15's distance-layer rule.

## 1. What this owns, and what it must not touch

#28 delivered three outlines a player can tell apart. This spec gives those
outlines a **surface, a lighting state, and a visible activity**, so that a
station reads by *role* — trade, shipyard, refinery — at the ranges a pilot
actually sees one, rather than reading only as "a station" until the shape
resolves.

It owns: procedural materials, generated surface detail, per-role light and
activity patterns, and how much of all that is drawn at a given apparent size.

It owns none of the geometry. `STATION_GEOMETRY` (`src/station.ts`) stays the
dockable contract #9's checks read; `stationSilhouetteKm`
(`src/station-mesh.ts`, per form since node #717) stays #28's bounded display reach. **Neither the geometry
table nor any form's declared `reachKm` moves, and neither budget rises for
this pass.** A visual pass that grew the silhouette
would be re-opening #28 under another name, and the two headless budget
assertions are what stop it.

## 2. Identity is the outline; the pass is what comes after it

§7's standard is unchanged and this spec is written under it: the three read
apart by outline before colour and before any detail resolves. Everything below
resolves *later* than that — nearer, or in better light — and so may sharpen the
reading but may never be what it rests on.

That gives the pass its one hard structural rule:

> **A detail level may not change the outline.**

The plating, the fixtures, the strobes and the flare are drawn inside the
silhouette the outline already has. Turning them off at range must leave the
same shape behind, or #28's desaturated silhouette probe starts measuring a
different object at 60 km than at 5 km and its finding decays into noise. The
headless tier asserts the reach is *identical* at all three levels; that is the
whole enforcement.

### 2.1 A fixture is mounted on a surface, or it is floating

**Superseded in its numbers by #56, kept for its rule.** When this was written
the trade station was #28's octahedron and `STATION_SILHOUETTE_KM.trade` was
0.6 km — exactly the octahedron's own vertex, so the budget was the hull and
there was no slack at all to mount anything in. Every fixture had to be solved
onto the face plane `|x| + |y| + |z| = r` and sit inside the convex outline.

#56 replaced that hull with a cuboctahedron and the budget is a declared reach
per *form* now. How much headroom each carries is **printed by
`station-mesh.test.ts`, not asserted tightly**: the guard is that a form is
inside its declaration and not below 60% of it, which catches an overrun and a
declaration nothing approaches, and says nothing about a form sitting a third
of the way in. Read the run's own figures rather than a number written here. The arithmetic changed;
the rule did not, and it generalised:

> A fixture's position is derived from the surface it is mounted on, never
> chosen beside it.

Every violation of that has looked different and cost the same. A lamp at
`(0.45, 0, 0.45)·r` on a plane defined by `|x| + |y| + |z| = r` sums to 0.9·r
and is **buried inside the hull**, invisible. A strobe at 0.55 of a reach whose
slab ends at 0.54 hangs beside it. A window run at 0.64·r past a body 0.62·r
half-wide clears it entirely. A radiator panel 0.46 of a span off a stalk a
fifteenth of a span thick touches nothing. A band at 1.1·r round a rock whose
crests reach 1.33·r is swallowed by it. All five shipped and all five were found
by measurement rather than by looking, which is why the headless tier asserts
that a station is **one connected assembly** — see §6.

### 2.2 An emissive fixture needs more clearance than a geometric one

Inside the hull is not far enough for a light. The renderer runs a bloom pass,
so an emissive surface spreads a halo past the geometry it is mounted on — and
on #28's trade station, whose hull *was* the whole silhouette, a strobe sitting
at 0.8·r on the face plane pushed the rendered outline 7 px wider at docking
range while the mesh's vertex reach was unchanged to the last bit.

The geometric budget cannot see this: it is a post-process on the frame, not a
vertex. So the rule for an emissive accessory is **inboard of the limb**, not
merely inside the surface.

**This half is not gated, and it is worth being plain about why.** Three
rendered forms of the check were tried and all three measure the bloom pass
rather than the geometry: with the clock pinned so the strobes are lit, the halo
reaches 24 px on the shipyard's 98 px bounding box — 32% — against the 170% a
strobe deliberately moved to 2.5·r produces. Those are not an order apart, so no
threshold between them is honest, and a check that cannot discriminate reports a
colour for a question it did not answer. §2's rule is gated where it holds
exactly: the mesh's vertex reach, identical at all three levels, in the headless
tier. What the bloom does on top of that is documented here and looked at, not
asserted.

**The aperture frame is the case that hid three others.** It sat *on* the face
it is cut into — bars centred half a bar proud — so it touched the hull at a
plane and nowhere else, which is a lit rectangle floating in front of a station.
It straddles the surface now, and is thick enough that "half in" is a real
overlap rather than a rounding.

## 3. The three reading distances

Detail is chosen from **apparent size**, not from absolute range. A refinery's
0.4 km core and a shipyard's 1.66 km frame are not the same object at 20 km, and
a rule written in kilometres would give the small one detail nobody can see
while stripping the large one of detail that is still legible.

The measure is `apparentRadii = distanceKm / mesh.silhouetteKm` — how many of
its own radii away the camera is, in the reach of the form that station is
built in (node #717), not of its role.

| Level | Apparent radii | What is drawn |
|---|---|---|
| `full` | ≤ 40 | plating, window grid, greebles, fixtures, strobes, flare, aperture recess |
| `reduced` | ≤ 400 | hull, aperture, strobes, bay floods and heat glow — no window grid |
| `outline` | > 400 | hull and aperture; every accessory off |

**The table is the undirected reading.** The bands switch with the same 5%
hysteresis the render layer uses (`HANDOFF_HYSTERESIS`, `src/units.ts`),
imported rather than restated, and that band is *directional*: a station already
at a level is held there until it is 5% past the threshold. So a station at 41
radii is `full` if it is receding from close range and `reduced` if it is being
approached from far, and both are correct. The figures above are where a station
lands with no previous level — the case of one being placed rather than flown
to. Without the directional band a station parked on an edge flickers its whole
detail set once a frame, which is more visible than any of the detail it is
choosing between.

At `HANDOFF_KM` — where a body crosses into the far layer — a trade station is
16,667 radii away and unambiguously `outline`. The two rules do not need to
agree by construction, but they do not fight: a near-layer station is `full` or
`reduced`, and a far-layer one is always `outline`.

### 3.1 Greebles ride the `full` band, and `low` drops them (#129)

The mechanical clutter added by [#129](https://github.com/jcfischer/seelite/issues/129)
is tagged `full` for the reason everything else in that row is: it resolves away
long before the outline does, and instances nobody has pixels for are state
churn. §2's rule binds it exactly as written — **no greeble may be a station's
farthest vertex** — and `tests/station-visuals.test.ts`'s equality is what holds
it, with `tests/station-greebles.test.ts` stating it per form so a failure names
one.

The clutter is also the station's side of #98's quality key. **`low` drops the
greeble instances and keeps every emissive**: the geometry is per-frame vertex
and instance cost, an emissive is one property on a part drawn anyway, and
dropping the lights would drop the reason
[#102](https://github.com/jcfischer/seelite/issues/102) exists. `STATION_QUALITY`
(`src/station-visuals.ts`) is the one place both sides read.

Two owners write `visible` on the clutter and they write it on **different
objects**: the band owns the greeble group, the quality key owns the instanced
meshes inside it. On one object, whichever ran last would win and the other
would be a silent no-op.

## 4. Surface: one greyscale plating map per role, multiplied by the type colour

The plating is generated as a **`DataTexture`, never a canvas.** `station-mesh.ts`
is imported by the headless tier, which has no `document`; a `CanvasTexture`
would force a `typeof document !== "undefined"` branch whose untested half is
the one that ships. Generating RGBA texels from arithmetic instead means the
same code path runs headless and in the browser, and the pattern itself becomes
a headless assertion.

The texels are **greyscale**, so `STATION_COLORS[type]` still multiplies through
and §7's secondary cue survives the pass. A per-role coloured map would quietly
replace that cue with a painted-on one.

| Role | Surface language |
|---|---|
| trade | tight plating, clean seams, little weathering — a maintained civil hull |
| shipyard | coarse structural plating, hard seams, working grime around the bays |
| refinery | wide plating under heavy vertical streaking — soot from its own stacks |

A second `DataTexture` per role carries roughness in green and metalness in
blue, which is the channel layout `MeshStandardMaterial` reads. Both are derived
from one generated buffer, so a shine cannot miss its own seam.

A role's pair is built **on first use and then shared by every station of that
role**, and never mutated after construction. Built eagerly for all three at
module load first, which is what the ratified version of this paragraph said:
measured, that is 18–22 ms paid by every importer of `station-mesh.ts` —
including headless tests that never render — and paid for roles a given system
may not hold.

**The texel buffer length must be exactly `4 × width × height` for
`RGBAFormat`.** A mismatch does not throw; it reads out of bounds and renders as
garbage, and the headless test asserts the length for that reason rather than as
a formality.

### 4.1 Two density figures per role, and both are settled by looking (#129)

`greebleDensity` and `windowScale` sit in each role's `STATION_VISUALS` profile.
A form declares the *layout* — which of its faces is a flank, how a run wraps a
band — and the profile declares **how much**, as a factor on what the form asked
for. That split is what makes the density one number per role rather than twelve
per form.

| Role | `greebleDensity` | `windowScale` | Why |
|---|---|---|---|
| trade | 1.0 | 3.0 | A habitat: the least cluttered and the most lit, because its machinery is inside it |
| shipyard | 1.4 | 2.5 | Scaffolding round a working volume — more plant, and most of its frame is not lived in |
| refinery | 1.7 | 2.0 | A plant, which is almost entirely machinery; the clutter is the point rather than the trim |
| outpost | 0.7 | 2.0 | Sparse on both, because the coarse plate above is what says *small* and clutter at the same pitch takes that ruler away |

Neither figure is arrived at by arithmetic and neither can be. #102 settled that
the density is decided in front of a frame, and #98 settled what frame: the
canonical view set plus the principal's yes. What #129 shipped is these four
rows and the sheet they were set on.

**A denser run is not the same run repeated.** #129's first build multiplied the
trade station's ports on one row and produced a 30 m pane every 21 m — a
continuous strip light rather than a window grid, and it was flown as one. Every
layout in `station-mesh.ts` is written against the count that was *built*, and
the Coriolis lays its ports out in rows: extra panes have to spread over the
face, not stack along a line.

### 4.2 Finishes and the macro structure (#202)

A **finish** (`STATION_FINISHES`, `station-visuals.ts`) is the station half
of `ship-visuals.md` §3.1: everything about a station that is not its form,
as a preset the workbench switches live. `stock` is the identity over each
role's profile and the pins in `tests/surface.test.ts` hold it. `plated`
gives every role #101's staggered cut plate — a one-texel groove in a normal
map, which `hullMaterial` now carries — under a second octave of 75 m panel
groups, on a 256 map with a 0.3 km tile so the plate stays 18.75 m.
`industrial` adds the **macro fixtures** and `worn` raises the streaking,
the reversal of #98's refusal that it is — **and `worn` is the default since
the principal's choice on the second sheet (2026-09-06)**
(`DEFAULT_STATION_FINISH`). `nostromo` is one step past it: deeper streaks,
sooted plates, the role's paint pulled toward grey through the finish's
`paint` dial, 9.4 m plates on a 512 map under the same 75 m groups, and the
clutter at two fifths of its size with three times the count
(`greebleScale`, `greebleDensity`); it stays a preset for variation.

The fixtures are at **ship scale** on every finish that draws them — the
principal's ruling on the first sheet, "the trusses are way too big on the
Coriolis": `SHIP_SCALE` (`station-fixtures.ts`) sizes every member against
a courier (12 m trusses, 30 m panels, 8 m tanks, 2 m pipes), every
declaration reads from it, and `tests/station-finish.test.ts` reads every
pooled member back against its cap.

The fixtures (`station-fixtures.ts`) are the scale between the plate and the
kilometre that #199 found missing, in the ISS's vocabulary: truss beams of
square-section members with diagonals, radiator banks of thin panels on a
spine, tank racks in saddles, pipe runs with elbows, a mast with a dish, a
docking collar with approach lamps, and clock-driven beacons on the roles
that strobe. Each is a primitive; where each goes is a short declaration per
form in a pool, in the form's own kilometres. Every member of every
fixture on a station is an instance in a per-material pool, so the whole
structure is a handful of draw calls. They are tagged `reduced`: 2 km
structure belongs with the aperture frame, not with the 40 m clutter.

Three rules bind them, and `tests/station-finish.test.ts` holds each under
every finish. **No fixture may be the station's farthest vertex** — the reach
is read at every detail level and must not move when the band hides them,
which is what caught the outpost's first radiator bank standing below its
tank cluster. **Nothing in the corridor**, which the corridor row sweeps.
**Every member is supported**, by structure or by a supported member — a
flood from the built form through the fixtures' boxes, because a ray from a
mast's top toward the station's centre passes over the keel the mast stands
on and read the first version as floating. The Coriolis's headroom is the
corner's, not the face's: a point at lateral offset `d` on a face may stand
`h` proud only while `hypot(face + h, d) < r`, so its fixtures sit on each
face's middle band and are sized against that.

## 5. Light and activity: identity, never state

Each role carries one emissive signature and one motion:

| Role | Light | Activity |
|---|---|---|
| trade | warm window grid, a pair of hull strobes on the docking face, and a ring of strobes on the mouth's lit frame | the pair alternates on a 2 s period at a 12% duty cycle; the ring flashes on the same period, one lamp after another round the slot |
| shipyard | cool window grid, cold blue-white floodlit bays, the same strobe pair and the same mouth ring | one bay carries a welding arc — a fast, deep flicker; the strobes and the ring run as the trade station's do |
| refinery | glowing vent throats, a heat ring, lit ports on the dock face, and hazard beacons on its tallest structures | the throats and the ring breathe on a slow shallow flicker; the beacons blink on their own period, holding each flash longer than a strobe does |

Node #745 flies all four refinery forms: Warren, Collar, Spar and Works,
drawn uniformly per system. Each carries the role's dock-face ports, visible
vent throats and obstruction beacons. Warren retains its macro fixture
declaration; Collar and Spar gain their own in node #745. Every form uses the
same aperture and berth catalogue.

Node #746 flies all three shipyard forms: Gantry, Hangar and Slipway, drawn
uniformly per system, each with the role's window grid, floods, welding arc,
hub strobes and mouth ring where the aperture axis sees them. The Hangar's
floods sit on the lips of its bay mouth and its arc on the slab's face below
the mouth; the Slipway's floods sit on the arc's inner face between its struts
and its arc on a slip-head, at the slip's edge. Both gain macro fixtures on
their static frames. The trade pool is handled by its own node.

The colours are drawn from `hud-and-scanner.md` §4's grammar rather than a
second palette: cool for structure and work light, warm for habitation and heat.
The aperture keeps #28's amber frame at a fixed intensity.

Every fixture is placed to read **from the aperture axis**, because that is the
one viewpoint defined for all three types and the one an arriving pilot has. The
refinery's lit ports were first put round the drum's side, where they are edge-on
from that axis and drew *zero pixels* — a crewed station reading as an unlit tank
from the only direction anyone approaches it.

Reading from the axis is a **placement rule**, and it is this: every fixture
named above goes on or forward of its form's outermost axis-facing surface.
Nowhere else is a rule, however reasonable it sounds. #274 measured all three
roles and found eight dead fixture names across them — the trade station's whole
window grid and both its strobes at exactly 0 px, the shipyard's strobes and its
weld arc at 0, the refinery's ports and all four of its flare throats at 0 —
while the check that was meant to catch this summed a *role* and passed on
whichever light still worked.

Two things the rule is not. It is **not a rule about which way a surface
faces**: the shipyard's bay floods are *turned* until their lit faces look 35°
inboard of the axis, so they read as lights aimed into the bay rather than as
lamps pointed at the pilot — and it is where they are mounted, not how they are
turned, that the rule decides. They were first on the inboard faces of the two
booms that reach forward past the hub, and with real-size fittings that failed:
each boom flares to a 0.16·r half-width at its tip, so seen down the axis the
tip stands in front of the whole inboard face, and the weld arc read 0 px and
the floods 2 px. They are on the tips' forward faces now, the one surface of a
boom nothing stands in front of on the approach. And it is **not satisfied by
being outdoors**: the refinery's flare throats were 8.5 m plates recessed a bore's
width inside their own pipes, unoccluded by anything else on the station and
still worth 2.9 px, so *"its flare is its light"* was a sentence nothing on
screen supported.

The strobe pair belongs to the **spinning member** — whichever part of a form
turns — and not to a role, a hull, or a form. It was written against "the
Coriolis hull", on the reasoning that the shipyard spins about the same axis for
the same reason, and that went stale the moment `SELECTED_FORM.shipyard` became
the Gantry: a keel with a drum on a bearing is not a Coriolis, there is no shared
hull for one answer to be one answer for, and the pair had been bolted to the
**static keel**, marking a rotation it did not share. What a strobe carries is
that the station turns and how fast, so the member that turns is the thing it has
to be on. Written this way the rule survives the next re-ranking; written against
a form it did not survive the last one.

What separates the two roles is the work light — the shipyard's
cold bays and its arc against the trade station's warm grid — and the drydock
frame that is already carrying the outline.

**A fixture on the docking face reads the rotation better than one on the rim,
not worse.** The first version of this section worried the other way round. It
is a fact about the geometry rather than a preference: from the aperture axis a
lamp at radius ρ on the +Z face traces a **circle** in the frame once per
revolution, so the rate is read straight off the sweep, while a rim lamp traces
its own circle and is *occluded at every phase of it* at three radii — at 0° by
the +Z face, and at 45° the sightline to `(0.721, 0.721, 0.5)·face` meets the
forward triangle's plane strictly inside that triangle. A rim lamp is a sliver
only at infinity.

**They are not a port/starboard pair, and they are not coloured as one.** The
first version made them red and green and described them as marking port and
starboard on the spin axis' beam. They sit inside the spinner, so both orbit the
axis and exchange sides every half revolution: a convention that inverts twice a
rotation is worse than none, and a station that spins has no fixed port side to
mark in the first place. What the alternation honestly carries is that the
station **turns, and how fast** — the physical fact `docking.md` §4's roll match
is matched against, readable at ranges where the slot itself has not resolved.
Both strobes are therefore the same white.

The trade station's window grid is a **warm** white and the shipyard's a cool
one. That is the pair's finest distinction and it is deliberate: it is what makes
the two Coriolis hulls read apart in the one measurement that ignores shape.

The refinery carries **no rotation marker**: it does not spin, and a marker of
rotation on a station that does not rotate marks nothing. Its flare is its
light. What it does carry is a **hazard beacon** on each of its tallest
structures — the flare stack and the mine headframe, which every plan has — and
that is a different signal, not the strobe under another name: a beacon says
something is there to clip, which is as true of a station that stands still as
of one that turns. So it blinks on its own period, holding each flash longer,
and it is white rather than an aviation red, because `hud-and-scanner.md` §4
owns red as refusal. This sentence said "no strobes" until #300's second sheet,
where the principal asked for beacons on the refinery.

**Every light here is a real fitting, and is seen at range by its glow**
(#300). The principal ruled every light on #300's first sheet *"way too big —
think about how big a light would be on a station that is several km big"*:
they were a 42 m strobe, a 30 × 12 m pane, a 156 m flood and a 60 m arc. A
strobe or beacon is 2 m now, a pane 3 × 1.5 m, a flood 4 m, the arc 1 m and a
flare throat at most 8 m. A fitting that size is under a pixel from the
approach, so each carries a glow — additive, in its own colour, floored at a
few pixels and capped so the fitting shows up close — driven by the same clock. The glow draws only where its fitting does, so none
is drawn at outline range.

**A blinking light burns past the bloom threshold; a steady one does not**
(#300). Steady glows — windows, floods, the flare throats, the weld arc — peak
at their fixture's drive, under #199's emissive ceiling. Strobes, beacons and
the mouth ring carry a white-hot core that crosses the bloom threshold, as the
ship's nav lights do, and that is the principal's ruling amending #199 for
blinking point lights. The reason is measured rather than argued: from the
cockpit on the player's GPU, those lights sit on or beside the brightest
surfaces a station has — lit plating, the amber aperture frame, the nameplate —
which read 141–227 of 255 at the lamps' own screen positions from 6 to 19 km.
A glow capped at the ceiling and added onto that drew nothing a pilot could see
(strobe-b at 18.6 km: 212 lit, 212 hidden), while beacons standing against
black space read at 226. A headless probe on a software rasteriser had called
every one of those lights present, which is why this paragraph cites the GPU.

**A blinking light is drawn with its glare, and lays light on the surface it
is mounted on** (#300). The hot core alone was visible and did not *feel* like
a light, in the principal's words, and two measurements on the principal's GPU
at Retina scale say why. Every glow was drawn at half its intended size: its
pixel floor counted device pixels while the game draws at 2x, which the ship's
nav lights had already corrected for. And bloom cannot supply glare to a source
this small: turning bloom off, strengthening it four times, running it at full
resolution or making the core twenty times brighter changed the lamp's
surroundings by almost nothing. So glare is part of the sprite — a blinking
light's glow is a tight white centre inside a faint wide skirt, sized by the
range rather than by a floor — for a 2 m lamp in a 60° field 900 points tall,
about 5 points from 20 km out, 14 at 5 km, 36 at
2 km, capped at 56 near 1 km; at a fixed 18 points it was as wide as the
station itself 50 km out and never grew on approach — and every blinking lamp that stands on a surface (the docking-face
strobes, the mouth ring) lays a soft disc of light on
that surface, 20–50 m across, flashing with it. It is a decal and not a light
source: real point lights were declined for their cost to every material in
the near layer. A beacon on a tip — a finish's mast, the refinery's sheave
crown and flare stack — has no surface round it and gets glare without a pool;
a pool with no surface under it is a sheet of light in space, which is where an
additive glow is easiest to see (the principal's ruling on #300's review).

**The mouth carries a ring of strobes, and it says nothing about docking
state** (#300). On a slot role, ten lamps stand on the lit frame round the
mouth, each flashing on the role's strobe period at its own place in it, so the
flash runs round the slot once a period: it says where the mouth is, from
ranges where the frame has not resolved. Red and green by clearance was asked
for and declined on §5.1's ground below. The lamps stand only where the frame
is outside the docking corridor, which is why a long bar carries a pair and
nothing at its middle.

### 5.1 The prohibition

**No station light encodes docking state.** Not clearance, not a grant window,
not hostility, not a refusal. Those belong to the HUD's director
(`hud-and-scanner.md` §3), which owns them because it can also write the reason —
and a red mark alone never carries a consequence. A station whose aperture went
red on denial would be a decorative cue standing in for an instrument, which is
the thing #36 was constrained against, and it would be unreadable at exactly the
range where the pilot needs the answer.

What the lights carry is what the station *is*, which does not change.

### 5.2 Activity is a pure function of the game clock

Every intensity above is `f(gameTime)` — #6's clock, the same one body positions
read. Not `performance.now()`, not a frame counter, not `Math.random()`.

Three consequences, all of them wanted. Two clients at the same seed and clock
draw the same frame. A probe can sample an intensity at a written clock value
rather than waiting for a flicker to happen. And the flicker itself is
deterministic: it is a hash of the quantised clock, so it looks stochastic and
replays exactly.

## 6. Verification

**Headless** (`tests/station-visuals.test.ts`) — the arithmetic:

- the detail bands and their hysteresis, including that a station held at an
  edge does not switch;
- reach is identical at all three detail levels (§2's structural rule);
- both silhouette budgets still hold with the pass applied, and #28's other
  station-mesh assertions are untouched;
- texel buffers are `4 × w × h`, deterministic across builds, and different per
  role;
- activity intensities are pure in `gameTime`, bounded to [0, 1], and the
  strobe's duty cycle is the declared one;
- a strobe sits out on the surface of **the member it is mounted on**, so a
  light cannot be buried inside the thing it is meant to sit on — a fraction of
  that member's own reach, not of the form's declared one, because the Gantry
  declares 1.66 km of boom around a 0.47 km drum;
- every light is within a real fitting's size, carries a glow named like it,
  driven at exactly its intensity, hidden wherever it is, never pickable, its
  drive never above the exposure ceiling, and every pool lies on structure on
  every form (`tests/station-glow.test.ts`); every lamp on every form is seated
  on the structure it is bolted to, by ray (`tests/station-mesh.test.ts`); every
  form's strobe pair turns with its spinner and reads down its own axis; the
  mouth ring's lamps sit an equal step of the period apart and never all light
  at once, and every refinery plan carries a beacon on its headframe and one on
  its flare stack;
- **no fixture named above is wholly hidden from the aperture axis**, at every
  eighth of a turn, by rays cast from three silhouette radii to the fixture's
  own front-facing surface. The row's claim is exactly that and no more: it
  cannot say how much of a fixture shows, and the attempt to make it — a
  fraction of reachable samples — fails, because a weld arc buried in its own
  boom scores 0.67 while measuring 0 px against a heat ring at 0.53 measuring
  526. Visible *area* is a pixel question. A control moves a strobe back onto
  the equator and the row goes red.

**Browser** (`scripts/probe-station-visuals.mjs`) — what no arithmetic reaches:

- **`every fixture §5 gives the <role> reads from its own aperture axis`** —
  per fixture and not per role, each name hidden alone and differenced against
  the frame as drawn, at the clock where that fixture's own drive peaks. A
  lamp's pool of light stays lit while its lamp is hidden, so a pool spilling
  onto visible plating cannot carry a lamp that is itself behind something. A name with no object is a failure rather than a skip, so a
  renamed fixture cannot read as a passing role. Each reading carries the
  fixture's apparent diameter beside it, because a zero cannot otherwise say
  whether it is sub-pixel or occluded and the two want opposite fixes;
- each role is distinguishable from the other two by its *lit* appearance at
  close range, measured the same differenced-mask way #28 measures outline, and
  **still asserted** — #28's outline gate was withdrawn on 2026-08-26
  (`station-types.md` §9.2) and this one was not, because they are different
  claims: a floor on a *shape* metric reshapes geometry, while this one only
  says each role's own fixtures put light of the right temperature on screen;
- the aperture is the brightest feature on the station at docking range, at both
  a desktop and a narrow viewport;
- the detail level actually falls with range (the silhouette half of §2's rule
  is headless, for §2.2's reason);
- the strobes alternate — each is lit at a moment the other is dark — and the
  same clock value replays the same state.

Both tiers are green before this merges; the browser tier does not run in CI
(#14) and is the closer's own obligation.

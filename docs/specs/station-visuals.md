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
dockable contract #9's checks read; `STATION_SILHOUETTE_KM`
(`src/station-mesh.ts`) stays #28's bounded display reach. **Neither table moves
and neither budget rises for this pass.** A visual pass that grew the silhouette
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

The measure is `apparentRadii = distanceKm / STATION_SILHOUETTE_KM[type]` — how
many of its own radii away the camera is.

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
`SELECTED_FORM` form in the form's own kilometres. Every member of every
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
| trade | warm window grid, plus a pair of hull strobes on the beam | the strobes alternate on a 2 s period at a 12% duty cycle |
| shipyard | cool window grid, cold blue-white floodlit bays, and the same strobe pair | one bay carries a welding arc — a fast, deep flicker; the strobes alternate as the trade station's do |
| refinery | glowing vent throats, a heat ring and lit ports on the dock face | the throats and the ring breathe on a slow shallow flicker |

The colours are drawn from `hud-and-scanner.md` §4's grammar rather than a
second palette: cool for structure and work light, warm for habitation and heat.
The aperture keeps #28's amber frame at a fixed intensity.

Every fixture is placed to read **from the aperture axis**, because that is the
one viewpoint defined for all three types and the one an arriving pilot has. The
refinery's lit ports were first put round the drum's side, where they are edge-on
from that axis and drew *zero pixels* — a crewed station reading as an unlit tank
from the only direction anyone approaches it. They are on the drum's face now,
round the pad.

The strobe pair belongs to the **Coriolis hull**, not to the trade station: the
shipyard spins about the same axis for the same reason, so marking it is the
same problem with the same answer. What separates the two roles is the work light — the shipyard's
cold bays and its arc against the trade station's warm grid — and the drydock
frame that is already carrying the outline.

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

The refinery carries no strobes: it does not spin, and a rotation marker on a
station that does not rotate marks nothing. Its flare is its light.

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
- every fixture on a Coriolis hull sums to `r` on the face plane, so a light
  cannot be buried inside the hull it is meant to sit on.

**Browser** (`scripts/probe-station-visuals.mjs`) — what no arithmetic reaches:

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

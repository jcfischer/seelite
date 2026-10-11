# Spec: procedural ship visuals

## 1. Purpose and boundary

Issue #35 replaces the player ship's chase-view cube with a readable, asset-free
procedural hull language. It supplies twelve **visual archetypes** — `courier`,
`interceptor`, `freighter`, `miner`, `patrol`, `explorer`, `raider`, `carrier`,
`tug`, `prospector`, `dreadnought`, and `voyager` — rather than a game roster. Issue #26 remains
the only owner of which purchasable or NPC ship selects an archetype; a future
roster must choose one explicitly and never receive a silent default.

Each archetype has three deliberately different construction concepts. From
round six the rounds stop converging on one hull per archetype and start
accumulating a stable: several concepts per role are viable at once, so an
archetype names a size and job class while its variants name distinct ship
models within it. That widens what the roster can draw on; it does not move the
boundary. Issue #26 still owns which purchasable or NPC entry selects which
hull, and a roster must still choose one explicitly and never receive a silent
default. The courier round spans a broad armored flying wing, a split
bow with long engine shoulders, and a compact offset-cockpit diamond. The
interceptor round spans a dart fuselage, a cropped delta, and an open-rear
twin-boom frame. The freighter round spans asymmetric side pods, an open-spine
catamaran, and a rear-heavy tug. Their silhouette and engine placement are
motion-relevant cues; exhaust is deliberately compact and secondary to hull
mass.

The visual grammar synthesises current space-game practice without copying a
specific craft: Elite contributes the iconic low planform, Star Wars contributes
role-readable functional landmarks and controlled asymmetry, EVERSPACE
contributes class-specific rules over modular parts, No Man's Sky contributes
paint/material variation, and Star Citizen/Starfield contribute layered
industrial construction. Primary mass must remain continuous; secondary panels
may explain structure but must never return to an assembly of disconnected
boxes.

**One archetype is the exception, by the principal's ruling (2026-09-14).**
`voyager` (#331) is a close homage to a specific craft — *Discovery One* from
*2001: A Space Odyssey* — requested with the reference frame. It is still built
from this grammar's primitives and finishes, and its `b` and `c` concepts are
not copies; but the rule above does not describe its `a`, and no later hull
should read this paragraph's absence as permission for another.

The query-gated `?model-viewer=ship` workbench exposes every candidate
without constructing `Game`. A designer can orbit each candidate, apply
temporary proportion controls, and rank A/B/C in preference order per role.
The ranking summary is an iteration input, not persistent game state: it guides
the next three concepts but does not select a roster hull or alter flight.

Round two is derived from the first recorded ranking: courier `B > A > C`,
interceptor `C > B > A`, and freighter `A > B > C`. It therefore explores
divided courier prows and long engine shoulders, closed-belly twin-engine
interceptor frames, and asymmetric or rail-built cargo hulls. Compact diamond
couriers, generic dart-and-wing interceptors, and rear-heavy tug silhouettes do
not carry forward. The workbench labels the active round and resets its ranking
state between rounds.

Round three is derived from the second ranking: courier `A > B > C`,
interceptor `C > A > B`, and freighter `A > B > C`. It tightens the search
around broad divided-prow couriers, close-coupled rail interceptors, and dominant
cargo outriggers. The lowest-ranked Ranger slab, Razorback delta, and Crane
command spear are replaced by paired utility prongs, a three-spine rail frame,
and a cargo-first service-rail freighter respectively.

Round four answers a review of the shape language rather than a ranking. Every
round-three hull was judged boxy — "like an iron press" — and the interceptors
were judged to read as fighter jets. Both are consequences of the construction,
not of the concepts: a planform extrusion gives every part a vertical side wall,
and a pointed nose over a swept delta is the aircraft silhouette whatever the
brief says. So round four changes the primitive rather than the parameters. The
whole round is built from swept superellipse lofts with hard shoulders where a
crease belongs, and the interceptors carry no lifting surface at all: `Lance` is
a drive spine with a radial bell cluster, `Vespid` puts its mass aft behind a
neck, and `Corona` runs an annular drive ring on short pylons. Couriers move to
rounded-rectangle sections with a hard chine along the beam; freighters carry
straight-barrelled drums and tanks instead of lozenges.

Round five is derived from the fourth ranking — courier `A > C > B`,
interceptor `A > C > B`, freighter `A > C > B` — together with a note that the
asymmetric hulls of the earlier rounds were missed. Slots `a` and `c` keep the
winner and the runner-up so their identity survives across rounds, and the
dropped `b` slot is spent on asymmetry rather than on a fourth variation of a
symmetric theme: `Dogleg` puts the courier's keel to port against one deep
starboard load bank, `Cant` cantilevers the interceptor's crew pod off a drive
block that sits to port, and `Porter` returns the round-three freighter thesis
of a dominant cargo outrigger beside a compact command keel. Port and starboard
drives stay named and structurally mounted on these hulls; they are simply not
the same drive.

Round six is derived from the fifth ranking — courier `A > B > C`, interceptor
`A > C > B`, freighter `B > C > A` — which for the first time is not the same
order in every role, and which puts an asymmetric hull first. Each role keeps
its top two and replaces only its last: `Meridian`, `Cant`, and `Dray` go. The
three replacements all probe the one layout axis the surviving pool never uses.
Every hull the rankings kept spreads its mass sideways; `Skiff`, `Yoke`, and
`Derrick` stack it instead, hanging drives above or below the keel. That changes
the head-on silhouette rather than only the plan view, which is the view a pilot
actually gets of another ship.

The first nine hulls are settled at round six and stop iterating. Round seven
adds three roles rather than more variations of the three that exist: `miner`
works rock, `patrol` enforces, and `explorer` goes out and stays out. Each
arrives with three concepts spanning the layout axes the earlier rounds
established — laterally paired, asymmetric, and stacked — so a new role starts
where the old ones finished rather than repeating their first three rounds.

Round eight is derived from the seventh ranking: miner `C > A > B`, patrol
`A > B > C`, explorer `B > C > A`. `Scree`, `Picket`, and `Sounder` go, replaced
by `Longwall`, `Bailiff`, and `Pilgrim`. The same review reported a defect
rather than a preference — two explorer hulls carried the survey dish directly
ahead of the canopy — so `Vagrant` moves its dish aft and outboard onto the
bunker, and the forward view became a tested contract rather than something
each hull is trusted to get right.

Round nine settles the first eighteen hulls and adds `raider` and `carrier`.
`raider` is the outlaw counterpart to `patrol`, and it is the reason the
proportion assertion now compares every pair of roles rather than the first
three: the raider's opening silhouette was close enough to the patrol hull's to
be mistaken for it at range, which is the one confusion this pool cannot afford.
The hull was narrowed rather than the assertion loosened.

`carrier` is a capital class, roughly seven couriers long. Nothing else in the
pool needs a second glance to tell which of two ships is bigger; this one has to
answer that at a distance, and a starfield offers no absolute ruler. What it
reads from is the count of things on it that are obviously small — rib frames at
a fixed pitch, rows of lit ports, a bay mouth a courier could fly into — so its
detail is many small repeated parts rather than a few large smooth ones. Its
three concepts sit on the same layout axes as every other role, so a capital
ship is a class rather than a scale trick.

A ninth role, `liner`, was built in this round and cut on review. Nothing of it
remains; the passenger role is open.

The capital hull also forced the workbench to stop assuming one camera. The
stage now derives its orbit radius, zoom limits, grid and clip planes from the
selected hull's declared reach, because a fixed 0.12 km orbit — fine while every
hull was within a factor of two of the next — puts the camera inside a capital
ship.

Round ten fills the passenger gap with three roles that are not it: `tug` works
station and salvage, `prospector` cores rocks and registers claims, and
`dreadnought` is a second capital class. Two capital classes only earn their
places if they cannot be confused at the range a capital ship is first seen, so
the dreadnought is longer and narrower than the carrier and wears its armour
outside: where the carrier counts bay mouths and deck lights, this one counts
turrets and belt ribs.

Placing them was arithmetic before it was drawing. With eleven roles the
pairwise proportion assertion has fifty-five pairs to satisfy, so each new hull
was aimed at a gap in the existing spread rather than drawn first and measured
after. `Rampart` initially cleared `Sluice` by 0.014 on a 0.08 threshold; the
hull was made leaner rather than the margin left as a trap for the next edit.

The workbench needed a second fix for this round, and a browser probe found it
rather than a reader: at a 390 px viewport the Role tabs were laid out in three
fixed columns, which fitted three roles. Eleven overflowed the fieldset and the
next one came down on top of them, leaving a tab that cannot be clicked. The
tabs now fit to the available width and the narrow panel is a single column.

Round eleven adds a third capital class rather than a ranking of the pool:
`voyager`, the expedition hull (#331). All three concepts share a command
sphere with its glass set low in the bow and a thin vertebral spine behind it
— the silhouette the homage is of — and spend the layout axes on the rest:
`Odyssey` is the reference, with paired drives and a dish array on a mast;
`Wayfarer` balances a port tank bank against a starboard dish; `Lodestar`
raises the spine, hangs a run of pods under it and stacks its drives. Placed by
the same arithmetic as round ten: at about half the carrier's reach it is
compared only with the carrier, and at more than six lengths to its height it
is far slenderer than either capital, which `tests/hull-voyager.test.ts`
asserts at half again the slenderer of the two. It docks nowhere by length
rather than by section — its section would pass a slot — and
`tests/aperture-fit.test.ts` states that difference rather than leaving
"capitals fit no aperture" to be read as true of it.


## 2. Rendering contract

All hull geometry is generated at load from swept superellipse lofts and
compact engine bells. One primitive covers the whole language: stations carry a
half-beam, a half-height above and below the centreline, and a superellipse
exponent, and the sweep resamples them onto a Catmull-Rom spline. Rotating that
sweep's own axis onto the ship's +X turns it into a blade for pylons and
radiators; circular stations turn it into a body of revolution for drums, tanks,
and nozzles. A station may be marked hard, which ends one spline and starts the
next so the two sides meet with different tangents and leave an edge — the
curvature is what stops a hull reading as a box, and the crease is what stops it
reading as inflated. It is deterministic, has a tested
local reach budget, needs no downloaded asset, and contains no simulation
position, collision, target, or AI data. `sim.ts` remains the float64 authority;
renderer objects are its camera-relative shadow.

The player hull is the courier `Kestrel`, named in `main.ts` as an explicit
`(id, variant)` pair. `buildShipMesh` defaults its variant, and a default is
what this spec forbids a roster to take; naming both halves means #26 can see
what it is replacing when it arrives to own the choice properly.

**Since node #812 the courier's selected variant draws an authored model**, the
O4 hull the principal approved on #795 (`src/courier-hull.ts`, loaded from
`src/models/courier-hull.glb` after the `Game` is built, since node #831). It
was the first hull here that is not lofted: it carries its own textures and machinery, so the
finishes, the plating and the greeble zones above do not reach it, and only
its drive glows follow the finish. Its scale is set by the courier's declared
57.5 m length, which every hull's turn rate is solved against; its beam and
height are measured off it, and the courier's envelope and vent placement
are now the O4's.

**So the procedural Kestrel is a stand-in, not a courier the game chooses.**
Built, it is 57.49 × 51.20 × 11.65 m against the declared 57.5 × 52.4 × 9.6 m
— two metres taller than the collision box — and the courier's vents were
measured on the O4. Since node #831 a live `Game` is built on it and the
model replaces every courier once it installs
(`Game.loadAuthoredHullsAfterBoot`, `rebuildAuthoredStandIn`); a failed
download keeps the Kestrel, warns once and shows no Retry. The postcard and
the ship workbench wait for the model behind the Retry panel. Outside
flight it is drawn wherever the model is not installed: the headless rows
that hold the hull generator (`tests/helpers/procedural-courier.ts`), the
cost instrument's comparison arm (`scripts/measure-courier-hull-cost.mjs`),
and the cockpit spike's review page (`src/courier-cockpit-viewer.ts`).

**The detail band switches the model.** Every Traffic courier is the O4, so
past `DETAIL_RADII.full` a courier draws a reduced copy of it and past
`DETAIL_RADII.reduced` a coarser one, each made by meshoptimizer's simplifier
to a **target error** of half a device pixel at its band edge **in
`LEVEL_FRAME`** — the near camera's 60° field of view on a frame 1800
device pixels tall, the player's retina panel and the frame the cost
instruments measure on (`courierLevelErrorKm`). It is a target and not a
bound. The error is the simplifier's own metric, which it reports reaching
and `tests/courier-hull.test.ts` holds inside the target; nothing measures
how far a level actually lies from the model. The band's hysteresis draws
`reduced` somewhat nearer than `DETAIL_RADII.full` on the way back in, and a
taller frame sees the same error at more than half a pixel, in proportion to
its height. How visible the switch is, is judged by eye in flight. The cabin and the pilot are left out of both levels, and
neither level takes a ray, so everything placed on the hull is placed on the
approved model. Inside the first edge — the
player's own courier in chase among them — the model is drawn as approved.

**Since node #814 the tug's selected variant is an authored model, by the
courier's path.** Bollard O4, the salvage tug the principal approved on #798
(`src/tug-hull.ts`, `src/models/bollard-tug.glb`), replaces the tug loft,
which now only stands in until the model installs after boot; the courier
installs first. Both hulls are built by `src/authored-hull.ts`, so the
detail band, the drive glows and the stand-in's replacement are the
courier's. Two differences: **it is drawn at 1:1**, so the tug's envelope is
the model's own box (56.6 × 48.4 × 21.2 m, against the loft's 58.5 × 45.7 ×
25.7) rather than the model being scaled to a declared length; and its
drive glows are placed by measurement, inside mouths that the barrel's end
cap closes at z −26.0 m (`TUG_NOZZLES_M`). Until the model installs, the
loft is 4.5 m taller than the declared box. The figures are
`tests/tug-hull.test.ts`'s and `tests/bollard-asset.test.ts`'s.

**Since node #815 the miner's selected variant is an authored model too**,
Longwall B (`miner/b`, `src/models/longwall-miner.glb`), and its levels are
made by the same module (`src/authored-levels.ts`), with two differences.
Its medium level is made to half a device pixel at 10 miner reaches
(`LONGWALL_MEDIUM_RADII`) rather than at the band's first edge, and **a
miner other than the player's own draws it however near** — a berth beside
the player included — by the principal's ruling of 2026-10-09: the band
holds it at `nearest` unless `updateShipVisuals` is told the hull is the
player's own. And its levels keep every lamp whole and collapse edges
across seams. The figures are `tests/longwall-mesh.test.ts`'s.

The player hull is a near-scene object. It is hidden in cockpit view because the
cockpit HUD, attitude floor, target director, and scanner remain the primary
flight references. Chase view makes that same hull visible as an external
orientation check, and the chase camera orbits it: `1` and `3` swing the camera
to port and starboard while held, `2` returns it astern. The orbit turns the
whole rig — position and look direction share one yaw about the ship's own up
axis — so the range to the hull never changes, which is what a browser probe
asserts rather than trusting the arithmetic. The angle survives a view toggle,
because a look the player set up is a look they meant. Chase shows that hull and nothing else.

An earlier pass put an interceptor and a freighter alongside it as a
relative-scale check. They were children of the player mesh, so they inherited
its orientation exactly and turned with it — glued to the hull rather than
flying beside it. The chase orbit made that impossible to miss, and they are
gone. The workbench does that job properly, framing each hull against its own
declared reach, and traffic that reads as traffic needs simulation positions,
which are #26's to give. A browser probe now asserts the count of hulls in the
near scene rather than the absence of two particular names, so anything parented
there in future has to be a deliberate change to that line.

Target identity follows [#52's contact model](https://github.com/jcfischer/seelite/issues/52), implemented by `display-contact.ts`: producers supply velocity, neutral legal status and scanner classification outside the generated body list.

Hulls do not participate in the body far/near handoff, so the existing
kilometre-scale body handoff stays untouched.

`?fleet` parks every model in an avenue the player can fly down, ordered by
declared reach so the walk runs smallest to largest. It is gated because
thirty-six hulls is a showroom rather than a star system. Each hull is a
targetable `ship` contact, named for its model, with zero velocity, `null` legal
status and `unknown` scanner classification. Unselected ship markers show the
model name and range where the label fits without overlapping another label;
selecting one always uses the existing amber target cue and reserves its label
space first. There is no NPC behaviour or collision.
Behind the gate it is a static arrangement anchored
once to the ship's boot position and facing, with no entry in `sim.ts` and no
roster meaning.

Two figures in that layout are answers to measurements rather than taste. The
gaps are far wider than clearance needs, because full throttle is 2 km/s and an
avenue packed as tightly as the hulls allow is gone in under three seconds. And
the middle variant of each row is lifted off the centre line, because three
hulls spread evenly about the axis put one of them exactly where the player is
flying — and with no collision in the scaffold, that means passing through a
ship, which reads as a rendering fault rather than as a fleet. Headless tests
own both: that no two hulls intersect, and that the lane down the middle stays
open.

## 3. Surface: one generator, a plate, a cut seam and an edge

Issue #101 gave the hulls a surface. Before it, `makePalette` built seven
materials per archetype from a colour, a roughness and a metalness and nothing
else: eleven archetypes across three concepts, and every large flat plate on
every one of them was a single value.

**The generator is shared, not copied.** `surface.ts` owns the arithmetic —
plate, wear and seam-normal texels from a `PlatingProfile` and a tag — and
`station-visuals.ts` (#36), `ship-surface.ts` and, when #105 lands, the cockpit
each hand it a profile. The alternative on the table was a second, ship-only
system. It was declined on a measurement rather than on taste: `hullLoft` writes
its UVs in **kilometres**, and `hullLoft` is this module's own primitive that
stations borrowed in #56. A station's plating was therefore three lines and a
panel size away from being a hull's, and a second generator would have been the
same arithmetic written twice, then three times.

What differs between the two consumers is one constant and one profile:

| | station | ship |
| --- | --- | --- |
| map | 128 texels | 256 texels |
| tile size | `STATION_PANEL_KM` 0.15 km | `SHIP_PANEL_KM` 0.008 km |
| plate | ~19 m square | 1 m x 4 m |
| bond | aligned grid | staggered half a plate |
| groove | none (painted) | 1 texel of 32, ~6% |
| seam | painted, 0.30–0.50 | cut, 0.18 painted + 0.55 in the normal |
| weathering | 0.12–0.78 | 0.10 |
| filtering | nearest | linear |
| finish | one per role, in the profile | four per hull, rescaled per material |

Nineteen metres on a 54 m courier puts three plates on the whole ship. One metre
is a figure set by looking at a frame and nothing in this repo can check it —
#104's finding, which applies to a plate more than to most numbers, because a
plate is the **ruler** a pilot judges a hull's size against.

**The layout is the other half, and the first version got it wrong.** Square
plates on an aligned grid, with a groove two texels either side of a 16-texel
pitch, was flown and called *scales*. Every failure was in the same direction —
a wall of identical squares is tiling, and a quarter of every plate bevelled on
all four sides domes each one into a pillow. A 25 cm chamfer on a one-metre
plate, where a real seam is millimetres.

What replaced it is what plating is: rolled strips, four times longer than they
are wide, laid in a **brick bond** so no seam runs the length of the hull, with
the seam a scribed line rather than a bevel. The map went to 256 texels for the
groove alone — a seam has to be one or two texels, and that is only small if a
plate is thirty-odd texels across. The stations kept the square grid: their
plate is nineteen metres, read from kilometres away, and their look is #36's to
change.

The layout lives in the profile — `aspect`, `stagger`, `seamHalfWidthPx`,
`variation` — so the station roles declare the grid they already had rather than
inheriting it by default, and the four checksum pins prove those figures
reproduce #36's buffers byte for byte.

**Panel lines are cut, not painted.** That is the half the station system did
not have. A darkened texel is a decal: it reads the same from every angle and a
moving sun sweeps over it. A seam in the normal map is lit, so the star breaks
across it as the ship turns, which is what the reference frames do. The albedo
still darkens the same texels — a groove in shadow *is* darker — and both maps
read one boundary set (`seamOffsets`) so the emboss cannot land anywhere but on
a painted seam. The stations were deliberately left painted: `seamDepth` is 0
for all four roles, an answer rather than an omission, because changing how a
station looks is a judgement somebody has to make in front of a frame.

**Wear comes from two places, because they answer different questions.** The
map's streaks give plate-to-plate variation and know nothing about where an edge
is; a texture has never been told which plates meet. The geometry has been.
`hullLoft` writes a per-vertex `crease` attribute — the largest angle between a
vertex's shading normal and any face meeting there, which is exactly what
`computeVertexNormals` has just averaged away at a `hard` station or a chine —
and the hull material patches it into `roughnessFactor` and a small albedo lift.
The shape it has to have is that edges are a **minority**: a wear term reading
high everywhere is a wash, not wear. Both ends are checked, over every
archetype rather than one — a share of exactly-zero vertices inside 60%–90%,
and a share above 0.6 inside 0.5%–15%. Each bound alone passes on a constant: a
term wired to 0 reads 100% zero, one wired to 1 reads none.

Measured across the roster: zero 70.8%–81.4%, hard edges 1.58%–7.15%. The
*saturating* share is deliberately not asserted, because it is not a property of
the term — the courier saturates on 2.40% of its vertices and the dreadnought on
none, which says how sharp each hull's creases are and nothing about whether the
term works. An earlier version of this paragraph quoted one hull's reading as a
contract, and quoted it wrong.

#98 binds the whole of this: depth and light, forms stay clean. Hulls are crisp
built objects, the wear is subtle, the panel lines geometric. The grime is
refused, and `weathering` at 0.10 is not zero only because seams with no
plate-to-plate variation at all read as a decal sheet.

**Nothing here implements lighting.** The crease patch writes `roughnessFactor`
and `diffuseColor` inside three.js's own chunk order and leaves the sun, the
fill, the environment and the tone mapping where they are — `station-surface.ts`
holds the same line, and for the same reason: a second lighting model would have
to be reconciled with #57's planet shaders. Every splice records whether it
found its marker (`shader-splice.ts`), because a missed splice leaves a stock
material that compiles, links, renders and reports its own name.

**The quality gate.** `low` drops the seam normal map and keeps the plate and
wear maps; the seams do not disappear, they stop being lit. It is switched live
on the material rather than at load, per #99: a reload puts the ship somewhere
else, and two frames from two positions measure the positions as much as the
term.

### 3.1 Finishes: the surface and the shared primitives as a preset (#203)

#199's review read every hull as one flat pastel loft at one detail scale — a
cyan sticker for a drive, torus hoops that read as rubber bands, a plate that
is the ship's only ruler — and the principal's steer was industrial: the ISS
and the Nostromo. A **finish** (`HULL_FINISHES`, `ship-surface.ts`) is
everything about a hull that is not its silhouette, and it is a preset the
workbench switches the way it switches a variant, so the sheet is captured
under every finish and the principal picks. Four ship: `stock`, `plated`,
`industrial`, `worn`.

`stock` is the hull that shipped, byte for byte: `tests/ship-finish.test.ts`
hashes every hull's positions and UVs against a pin taken on `main`. The
other three share a **second plating octave** (`PlatingProfile.macro`,
`surface.ts`): a 4 m × 8 m panel group with a six-texel groove and a
per-group tone spread, on a 512 map with a 16 m tile so the plate stays a
metre. They mute the livery toward its own luma, and splice a **grazing-angle
rim** after three's emissive chunk so a dark hull separates from a dark sky
without a light. `industrial` and `worn` also change the two primitives every
builder shares: the torus hoop becomes a twelve-facet flanged **collar**, and
the exhaust disc becomes an **open bell** — the bell's loft folds back at the
lip to a small throat, and a `BackSide` bowl inside it carries a throat-to-lip
emissive ramp — with the `-bell`/`-exhaust` names and the half-span rule kept.
`worn` raises the streaking toward the Nostromo and reverses #98's refusal
of grime — **the principal's call, made on the second sheet (2026-09-06),
and `worn` is the default** (`DEFAULT_HULL_FINISH`). `nostromo` is one
step past it — deeper streaks, sooted plates (`streakDepth` and `soot` on
the profile), paint most of the way to grey — and stays a preset, as does
`stock`, which is #35's hull as it shipped and is what the roster hash pins.
No finish moves a hull's **envelope**: the collar and the open bell keep the
torus's and the disc's box to within 5 cm, because the envelope is the
berth catalogue's fit predicate, and `tests/ship-finish.test.ts` holds it.

The finish is module state read at build time, and the game never switches
it: `setHullFinish` exists for the workbench, and a test that sets one must
restore the default. `scripts/shot-finishes.mjs` is the sheet's instrument and
refuses a software rasteriser, for `capture-views.mjs`'s reason.

### 3.2 Authored machinery regions, emissives and the shared detail band (#130)

Each of the thirty-six current variants declares a named surface patch beside
its builder entry: the exact plated part, the face of it, and the longitudinal
interval where machinery belongs. The fill is generated from
`DOMAIN.SHIP_GREEBLES`, split again by hull, variant and zone name. This is not a
scatter over whatever triangles happen to exist: the declaration says where
machinery belongs, and every generated crate, tank or fin is ray-mounted back
onto that named plated mesh. A structural check keeps that machinery smaller
than the base hull's reach; the headed view set owns the stronger judgement that
it remains subordinate to the local contour and never reads as a new outline.

Every hull also carries one paired set of steady cool service rails. The
existing four-point red/green/white/amber navigation-light fixture remains a
non-semantic aspect cue and does not acquire docking, hostility or damage
meaning. Lit habitation panes belong only to the extant hull classes with the
volume the original #102 ruling named: freighter, carrier and dreadnought. The
liner from that ruling was cut in round nine and is not silently replaced by a
different role. Voyager post-dates #102 and still receives an explicit authored
machinery zone and strip rather than inheriting a default.

`detail-level.ts` owns the one directional full/reduced/outline state machine
used by stations and ships. The ship renderer draws generated clutter only at
`full`; steady strips, habitation panes and navigation beacons remain visible
at every band. The independent quality gate has the same boundary: `low` drops
all generated greeble instances and keeps every emissive. The player, raider,
ordinary traffic and fleet-review hulls all receive the gate from their actual
camera-relative range each frame, including ships materialised after a setting
change.

## 4. Verification contract

Headless tests assert every candidate has stable hull and variant identity,
deterministic bounds, declared reach, distinct design theses, compact exhausts,
intersecting canopy fairings and structurally mounted nacelles. The mount
assertion names no side: it was written as port and starboard, which outlawed
any drive layout that is not laterally paired, and the rankings kept choosing
the layouts it forbade. It now says what it always meant — every nacelle
intersects some named mount, so none of them float.

A further test walks the pilot's forward sightline out to the hull's declared
reach and asserts no solid module sits on it. It was first written as an
allowlist of part names and review found four parts it silently passed; it is
now the other way round, with two exemptions decided by construction rather than
by name. A torus is open, and an axis-aligned box cannot see the hole in the
middle of one. A strut is thin: `strut()` stamps `userData.thin`, so a pylon or
a stay is something the pilot sees past rather than through. Widening it found
eleven sensor blisters parked at eye height in front of the glass, which the
allowlist had never looked at. Every other check in this file measures a part against the hull; this is
the only one that measures it against the view out of the canopy, which is why
the dish defect survived until a designer looked at a render. A viewer probe
verifies every candidate, per-role ranking, isolated draft controls, and the
absence of `Game`. A live browser probe verifies that the courier is present
only in chase view and that returning to cockpit restores the live cockpit
instruments and overlay.

Lofted command bodies, nacelles, and fuselages must contain indexed front and
rear caps, and every side and cap triangle of those parts must face outward.
The scope is named because the test enforces exactly it: parts whose name
carries `fuselage`, `cockpit`, `bridge` or `nacelle`. Chines, fins, blisters,
struts and hoops are not inspected. That is a gap and is written down as one
rather than described as a universal contract — the parts that are checked are
the ones whose inward wall would show as a false transparent cone across a whole
hull, and the ones that are not are small enough that the failure would read as
a speck. This winding is a
rendering contract: an inward near wall is culled and exposes the far wall as a
false transparent cone. Outwardness is measured against each part's own recorded
centreline rather than against -Z, because a blade is swept along +X and a strut
is oriented between two arbitrary points; a cap normal is compared with the
direction from the part's middle towards that end. Concepts with visual negative space must still expose a
continuous ventral structure, and the inspection viewer supplies neutral
underside fill so solid geometry does not read as a missing face.

The surface has its own two tiers. Headless (`tests/surface.test.ts`): every
station buffer is pinned to an **absolute checksum** taken by running the
shipped generators at `01427e4`. That guards against drift from the day the pins
were taken and no further — it cannot prove its own provenance, because pins
taken from the new code and labelled as old would satisfy every assertion
identically, so the claim that they came from the parent commit lives in a
commit message and not in anything a machine checks.

The seam normal map is asserted **in register with the painted seam** by
comparing the two maps on a row rather than by comparing their boundary lists,
and `plateTexels` reads `seamOffsets` rather than recomputing the panel
arithmetic — the first version did both wrong at once, computing an albedo it
never read while the generator kept its own copy of the expression. The crease
term is asserted in both directions: a constant-section tube reads under 0.2 on
its swept surface while the same tube with a hard shoulder reads over 0.6, so
neither a term wired to 0 nor one wired to 1 survives.

One wear map serves four paints, and the test asserts the product the shader
forms — `material.roughness × map.g` — for each of `hull`, `panel`, `trim` and
`accent`, with a control on the count and a second test that the four differ
from each other. Forcing the scalars to 1 is a repaint of three of them and it
turns that test red.

In the browser (`probe-ship-visuals.mjs`), the check that matters is that the
seam map **reaches the frame**, and it took two wrong levers before it was one.
Toggling the quality setting passed at 30.3% of hull pixels on a build whose
seam map was generated flat, because `low` also drops the baked environment
(#99). Nulling `material.normalMap` passed at 29.0% on that same flat build,
because attaching any normal map changes three.js's defines and sends the
fragment down a screen-space tangent frame — the map's *presence* moves pixels
on its own. The lever is the map's **texels**, overwritten in place with the
texture marked dirty and the material left alone: same program, same defines,
same sampler. On the flat build that reads exactly 0.0% and fails; on the
shipped one it reads 12.0%. The mask is the pixels that change when the hull is
**removed from the scene** rather than hidden, because `render` reassigns
`shipMesh.visible` every frame and the flag version returned an empty mask while
every record-level check stayed green.

Neither tier can say the hull looks right. #98 and #104 own that: this node
closes on the canonical view set and the principal's yes, not on a green probe.

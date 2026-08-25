# Spec: procedural ship visuals

## 1. Purpose and boundary

Issue #35 replaces the player ship's chase-view cube with a readable, asset-free
procedural hull language. It supplies eleven **visual archetypes** — `courier`,
`interceptor`, `freighter`, `miner`, `patrol`, `explorer`, `raider`, `carrier`,
`tug`, `prospector`, and `dreadnought` — rather than a game roster. Issue #26 remains
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

Hulls do not participate in the body far/near handoff, so the existing
kilometre-scale body handoff stays untouched.

`?fleet` parks every model in an avenue the player can fly down, ordered by
declared reach so the walk runs smallest to largest. It is gated because
thirty-three hulls is a showroom rather than a star system, and because a hull
the player can fly past but never scan, target or collide with would be a lie in
the shipped game. Behind the gate it is honest: a static arrangement anchored
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

## 3. Verification contract

Headless tests assert every candidate has stable hull and variant identity,
deterministic bounds, declared reach, distinct design theses, compact exhausts,
intersecting canopy fairings and structurally mounted nacelles. The mount
assertion names no side: it was written as port and starboard, which outlawed
any drive layout that is not laterally paired, and the rankings kept choosing
the layouts it forbade. It now says what it always meant — every nacelle
intersects some named mount, so none of them float.

A further test walks the pilot's forward sightline out to the hull's declared
reach and asserts no solid module sits on it. Rings and hoops are exempt: they
are deliberately open, and an axis-aligned box cannot see the hole in the middle
of one. Every other check in this file measures a part against the hull; this is
the only one that measures it against the view out of the canopy, which is why
the dish defect survived until a designer looked at a render. A viewer probe
verifies every candidate, per-role ranking, isolated draft controls, and the
absence of `Game`. A live browser probe verifies that the courier is present
only in chase view and that returning to cockpit restores the live cockpit
instruments and overlay.

Lofted command bodies, nacelles, and fuselages must contain indexed front and
rear caps, and every side and cap triangle must face outward. This winding is a
rendering contract: an inward near wall is culled and exposes the far wall as a
false transparent cone. Outwardness is measured against each part's own recorded
centreline rather than against -Z, because a blade is swept along +X and a strut
is oriented between two arbitrary points; a cap normal is compared with the
direction from the part's middle towards that end. Concepts with visual negative space must still expose a
continuous ventral structure, and the inspection viewer supplies neutral
underside fill so solid geometry does not read as a missing face.

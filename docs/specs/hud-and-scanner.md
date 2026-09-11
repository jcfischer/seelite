# Spec: HUD, scanner, and cockpit

**Status:** proposed design decision — [#34](https://github.com/jcfischer/seelite/issues/34)  
**Date:** 2026-08-20  
**Context:** flight (#5 and #21), docking (#9), and target-marker (#10) work
provide the simulation surfaces this visual contract will eventually consume.

## 0. Scope and vocabulary

This is the cockpit-first language for a pilot flying normal, assist-off, cruise,
targeting, and docking states. It does not replace #21's flight model, mouse
controls, or target-marker math, and it does not implement combat.

**The galaxy map is not excluded, it is owned elsewhere.** This paragraph read
"it does not implement #11's galaxy map" while #11 was closed and the chart
mounted — so a reader learned the map was out of scope and not who has it. The
chart is [#96](https://github.com/jcfischer/seelite/issues/96), on the left
console's sibling tab (§5); the finder is
[#115](https://github.com/jcfischer/seelite/issues/115). What this spec *does*
own of the map is §5.2 below: `galaxy-map.md` §8.3's course cue is a cockpit
instrument, and #117 put it on the floor.

**It does own the market**, since #70. The original text of this paragraph
declined it while `economy-trade.md` §11 was handing it here, and the screen was
owned by nobody for as long as neither half was buildable. §8 is the answer and
§8.1's M1 is why it lives in the cockpit at all.

A **flight floor** is the small set of information that remains on glass. A
**director** is the centred, target-specific guide that temporarily answers the
pilot's immediate action. The **compact scanner** is a read-only local radar. A
**side panel** is an intentional, dismissible view; it is never a permanent
column of text.

## 1. Cockpit hierarchy and ownership

The cockpit is a target-primary cockpit: the selected target and its interaction state lead
the flight view. The left panel owns Navigation and Communications; the right
panel owns Flight and Drive. That split gives every future screen a home without
turning the flight view into an opaque wall of labels.

The game continues while either panel is open: there is **no pause and no time
compression**, flight controls remain active, and an explicit close action
returns to an unobscured cockpit.

**Docked, the split gains a third member: the forward wall carries the station
console** (§8's M2). Left and right are unchanged. The forward wall is never a
panel in the flying state: it carries the console only while docked, from the
completion of #73's E3 arrival (§8's M4) to launch (M9).

## 2. Compact scanner

The compact scanner is persistently visible at the **lower centre of the
cockpit** — in the flying states. §8's **M10** removes it while docked; this
section describes the state it serves. It is a **local radar**: a large, shallow concentric
elliptical base. Each contact uses a **vertical mast** anchored to a small
**anchor disc** on that plane, so the separation is read as height rather than a
slanted vector. Bearing and range read from the base, not a detached top-down
map. The gallery uses fixed review fixtures for its contacts; the integrated HUD
must derive contacts from true simulation positions rather than the
camera-relative near/far render layers. It is read-only: its job is spatial
awareness while the pilot flies, not accidental target selection under mouse
control.

It is strictly local, with deliberate fixed range steps up to the **10,000 km
vicinity**. Navigation is authoritative for target selection and filters, while
`T` remains the quick-cycle shortcut. System-scale discovery, filtering, and
target records therefore belong to the left Navigation panel.

## 3. Target and docking director

The right-hand cockpit Target instrument shows a designation between its title
and target name/range: `STAR`, `PLANET`, `MOON`, `STATION · <TYPE>`, or
`SHIP · <HULL TYPE> · <SCANNER STATUS>`. The producer supplies a ship's type;
it is never inferred from the display name. Unclassified review hulls show
`UNKNOWN`, not a fabricated legal status. The designation updates on target or
classification changes and leaves the separate ETA line in place (principal
request during #198).

The on-glass director retains the selected target after Navigation chooses it.
During target acquisition, an amber **target-circle arrow** rotates around the
circle's perimeter to the target bearing and points in the direction the pilot
must turn. It replaces a bare angular readout: an arrow produces an action while
"12° left, 4° up" merely describes a problem. Combat inherits this same cue
rather than inventing a second aiming language.

For a local station it becomes a docking director: an axis-alignment funnel, a
roll-match ring when the station has a slot, and explicit clearance, grant, and
hostile state. It makes #9's checks legible; it does not automate them.

Granted clearance uses a positive state and the remaining window. Denial or
hostility is blocking: the director says **do not enter** and writes the reason,
so a red mark alone never carries the consequence.

## 4. Attention and visual grammar

Attention order is: blocking danger or failed clearance; immediate flight or
docking action; selected-target state; then passive system information. Important
states use shape, text, and restrained motion as well as colour:

- cool cyan/blue: passive instrumentation and stable reference;
- amber: selected target and actionable prompt;
- green: confirmed or clear state;
- red: blocking danger or refusal.

The design deliberately carries meaning through shape and text as well as
colour; a future accessibility pass must validate contrast and non-colour cues.

## 5. Persistent floor and side panels

The persistent flight floor contains attitude/nose/prograde-retrograde, the
compact scanner, selected-target or docking director, and a compact
mode/throttle/assist/charge strip. This is the minimum that keeps a hull-hidden
cockpit flyable and honest about cruise charge.

The browser prototype renders this language as a **3D cockpit**, not as a set of
flat application cards: a framed canopy opens on the flight glass, faceted side
consoles recede toward the pilot, and a physical lower-centre dash deck carries
the scanner. The gallery renders canopy, deck, and console housings in its own
Three.js scene, with a cockpit camera and shallow idle parallax. The lower radar
is a DOM/CSS instrument positioned on that physical deck, so its rings, masts,
and anchor discs remain independently inspectable. The modern spaceflight
reference guides the presentation only; simulation ownership remains with the
existing flight, target, and docking work.

**While docked this rule is amended by §8's M2**: looking forward returns the
station console rather than flying glass, and M10 removes the lower-centre
radar for the duration. Everything below describes the flying state.

Navigation/Communications and Flight/Drive/Tuning are **separate physical
consoles**, not persistent sidebars. The forward view deliberately leaves their
readable surfaces out of the working field (only their cockpit structure may sit
at the edges). Turning the cockpit view left or right makes the corresponding
large console display the primary view; looking forward returns to flying glass
and the lower-centre radar.

Navigation lists filterable targets with type, range, ETA, and the expanded
scanner, and the left console carries the galaxy chart on a sibling tab
(`galaxy-map.md` §1) that replaces the Navigation body and retitles the header. The
list is the **finding** surface and the chart the **reading** one: §5.1 of that
spec measured that no camera distance both frames the cluster and lets a system
be picked, so the list is load-bearing rather than a convenience. Ranges refresh
every frame and the estimates on `ETA_INTERVAL_S`, because a range is a
subtraction and an estimate is an integration of the cruise law per row.

Communications carries clearance requests and replies, hostile/legal
status, and actionable messages. Flight presents speed, throttle, assist, current
regime, and relative motion. Drive presents cruise charge, range, regeneration,
and future equipment state. Developer tuning parameters move to a **Tuning tab**
on the right panel: they are available while tuning the prototype, but never
occupy the persistent player flight floor.

### 5.1 The mode/throttle/assist/charge strip

Built under #92. It draws along the **bottom of the glass**, above the deck and
below the cruise prompt, and it is the last of §5's four floor instruments to
ship.

**What each of the four had before it, checked rather than assumed:**

| field | before | where |
|---|---|---|
| mode | `NORMAL FLIGHT` / `CRUISE` | the right console's Flight/Drive copy |
| throttle | a percentage, and an unlabelled lit wedge | that copy, and the deck |
| assist | **nothing** — a label with an empty value | the right console's readout row |
| charge | `CHARGE 12.0 AU` | the **target** instrument's secondary line |

So the gap is not that these were invisible. It is that §5 distinguishes the
**persistent floor** from the **side consoles**, and puts a compact strip on the
floor *as well as* giving the Flight console speed, throttle, assist and regime.
A console is read by turning the head away from the glass; the floor is what
keeps a hull-hidden cockpit flyable while looking forward, which is the sentence
this strip exists to satisfy.

Two consequences worth stating plainly. **The overlay drops nothing** — `#hud` is
`clip: rect(0 0 0 0)` and is only written under `?legacy-hud=1`, so §5's rule
that developer tuning must never occupy the floor was already satisfied; it was
never on the floor. And **assist and charge were advertised on the console and
never wired**: the markup has carried `<b>ASSIST</b><em></em>` and
`<b>CHARGE</b><em></em>` since the console was built, which reads as a broken
instrument rather than an unbuilt one. Both are filled now, from the strip's own
cells, so the console and the floor cannot describe one fact two ways.

Charge also **moves off the target instrument**: a second consumable with its
own regeneration read as a property of the thing being flown to.

**On the glass rather than on the deck.** The deck's only clear band is the
2.3 mm lip outside the scanner bezel, which at the shipped dashboard pitch is a
foreshortened sliver — and #94 is the recorded case of a geometrically honest
cockpit instrument being unreadable and having to be rebuilt as a compressed
on-glass one. The floor is the persistent instrument *set* and not a single
surface: §5's attitude and prograde markers are already on the glass, and this
joins them. It is not a DOM card either, which is a distinction
`probe-live-cockpit.mjs` already asserts (`[data-live-floor]` must be absent).

| cell | reads | tone |
|---|---|---|
| MODE | `NORMAL`, `CRUISE`, or `SPOOL 1.4s` | passive / confirmed / action |
| THR | the throttle, rounded to a percent | passive |
| ASSIST | `ON` or `OFF` | passive / **action** when off |
| CHARGE | `4.2/12 AU  +1.0/min` | passive, **refused** when empty |

Spooling **outranks the regime**, because on the frame a drop-out fires the
regime field still reads cruise. Assist off is amber rather than cyan: it is
#5's Newtonian regime, where the nose and the velocity genuinely disagree, and
it is the one fact about the ship's handling a hull-hidden cockpit cannot show
any other way. The regeneration is printed **only while it is running** — the
map makes it the anti-stranding rule and requires the HUD to show it, but a
`+1.0/min` beside a full tank is a claim about a process that is not happening.

**One predicate decides "empty", and it reads the printed value.** The sim's own
gate is `chargeAu <= 0`, and passive regeneration lifts the raw value off zero on
the very next frame — so a tone keyed to the raw number went calm cyan while the
same cell still printed `0.0/12 AU`, and `cruisePrompt` offered "press J to
cruise" beside it. `chargeReadsEmpty` rounds first, and both the tone and the
prompt read it, so the glass cannot say two things about one quantity. It
follows that the refusal is **brief by construction**, about three seconds until
regeneration reaches 0.05 AU. Whether "practically stranded" deserves a band of
its own is a design question this node did not take: it needs a threshold no
spec states.

**The strip is laid out against its widest possible reading**, not against what
it currently says (`flightFloorWidest`), and the fit is memoised for the width
it was solved at. Sized to the live values it re-centred whenever a digit
changed — and the fit taken on a full tank, where the regeneration suffix is
absent, was a fifth too narrow for the run drawn a second later: at 390 px both
ends were clipped. The font is monospace, so a character count is a width, and
the headless tier sweeps every reachable reading against the bound.

**The bound is derived by asking the formatter**, not by restating its output.
It was four literals beside `flightFloorCells` — two spellings of every printed
shape with nothing linking them, so a format change in one had no tie to the
other. It now runs the formatter over a worst-case input per field and keeps the
longest, which is one owner of every string the strip can print.

**The scale is solved, not searched.** One measurement of the widest run at full
size gives the ratio, since text width is very nearly linear in type size; the
second confirms it. The step-down loop it replaces ran up to nineteen full
measurements on every distinct canvas width, and a resize drag missed on every
frame and appended to a map nothing evicted.

**`FLOOR_MIN_SCALE` fails open, and records that it did.** It is a floor on
legibility, so a viewport too narrow for the widest run at that size draws
anyway — a floor instrument that vanished would be worse. What it must not do is
fail open silently: the residue is recorded as `overflowPx` and §7.0's fit check
requires it to be zero at the two viewports that probe measures — which is not
"every viewport", and §7.0 item 8 says what is left unmeasured.

Its band is owned by one constant, `FLOOR_STRIP_HEIGHT_PX`: the baseline and
both type sizes are fractions of it, and §3's clearance line is offset by it.
The comment claimed that ownership before the code had it — the strip placed
itself at `glassBottomY - 9` with a fixed 13 px font while only the clearance
line read the constant, so raising the type would have slid the strip under the
line without touching the number it was supposedly anchored to.


### 5.2 The course row

Built under [#117](https://github.com/jcfischer/seelite/issues/117), which took
`galaxy-map.md` §8.3's obligation — "the next hop and the jumps remaining belong
on the flight floor or the Navigation console" — and picked the floor.

**A row of its own, above §5.1's strip, not a fifth cell in it.** The Navigation
console was read out on §8.3's own argument: a console is read by turning the
head away from the glass, which is exactly the posture in which a course is
forgotten. A fifth cell was read out on width. §5.1's strip is laid out against
its widest *reachable* reading and the fit is memoised for the width it was
solved at; a cell carrying a system name costs that bound about twelve
characters — permanently if the cell is dormant with no course, and as a reflow
of four already-solved cells if it is absent. A row of its own pays neither.

It keeps the strip's grammar — a label, a value and a §4 tone, measured by the
same run-width pass and centred on the same axis — because two runs on one floor
authored two ways is how a floor comes to look like two instruments. The
`FLOOR_COURSE_HEIGHT_PX` band above the strip is reserved **whether or not a
course is set**, and §3's clearance line is offset by it unconditionally: a line
that jumps the moment the player commits to a destination is a worse instrument
than one sitting a row higher always.

| state | reads | tone |
|---|---|---|
| no course | *nothing is drawn* | — |
| underway | `LAVEIAN 3 jumps`, singular on the last leg | passive |
| underway, tank short | the same reading | **refused** |
| arrived | `LAVEIAN arrived` | confirmed |

**Absence, not a dormant slot.** §5 calls the floor "the minimum that keeps a
hull-hidden cockpit flyable"; a permanent field reading `NO COURSE` is not that,
and the reflow objection that makes a dormant slot attractive on the strip does
not apply to a row of its own.

**There is no unreachable state, because the generator cannot produce one.**
§5 of `galaxy-generation.md` guarantees same-galaxy connectivity, so no
destination in a galaxy is unroutable from any other.

`courseProgress` still has a `null`, and it is worth naming precisely, because
the row draws nothing for it and *drawing nothing* is also D2's deliberate
no-course state. Two things reach it. A destination index that resolves to no
system is a **corrupt save**, which `parseCourse` refuses loudly and this row
does not try to second-guess. And a ship whose galaxy differs from the course's
is **not corrupt** — a course is per-galaxy state under
`persistent-world-state.md` §7 — but it is unreachable today: `planJump` refuses
`other-galaxy` with "no galactic hyperdrive fitted", so nothing moves a ship
between galaxies. When one is fitted, the pairing of a course to a galaxy needs
an owner, and this row will report whatever that owner decides rather than
deciding it. What *is* reachable is a next hop the hyperspace tank cannot pay
for, and there the row **reddens and says nothing extra of its own**:
`planJump` owns the *codes*, `jumpRefusalText` owns the words, and §3's prompt
prints them.

**That was a claim before it was true.** The prompt never asked `planJump` — it
offered "press ` to jump to ANDIMA" beside a row this build had already painted
red, and the refusal arrived only after the key was pressed. It is #92's
`chargeReadsEmpty` defect one instrument over: two halves of one reading
disagreeing on the glass. The fix is the same one — **one predicate, read by
both**, with the words themselves owned by a single `jumpRefusalText`.

**Arriving does not clear the course.** Ratified as shipped rather than changed:
the course survives the last jump, `courseProgress` reports it, and the jump key
already answers "course complete — set another on the galaxy chart". A course is
player intent under `persistent-world-state.md` §7, and intent is not cancelled
by being satisfied.

**The row is bounded because a system name is.** `systemName` draws three or
four pairs of at most two characters and its guard loop extends only a name
still under two, so `SYSTEM_NAME_MAX_CHARS` is 8 — a ceiling of the draw, true
of every seed.

The jump count is reserved at **two digits**, and that figure is of a different
kind: it is measured, and a measurement is of the worlds it visited.
`tests/course-cue.test.ts` sweeps every origin in all eight galaxies at four
seeds and puts the longest route at **13–14**, so the row's two digits have an
order of magnitude of headroom. It is not a property of the generator —
`seedFromQuery` gives a player one of 2^32 worlds and the sweep sees four — and
this paragraph said "the real generator" for a round, which is the claim a
single-seed figure cannot carry. What makes it a measurement rather than a
number chosen to be safe is that the band is asserted exactly, not that the
sweep is exhaustive.

## 6. Responsive behaviour

On narrow viewports, one side panel at a time becomes a wide overlay. In either
head-turn view, that focused console temporarily replaces the flight floor and
scanner; looking forward restores both to their stable lower-centre positions.

## 7. Verification plan

Headless checks pin the state inventory, safe fallback, and rendered gallery
hooks. The browser state-gallery probe exercises **assist-on, assist-off,
cruise, target acquisition, granted docking, and denied docking** at desktop and
narrow viewport sizes. It asserts the forward target director, local scanner,
and flight floor; each head turn exposes exactly one large console, replaces
those forward instruments, uses one non-overlay gallery canvas without a live
game instance, and returns to the live game route on exit.

**This inventory is flying states only, and every one of them asserts a flight
floor.** §8's M10 removes that floor while docked, so the `docked` state is one
this plan cannot express rather than one it happens to omit. §8.6 carries its
twelve obligations — eight browser, four headless — and the browser eight extend this probe rather
than starting a second one.

`?hud-gallery=<state>` is the low-risk browser prototype for these checks. It is
a design surface, not a claim that unbuilt docking, communications, or scanner
simulation has shipped.

### 7.0 The flight-floor strip

Headless — `tests/flight-floor.test.ts`, over `flightFloorCells`:

1. **The four cells, in §5's order.** The order is pinned separately from the
   contents, because a strip read at a glance makes a reordering a silent
   relearning cost.
2. **Each cell's text and tone against every branch** — spooling outranking the
   regime, assist-off's amber, the regeneration suffix appearing only below
   capacity, and the rounding, which was written expecting `4.25` to print
   `4.2` and pinned at `4.3` once the formatter said otherwise.
3. **The empty predicate at display resolution**, including the frame-after-a-
   starve-out value that used to read passive, and a sweep over the whole range
   asserting that no reading prints `0.0` without the refusal tone. The tone and
   the text are one quantity computed by two expressions; a boundary is where
   that parts.
4. **The bound is the longest *reachable* reading**, and tightness is measured
   against what the sim produces. MODE's bound was `SPOOL 10.0s` while the
   wind-up is three seconds, and the test guarding against a loose bound
   compared it to `"SPOOL 9.9s"` — another reading that cannot happen. The
   maxima come from the sim's constants, and the spool duration is a parameter
   for the same reason the charge capacity and rate are: one owner per constant
   in the presentation tier.
5. **No reachable reading is wider than `flightFloorWidest`**, swept over every
   combination of the four inputs, with the sweep's own size asserted — a loop
   that stopped iterating would satisfy every expectation inside it. And the
   bound is required to be *close*, since a bound of 200 characters would pass
   the sweep and make the fit useless. The bound is now derived from the same
   formatter, so what this sweep still catches is a worst-case *input* the
   derivation does not enumerate.

Browser — `scripts/probe-live-cockpit.mjs`, at both viewports:

6. **The strip paints §5's four cells in order**, read from the record the draw
   writes rather than from the state beside it.
7. **The strip was drawn from the ship's own state** — the draw stamps the four
   scalars it drew into the record, and they are compared against the game
   handle. The first version restated the projection here, rebuilding MODE from
   the regime and the spool in a nested ternary: the second copy its own comment
   said it was avoiding, and one that would drift the day the precedence
   changed. The mapping from those scalars to the strings is §7.0's item 2,
   where it is swept.
8. **It sits inside the glass, fits its widest reading, and the fit is the
   viewport's** — three named checks rather than one fifteen-clause boolean,
   which named the check and not which of its eight properties broke. Both the
   drawn run
   and the widest one must clear the margins — read off the record rather than
   restated — the fit must not have moved between them, and `overflowPx` must be
   zero — whichever way it could have been non-zero, since the type size
   rounds to a whole pixel and can land above what the linear solve predicted,
   not only when the legibility clamp binds. **"Every viewport" here is the two
   `probe-live-cockpit.mjs` measures**, and the fit is solved per canvas width:
   below 390 px the clamp can fail open with nothing measuring the residue. The
   console's own media query bottoms out at 600 px and the narrow probe runs at
   390, so what is unmeasured is narrower than anything the layout targets —
   stated rather than implied by "every shipped viewport", which §5.1 said and
   should not have.

   **Every cell is driven to its own widest, not just one of them.** The first
   version measured whatever the strip happened to say and passed at 390 px on a
   run the frame showed clipped; the second set only the charge, leaving MODE at
   `NORMAL` against a `SPOOL 00.0s` bound and THR at `62%` against `100%` — five
   characters of the widest run never on the glass, which is the same surrogate
   one layer in. What is asserted is each drawn cell's **width against the
   bound**, read off the page as `floorWidest`, because the drive refills between
   the set and the draw and an exact-string assertion loses that race.

   The spool used to lose it too: driven to 10.5 s against a bound of
   `SPOOL 00.0s`, a character dropped the moment it crossed 10.0, so the width
   assertion had half a second of margin rather than immunity. The bound is the
   sim's `SPOOL_S` now — three seconds, one digit — so **every** reachable spool
   reading is the same width and the countdown cannot change it. The probe drives
   `g.spoolSeconds` and asserts the page agrees with the constant the headless
   tier restates.
9. **An empty drive paints the CHARGE cell red and a charged one does not** —
   sampled off the overlay's own pixels inside that cell's box, because a tone
   is a field on a record and a record can say anything.
10. **The prompt and the cell agree** about an empty drive.
11. **The target instrument no longer carries the charge**, and **the right
    console's ASSIST and CHARGE rows are no longer empty** — both read the same
    cells the strip draws, so a check that finds them agreeing is checking one
    owner rather than two that happen to match.

**Every one of these was built a red build** — including, after the first
review round, the clamp failing open (`FLOOR_MIN_SCALE` raised to 0.95: 108.6 px
of overflow, and the check red), the draw stamping a stale scalar, and the
baseline no longer derived from the band. Two of those three first read green
because the edit that was supposed to break them silently did not match the
formatted source — a no-op `replace` and a green run look exactly alike, which
is the repo's own recorded lesson and cost two false clears here.

One caveat worth stating:
putting the charge back on the target instrument (check 10) makes the probe's
own boot wait time out before any check runs, because that wait is keyed to the
readout pattern. It fails loudly and cannot pass, but it fails as a timeout
rather than as the named check — the same wait-standing-for-an-assertion shape
§9.3 of `galaxy-map.md` records, left here because the wait is a genuine settle.

**And two defects came from looking at a frame rather than from any check**: the
tone/prompt disagreement at zero charge, and the clipped run at 390 px. Both
were green in both tiers at the moment they were photographed.

### 7.1 The docking director

**The gallery cannot verify §3's two docking cues, and that is why they are
checked elsewhere.** Its `docking-granted` and `docking-denied` states are fixed
review fixtures, so a cue drawn there is a picture of one rather than a reading.
The cues are readouts of live docking state, and `docking.md` §3.2 records that
check 2's cone and check 4's roll were set wide partly because these instruments
did not exist.

**The director is a corridor in the world, plus one gauge on the glass.** That
split follows from check 2 having two halves that are different pilot tasks: the
**nose** half is fixed by turning and the **position** half only by translating.
A first build drew both on glass and neither worked — the position half became a
bar with a magnitude and no direction, and the nose half was drawn as a true
projection of its own tolerance, which at a 60° field of view is
`tan(35°)/tan(30°)` — 1.21 times half the canvas height, a ring larger than the
screen. It read as arcs running off every edge.

So:

- **The corridor** (`src/docking-tunnel.ts`) is a rectangular tunnel projected
  out of the station along its docking axis, its throat the aperture itself, its
  mouth three quarters of the way back to the ship. Being anchored to the
  station rather than the glass is what lets it answer **which side to approach
  from**, which nothing in the cockpit answered before. Its rectangle carries
  the slot's phase, so it is check 4's roll reference as well: the pilot lines
  the cockpit up with it rather than reading ticks. A pad's corridor is square,
  because check 4 does not apply there.
- **The gauge** is a fixed ring on the glass with the docking axis marked on it
  at the error *as a fraction of the tolerance*. The direction is true; the
  radius is a gauge, and that has to be read rather than discovered.

**The corridor is deliberately narrower than every tolerance it guides.** Check
2's position half admits a 35° cone, and a cone drawn truthfully is always a
70°-wide object — its rim is 35° from the station wherever the pilot stands. So
this draws the corridor to *fly*, not the boundary not to leave: inside it is a
**sufficient** condition, never the gate. `evaluateEntry` stays the gate.

**It is on glass only on an approach, and only with the protocol engaged.** The
first build gated on `VICINITY_KM` — §6's ten-thousand-kilometre *clearance
request* range — and put a funnel on screen through most of ordinary in-system
flight, which is §1's wall of labels. `DIRECTOR_RANGE_KM` is an approach range;
requesting clearance is what turns the instrument on; and a refusal or a hostile
station keeps it, because §3's blocking state is the one thing a pilot must not
lose by looking away.

**And it is clipped to the canopy**, sharing `GLASS_BOTTOM_FRACTION` with the
laser tracer rather than restating it. The first build had no clip and drew over
the dash deck, the scanner well and both console housings.

| Where | What it holds |
|---|---|
| `tests/docking-director.test.ts` | Every angle the cues are judged on is `evaluateEntry`'s. Check 2's **two halves get two sweeps** — one that rotates only the nose leaves the position cue constant, so it constrains the nose alone — and check 4 gets a third. Each runs a 0.25° grid over 0–90° **and a 0.005° grid through the half-degree either side of the tolerance**: a cue whose tolerance is 35.1° disagrees with the gate only on (35°, 35.1°], which the coarse grid steps over. Plus the engagement rule, and the signed roll swept over four nose angles × four out-of-plane tilts × seven rolls. |
| `tests/docking-tunnel.test.ts` | The corridor's sufficiency, against the shipped checks rather than a hand-typed angle: every corner of every ring passes check 2's position half **with half the tolerance still in hand**, at every length and at **both aperture kinds** — which matters because the worst point is not the same one: for a slot it is the mouth, converging on `atan(tan(flare)·√(1+aspect²))` at 6.9°, and for a pad it is the throat, at 14.9°, because a refinery's aperture is wide against a small core. The row asserts the limit, that it is genuinely approached, and the half-tolerance bound at both. Plus: the throat's corners are contained and a hair outside is not; the rectangle turns with the slot's phase; a pad's is square. |
| `scripts/probe-docking.mjs` | What only a rendered frame answers. The corridor is drawn and shortens as the ship closes; the gauge's marker sits at the error as a fraction of the tolerance and goes off-scale rather than pinning at the rim; the director is absent without clearance and beyond the approach range, and present on a refusal; the **drawn throat's tilt tracks the ship's roll one degree for one**, which is the reading the roll ticks used to give and the headless phase row cannot make; and three rows read the **overlay's own pixels** — the ring is painted, its stroked colour changes across the tolerance, and the director paints across the band just above the clip line and nothing at all in the band just below it. |

**Every pixel row needs an arm that registers hits.** The clip row began as zero
against zero, which a pose whose corridor never reached the clip line would have
satisfied — and so would a region the sampler could not read. It samples two
bands now, one either side of the line, and the one above must be painted.

**The pixel rows exist because `directorRender` cannot report on itself.** It is
assembled at the end of the draw whether or not the strokes landed: delete every
`ctx.stroke()` and every field-reading row stays green while the pilot sees
nothing. Each pixel row's control frame reads the **same pixels** and differs
only in the one thing under test — a sampler keyed off each frame's own record
never runs on the frames a control needs, and a control that also changed the
ship's attitude was measuring the attitude reference moving.

## 8. The station console

**Decided with the principal on 2026-08-27, on node
[#70](https://github.com/jcfischer/seelite/issues/70), after
[#73](https://github.com/jcfischer/seelite/issues/73) settled what a successful
dock does.** Ten decisions, one at a time. Anything below that was not decided
in that session is derived here and marked as such.

The trigger was a gap rather than a defect: `economy-trade.md` §11 handed the
market screen to "the HUD node", §0 of this document declined it, and neither
half was buildable, so nothing noticed. `src/market.ts` shipped in
[#25](https://github.com/jcfischer/seelite/issues/25) with four importers, all of
them tests and scripts.

### 8.1 Where it lives

**Decision M1: docked reuses the cockpit.** It is not a mode outside §1's
language. A separate full-screen station mode was on the table — it is what
Elite 1984 did — and was declined because it authors a second UI grammar and
leaves #28/#56's forms and the 3D cockpit of §5 unused for the whole stop.

**Decision M2: the console hangs on the forward wall.** While docked, the canopy
opening carries it. §1 names two walls and four consoles — left owns Navigation
and Communications, right owns Flight and Drive — and §5 adds Tuning to the
right one. There is no third wall for a station console to hang on, and forward
is the one surface with no job, because
[#73](https://github.com/jcfischer/seelite/issues/73)'s **E5** suspends flight
and the canopy then looks at a throat wall. The left and
right consoles keep their jobs unchanged.

**This amends §5.** "Looking forward returns to flying glass and the
lower-centre radar" is a rule about the *flying* state. Docked, looking forward
returns to the station console. The head-turn grammar is otherwise untouched:
left and right still expose exactly one large console each.

**Decision M3: it is a *station* console, not a trade console.** Market is its
first tab and equipment its second; later station business — missions, a
bulletin board, shipyard hulls — takes a tab rather than a new wall. This is the
reason the forward wall wins rather than a consequence of it: it is the only
surface in the cockpit with room to grow, and §1's stated purpose is to give
every future screen a home.

**Decision M4: full takeover, after the arrival.** The console fills the canopy
opening once #73's **E3** arrival completes — four to six seconds, and the
console is not up during it. The throat is the arrival's payoff and the console
is the stop's; they are sequential, not simultaneous, and a translucent console
over live rotating geometry was declined on contrast rather than on principle.

**Decision M10: the persistent flight floor is hidden while docked.** Attitude,
prograde/retrograde, the compact scanner and the mode/throttle/assist/charge
strip all go. §5 defines the floor as "the minimum that keeps a hull-hidden
cockpit flyable", and E5 means it is keeping nothing flyable. Docked is
therefore visibly a different state of the same cockpit rather than the same
cockpit with dead instruments. Nothing becomes unreachable: the Flight and Drive
consoles still carry their readouts on a head-turn, and say they are inert.

### 8.2 The market tab

**Decision M5: all seventeen commodity rows, at every station.** The three
illegal goods (`economy-trade.md` §4 — Narcotics, Firearms, Slaves) appear
everywhere. At a fence they carry a price, a shelf and a marker; anywhere else
they sit in a **not traded here** block with no price. This is §4's obligation 2
— "a visible marker on the market screen, wherever an illegal good is listed, at
a fence and in the player's own hold" — and it goes further than the obligation
asks, because `station-types.md` §3.4's failure mode is the exception being
*unread*, and a fourteen-row table with no gap in it is not misread so much as
silent.

**A fourteen-row alternative was chosen first and reversed within the session**,
once §8.3's equipment rule made the asymmetry visible: two tabs of one console
would have handled absence in opposite ways. The reversal is recorded rather
than tidied away, because the argument that moved it was the consistency and not
the original merits.

**Decision M6: the deficit shows as a delta from the current epoch's base.** A
row the player has moved reads `96.4 Cr ↑8.1` with the shelf `7 t ↓8` — the
price beside how far it has travelled from what this station would otherwise
quote. `economy-trade.md` §11 asks for "a stock/price display that can show a
deficit-moved price without implying a bug", and an annotated deviation is what
carries that: an unexplained number reads as broken, a number with its own
delta beside it reads as an effect.

**Decision M7: only the deficit clock is visible.** The arrow decays toward zero
across `economy-trade.md` §5.2's 20-minute half-life and the player watches their
own mark fade. **`economy-trade.md` §5.1's 30-minute epoch is not surfaced** — no
countdown, no announcement. The base is the world and the arrow is the market's
memory of *you*, which is the distinction that spec's §5 draws and the one worth
putting on glass. (Every §5.x in this decision is `economy-trade.md`'s; **§5** of
*this* document is the cockpit's physical consoles.)

**The cost is named rather than discovered.** At an epoch roll every price in the
table changes at once with nothing saying why, and a player returning to a
station they know will find a different market. A refresh timer was on the table
and declined for a reason that cuts the other way: `economy-trade.md` §5.5
measured waiting-for-the-roll as an exploit available at ~1% of decision points
and worth up to 4.7× when it lands, and a visible countdown is a countdown to
park against. Surfacing the clock would make the screen more honest and the game
more exploitable. Recorded as a weak joint (§8.7, joint 1) on the principal's
call.

### 8.3 The equipment tab

**Decision M8: the full catalogue, with every unavailable item shown and its
reason stated.** A frontier station lists what it sells, then a **unavailable
here** block naming what it does not and why — `requires TL 7`, `shipyards
only`, `refineries only`. #70 asked that a short list read as the exploration
incentive rather than an error state, and a reason is what makes it one:
`station-types.md` §4.2 puts the tech gradient's teeth in *where* shipyards
exist at all, which the player cannot infer from a list that simply ends early.

**This is the same absence rule as M5**, and that is the point of it. One
console handles absence one way across both tabs: what is missing is named, and
why.

Hull purchase is this tab's, and its prices are not this spec's or
`economy-trade.md` §7's — the ship-roster node
([#26](https://github.com/jcfischer/seelite/issues/26)) owes them, and until it
lands the shipyard's hull section is empty rather than absent.

### 8.4 Launch

**Decision M9: the launch control is on the Flight console, reached by turning
the head right.** §1 gives Flight to the right panel and launching is flight.
The console is otherwise inert while docked and says so; the launch command is
the one live control on it.

**This amends `docking.md` §12.2.** That section says "a docked player is in a
screen, and the launch command is a control *in* that screen", written before
this node chose M1 — under a separate full-screen station mode there was only
one screen it could be in. With the cockpit reused, "that screen" is the
cockpit, and the control sits on the console that owns flight rather than on the
one that owns commerce. The seam §12.2 was protecting is unchanged and is worth
restating: **what the player presses is this spec's, and the motion after it is
`docking.md` §12.2's.** Neither may assume the other.

### 8.5 What the implementation must not do

Three traps, each one a fact about the shipped module rather than a style note.

1. **`marketRow` throws for a good the station does not sell.** It is deliberate
   — `src/market.ts` calls a silently empty shelf "how it would ship" — and M5
   walks straight at it: the screen renders seventeen rows and, **away from a
   fence**, only some of them have a price. (Not "fourteen" — obligation 2
   refuses that constant for the reason it gives, and at a fence all seventeen
   are priced.) The rule is to iterate `COMMODITIES`, test `listsCommodity`, and
   call `marketRow` **only** where it returns true. A screen that asks for a
   price so it can grey the row out throws on every non-fence station in the
   galaxy.
2. **`stationCommodities` is not the row list under M5.** It filters to what the
   station trades, which is the fourteen-row shape this section reversed. It
   stays correct for anything asking *what can I buy here*; it is the wrong
   source for *what does the table show*.
3. **The tech-level gate counts Fuel, which is not in `EQUIPMENT`.**
   `station-types.md` §4.1 gates "the ten universal items" at
   `min(displayTL + 3, 10)`. **Fuel is the *first* of those ten and the one
   absent from the array** — `economy-trade.md` §7's table opens with it, and
   `EQUIPMENT` holds the other nine, because fuel is priced by the light year as
   `FUEL_CR_PER_LY` rather than as a unit item. A draft of this paragraph called
   Fuel "the tenth", which contradicted obligation 8 and, worse, would have made
   the whole *sold too early* column below vanish: a slice of items 1…n taken
   from a list missing its *last* member differs from the correct set only by
   length. A gate implemented by taking the first
   `min(displayTL + 3, 10)` of `EQUIPMENT`'s universal rows is wrong in *two*
   directions at once: it hides Fuel at every tech level, and from `displayTL` 0
   through 6 it also sells one item the station should not have. Measured against the shipped
   array:

   Every row read off the shipped array rather than reasoned about, because a
   range row that names no item is the shape of a row nobody measured:

   | `displayTL` | n | hidden | sold too early |
   |---|---|---|---|
   | 0 | 3 | Fuel | Extra Pulse Laser |
   | 1 | 4 | Fuel | E.C.M. System |
   | 2 | 5 | Fuel | Extra Beam Laser |
   | 3 | 6 | Fuel | Escape Pod |
   | 4 | 7 | Fuel | Energy Bomb |
   | 5 | 8 | Fuel | Docking Computer |
   | 6 | 9 | Fuel | Galactic Hyperdrive |
   | 7–12 | 10 | Fuel | — (the slice exhausts the 9-row array and returns 9, not 10 — §8.6's count-separates case) |

   The *sold too early* column is exactly `economy-trade.md` §7's order shifted
   by one, which is the signature of the missing first element.

   The early sale is the half that matters: it puts a galactic hyperdrive on a
   `displayTL = 6` shelf, one tech level below where §4.1 puts it, and nothing
   in the module refuses it.

### 8.6 Verification obligations

**This section owes §7 a docked gallery state**, and it is not covered by the
existing one. §7's browser probe exercises assist-on, assist-off, cruise, target
acquisition, granted docking and denied docking — every one of them a *flying*
state with a flight floor on glass. M10 removes that floor, so `docked` is a
state the current probe cannot express, let alone assert.

| # | Obligation | Tier |
|---|---|---|
| 1 | `?hud-gallery=docked` exists and renders the station console on the forward wall, with **no** flight floor and **no** compact scanner. | browser |
| 2 | The market tab renders **seventeen** rows at every station, and a row is priced **iff** `listsCommodity` is true for it. Asserted as that biconditional and not as the constant fourteen: a station type that later drops a legal good would fail a hard-coded count on a correct build, which is the brittleness §8.5.2 rejects `stationCommodities` for. | browser |
| 3 | The screen's row builder never calls `marketRow` for a good failing `listsCommodity` — asserted by construction, not by absence of a throw. | headless |
| 4 | The row builder returns a signed delta field for a non-zero deficit, against **this epoch's** base, and no delta field for a zero deficit. Asserted against the builder's return value rather than against pixels, which is what keeps it headless. | headless |
| 5 | Those deltas reach the glass: the docked gallery renders a moved row with a visible signed delta and an unmoved row without one. | browser |
| 6 | The equipment builder at a low-TL trade station returns a non-empty available list **and** a non-empty unavailable list, every unavailable entry carrying a reason string. Return value, not rendering. | headless |
| 7 | The unavailable block and its reason strings are on the glass in the docked gallery. | browser |
| 8 | The universal-item **set** at `displayTL` d matches `economy-trade.md` §7's table order truncated to `min(d + 3, 10)`, Fuel included — the trap in §8.5.3, checked at d = 0…12. (`station-types.md` §4.1 owns the *gate*; `economy-trade.md` §7 is where the ten items appear in order, Fuel first.) | headless |
| 9 | Turning the head right while docked exposes the Flight console with a live launch control and inert throttle/assist readouts. | browser |
| 10 | Looking forward while docked returns the station console, not flying glass — §5's rule as amended by M2. | browser |
| 11 | **M4's negative:** during the arrival the station console is **not** up. Asserted mid-arrival, not only at its end, or the check passes on a build that never delays it. | browser |
| 12 | **M7's negative:** no epoch countdown or refresh announcement appears anywhere on the market tab, including across a simulated epoch boundary while docked. | browser |

**Twelve obligations, and the count is the handoff contract.** A draft of this
section said eight and then grew two tiers and two negatives without updating it,
which is the drift this document keeps finding in itself. The implementation node
inherits twelve.

Obligation 3 is written as a construction check rather than "no throw is
observed", because the passing build and the broken one both throw nothing on a
fence, where every good lists. A test that only visits a fence cannot fail.

**Obligations 11 and 12 exist because M4 and M7 are negatives**, and a decision
whose whole content is "this does not appear" regresses in silence. Obligation 11
is asserted *during* the arrival rather than after it, because a build that
skipped E3's four to six seconds entirely would satisfy an end-state check.

**Obligation 8 asserts the set and not the count, and a first draft of this
paragraph justified that with a claim it had not run.** It said a count check is
green on both builds at all thirteen values of d. It is not: `EQUIPMENT` holds
nine universal rows, so from d = 7 the buggy slice runs out of array and returns
9 against the correct 10, and a count check goes red. Measured across d = 0…12:

| d | correct | buggy | count separates | set separates |
|---|---|---|---|---|
| 0–6 | 3…9 | 3…9 | **no** | yes |
| 7–12 | 10 | 9 | yes | yes |

So a count check does catch the bug — **but only above the saturation point**,
and `station-types.md` §4.2 records that shipyards exist only at
`displayTL ≥ 10`, so a check written against the station types a reader has in
mind can sit entirely inside the half where counting is blind. Membership
separates them at every d, which is why the obligation is written that way.

### 8.7 Weak joints, recorded not reopened

1. **The epoch roll is unannounced.** M7. Every price changes at once with
   nothing on screen saying why, and the alternative hands the player a
   countdown to an exploit `economy-trade.md` §5.5 measured at up to 4.7×.
   Chosen knowing both halves.
2. **M5 solves legibility, not discovery.** The three illegal rows are now
   visible at every station, so a player learns the goods exist — but nothing on
   the market tab says where a fence is. `station-types.md` §5.2's rim-weighted
   fence geography is the answer and it is
   [#8](https://github.com/jcfischer/seelite/issues/8)'s to surface, not this
   screen's.
3. **Contraband still does not pay.** `economy-trade.md` §4.1: a legal run
   out-earns a smuggling run by 62%. M5 makes the exception visible on a screen
   where the numbers say not to take it. That is #7's recorded weak joint 11 and
   #8's to price; this spec displays it faithfully and does not repair it.
4. **The hull section is empty until #26.** §8.3. A shipyard's equipment tab has
   a hulls heading with nothing under it, which is a state the gallery has to
   render and a player will see.

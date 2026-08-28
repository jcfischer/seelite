# Spec: HUD, scanner, and cockpit

**Status:** proposed design decision — [#34](https://github.com/jcfischer/seelite/issues/34)  
**Date:** 2026-08-20  
**Context:** flight (#5 and #21), docking (#9), and target-marker (#10) work
provide the simulation surfaces this visual contract will eventually consume.

## 0. Scope and vocabulary

This is the cockpit-first language for a pilot flying normal, assist-off, cruise,
targeting, and docking states. It does not replace #21's flight model, mouse
controls, or target-marker math, and it does not implement combat or #11's
galaxy map.

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
scanner. Communications carries clearance requests and replies, hostile/legal
status, and actionable messages. Flight presents speed, throttle, assist, current
regime, and relative motion. Drive presents cruise charge, range, regeneration,
and future equipment state. Developer tuning parameters move to a **Tuning tab**
on the right panel: they are available while tuning the prototype, but never
occupy the persistent player flight floor.

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

### 7.1 The docking director's own two tiers

**The gallery cannot verify §3's two docking cues, and that is why they are
checked elsewhere.** Its `docking-granted` and `docking-denied` states are fixed
review fixtures, so a funnel drawn there is a picture of a cue rather than a
reading of one. The cues are readouts of live docking state, and
`docking.md` §3.2 records that check 2's cone and check 4's roll were set wide
partly because these instruments did not exist — a cue that measured a slightly
different angle from the check would leave them wide for a second reason.

So the director is verified against `docking.ts` itself, in both tiers:

| Where | What it holds |
|---|---|
| `tests/docking-director.test.ts` | Every angle the director reports is `evaluateEntry`'s, and the cue's verdict is swept against checks 2 and 4 across 0–90° at both tolerances. A director one degree looser than the gate turns both sweeps red. |
| `scripts/probe-docking.mjs` | The funnel, the roll ring, the corridor bar and the clearance line reach the glass on a live approach; five degrees past the tolerance flips the cue and takes the axis marker out of the funnel; a pad draws no ring; hostility outranks a live grant; a head turn takes the director off the glass. |

The browser rows read `directorRender`, which the **draw** writes rather than a
computation beside it, so a build that produced a correct director and never
painted it goes red rather than passing the tier that matters least.

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

# Spec: HUD, scanner, and cockpit

**Status:** resolved design decision — [#34](https://github.com/jcfischer/seelite/issues/34)  
**Date:** 2026-08-20  
**Context:** flight (#5 and #21), docking (#9), and target-marker (#10) work
provide the simulation surfaces this visual contract will eventually consume.

## 0. Scope and vocabulary

This is the cockpit-first language for a pilot flying normal, assist-off, cruise,
targeting, and docking states. It does not replace #21's flight model, mouse
controls, or target-marker math, and it does not implement combat, the market,
or #11's galaxy map.

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

## 2. Compact scanner

The compact scanner is persistently visible at the **lower centre of the
cockpit**. It is a **local radar**: a large, shallow concentric
elliptical base. Each contact uses a **vertical mast** anchored to a small
**anchor disc** on that plane, so the separation is read as height rather than a
slanted vector. Bearing and range read from the base, not a detached top-down
map.
Contacts derive from true simulation positions, not from the camera-relative
near/far render layers. It is read-only: its job is spatial awareness while the
pilot flies, not accidental target selection under mouse control.

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
the scanner. The gallery renders those physical cockpit surfaces in its own
Three.js scene, with a cockpit camera and shallow idle parallax. The modern
spaceflight reference guides the presentation only; simulation ownership remains
with the existing flight, target, and docking work.

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

Headless checks pin the state inventory and the deterministic state-to-instrument
mapping. The browser state-gallery probe exercises **assist-on, assist-off,
cruise, target acquisition, granted docking, and denied docking** at desktop and
narrow viewport sizes. It asserts the forward target director, local scanner,
and flight floor; each head turn exposes exactly one large console, replaces
those forward instruments, and uses the gallery's only renderer.

`?hud-gallery=<state>` is the low-risk browser prototype for these checks. It is
a design surface, not a claim that unbuilt docking, communications, or scanner
simulation has shipped.

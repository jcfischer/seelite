# The pad

Written for #283. The bindings are at the bottom; the contract is the point.

## Why this exists at all

A desktop mapper app already lets a PS5 pad play seelite. It pairs over
Bluetooth, the Mac sees it, and a mapper turns the sticks into `WASD` and a
button into a click. Nothing in this repository has to change for that to work,
and it is still the right answer for a player who wants it today.

What it cannot do is give the ship a *rate*. A key is on or off, so a stick
pushed a tenth of the way turns at full tilt or not at all — and this game's
flight model was already waiting for the difference: `stepAngular` clamps its
command to [-1, 1] and scales it by the axis maximum, so a partly-deflected
stick is a partial turn with **no change to the simulation at all**. The
keyboard was the lossy part. That gap — analog, not access — is the whole
argument for the code.

## The module is copied, not shared

`src/gamepad.ts` came from seekolous (#249) unchanged but for nothing at all —
it is byte-identical. It is a leaf with **no imports**, and
`tests/headless.test.ts` fails if that stops being true.

**The rules that make it portable live in the module's header, and only there.**
This file deliberately does not restate them, because two renderings of one
contract is two things to keep in step and the one that drifts is always the
copy. Read the header before touching the file. What is worth knowing here is
the shape: four rules about what the module may touch and what it may assume —
polling rather than listening, `navigator` inside `poll()` alone, analog values
on the triggers, and a refusal to read a pad off the standard mapping — plus one
about edges, which is the one with a known hole.

**The hole, stated once.** A pad the module has not seen before reports no
button edges on its first frame; that is what stops a controller swap, a
controller waking, and a page reload from each inventing a press. Identity is
the slot plus the pad's `id`, and `id` is a model string rather than a serial —
two DualSense pads report the same one. So two identical controllers hot-swapped
into the same slot still inherit the old history. Closing that needs a device
identity the platform does not expose.

**The binding table is not in the module**, and neither is it in `main.ts`. It
is `src/pad-bindings.ts`, which is a departure from what #283 asked for and
buys one thing: `main.ts` is not on the headless list and nothing in the unit
tier can load it, so a table written there is a table no test can read. The rule
the contract protects — that the copied module stays game-agnostic — holds.

## Three contexts, and the second one is the interesting one

**`flight`** is the forward view. The pad flies the ship.

**`console`** is a surface being read: a head turned to the port or starboard
console, or the station console on the forward wall while docked. It claims
**six controls** — the d-pad's two vertical positions, the two face buttons and
the two shoulders — and it **suspends the sticks, the triggers and the mouse**.

That suspension is a reversal of what #283 first shipped, and the reasoning it
replaced was wrong in a way worth keeping. **`src/pad-bindings.ts`'s header owns
the argument and this file does not repeat it** — it was verbatim in both for a
round, which is the third-copy drift `CLAUDE.md` warns about. What is worth
knowing without opening it: the footer is a claim about the *world*, not the
controls, and the throttle is **held** rather than zeroed, so you coast.

**`instrument`** is the frame overlay behind `?perf`, and it is the one
exception. It takes a console's six buttons and leaves the sticks alone, because
it exists to measure a frame *while it is flown* — a mode that stopped the ship
would measure a different frame from the one it is there for.

**`modal`** is the settings screen and nothing else — the one place the whole
pad is taken, sticks included. `settings-panel.ts` already does this for the
keyboard by calling `releaseHeldKeys` on open, because a held throttle key kept
flying the ship behind a screen the player was reading. A key is an *event* and
can be forgotten; a stick is a **position, re-reported every frame**, so there
is nothing to release and the axes have to be refused instead.

The mode is a panel's state, never a flag on the pad. So the mouse can act on
the same panel in the same frame, and whichever device acted last is the one in
charge — seekolous's rule, inherited with the module.

## The flight bindings

Names are the W3C standard mapping's positions; DualSense labels in brackets. An
Xbox pad reads `a`/`b`/`x`/`y` literally.

| control | does | keyboard |
| --- | --- | --- |
| right stick | pitch and yaw, analog | `w`/`s`, `a`/`d` |
| left stick, X | roll, analog | `q`/`e` |
| `r2` / `l2` | trim the throttle open and shut, analog | `shift` / `control` |
| `a` (Cross) | launch, or skip the dock traversal | `Enter` |
| `b` (Circle) | request docking clearance | `c` |
| `x` (Square) | flight assist | `x` |
| `y` (Triangle) | engage or drop cruise | `j` |
| `l1` / `r1` | previous and next target | `g` / `t` |
| `l3` | face the target | `f` |
| `r3` | cockpit or chase | `v` |
| `start` (Options) | docking computer | `u` |
| `select` (Create) | charge the Jump | `` ` `` |
| d-pad ← / ↑ / → | head-look port, forward, starboard | `1` / `2` / `3` |
| d-pad ↓ | hand the pad to the frame instrument (Circle gives it back) | — |

**The throttle is a trim, not a position**, and that is #283's F2. A trigger
reporting an absolute 0–1 throttle was the obvious alternative and is wrong for
three reasons, the first of which settles it: a throttle you have to hold is not
a throttle, and every leg in this game is minutes long. The other two — a
position has no rate for `STATION_THROTTLE_RATE_SCALE` to scale, so the fine
control that makes docking flyable would not reach the pad; and it would fight
the docking computer, cruise entry and the detour cancel, each of which
*assigns* the throttle and would be overwritten on the next frame.
`PadFlightAxes.throttleTrim` carries the argument.

**Every stick term is a negation**, because the pad's axes are positive right
and positive *down* while this game's commands are positive nose-left and
nose-up. That is also how `main.ts` builds the mouse's two terms, so the pad
agrees with the mouse: push right, the nose goes right.

## The console bindings

| control | does |
| --- | --- |
| d-pad ↑ / ↓ | walk the cursor |
| `a` (Cross) | act on the ringed row |
| `b` (Circle) | back out — to the forward view, out of a modal, or out of the instrument |
| `l1` / `r1` | previous and next tab |
| sticks, triggers, mouse | **suspended** — the ship coasts |
| the keyboard | still flies, deliberately — a key has to be held |
| every other button | still acts on the ship |

**The cursor walks content, not chrome.** Tabs are not in the walk: they have
the shoulders, and passing through the tab row to reach a list was the first
thing the principal found wrong with it. The Navigation rail's own GALAXY MAP
button stays walkable — it carries a tab's attribute and is not a tab.

The panel holding the pad says so — a cool ring on its border, matching the
cursor's — and carries a hint line. Both are drawn only when a pad is attached,
and the hint names **what that surface actually has**: a panel with nothing
focusable does not promise a walk, and the station console does not promise a
back, because it is reached with the head already forward.

On the Galaxy Map tab the right stick orbits the cluster, which is the one thing
a stick still does inside a console.

On the settings screen, ← and → change the focused row's value, which is what
that screen's own hint line says. The pad adopts its model rather than inventing
a second one beside it.

**Unbound: `home`.** The module reports it; nothing claims it.

## What is checked, and where

| what | where |
| --- | --- |
| the deadzone, the edges, the standard-mapping refusal | `tests/gamepad.test.ts` (bun, no browser) |
| what a button means in each of the three contexts | `tests/pad-bindings.test.ts` |
| the shared cursor's arithmetic | `tests/panel-focus.test.ts` |
| both modules load headless, and one is a leaf | `tests/headless.test.ts` |
| the pad is read once a frame, and the stick is analog when it reaches the ship | `scripts/probe-gamepad.mjs` |
| five panel surfaces do the thing rather than showing a ring | `scripts/probe-pad-panels.mjs` |
| the sixth, which needs `?perf` | `scripts/probe-pad-instrument.mjs` |

Both probes are mutation-checked and their headers record what each mutant
reddened — including one that **passed** because the edit meant to break the
code missed its indentation, and one check that was passing on a chart another
check had already mounted. Read those before trusting a green run.

**What none of that establishes is that any particular controller works.** The
probes drive a synthetic pad: an object reporting `mapping: "standard"` with
seventeen buttons and four axes, injected before the page loads. That is the
contract the code is written against and the whole of what is verified here.
**No physical controller has been tested.** Whether a given pad satisfies the
contract is a question about that pad and that browser. `navigator.getGamepads()`
in the console after a button press answers half of it in ten seconds — the
browser either fits your pad to the standard mapping or it does not — and that
is metadata, not proof: it says nothing about whether the axes read the way the
names say, or whether the bindings feel right. Flying a leg is the rest of the
evidence, and #283 does not close without it.

## What the pad cannot do

- **Type.** The Navigation list's filter field and the finder's query are free
  text, and there is no on-screen keyboard — #70 already refused a second UI
  grammar, and one for a single field is not a good enough reason to reopen it.
  The kind chips and the economy chips are what narrow those lists for a pad,
  and both are walkable rows.
- **Open the settings screen.** `z` on the keyboard is the only way in. Once it
  is open the pad drives it, and Circle closes it.
- **Reach the tuning dials or the perf panel's letter keys.** Seventeen buttons
  cannot carry twenty-six letters plus `PERF_KEYS`, `RESTORE_KEY` and
  `SETTINGS_KEY`. What the pad claims is the flight-critical set; the dials stay
  on the keyboard, and the instrument's switches are reachable through its
  cursor rather than through their letters.
- **Rebind anything.** There is no rebinding UI.
- **Rumble, adaptive triggers, the touchpad, motion.** All DualSense extras
  behind vendor-specific surfaces. None are in the standard mapping, and none
  are needed to fly.

## If the pad does not appear

Press a button on it. The browser will not report a pad that has not been used
since the page loaded — a privacy measure, not a bug, and the reason the module
polls rather than listening. `navigator.getGamepads()` in the console after a
button press should show an entry with `mapping: "standard"`.

**No sound if you start on the pad.** A gamepad button is not an *activation
triggering input event* as the HTML specification defines one, so it cannot open
an `AudioContext` — a session begun on the pad and played without touching the
keyboard or mouse is silent. The game says so once, on the prompt line, when it
happens. Any key or click unlocks it.

**The press that wakes the pad does nothing else.** The browser hides a pad
until a button on it is pressed, so that press is also the pad's first visible
frame — and acting on it would mean the keystroke that woke the controller
launched the ship. It counts as held and not as pressed. Press again; that one
lands.

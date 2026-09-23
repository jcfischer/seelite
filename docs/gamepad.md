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

## The contexts, and the second one is the interesting one

**`flight`** is the forward view. The pad flies the ship.

**`console`** is a surface being read: a head turned to the port or starboard
console, or the station console on the forward wall while docked. It claims
**six controls** — the d-pad's two vertical positions, the two face buttons and
the two shoulders — and it **suspends the sticks, the triggers and the mouse**.

That suspension is a reversal of what #283 first shipped, and the reasoning it
replaced was wrong in a way worth keeping. **`src/pad-bindings.ts`'s header owns
the argument and this file does not repeat it** — it was verbatim in both for a
round, which is the third-copy drift `CLAUDE.md` warns about. What is worth
knowing without opening it: the footer the argument rested on was a claim about
the *world*, not the controls, and the throttle is **held** rather than zeroed,
so you coast. The header also says what became of that footer.

**One consequence of that suspension went unshipped until #371.** A console that
suspends the mouse while the pointer is still captured suspends nothing the player can
feel: `pointerLockMove` in that same module owns that rule and the argument for it.
What is worth knowing here is the one thing the rule adds at this level — **the release
belongs to the drawn surface, not to the head turn** — because the station console
arrives on the forward wall with the head still forward, through `hasFocusScope()`,
which is the same answer `padContext` already takes. That surface is reasoned and not
measured; `probe-pointer-lock.mjs` says why, and its rows are the head turn and the
settings screen.

**`instrument`** is the frame overlay behind `?perf`, and it is the one
exception. It takes a console's six buttons, of which the shoulders do nothing
there because it has no tabs, and leaves the sticks alone, because
it exists to measure a frame *while it is flown* — a mode that stopped the ship
would measure a different frame from the one it is there for.

**`modal`** is the settings screen and the Commander overlay
(`persistent-world-state.md` §11) — the two places the whole pad is taken, sticks
included. When both could claim the pad the overlay does, because settings does
not open over it. `settings-panel.ts` already does this for the
keyboard by calling `releaseHeldKeys` on open, because a held throttle key kept
flying the ship behind a screen the player was reading. A key is an *event* and
can be forgotten; a stick is a **position, re-reported every frame**, so there
is nothing to release and the axes have to be refused instead.

**`capture`** is the rebind modal on the `Controls` tab (#381 S4), and it is
the one context that exists to *admit* the sticks and triggers — for one
capture — while refusing everything else. `src/pad-bindings.ts`'s header owns
why it is a context rather than a hole in `modal`'s suspension.

The heading counted these once and the count went stale twice, as a context
joined each time; the list is `PadContext` in `src/pad-bindings.ts`.

The mode is a panel's state, never a flag on the pad. So the mouse can act on
the same panel in the same frame, and whichever device acted last is the one in
charge — seekolous's rule, inherited with the module.

## The flight bindings

Names are the W3C standard mapping's positions, as the `Controls` tab prints
them. On a DualSense `A` is Cross, `B` Circle, `X` Square, `Y` Triangle,
`Start` Options and `Select` Create; an Xbox pad reads `A`/`B`/`X`/`Y`
literally.

**These are the shipped layout's, and they are not typed here** (#381 S5).
Both tables are rendered from `DEFAULT_BINDINGS` by `tests/gamepad-doc.test.ts`,
which fails when the file and the registry disagree — this file carried its own
copy until then, and #369 D11 names it among the copies a rebind could not
reach. A player's own layout is the `Controls` tab's to print. One row per
direction, because a stick's two halves are two commands (#369 D2); the sticks
and triggers are analog.

<!-- generated: flight — tests/gamepad-doc.test.ts renders it from DEFAULT_BINDINGS; do not edit by hand -->

| on the pad | does | keyboard and mouse |
| --- | --- | --- |
| right stick down | Pitch: nose up | `hold s or ↓` |
| right stick up | Pitch: nose down | `hold w or ↑` |
| right stick left | Yaw: nose to port | `hold a or ←` |
| right stick right | Yaw: nose to starboard | `hold d or →` |
| left stick left | Roll to port | `hold q` |
| left stick right | Roll to starboard | `hold e` |
| R2 | Throttle up | `hold Shift` |
| L2 | Throttle down | `hold Ctrl` |
| Y | Engage or drop cruise | `j` |
| Select | Wind up the jump | `` ` `` |
| hold X | Fire the pulse laser | `hold Space or left mouse button` |
| R1 | Next target | `t` |
| L1 | Previous target | `g` |
| L3 | Face the target | `f` |
| B | Request docking clearance | `c` |
| Start | Docking computer on/off | `u` |
| A | Launch, or skip the traversal | `Enter` |
| d-pad ← | Head to port console | `1 or Alt + ←` |
| d-pad ↑ | Head forward | `2 or Alt + ↑` |
| d-pad → | Head to starboard console | `3 or Alt + →` |
| R3 | Cockpit or chase view | `v` |
| d-pad ↑ | Centre the chase camera | `2` |
| d-pad ↓ | Hand the pad to the frame instrument, and back | — |

<!-- end generated: flight -->

The d-pad's ↑ appears twice because it means two things by view: head forward
in the cockpit, and the chase camera's reset in chase. Circle takes the pad back
from the frame instrument.

**#324 put fire on the controller: Square (`x`), held**, by the principal's
ruling. Flight assist left the pad for the keyboard's `x`. For one round the
trim sat on the shoulders so R2 could fire. The principal then moved fire to
Square, the trim back to the triggers, where it keeps its analog pull, and
the targets back to the shoulders.

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

A console's own grammar, rendered like the table above. `B` backs out to the
forward view, out of a modal, or out of the instrument; the shoulders do
nothing in the instrument, which has no tabs (#379). The keyboard column is the
Requests tab's, which walks on the same five keys.

<!-- generated: console — tests/gamepad-doc.test.ts renders it from DEFAULT_BINDINGS; do not edit by hand -->

| on the pad | does | keyboard and mouse |
| --- | --- | --- |
| d-pad ↑ | Walk a console's cursor up | `↑ (Requests)` |
| d-pad ↓ | Walk a console's cursor down | `↓ (Requests)` |
| L1 | Previous console tab | `← (Requests)` |
| R1 | Next console tab | `→ (Requests)` |
| A | Select the row under the cursor | `Enter (Requests)` |
| B | Close a console, or turn the head forward | — |

<!-- end generated: console -->

And what a console does to everything else, which is a rule rather than a
binding:

| control | while a console holds the pad |
| --- | --- |
| sticks, triggers, mouse — its look, its pointer and its button | **suspended** — the ship coasts, and a click on the glass beside the console does not fire (#378) |
| the keyboard | still flies — the principal's ruling; a key has to be *held* |
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
| what a button means in each context | `tests/pad-bindings.test.ts` |
| the two tables above are the shipped layout's | `tests/gamepad-doc.test.ts` |
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
- **Open the settings screen by a button of its own.** Nothing on the pad is
  bound to it by default. Since #381 S4 the `Controls` tab has a Settings door,
  and the pad reaches it — d-pad → turns the head to the right console, the
  shoulders step to the tab, d-pad ↑ walks the ring onto the door, and `A`
  opens the screen (`scripts/probe-derived-names.mjs` flies that path). Once it is
  open the pad drives it, and Circle closes it. A player can also bind
  `system.settings` to a button in that tab.
- **Type a Commander's name or a seed** (once #306 lands). The new-game form
  pre-fills both — a free default name and a random seed — so a pad player can
  start a game by accepting them, and re-roll the seed; retyping either takes the keyboard, for the
  reason under **Type** above.
- **Reach the tuning dials or the perf panel's letter keys.** Seventeen buttons
  cannot carry twenty-six letters plus `PERF_KEYS`, `RESTORE_KEY` and
  `SETTINGS_KEY`. What the pad claims is the flight-critical set; the dials stay
  on the keyboard, and the instrument's switches are reachable through its
  cursor rather than through their letters.
- **Rebind a stick, a trigger or a held button.** The `Controls` tab rebinds
  since #381 S4, and a pad button can be moved there like a key — but the
  sticks, the two triggers and the held fire button are read in fixed
  positions, so the rebind refuses them and says why. #496 owns that.
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

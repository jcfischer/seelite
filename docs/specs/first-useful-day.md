# A new pilot's first useful day

Author: Ivy · 2026-09-25
Status: principal decisions D1–D7 and playtest rulings P1–P5 taken live on
2026-09-25; approved in flight by the principal the same day. A hand dock at a
fast shipyard stays open as #529 (D7).
Decision node: [Give a new pilot their first useful day](https://github.com/jcfischer/seelite/issues/408).
Direction it implements: `product-and-website-direction.md`, principle 2 and the
player-journey row "First useful day". This spec does not redefine that
direction.

## What this spec does not own

| Fact | Owner |
| --- | --- |
| Offers, acceptance, tracking, report-at-requester, the journal | `missions-and-requests.md` |
| Job families, rows, binders, the courier floor | `ordinary-requests.md` |
| Clearance, berths, the docking computer, arrival and launch | `docking.md` |
| The save envelope, its versions and the Commander overlay | `persistent-world-state.md` |
| Raider legs and their odds | `combat-model.md` and `src/raider-slots.ts` |

## Measured before deciding

Taken at `origin/main` 96fd436 over 200 world seeds (`seed × 7919`, galaxy 0,
`startSystem`). Figures are for that sample only.

- A new game starts **in flight**, at the arrival point 1 AU from the star
  (`makeWorld`). The start trade station is a median **1.15 AU** from it
  (0.28 to 5.08), so the first act of an in-flight start is a cruise leg, and
  cruise legs are where raiders roll.
- A death before the first dock had no `lastDocked` checkpoint; both arms of
  `onDeath` ended at the Commander overlay. Since #660 D10 (node #702) such a
  pilot wakes as a new commander docked at the start system's trade station.
- The start trade station's first courier is in-system in **4 of 200** seeds.
  Its candidates average 27.7, of which 1.15 are in-system.
- The start system has only its trade station in **33 of 200** seeds (16.5%).

## Decisions

### D1: A guided new game starts docked

A new game that chose the guided first day starts **docked at the start
system's trade station**, so the day begins with launch. It gets there through
the docking protocol, never around it: after the store attaches, the ship is
set on the station's aperture axis, co-moving, asks for clearance, and the
docking computer flies it in with Traffic running
(`Game.startDockedAtHome`). The dock is an ordinary one, so it writes the
`lastDocked` checkpoint, and a guided pilot has a checkpoint before their first
flight. The clock starts at that dock rather than at zero: 76.9 s of game time
at each of the ten seeds tried when the path was built, because the run-in is
the same geometry at every trade station. `probe-first-day` prints it for its
own seed on every run. A start that cannot dock ends still flying (a run-in
already inside the station is finished, not undone), and then puts back what it
moved: the ship at the arrival point, the computer off, the grant it was given
released. So it is a free start with the clock moved on. `probe-first-day`
runs both ways of failing: the clearance refused, and a run-in that never ends.

**Amended by #530 (built in #535).** The guided start is now a real flight
from the arrival point — the opening cinematic, `src/opening.ts` — which ends
docked at the same trade station through a real clearance and writes
`lastDocked` the same way. The placement above is its fallback (#530 D6), run
from wherever the flight stopped. The clock at the dock is the whole flight's,
about 148 s on seed 47 rather than 76.9 s. Under `?boot=direct` and
`?system=` the flight still runs, skipped, so a guided probe starts where a
player who skips the opening starts.

A free new game, `?boot=direct` and `?system=` keep the in-flight start.
`?guided` on a direct boot with nothing loaded opts in, for probes and
playtests, on `?permadeath`'s rule.

A save taken docked **re-enters its station through the docking protocol**
(node #658, building #293): `restoreDockedAt` docks the ship at the saved
station before the clock runs. So a guided pilot who reloads before launching
is docked, on the same step they saved at. If the station is absent after a
generator change, or the ship is not in flight, the ship stays at its saved
position in flight. If the station exists and the protocol reaches it but the
grant is refused (no free berth), the ship is left **beside the station** — on
the axis outside the standoff, co-moving — not at the saved position (D2).

The principal chose this on 2026-09-25 over an in-flight start with or
without a start checkpoint, and over docking every new game.

### D2: The first job is a "local run"

A new authored courier row, **Local run**, that binds only to a station in the
posting system. Every station whose system has a second station posts it,
whoever is docked, so it is ordinary work and not a tutorial offer. It is its
own **post** on the board beside D8's floor courier, with its own draw stream,
offer identity and episode count, so taking or settling one never moves the
other (`ordinary-requests.md` §3 records the second post). It pays 78 Cr for
6 t.

Measured on the build: 167 of 200 start trade stations post one, which is
every start system except the 33 single-station ones above.
`scripts/measure-first-day.ts` reprints this and the figures above. Once, when
the row landed, every other offer on the first 120 systems of two galaxies was
compared with `origin/main` (96fd436) and was byte-identical. What keeps that
true in the tree is structural: the existing posts keep their stream values,
and `tests/local-run.test.ts` holds that settling either post leaves the other
unchanged.

A start system with no second station posts no local run; the guided day then
points at a job the pilot can fly, which is the one-jump courier.

Rejected: using the one-jump courier for everyone; an offer only a new pilot
sees, which would make a binder read commander state
(`ordinary-requests.md` §2).

### D3: Guidance is pushed where the pilot is looking, and pulled from a tab

- **Push, docked:** station control speaks on the **station console**, under
  its tabs. The docked console fills the forward view and the glass prompt is
  not drawn there, so the Communications log alone would be out of sight.
- **Push, in flight:** the prompt line names the delivery station and, beside
  it, the two keys that dock. A far selected station is left to the ordinary
  cruise prompt, which already says what to do.
- **Record:** each line station control says is also written to the
  Communications log. It keeps the last three, because the log shows six and a
  first day says five.
- **Pull:** a **First day** tab on the port console lists the steps and marks
  the one the pilot is on.

Station selection is named as the Navigation console, not the next-target key:
that key cycles through every contact in the system.

### D4: The choice is made at New game and saved

The Commander overlay's New game has a **First day guidance** row, on by
default, beside Permadeath. The choice rides the pending record across New
game's reload and is saved on the commander (save schema v6). A save from v2–v5
loads as **free**: a pilot who already has a save is not new. A pending record
written by the build before this one reads as free too.

Rejected: deriving the choice with a settings switch; an in-world offer the
pilot may ignore.

### D5: Everyone has the tab; only guided pilots are pushed

The tab is on-demand guidance for every commander. Only a guided commander
gets station control's lines and the prompt-line steps unasked, and the push
stops once the pilot has reported a first job: station control says one
closing line at that berth, and nothing after the pilot launches. The tab
stays.

### D6: Trouble is not scripted

The day ends in trade or trouble as the world decides it. A scripted raider
would be the compulsory tutorial track the direction rules out. The local run's
cruise legs roll raiders at the start system's ordinary odds; the report pays
credits, and the Market is the day's last step.

### D7: A new ship has no docking computer

The principal's ruling on 2026-09-25: the docking computer is not on the
initial ship; it is bought, at the Equipment tab's 1,000 Cr. It had shipped
fitted while no screen sold it (`docking.md` §3.1 records what that cost).
`Game.hasDockingComputer` now reads the commander's equipment.

So a new pilot's first dock is by hand, and the day says so: a pilot without
the computer is told to ask for clearance, line up with the opening and fly in
slowly, and the docking key is named only to a pilot who owns one. D1's docked
start still engages the computer's flag directly, because that is the station
bringing the ship in before the clock runs, not the pilot flying.

**Open, and owned elsewhere: a hand dock at a fast shipyard.** The flight
assist holds a ship at rest against its frame's velocity but not its
acceleration, so beside a station orbiting a gas giant low the ship keeps a
sideways lag of about a × τ. The principal found the USBISO shipyard (71.7 m/s²)
impossible to dock by hand. The free computer hid this until D7. The Local
run goes to the shipyard in 122 of 200 start systems, and in 18 of them that lag
is over half the gate speed (`scripts/measure-first-day.ts`). The principal
ruled it a machine-map fix, not this node's:
[#529](https://github.com/jcfischer/seelite/issues/529).

### The escape pod (#660 D9, built by node #704)

No new pilot is exempt from what a death costs, and none is given a pod: a
new pilot in a bare courier loses little to a death without one, and the
courier floor is open to a pilot with 0 Cr (`economy-trade.md` §9). So the day
teaches the eject key **from the first pod purchase**: once one is fitted, the
First day tab carries an escape-pod row naming the control as bound
(`firstDayEjectLine`) and what an eject keeps and loses. Every commander has
it, guided or free, as every commander has the tab (D5); it is not pushed.

## Playtest rulings (2026-09-25)

The principal flew the build and ruled on what the day should say and do. Each
is built and probed; the mechanism a ruling changed is recorded in its owner.

- **P1: Launch goes through the right console.** Enter on the docked console
  acts on the focused Requests control, and it tracked the job instead of
  launching. The launch step names the starboard head-look key and LAUNCH on
  the Flight tab.
- **P2: After selecting, say 2, F, then J.** When a station is selected on the
  port console, station control says so there, where the head is turned and the
  glass is not drawn. The glass then says to turn toward it and cruise.
- **P3: A launch flies clear, and lets go moving.** Built for every player
  launch, not only the first day's (`docking.md` §12.2).
- **P4: F then J tracks the station.** A plain leg steers at the selected
  station until the drop, as a detour's last leg did (`in-system-travel.md`
  §12.5).
- **P5: Show how to fly and steer.** A guided pilot in normal flight sees
  throttle, pitch, yaw and roll, on the keyboard and the controller, at the top
  of the glass, from the layout in force (`flightControls` in
  `src/key-names.ts`). The First day tab lists them for every commander.

## The steps

The step is **derived from state**, never stored (`src/first-day.ts`). Only
the guided/free choice (D4) is saved. The rows overlap, so the order is the
rule: a reported job ends the day before anything else is asked, and a running
job outranks being docked.

| Step | Holds while | The pilot is told |
| --- | --- | --- |
| Trade | A request has been reported | The pay is yours; the Market and more work are on the console |
| Report | A job running, docked where it reports | Report on the Requests tab |
| Launch | A job running, docked anywhere else | Turn to the right console and select LAUNCH (P1) |
| Fly | A job running, not docked | Select the delivery station on the port console, then 2, F and J (P2); near it the clearance key, then the docking key if the computer is owned, else to fly in slowly (D7) |
| Take work | Nothing running, docked | Accept the Local run, or a job when none is posted |
| Dock at a station | Nothing running, not docked | Select a station, cruise, clearance, dock |

"Dock at a station" is a free pilot's start, and a guided pilot's after a
reload (D1).

## Verification

| Case | Tier | Where |
| --- | --- | --- |
| v6 round-trips the choice; v2–v5 load as free; an older version carrying the key is refused | Headless | `tests/first-day-save.test.ts` |
| The choice at boot: New game's, or `?guided` on a direct boot with nothing loaded | Headless | `tests/commander-flow.test.ts` |
| The local run binds only in-system, is deterministic, declines with no second station in the system, and never moves the floor courier | Headless | `tests/local-run.test.ts` |
| Every step, its precedence, and the in-flight hole | Headless | `tests/first-day.test.ts` |
| A guided new game boots docked through a real clearance and writes `lastDocked`; a free one boots in flight | Browser | `probe-first-day.mjs` |
| The day flown end to end: accept, launch, fly, dock, deliver, report, paid | Browser | `probe-first-day.mjs` |
| The station console line, the tab, the log and the prompt line read right | Captures, then the principal in flight | `probe-first-day.mjs` writes them |

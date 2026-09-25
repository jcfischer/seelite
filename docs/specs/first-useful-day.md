# A new pilot's first useful day

Author: Ivy · 2026-09-25
Status: principal decisions D1–D6 taken live on 2026-09-25; the slice is a
prototype until the principal approves it in flight.
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
- A death before the first dock has no `lastDocked` checkpoint; both arms of
  `onDeath` end at the Commander overlay.
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
on ten seeds.

A free new game, `?boot=direct` and `?system=` keep the in-flight start.
`?guided` on a direct boot with nothing loaded opts in, for probes and
playtests, on `?permadeath`'s rule.

A save taken docked still **resumes in flight at the arrival point**
(`main.ts`'s load arm, pending #72's dock-session extraction). So a guided
pilot who reloads before launching is in flight, on the Dock at a station step.

The principal chose this on 2026-09-25 over an in-flight start with or
without a start checkpoint, and over docking every new game.

### D2: The first job is a "local run"

A new authored courier row, **Local run**, that binds only to a station in the
posting system. Every station with an in-system neighbour posts it, whoever is
docked, so it is ordinary work and not a tutorial offer. It is its own slot
beside D8's floor courier, with its own draw stream, offer identity and
episode count, so taking or settling one never moves the other
(`ordinary-requests.md` §3 records the second slot). It pays 78 Cr for 6 t.

Measured on the build: 167 of 200 start trade stations post one, which is the
33 single-station start systems above and no others. Every other offer on the
first 120 systems of two galaxies is byte-identical to `origin/main`.

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

## The steps

The step is **derived from state**, never stored (`src/first-day.ts`). Only
the guided/free choice (D4) is saved. The rows overlap, so the order is the
rule: a reported job ends the day before anything else is asked, and a running
job outranks being docked.

| Step | Holds while | The pilot is told |
| --- | --- | --- |
| Trade | A request has been reported | The pay is yours; the Market and more work are on the console |
| Report | A job running, docked where it reports | Report on the Requests tab |
| Launch | A job running, docked anywhere else | The launch key |
| Fly | A job running, not docked | The delivery station, and near it the clearance and docking keys |
| Take work | Nothing running, docked | Accept the Local run, or a job when none is posted |
| Dock at a station | Nothing running, not docked | Select a station, cruise, clearance, dock |

"Dock at a station" is a free pilot's start, and a guided pilot's after a
reload (D1).

## Verification

| Case | Tier | Where |
| --- | --- | --- |
| v6 round-trips the choice; v2–v5 load as free; an older version carrying the key is refused | Headless | `tests/first-day-save.test.ts` |
| The choice at boot: New game's, or `?guided` on a direct boot with nothing loaded | Headless | `tests/commander-flow.test.ts` |
| The local run binds only in-system, is deterministic, declines with no in-system neighbour, and never moves the floor courier | Headless | `tests/local-run.test.ts` |
| Every step, its precedence, and the in-flight hole | Headless | `tests/first-day.test.ts` |
| A guided new game boots docked through a real clearance and writes `lastDocked`; a free one boots in flight | Browser | `probe-first-day.mjs` |
| The day flown end to end: accept, launch, fly, dock, deliver, report, paid | Browser | `probe-first-day.mjs` |
| The station console line, the tab, the log and the prompt line read right | Captures, then the principal in flight | `probe-first-day.mjs` writes them |

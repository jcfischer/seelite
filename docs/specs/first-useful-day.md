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
the docking protocol (a real clearance, a real berth, the arrival skipped),
never around it, and that dock writes the `lastDocked` checkpoint like any
other. A free new game, `?boot=direct` and `?system=` keep the in-flight start.

Rejected: an in-flight start with or without a start checkpoint (the direction
spec's order is launch first); docking every new game (moves every probe's
start).

### D2: The first job is a "local run"

A new authored courier row, **Local run**, that binds only to a station in the
posting system. Every station with an in-system neighbour posts it, whoever is
docked, so it is ordinary work and not a tutorial offer. It is its own slot
beside D8's floor courier, with its own draw stream, offer identity and
episode count, so taking or settling one never moves the other.

A start system with no second station (16.5% above) posts no local run; the
guided day then points at the ordinary courier, which is one jump away.

Rejected: using the one-jump courier for everyone; an offer only a new pilot
sees, which would make a binder read commander state
(`ordinary-requests.md` §2).

### D3: Guidance is pushed on existing channels and pulled from a tab

- **Push:** station control speaks in the Communications log, and the prompt
  line shows the next step.
- **Pull:** a **First day** tab on the port console shows the steps and which
  one the pilot is on.

### D4: The choice is made at New game and saved

The Commander overlay's new game offers **guided** and **free**. The choice is
saved on the commander (save schema v6). A save from v2–v5 loads as **free**:
a pilot who already has a save is not new.

Rejected: deriving the choice with a settings switch; an in-world offer the
pilot may ignore.

### D5: Everyone has the tab; only guided pilots are pushed

The tab is on-demand guidance for every commander. Only a guided commander
gets the log lines and prompt-line steps unasked, and the push stops once the
pilot has reported a first job. The tab stays.

### D6: Trouble is not scripted

The day ends in trade or trouble as the world decides it. A scripted raider
would be the compulsory tutorial track the direction rules out. The local run's
cruise legs roll raiders at the start system's ordinary odds; the report pays
credits, and the Market is the day's last step.

## The steps

The step is **derived from state**, never stored. Only the guided/free choice
(D4) is saved.

| Step | Holds while | The pilot is told |
| --- | --- | --- |
| Take work | Docked, no running request | Open Requests and accept the Local run |
| Launch | Docked with a running request | Launch |
| Fly | In flight with a running request | Select the delivery station, cruise to it, ask for clearance and dock |
| Report | Docked where the running request reports | Report on the Requests tab |
| Trade | A request has been reported | The pay is yours: the Market is on the station console |

The day is over when the journal holds a completed request. That is the same
fact the push reads to stop.

## Verification

| Case | Tier |
| --- | --- |
| v6 round-trips the choice; v2–v5 load as free | Headless |
| The local run binds only in-system, is deterministic, declines with no in-system neighbour, and never moves the floor courier | Headless |
| The step derivation for each row of the table | Headless |
| A guided new game boots docked at the start trade station through a real clearance and writes `lastDocked` | Browser |
| A free new game boots in flight, as before | Browser |
| The day flown end to end: accept, launch, fly, dock, report | Browser |
| The tab, the log lines and the prompt line read right | Browser captures, then the principal in flight |

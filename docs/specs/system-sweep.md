# System sweep — node #482

The Long-Range Scanner has a **Sweep** tab beside Navigation on the left
console. The tab appears only while the module is fitted. One explicit press
starts a ten-second charge on the game clock; release, changing tabs and looking
away do not cancel it. It consumes no drive charge. Cruise engagement (including
spooling), docking and leaving the system break the charge. A new press starts
from zero. Cruise and docked actions refuse with a readable reason.

Completion reads the current system once. Operational active pirate relays name
the watched station's surrounds. Active derelict slots produce one salvage
reading each. Operational raider slots produce **one** pressure region, around
the outpost where one exists, otherwise along the system's **cruise lanes**
(node #769): raiders have no standing position, and a cruise leg is the only
place the leg law brings one. Disabled ordinary
carriers and repair tenders are never sweep sources. Derelict hull placement and
capital content are separate builds. Node #732 gives a derelict a pose beside a
planet or moon (`derelictPose`), but a derelict region still names system
space, with no body and no position. The sweep does not author their placement
or their close cues.

`CommanderRecord.sweepReadings` holds **Sweep readings** (`SweepReading`): a stable id
names the galaxy, system and source; the row records `own-sensors`, observation
time and a named region. This ledger is distinct from Requests' retained
`SavedLead`: it has no confirmation action or state. No coordinates, identified reference,
condition snapshot or target id is saved. Region rows are plain reading blocks,
visually separate from Navigation's selectable contact rows. They have no
target control, contact registration or marker path.

The per-galaxy `KnowledgeRow` remains the only discovery/condition authority
(`missions-and-requests.md` §1). Sweep code invokes no knowledge writer. The
existing fitted relay cue appears inside `RELAY_SIGNAL_RANGE_KM`; flown
identification inside `RELAY_IDENTIFY_RANGE_KM` alone makes it a contact.

Age is derived from the saved observation time using the same formatter as the
Identity Scanner. At one hour the row adds **STALE**. Looking at the tab cannot
refresh it. A past reading remains even if its source disappears; the next
completed sweep replaces only this galaxy/system's readings, including
absences, as `salvage.md` S22 requires.

## Raider pressure strength — node #769

A pressure row reads a **strength**, light, moderate or heavy, and never a
count (#468 D5: a region of pressure, not a roster of ships). The strength
buckets `raiderLegMeetChance` in `raider-slots.ts`: the leg law's chance for the
system's government, times the share of its raider slots that are operational.
That product is what a law leg delivers, because `scheduleEncounter` does not
move a draw from a down slot to another. The edges are
`PRESSURE_HEAVY_CHANCE` and `PRESSURE_MODERATE_CHANCE` in `system-sweep.ts`;
at full strength they read governments 0–2 heavy, 3–5 moderate and 6–7 light,
and every reachable product sits clear of both edges.

Rulings taken at the build, open to the principal:

- **Three levels.** Two would leave a downed raider invisible everywhere but
  at one edge.
- **Destroyed or repairing raider slots lower the strength until their
  replacement is operational**, because the leg law is lower by exactly that
  share. An anarchy that lost three of four raiders reads light.
- **An outpost keeps its station name** as the region; the strength is on the
  row's label in both cases. The outpost is the haven the pressure comes from
  (#490).
- **The strength is recorded at observation, like the region**, so a stale row
  keeps the strength it was read at. Deriving it on read would make a row show
  today's slot conditions, which is a refresh by looking.

Save schema 15 adds the strength to pressure rows and the `cruise-lanes` region
kind, which only a pressure row may name. A version 11–14 pressure row keeps
its region exactly as observed and loads with a `null` strength, labelled
*strength not recorded*; today's slots cannot say what it was, and the next
sweep replaces it. Those versions refuse a row carrying either new field;
version 15 refuses a pressure row without the strength key, a strength on any
other row, and a `null` strength beside the cruise lanes.

## Save

Save schema 11 adds a required sweep ledger, empty or populated. Versions 2–10
retain their original integrity check and migrate to an empty ledger. Those
versions refuse an assembled sweep field; version 11 refuses a missing ledger.
Older readers refuse version 11 instead of silently dropping readings.
Nonempty provenance is validated
against the named galaxy/system and enabled generated subject, with finite clock bounds,
unique identities, supported region kinds and a fixed field set. Malformed
provenance refuses the whole save. Load validation does not read current source
condition: disappearance after an observation cannot erase a dated reading.
Region validation checks its shape and any named station, not today's generated
placement: a historical reading survives later placement changes unchanged.
Charge and console status are session state. The domain module owns charge,
sources and parsing; `system-sweep-view.ts` owns the read-only cockpit projection.

## Verification

`tests/system-sweep.test.ts` covers charge/refusal, source purity,
save validation and ages, and node #769's buckets, the leg law's delivered
rate, downed slots and the schema 11–14 migrations; `scripts/probe-system-sweep.mjs` covers the live
console press, interruption, target isolation, save reload and relay proximity
identification. This is scoped worker evidence; principal visual approval and
the checkpoint gate remain the supervisor's delivery steps.

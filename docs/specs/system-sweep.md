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
the outpost where one exists, otherwise in system space. Disabled ordinary
carriers and repair tenders are never sweep sources. Derelict hull placement and
capital content are separate builds: until their generated frames exist,
derelict regions conservatively name unsettled system space, with no invented
position. The sweep does not author their placement or their close cues.

`CommanderRecord.sweepLeads` holds SavedLead-shaped provenance: a stable id
names the galaxy, system and source; the row records `own-sensors`, observation
time, a named region and `unconfirmed`. No coordinates, identified reference,
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

Save schema 10 adds a required sweep ledger, empty or populated. Versions 2–9
retain their original integrity check and migrate to an empty ledger. Those
versions refuse an assembled sweep field; version 10 refuses a missing ledger.
Older readers refuse version 10 instead of silently dropping readings.
Nonempty provenance is validated
against the named galaxy/system and generated subject, with finite clock bounds,
unique identities, supported region kinds and a fixed field set. Malformed
provenance refuses the whole save. Charge and console status are session state.

Verification: `tests/system-sweep.test.ts` covers charge/refusal, source purity,
save validation and ages; `scripts/probe-system-sweep.mjs` covers the live
console press, interruption, target isolation, save reload and relay proximity
identification. This is scoped worker evidence; principal visual approval and
the checkpoint gate remain the supervisor's delivery steps.

# seelite Domain Language

This glossary defines vocabulary for seelite's planned causal world model and points to the specs that own structural details. The core consequence terms originate in work-graph node [“Operational consequences: what can the player change?”](https://github.com/jcfischer/seelite/issues/41). The work-graph map (`soma graph node 1`) remains authoritative for constraints and delivery rules.

## Language

**Carrier**:
A named physical asset, actor, or condition in the universe that enables a capability in a bounded consequence area.
_Avoid_: Modifier, influence point

**Carrier slot**:
The persistent identity for a generated place that survives destruction and replacement of its occupying carrier instance. `docs/specs/persistent-world-state.md` §2 owns its key structure.
_Avoid_: Bare global object ID, display name

**CarrierKey**:
The canonical persisted identity of a carrier slot; a galaxy envelope may store its system-local pair and supplies the galaxy component. `docs/specs/persistent-world-state.md` §2 and §7 own the structure.

**Carrier instance**:
The original or a numbered replacement occupying a carrier slot.
_Avoid_: Replacement state

**Instance ordinal**:
The stable sequence number distinguishing the original carrier instance from its replacements. `docs/specs/persistent-world-state.md` §2 owns its allocation rule.

**Capability**:
What a carrier enables while it has a particular operational condition.
_Avoid_: Bonus, percentage effect

**Intervention**:
A player action that changes a carrier's operational condition or recovery process.
_Avoid_: Command, influence spend

**Operational condition**:
A carrier instance's objective physical condition. `docs/specs/persistent-world-state.md` §3.2 owns the enumeration.
_Avoid_: Status flag, lifecycle

**Last-known state**:
The player's timestamped knowledge of a carrier instance and its observed operational condition. It may differ from the objective condition when events happen out of sight.
_Avoid_: Live map state, discovery status

**Recovery process**:
A named, visible, and interruptible in-world process that repairs a carrier instance or replaces it with a new one.
_Avoid_: Respawn timer

**Causal episode**:
The bounded provenance unit for the latest related operational transitions at one carrier slot. `docs/specs/persistent-world-state.md` §5 owns its retained facts and compaction rule.
_Avoid_: Full event log

**Causal-episode ordinal**:
The stable sequence number distinguishing successive causal episodes at one carrier slot. `docs/specs/persistent-world-state.md` §4 owns allocation; §5 owns retention and compaction.

**Consequence area**:
The station, system, or named route affected by a carrier's capability.
_Avoid_: Territory

**Operational consequence**:
A mechanically different later situation produced by an intervention and attributable through world evidence and a persistent record.
_Avoid_: Flavour text, global influence

# seelite Domain Language

This glossary defines domain language for seelite's planned causal world model. It is vocabulary only; the work-graph map (`soma graph node 1`) remains authoritative for constraints and delivery rules.

## Language

**Carrier**:
A named physical asset, actor, or situation whose operational condition enables a capability in a bounded consequence area.
_Avoid_: Modifier, influence point

**Carrier slot**:
A stable generated place in the universe identified by galaxy, system, and the sanctioned `localCarrierId` component. A slot survives destruction and replacement of the carrier instance occupying it.
_Avoid_: Bare global object ID, display name

**Carrier instance**:
The original or a numbered replacement occupying a carrier slot.
_Avoid_: Replacement state

**Capability**:
What a carrier enables while it has a particular operational condition.
_Avoid_: Bonus, percentage effect

**Intervention**:
A player action that changes a carrier's operational condition or recovery process.
_Avoid_: Command, influence spend

**Operational condition**:
A carrier instance's objective physical condition: operational, disabled, destroyed, or repairing.
_Avoid_: Status flag, lifecycle

**Last-known state**:
The player's timestamped knowledge of a carrier instance and its observed operational condition. It may differ from the objective condition when events happen out of sight.
_Avoid_: Live map state, discovery status

**Recovery process**:
A named, visible, and interruptible in-world process that repairs a carrier instance or replaces it with a new one.
_Avoid_: Respawn timer

**Causal episode**:
The bounded summary of the latest related operational transitions for one carrier slot, preserving why it changed and the player's role.
_Avoid_: Full event log

**Consequence area**:
The station, system, or named route affected by a carrier's capability.
_Avoid_: Territory

**Operational consequence**:
A mechanically different later situation produced by an intervention and attributable through world evidence and a persistent record.
_Avoid_: Flavour text, global influence

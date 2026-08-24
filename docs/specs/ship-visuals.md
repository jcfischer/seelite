# Spec: procedural ship visuals

## 1. Purpose and boundary

Issue #35 replaces the player ship's chase-view cube with a readable, asset-free
procedural hull language. It supplies three **visual archetypes** — `courier`,
`interceptor`, and `freighter` — rather than a game roster. Issue #26 remains
the only owner of which purchasable or NPC ship selects an archetype; a future
roster must choose one explicitly and never receive a silent default.

Each archetype has three deliberately different construction concepts for
design selection. The courier round spans a broad armored flying wing, a split
bow with long engine shoulders, and a compact offset-cockpit diamond. The
interceptor round spans a dart fuselage, a cropped delta, and an open-rear
twin-boom frame. The freighter round spans asymmetric side pods, an open-spine
catamaran, and a rear-heavy tug. Their silhouette and engine placement are
motion-relevant cues; exhaust is deliberately compact and secondary to hull
mass.

The visual grammar synthesises current space-game practice without copying a
specific craft: Elite contributes the iconic low planform, Star Wars contributes
role-readable functional landmarks and controlled asymmetry, EVERSPACE
contributes class-specific rules over modular parts, No Man's Sky contributes
paint/material variation, and Star Citizen/Starfield contribute layered
industrial construction. Primary mass must remain continuous; secondary panels
may explain structure but must never return to an assembly of disconnected
boxes.

The query-gated `?model-viewer=ship` workbench exposes all nine candidates
without constructing `Game`. A designer can orbit each candidate, apply
temporary proportion controls, and rank A/B/C in preference order per role.
The ranking summary is an iteration input, not persistent game state: it guides
the next three concepts but does not select a roster hull or alter flight.

## 2. Rendering contract

All hull geometry is generated at load from beveled planform extrusions,
longitudinal lofts, and compact engine rings. It is deterministic, has a tested
local reach budget, needs no downloaded asset, and contains no simulation
position, collision, target, or AI data. `sim.ts` remains the float64 authority;
renderer objects are its camera-relative shadow.

The player hull is a near-scene object. It is hidden in cockpit view because the
cockpit HUD, attitude floor, target director, and scanner remain the primary
flight references. Chase view makes that same hull visible as an external
orientation check. Chase also includes one interceptor and freighter formation
sample at flight distance, giving the archetypes an honest relative-scale check.
Those samples are child display meshes, not simulation actors: they have no
position in `sim.ts`, target identity, scanner contact, AI, collision, or roster
meaning. Hulls do not participate in the body far/near handoff, so the existing
kilometre-scale body handoff stays untouched.

## 3. Verification contract

Headless tests assert all nine candidates have stable hull and variant identity,
deterministic bounds, declared reach, distinct design theses, compact exhausts,
intersecting canopy fairings and structurally mounted nacelles. A viewer probe
verifies all nine candidates, per-role ranking, isolated draft controls, and the
absence of `Game`. A live browser probe verifies that the courier is present
only in chase view and that returning to cockpit restores the live cockpit
instruments and overlay.

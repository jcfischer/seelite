# Spec: procedural ship visuals

## 1. Purpose and boundary

Issue #35 replaces the player ship's chase-view cube with a readable, asset-free
procedural hull language. It supplies three **visual archetypes** — `courier`,
`interceptor`, and `freighter` — rather than a game roster. Issue #26 remains
the only owner of which purchasable or NPC ship selects an archetype; a future
roster must choose one explicitly and never receive a silent default.

`courier` is the player baseline: a compact faceted nose, a low wing, and paired
exhausts. `interceptor` is a fast-looking spear with a broad delta plane;
`freighter` is a deeper spine with twin cargo pods. Their silhouette and exhaust
placement are motion-relevant cues; colour and metal/emissive detail are
secondary.

## 2. Rendering contract

All hull geometry is generated at load from Three.js primitives. It is
deterministic, has a tested local reach budget, needs no downloaded asset, and
contains no simulation position, collision, target, or AI data. `sim.ts`
remains the float64 authority; renderer objects are its camera-relative shadow.

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

Headless tests assert stable hull names, deterministic bounds, declared reach,
and distinct gross proportions. A browser probe verifies that the live courier
is present only in chase view and that returning to cockpit restores the live
cockpit instruments and overlay.

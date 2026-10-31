# Longwall drill production port (node #1150)

With `?mining=1`, arming **BUILT-IN DRILL** deploys the Longwall's feed and
four struts. Near rock, the pilot flies in its surface frame with fine
translation and turns. **4** anchors and seats the ship; the held trigger
spins the cutter, spends the shared bank, heats the gauge and transfers whole
ore tonnes directly into the existing mining hold projection.

The port follows `origin/prototype/920-drill` at `3af26015`. Surface-frame
fine control, face-plane strut reach and seating are fixed defaults. The
prototype's alternative URL controls, mount loader, slot mutation, badge and
save filtering are excluded. Rates remain provisional for node #922.

## Integration boundaries

- `rock-drill.ts` owns contact, feed, spin, extraction, fine-control and anchor
  arithmetic. `longwall-drill-rig.ts` copies the approved study's joint
  geometry into production source; runtime imports no study file.
- `poseLongwallDrill` poses feed, rotor and struts in the game and table test.
- The shipped GLB is unchanged. With mining enabled, installation preserves
  strut joints and lifts the six existing mount meshes out of the hull batch
  into two mount groups, preserving their transforms. Without the flag, the
  original hull and anchor batching remains in force.
- `cockpitOcclusion` runs in tests. The game reads the nearest of five rows
  measured from the unchanged `(0, 0, -8)` m eye and draws only those parts.
  The cockpit view draws neither the hull nor plumes. Leaving restores each
  part's previous visibility. The table must be regenerated after an eye or
  exterior-model change.
- Ore uses the existing mining hold projection and deposit-state writes.
  No Commander field, save codec, loadout, hull specification or NPC fit changes.
  Survey knowledge is unnecessary for extraction.

## Every shared change

- `FireGroup.kind` includes `drill`; only a cutter hull with the mining flag
  gets that group. Scanner and laser routing retain their existing behavior.
- The controls catalogue adds rebindable `fight.drillHold` on **4**. Dispatch
  performs its action only with mining enabled.
- The flown collision cache also keys on full deployment; only a mining-enabled
  deployed cutter adds `shipPrimitives(spec, true)` to the flown solid.
- Normal-flight demand and the assist-frame source use fine control only when
  the flag is enabled, the drill is armed and a rock is nearby. Turns use 5%
  input in that state. Other flight paths keep their existing inputs.
- `AudioFX` gains a synthesized drill motor and contact grind on the ship bus.
  Pause and leaving a cutter hull silence it.
- The cockpit beam buffer increases from 16 to 128 strokes, shared through
  `BEAM_CAPACITY`, as preparatory capacity explicitly required by node #1150 when this slice
  lands before the laser-beam port. The drill emits no beam strokes. A headless
  capacity check covers all 128 strokes.
- The comments baseline decreases for the removed local beam-capacity and
  cockpit-eye comments. Probe catalogue and roots register `probe-mining-drill.mjs`
  and its shared cockpit-eye module.

## Initial implementation verification

The domain and cockpit tests were ported before their implementation. Their
first run failed on the missing drill modules. Production-model tests then
exposed the mounts' different hierarchy and the struts visible from the eye.
The view tests now measure the shipped asset with posable struts and check
both the cockpit eye and an eye above the mounts, including the drill head.

`WRITE_COCKPIT_OCCLUSION=1 bun test tests/cockpit-occlusion-table.test.ts`
regenerates the five rows. The drift test compares every measured row and the
eye imported by both `main.ts` and the test from `cockpit-eye.ts`; a blank or single-pose table cannot match it.
Each measurement test has enough time for raycasting under host load.
Both a blank-table mutation and a single-pose mutation failed the five-pose
check; restoring the generated table passed.

Targeted validation: 137 tests passed across the ten changed domain, controls,
beam, rig and cockpit test files. Typecheck, build, format, script lint and the comments check pass.

The one required `npm test` run completed with 7,330 passes and 21 failures.
All failures had three causes: an older miner fire-group expectation omitted
the drill, the extracted-Game field-frame fixture lacked the new
`MINING_ON: false` binding, and the new browser probe needed its default-layout
label. Those integration expectations are repaired. A focused rerun of
`miner-hardpoints`, `field-frame`, `probe-key-labels`, `probe-impact` and
`probe-selection` passed 84/84. Per the worker SOP, there was no second full
suite run; the supervisor reruns it on this commit.

The new hardware probe uses a real shaped rock with no survey. It exercises
the bound **B**, **4** and trigger inputs, deploys, seats at a measured 0.3 m
face gap and checks exact conservation. Its initial passing run transferred
5 t to the hold and debited 5 t from the deep reserve. Release and disarm
retracted the cutter, stopped output and restored one collision primitive.
The flagless control retained the old fire groups and cockpit visibility.

Five chase-to-cockpit transitions recorded zero long tasks on ANGLE Metal,
Apple M1 Pro, at 1280 × 800 with the full models installed and the simulation
clock held. The game reads the static pose table; this check does not force a
cold cache or exercise a runtime raycast.
The observer watches the real rendered transition and checks
that the cockpit drill view is active and plumes are hidden. This is a
50 ms long-task check, not a frame-time or speedup claim. The host was busy;
the first successful run reported a peak load of 43.1 on 10 cores.

Probe evidence is under `probe-shots/mining-drill/`; the worker inspects the
cockpit capture. The drill readout is placed on a dark plate on the glass,
above the dash. The principal's visual and sound approval remains their gate.

The final affected hardware runs passed: `mining-drill` 9/9,
`mining-survey` 24/24, `field-flight` 4/4 and `fire-groups` 14/14.
The drill rerun reported peak load 12.5 on 10 cores.

Only affected browser probes run in this worker, as required by its operating
contract. The supervisor owns the final reviewed browser gate. No full browser
suite or principal approval is claimed. The feature stays behind the mining
flag; a public changelog entry belongs with its release.

## Review round 1 finish pass

Longwall installation now takes an explicit `posableStruts` option. Both
browser-loading paths pass the mining flag, while measurement tests request
posable joints directly. No mutable strut-mode flag remains. The cockpit eye
lives in `cockpit-eye.ts`, imported by the game and both occlusion tests.
The five measured visibility rows are unchanged.

`strutPose` delegates to the rig's target-aware `anchorAssembly`; the unused
`cutterPosition` export is removed. Both ship-frame conversions use `cross`.
The drill returns before inspecting rocks while stowed and idle. Fine control
and the feed share candidates at the same game time and ship position; moving
the ship invalidates that cache even with the clock held. Extraction and sparks
have separate methods. Extraction and the glass read one `reserveLeftT` helper.

The fractional-readout finding is declined: `rockContents` rounds both seeded
reserves, and `debitAt` recovers whole tonnes. Their difference is already a
whole-tonne count. No formatting guard or artificial fractional fixture remains.
The probe no longer deletes an unused cache key. Capacity 128 stays because
node #1150 explicitly requests it if this slice lands before the laser-beam
port; the drill itself emits no beam strokes.

Finish-pass checks include the affected domain, runtime, model and cockpit
tests, plus 57 probe registry, selection and key-label tests. Typecheck,
build, formatting, script lint and the comments check pass.
The hardware drill probe passes 9/9: the hold gains 5 t and the deposit loses
5 t, and its flagless control passes. Five real cockpit transitions produce
no long tasks on ANGLE Metal, Apple M1 Pro, at 1280 × 800. This is a 50 ms
long-task assertion with a static table, not a cold-cache benchmark or a
speedup measurement. The run reports peak load 22.4 on 10 cores. Both cutting
and cockpit captures were inspected.

The selector requests all 119 probes because this branch changes boot wiring
and shared code. Per the worker SOP, this pass runs affected probes only; the
supervisor owns the complete final browser gate.

The affected model-queue hardware probe passes 32/32, including the flagless
miner's delayed Longwall install, flight and vent behavior. The field-flight
hardware probe passes 4/4 collision and rock-frame checks. These three affected
probe runs are partial coverage.

The finish pass ran the required full host `npm test` once: **7,353 passed,
0 failed**, across 449 files. The run completed in 920.47 s.

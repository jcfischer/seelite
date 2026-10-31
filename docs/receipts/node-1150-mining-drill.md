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
  `BEAM_CAPACITY`, because this drill slice precedes the separate laser-beam
  port. A headless capacity check covers all 128 strokes.
- The comments baseline decreases by one for the removed local beam-capacity
  comment. Probe catalogue and roots register `probe-mining-drill.mjs`.

## Verification

The domain and cockpit tests were ported before their implementation. Their
first run failed on the missing drill modules. Production-model tests then
exposed the mounts' different hierarchy and the struts visible from the eye.
The view tests now measure the shipped asset with posable struts and check
both the cockpit eye and an eye above the mounts, including the drill head.

`WRITE_COCKPIT_OCCLUSION=1 bun test tests/cockpit-occlusion-table.test.ts`
regenerates the five rows. The drift test compares every measured row and the
eye parsed from `main.ts`; a blank or single-pose table cannot match it.
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
clock held. Before each transition the fixture clears the legacy
occlusion cache, so a warmed runtime raycast cannot hide its first-frame cost.
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

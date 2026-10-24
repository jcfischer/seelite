# Node #1042: probe-occlusion's approach ladder starts from a shut gate

**The fix is in the probe's setup. The gate is right.**

## Cause

`OCCLUSION.gate` opens after `openFrames` (2) and closes after `closeFrames`
(30), and between `closeRad` and `openRad` an open gate is held open by the
pose it stands at. The flank pose that runs just before the ladder reads
0.36–0.43 rad of enclosure, inside that band. A gate an earlier section left
open stays open there, and the ladder then gave the 20 and 12 radii rungs
`settleFrames`' three frames each against a close that needs thirty. Whether
the gate closed at 8 or 5 radii and then reopened at 3 depended on how many
frames the host drew, which is the pair of reds node #1042 was filed for:
`20:open 12:open 8:shut 5:shut 3:open ...`.

Enclosure at 20 and 12 radii (0.07–0.17 rad) is under `closeRad`, so "open"
there was state left over, not a reading.

## Evidence

- Three runs of `npm run probe:one probe-occlusion` before the fix, with the
  gate read before the first rung: shut and green each time, so the unforced run does not show the cause by itself; it needs the
  gate open on arrival.
- The same probe with the gate forced open before the ladder (camera at 1.5
  radii for ten frames, then the ladder as it was): the two reported checks
  fail with `20:open 12:shut 8:shut 5:shut 3:open 2:open 1.5:open`, 21 of 23.
- The same forcing with the fix: the wait draws 30 frames, the gate is shut at
  20 radii and the ladder reads `shut shut shut shut open open open`, 23 of 23.
- With the fix and no forcing, 5 runs alone: 5 of 5 pass, the gate shut on
  arrival every time.

## Change

`waitForGateShut` (`scripts/lib/fixture-reset.mjs`, headless-tested in
`tests/fixture-reset.test.ts`) places nothing and reads the gate: it draws
frames in batches until the gate is shut and throws if it is still open after
300, naming the enclosure, because that means the pose is holding it open.
`probe-occlusion.mjs` places the first rung, calls it, prints how many frames
it took, then flies the ladder. No threshold or frame count in
`src/occlusion.ts` moved.

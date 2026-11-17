# Longwall cockpit far arms — node #1301

The cockpit measurement flattened each part's vertices and tested roughly twelve
of them by buffer index. This missed clear sightlines to the far arm's elbow and
lower section, so the generated table hid entire parts. Before the correction,
the new two-seat regression failed on `anchor-0-elbow`; the pilot-seat screenshot
showed the right arm appear when culling was disabled.

`cockpitOcclusion` now tests every unique vertex until one has a clear hull ray.
A binary index over the hull triangles keeps these exhaustive vertex checks
within the existing table-test timeout. It preserves double-sided blocking,
finite target distances and the glazing/display exceptions, without changing
shared material sides. No model, eye, cockpit renderer or hand-authored visibility
list was changed. The shipped table was regenerated with its existing writer.

## Evidence

- The five affected headless files pass. The table
  agreement test checks all fifteen eye/extension rows and took 14.4 seconds in
  the full host run, inside its existing 300-second timeout. The indexed-ray test compares
  indexed and non-indexed, rotated meshes against Three.js double-sided
  raycasting, including origins inside the hull, flat panels and finite ray
  endpoints. A second independent comparison checks visible-vertex witnesses
  and boundary samples on the authored Longwall for all fifteen measured rows.
  Hidden parts receive three independent boundary samples. The courier fallback
  row also gains the second below-hull elbow at extension 0. Poses 0 through
  0.75 and the courier eye have geometric evidence; the live pixel check covers
  both bridge seats at extension 1.
- The below-hull arm bodies remain blocked from both bridge eyes at all five extensions;
  the existing enclosed-eye and above-mount controls still pass. All fifteen
  generated rows retain every previously visible part.
- Hardware browser: ANGLE Metal, Apple M5 Pro. `probe-miner-cockpit` passes
  24/24 checks; `probe-mining-drill` passes 11/11, including five cockpit switches
  without a long task. These are the affected contracts, not a full browser run.
- The live regression boots seed 2 with the miner hull, no save and raiders off,
  deploys the drill through its fire group, and checks both seats. It requires
  both arms' body, sleeve, elbow and lower section in the table and visible set.
  Hiding each arm's combined elbow/lower geometry removes pixels in its projected box;
  a restored frame rejects unstable pixels, and an unculled control checks for
  disappearing arm pixels.

| Seat | Anchor 0 changed pixels | Anchor 1 changed pixels | Unstable / missing pixels |
| --- | ---: | ---: | ---: |
| Pilot | 8,801 | 7,440 | 0 / 0 |
| Miner | 6,799 | 9,476 | 0 / 0 |

Captures and logs are outside the repository at `/tmp/seelite-node1301/`:
`before/pilot.png`, `before/pilot-unculled.png`, `before/miner.png`,
`after/far-arm-pilot.png`, `after/far-arm-miner.png`, `regression-before.log`,
`focused-final.log`, `oracle-tests-final.log`, `miner-cockpit-probe-final.log`
and `mining-drill-probe.log`. The complete host run is `npm-test.log`.

The single full host `npm test` run passes: 8,331 tests across 508 files,
17,193,383 assertions, zero failures. Build, typecheck, formatting, script lint
and comment lint pass. The checked text-source digest remained unchanged during
the run: `a51bca2263329ae9183dea516e9e09717bc679fde51548409be74873bdbf2be5`.

Claude Sonnet 5.5 independently reviewed the diff and evidence, finding no code
defect in its follow-up. Its request for independent real-hull rays and flat-panel
cases was taken; the final host run includes both. Its proposed endpoint tolerance
was declined: there was no reproduced endpoint error on this host, and changing
that rule would change physical blocking. Linux CI was not run by this worker.

The principal's visual acceptance and `cp-seelite-cockpit-far-arm` remain the
supervisor's close gate. This worker does not close the graph node.

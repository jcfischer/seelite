# Node #1142: Coriolis scale detail and lighting

## Current result

Trade-A carries the station-scale study's window rows, panel greebles, spine
lattice, lit girders, face masts, dishes, edge-girder masts and slot beacons.
The source is `spikes/coriolis/build_model.py`, ported from the study at
`6b546792`. Eight `scale-detail-*` material batches carry `minDetail: full` in
the exported nodes. Production collects those nodes as accessories, so
`setStationDetail` hides all eight at reduced and outline.

The [principal's ruling](https://github.com/jcfischer/seelite/issues/1142#issuecomment-6526047964)
sets warm authored paint at ×2.3, directional key gain 2, hemisphere gain 0.6,
and navigation-beacon gain 8. Trade role colour no longer repaints this form.
The study's paint roughness floor of 0.82 remains. The shader patch applies to
non-emissive Coriolis exterior materials, including cloned paints; it leaves
the production bay, ship materials, cockpit and global rig unchanged.
Missing or duplicate shader markers throw instead of silently retaining a
stock shader. Red and green beacons exceed the bloom threshold in linear
emissive luminance, not just intensity.

F22 is accepted as is. There is no shade-side ambient lift, backdrop change
or rim shader term. The formerly inert `CORIOLIS_ENV_LIFT` is omitted;
environment intensity remains 1. The existing strobes, lamp pools, nameplates
and navigation fittings remain production fixtures.

The principal's acceptance of frame cost, asset size, canonical views and the
proposed changelog sentence remains pending. Review and the final PR browser
gate belong to the supervisor. This receipt does not close the node.

## Asset and geometry

| Flight GLB | Main | This branch |
| --- | ---: | ---: |
| Bytes | 6,702,852 | 16,415,344 |
| Triangles | 139,948 | 478,286 |
| Mesh primitives | 14 | 22 |
| Added triangles visible below full | 0 | 0 |

The baseline geometry remains 139,948 triangles. The separate detail adds
338,338 triangles and eight draws at full. These are asset figures; the
whole-frame renderer counts below include shadows, interiors and other bodies.
Reduced and outline retain the baseline geometry and draw count; no claim of
identical elapsed frame cost at those levels is made.

Shipping asset SHA-256:
`214fc26dd140fe55c954d21021ab3913a88db087ff8cc4683d9a47bb8d77e846`.
The preparation script verifies exact decoded vertex attributes and texture
pixels after lossless Meshopt and WebP encoding. The asset remains below the
repository's 25 MiB deployment guard. The authored texture is unchanged.

Rebuild commands, from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python spikes/coriolis/build_model.py -- --flight
node spikes/coriolis/prepare-flight-asset.mjs
```

Blender 5.2.2 required host GPU access: the sandboxed executable crashed in
Metal device detection before Python ran. The successful export used this
host directly. No VM or container was used.

The collision proxy is unchanged. Production-loader tests check every vertex
against the existing proxy tolerance for three berth seeds, display reach,
the open aperture, retained fittings, detail visibility and shared-resource
teardown. `coriolis-spike.test.ts` continues to check the historical display
export; `coriolis-flight.test.ts` reads the rebuilt shipping GLB.

## Frame-time receipt

[Raw blocks and provenance](../../spikes/station-scale/evidence/cost.json)
were recorded on 2026-10-30, 15:46–15:47 UTC. Main is
`8aa96c1f6016b79660480e1a38af04de6a1788a3`, in a detached worktree. The
branch was measured before its commit; the raw record pins its shipping asset
and `src/coriolis-flight.ts` hashes. The latter is
`285e2a5392e6d10923c972b238f0843b3946d419c206cbad50292a2d4faf77fd`.
Baseline capture files were the only changes in the main worktree.

Both arms used ANGLE Metal on Apple M1 Pro, 1440×900, device scale 1,
quality High, 100% resolution and zero MSAA. The fixture is seed 42, system 4,
trade-A, full detail. Approach is the canonical station-axis framing at three
silhouette radii, 1.86 km from the centre. Close chase is 0.6 km outside the
aperture plane, 1.028 km from the centre. Both placements read back zero
off-axis error and agree on range within 0.00001 km.

The instrument held the machine-wide probe lock. No suite or Sage review was
launched by this worker beside it. Initial load averages were 7.25, 13.18 and
69.13 on 10 logical CPUs; this was not an idle host. Both page loops were
cancelled after settled boot. Each block times 120 synchronous complete
`render(0)` calls and one final pixel readback to drain queued work. There are
12 blocks per arm per framing, interleaved in shuffled pairs with seed 1142.
Warm frames are excluded. Browser and WebGL errors fail the instrument; the
record contains zero errors and confirms all eight detail meshes were visible.

| Framing | Main median, range (ms/frame) | Branch median, range (ms/frame) | Median delta | Branch slower pairs |
| --- | --- | --- | ---: | ---: |
| Station approach | 2.975, 2.889–3.432 | 3.159, 3.111–3.563 | +0.183 | 123/144 |
| Close chase | 6.602, 6.061–7.078 | 6.996, 6.285–9.071 | +0.394 | 119/144 |

Submitted whole-frame counts were 663 → 671 calls and 3,723,338 → 4,061,676
triangles on approach; chase was 1,596 → 1,620 calls and
9,651,228 → 10,666,242 triangles. These confirm the added geometry was drawn.
This is render throughput under saturation through Vite, excluding simulation,
download and cold installation. It is not player frame latency or an FPS
promise. The CPU/GPU limiter is not isolated, and the ranges overlap, so the
performance verdict remains inconclusive pending the principal's budget ruling.

Reproduce with a detached main worktree available as the first argument:

```sh
SEELITE_PROBE_RENDERER=hardware node spikes/station-scale/measure.mjs /path/to/main
```

## Visual and delivery evidence

The [study comparison sheet](../../spikes/station-scale/evidence/study-before-after.png)
puts main on the left and this branch on the right, close above wide. Both
arms ran the node's specified `capture.mjs` command on the hardware lane.
Their JSON reports retain measured ranges and the renderer identity.

The canonical fixture now draws a Wheel at seed 47. Three additional canonical
rows pin a real Coriolis at seed 42, system 4: `coriolis-approach`,
`coriolis-flank` and `coriolis-range`. Their framings match the existing axis,
flank and range rows. The original rows remain as controls, alongside
`hull-chase` and `cockpit-backlit`. Headless tests pin the fixture's form and
all three declarations.

The capture command accepts `--boot-timeout-ms`; its default remains 20,000.
A hardware diagnostic measured a valid full-model boot at 21,381 ms, explaining
the baseline capture timeout. Both arms use 120,000 ms for these captures;
the existing handle, first-frame and completed-sky predicate still decides
readiness. Invalid deadlines are rejected before a browser opens.

The [canonical sheet](../../spikes/station-scale/evidence/views/index.html)
contains eight before/after pairs. Capture it with the matching tree's dev
server, the three Coriolis declarations copied to the main arm, and the same
capture-timeout option on both arms:

```sh
npm run views -- --only station-approach,station-flank,station-range,coriolis-approach,coriolis-flank,coriolis-range,hull-chase,cockpit-backlit --boot-timeout-ms 120000 --label before --out spikes/station-scale/evidence/views
```

Use `--label after` on this branch. Both manifests record the served tree,
dirty ref, renderer, shot fixtures and actual clock at each frame. Frames were
opened at full size. No principal approval is inferred from their presence.

Path diagnostics on the runtime and harness changes select all 118 probes
because the canonical view manifest is shared harness infrastructure.
Git-based selection on implementation commit `f5847b4516796eec0b4b95304d07e535cfe8bf46`
also selects all 118, reporting: “At least one changed path has no dependency
owner; impact is unknown.” Under the worker contract, the supervisor runs that
final reviewed-head gate. The two manually filtered local probes do not satisfy
that gate.

Worker checks before the full host suite:

- Coriolis flight, historical spike, view declarations and capture framing tests
  pass, including a red-before-green invalid-deadline regression.
- Typecheck, format, lint, comments, launcher wiring and production build pass.
  The comment baseline shrinks by two in `src/coriolis-flight.ts`.
- Hardware `probe-light-rig` passes 12/12. `hull-chase` painted peak is 238.21,
  inside 131.016–255; lower quartile is 34.48 ≥ 29.392 and median 51.70 ≥ 44.608.
  The subject is the calibrated authored courier, model hash `6967208f3169`.
  [Probe log](../../spikes/station-scale/evidence/light-rig.log).
- Hardware `probe-station-visuals` passes 92/92. Its Ring and Wheel fixtures
  retain their lighting and full → reduced → outline transitions. The Coriolis
  itself is checked by the loader-backed tests and the captured live frames.
  [Probe log](../../spikes/station-scale/evidence/station-visuals.log).
- Four [deliberate defects](../../spikes/station-scale/evidence/mutations.json)
  each fail the new assertions: paint lift disabled, key gain 1, beacon gain 1,
  and scale detail excluded from the accessory collection. The original source
  is restored byte for byte after each experiment.
- The proposed public changelog sentence is in `src/changelog.ts`, awaiting the
  principal's approval and the actual merge date.

The one full host `npm test` run before commit passes: **7,258 tests across
437 files, zero failures** (1,061.62 seconds). No VM or container was used.

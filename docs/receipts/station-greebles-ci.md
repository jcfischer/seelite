# Parallel CI station-greeble investigation

Refs #1206. The cause is not yet established and this diagnostic change is not
a correction to station geometry or CI isolation.

## Existing failures

The initial shard-3 CI runs for isolated field study PR #1203 (`d031d6a1`) and
outage PR #1205 (`5786c618`) failed the same mounting and outline assertions.
Their unchanged-head retries passed. Both failure logs name exactly 32 distinct
floating instance IDs at the first tested form: stock trade a (10 crates, 7
tanks and 15 fins). The assertion stops that loop, so the logs do not establish
that other forms would pass.

Failure evidence: `/tmp/seelite-pr1203-ci-failed.log` (run 42319438727, job
128240148239) and `/tmp/seelite-pr1205-final-shard3.log` (run 42328103867,
failed job 128268135891, passing retry job 128275827406). Main `a107a16` and
the field-study head have identical test, source and CI-workflow trees.

## Matching local experiment

Installed Bun 1.4.2 into an isolated npm cache under `/tmp/greeble1206-npm`;
the global Bun 1.4.4 installation is unchanged. At clean main `a107a16`, ran:

```sh
bun test tests/ --shard=3/4 --timeout=60000 --parallel=3 --no-isolate --timings=tests/timings.json
```

The pinned local run passes 2,531 tests and 6,721,210 assertions across 149
files in 142.21 seconds, including both target assertions. Log:
`/tmp/greeble1206-pinned-shard3.log`. That first command omitted CI's
`--update-timings` flag. A second run at diagnostic head `d13dc1bf` included
that flag as well and passed the same 2,531 tests and 6,721,210 assertions in
141.51 seconds. Its original committed timing input was restored byte-for-byte
afterward. Log: `/tmp/greeble1206-pinned-actual-flags.log`. Both runs report
Bun build `744846f84`, matching the failed CI log. The second run matches CI's
flags and timing input, but runs on Darwin arm64 rather than Linux x64.
There is no available local Linux container runtime. The green run establishes
neither a platform cause nor a global-state leak.

Separately, seven related station/ship suites ran in one reused worker with
`--parallel=1 --no-isolate --timings=tests/timings.json --timeout=60000`:
station-mesh, station-finish, ship-finish, ship-mesh, ship-muzzles, station-glow
and station-greebles. All 179 tests and 188,818 assertions pass in 23.62 seconds
(`/tmp/greeble1206-one-worker-fixtures.log`). Combining these fixtures' registry
history does not reproduce the defect locally; this is not a proof that all
state leaks are absent.

## Failure-only observation

The existing assertions and loops are unchanged. Once their failure condition
is already known, a diagnostic reads current transforms, geometry samples,
nonfinite component counts, material sides and the full current Mesh prototype
raycast function text, together with runtime/platform/CPU/finish information.
Cached bounds, normal samples and draw ranges are read without recomputing them.
Each mesh reports whether its raycast matches that prototype. The first three
missed instances also retain the actual verification ray vectors, instance
transform, dimensions, range and hit count, including the initial origin and
nudge axis needed to reconstruct the casts. It keeps the first twelve encountered
meshes and all subsequent greeble meshes. Diagnostic exceptions are caught so
the original assertion still reports the failure.

The instrumented existing suite passes 13 tests and 266 assertions with pinned
Bun, and typecheck passes. Logs: `/tmp/greeble1206-diagnostic-local.log` and
`/tmp/greeble1206-diagnostic-tsc.log`. After expanding the ray capture, the same
suite and typecheck pass again in `/tmp/greeble1206-response-{local,tsc}.log`.

A deliberately zero-length verification ray exercises the red logging path.
This is synthetic, not a reproduction of the CI defect: the healthy fixture
reports 32 floating IDs, fifteen mesh records and zero nonfinite geometry
components; the original mounting assertion still fails with exit 1. The
diagnostic itself reports no exception. Log:
`/tmp/greeble1206-diagnostic-forced-red.log`. The temporary mutation was
restored before committing.
The expanded logging path is exercised separately in
`/tmp/greeble1206-response-forced-red.log`: three complete missed-ray snapshots,
full prototype source and cached bounds are present; the diagnostic reports no
exception and the original assertion still exits 1. This is also synthetic.

Sage round 1 returned one suggestion and no blocker: a function prefix did not
justify describing the raycast implementation, and the actual missed rays were
absent. The response records the full current prototype source and missed-ray
inputs above; neither those records nor a matching source string clear the
entire ray path. Review stops under the suggestion-only rule.

## Remaining evidence

The first instrumented Linux PR CI run at `d13dc1bf` passes its four unit
shards, including the two target assertions. Run: 42334550996; shard-3 job:
128288427956. This supplies no failing state to interpret. The response head's
normal CI at `7e55ca87` subsequently reproduces both original failures. Its
assembled core has finite positions and 108 nonfinite normal components;
greeble instance transforms and missed-ray inputs are nonfinite. The material
side and object world transforms are ordinary. Raw evidence:
`/tmp/seelite-pr1207-final-shard3.log`, with complete parsed snapshots at
`/tmp/seelite-greeble-diagnostic-{mount,outline}.json`. This locates invalid data
upstream of the verification rays, but does not establish its origin.
A green run alone is not a cure. Runtime source,
configuration, browser probes, test tolerances and assertions remain unchanged. This diff is confined
to a headless test and prose, so no browser run is required by CLAUDE.md.

## Construction-stage experiment

Test-only checkpoints wrap the existing `computeVertexNormals` and
`normalizeNormals` methods and restore both after the file. They report only
invalid Polyhedron normal arrays, before and after each stage. Numeric values
are encoded as strings so NaN and infinities remain distinguishable. Counts,
item size, normalization flag and array type accompany the values. Reports
are bounded and diagnostic exceptions retain the original failure path.

A separate bounded case constructs 2,048 raw polyhedra using the actual
production core's `parameters`, without copying its geometry literals. The
pinned local target suite passes 14 tests and 2,314 assertions in 4.03 seconds;
typecheck and the standard static/build gates pass. Logs use
`/tmp/greeble1206-cause-{local,tsc,format,lint,comments,wiring,build}.log`.
No production source, normal calculation, tolerance or CI setting changes.
The next Linux observation will distinguish computation/normalization from
later assembly; wrapping methods can change optimization, so another green
result alone would not exonerate those stages.

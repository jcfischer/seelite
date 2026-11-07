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
`/tmp/greeble1206-pinned-shard3.log`. This matches CI's Bun version, flags
and committed timing file, but runs on Darwin arm64 rather than Linux x64.
There is no available local Linux container runtime. The green run establishes
neither a platform cause nor a global-state leak.

## Failure-only observation

The existing assertions and loops are unchanged. Once their failure condition
is already known, a diagnostic reads current transforms, geometry samples,
nonfinite component counts, material sides and raycast function text, together
with runtime/platform/finish information. It keeps the first twelve encountered
meshes and all subsequent greeble meshes. Diagnostic exceptions are caught so
the original assertion still reports the failure.

The instrumented existing suite passes 13 tests and 266 assertions with pinned
Bun, and typecheck passes. Logs: `/tmp/greeble1206-diagnostic-local.log` and
`/tmp/greeble1206-diagnostic-tsc.log`.

A deliberately zero-length verification ray exercises the red logging path.
This is synthetic, not a reproduction of the CI defect: the healthy fixture
reports 32 floating IDs, fifteen mesh records and zero nonfinite geometry
components; the original mounting assertion still fails with exit 1. The
diagnostic itself reports no exception. Log:
`/tmp/greeble1206-diagnostic-forced-red.log`. The temporary mutation was
restored before committing.

## Remaining evidence

The next normal Linux PR CI run will carry these diagnostics if the failure
recurs. A green run alone is not a cure. Runtime source, configuration, browser
probes, test tolerances and assertions remain unchanged. This diff is confined
to a headless test and prose, so no browser run is required by CLAUDE.md.

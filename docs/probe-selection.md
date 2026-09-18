# Selecting browser probes for a pull request

The browser tier is intentionally sequential, so a full run is expensive. The
PR selector reduces local feedback time without changing what `npm run probe`
means: the unfiltered command still runs every gate, and `npm run probe:one`
still takes one explicit substring.

## Decision tree

1. Shared runtime, build, or probe-harness files run every probe.
   CI workflow changes are global-risk because they can change how the tier is
   invoked.
2. Documentation and headless-test-only changes run no browser probe.
3. Directly edited probe scripts are always included. When the change is
   confined to named probe scripts, those probes run exactly.
4. Other production changes send the PR state and all probe contracts to
   TypeSafe as one batch of independent Noul questions.
5. Only a probability at or below `0.25` is a strong enough **no** to exclude a
   probe. An unavailable service, missing key, missing answer, or malformed
   answer falls back to all probes. A production change for which every probe
   is excluded also falls back to all rather than pretending an empty run is a
   verdict.

The selector is a development tool. It makes no runtime network request from the
game, and `TYPESAFE_API_KEY` is read only from the process environment and
removed before Vite, Chromium, or a probe child starts.

By default TypeSafe receives the PR title, body, and changed-file names. These
are normally already public PR metadata. It does **not** receive source diff
contents unless `--include-diff` is explicitly given; use that option only when
the diff is safe to send to an external service. The selector labels PR text as
untrusted evidence, but that prompt instruction is best-effort rather than a
security boundary. Filtered runs are refused in CI, and a merge receipt still
requires the repository's full browser tier.

The request uses TypeSafe's documented [`jev-latest`
alias](https://docs.typesafe.ai/models.md) and reports the exact resolved model
(for example `jev-1.13.0`) with every result. Re-run the evaluation cases after
a resolved-model change before adjusting the exclusion threshold.

The catalog parity test proves that every runnable browser gate has an entry; it
cannot prove that an entry still describes what the gate verifies. Whenever a
probe's behavior, assertions, or evidence header changes, review and update its
catalog `contract` and `evidence` fields in the same PR.

## Use it

Load the key into the shell, then inspect the plan without launching Chromium:

```sh
set -a
source ~/.env
set +a
npm run probe:select -- --base origin/main --head HEAD --title "PR title"
```

Run the selected probes through one shared dev server:

```sh
npm run probe:pr -- --base origin/main --head HEAD --title "PR title"
```

For an experiment or a not-yet-committed file list, repeat `--changed-file`:

```sh
npm run probe:select -- --changed-file src/cruise.ts \
  --title "Keep cruise clear of moving host planets" --json
```

To include source context after reviewing it for secrets, opt in explicitly:

```sh
npm run probe:select -- --base origin/main --head HEAD \
  --title "PR title" --include-diff
```

`--include-diff` applies to a base/head git range. It is ignored with explicit
`--changed-file` evidence, and the CLI warns when both are supplied.

`PROBE_FILES` is the selector's exact-name handoff to `probe-all.mjs`. It is
refused in CI, cannot be combined with `--only` or `PROBE_ONLY`, and every
partial-run banner names that it is partial. A merge receipt still needs the
repository's normal full browser-tier evidence.

The calibration cases and named expected probes are recorded in
[`probe-selection-evaluation.md`](./probe-selection-evaluation.md).

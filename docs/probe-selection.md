# Selecting browser probes for a pull request

The browser tier is intentionally sequential, so a full run is expensive. The
PR selector reduces local feedback time without changing what `npm run probe`
means: the unfiltered invocation still runs every gate, and `npm run probe:one`
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

TypeSafe is an external service. Every semantic selection sends changed-file
names. A PR title or body is sent only when explicitly supplied with `--title`
or `--body`; ambient `PR_TITLE` and `PR_BODY` variables are ignored. Source diff
contents are sent only when `--include-diff` is explicitly given. Review all of
that evidence for repository confidentiality before running the selector. The
selector places all PR input under a dedicated `state.untrusted_evidence`
object, and every question's direction references that boundary. Model
instructions remain best-effort rather than a security boundary. Filtered runs
are refused when `CI` is set. A selected run is partial evidence and does not
replace a full browser-tier receipt.

The request names `jev-latest` and reports the exact model that the response
resolved (for example `jev-1.13.0`). Re-run the evaluation cases after a
resolved-model change before adjusting the exclusion threshold.

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

The selector itself runs `check:wiring` immediately before any browser launch;
this cannot be bypassed by invoking `probe:select -- --run` or the Node entrypoint
directly.

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
partial-run banner names that it is partial. Treat that result as local feedback,
not as a full browser-tier receipt.

The calibration cases and named expected probes are recorded in
[`probe-selection-evaluation.md`](./probe-selection-evaluation.md).

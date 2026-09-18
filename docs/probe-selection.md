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
game. When the selector launches probes, `TYPESAFE_API_KEY` is read only from
its process environment and removed before Vite, Chromium, or a probe child
starts. A separately invoked `npm run probe` does not perform that scrubbing.

TypeSafe is an external service. A semantic selection sends changed-file names
and, only when supplied, one reviewer-authored `--intent` sentence. It never
sends the PR title, body, or source diff. The selector places filenames under
`state.untrusted_evidence` and keeps `state.reviewer_intent` separate. Filenames
can still be attacker-controlled, so model instructions remain best-effort
rather than a security boundary. Write the intent yourself after reading the
change; do not paste contributor-controlled prose into it. The runner refuses
its internal `PROBE_FILES` subset handoff when `CI` is set. A selected run is
partial evidence and does not replace a full browser-tier receipt.

The request names `jev-latest` and reports the exact model that the response
resolved (for example `jev-1.13.0`). Re-run the evaluation cases after a
resolved-model change before adjusting the exclusion threshold.

The catalog parity test proves that the catalog matches the sequential runner's
discovered inventory. It cannot discover a measurement script that should have
been promoted into that inventory, or prove that an entry still describes what
its gate verifies. Whenever a probe's behavior, assertions, or evidence header
changes, review and update its catalog `contract` and `evidence` fields in the
same PR.

## Use it

Load the key into the shell, then inspect the plan without launching Chromium:

```sh
set -a
source ~/.env
set +a
npm run probe:select -- --base origin/main --head HEAD \
  --intent "Describe the intended behavior change in one sentence"
```

Run the selected probes through one shared dev server:

```sh
npm run probe:pr -- --base origin/main --head HEAD \
  --intent "Describe the intended behavior change in one sentence"
```

The selector launches the canonical `npm run probe` sequence, which owns
`check:wiring` and the browser runner. Invoking `probe:select -- --run` or the
Node entrypoint directly therefore uses the same preflight as a full run.

For an experiment or a not-yet-committed file list, repeat `--changed-file`:

```sh
npm run probe:select -- --changed-file src/cruise.ts \
  --intent "Keep cruise clear of moving host planets" --json
```

`PROBE_FILES` is the selector's exact-name handoff to `probe-all.mjs`. It is
refused in CI, cannot be combined with `--only` or `PROBE_ONLY`, and every
partial-run banner names that it is partial. Treat that result as local feedback,
not as a full browser-tier receipt.

The calibration cases and named expected probes are recorded in
[`probe-selection-evaluation.md`](./probe-selection-evaluation.md) and can be
rerun with `npm run probe:evaluate` after loading the API key. To retain a
machine-readable receipt with every probability, add
`--receipt docs/probe-selection-evaluation.jsonl`.

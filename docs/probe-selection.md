# Selecting browser probes for a pull request

The browser tier is intentionally sequential, so a full run is expensive. The
PR selector reduces local feedback time without changing what `npm run probe`
means: the unfiltered command still runs every gate, and `npm run probe:one`
still takes one explicit substring.

## Decision tree

1. Shared runtime, build, or probe-harness files run every probe.
2. Documentation and headless-test-only changes run no browser probe.
3. Changes confined to named probe scripts run those probes exactly.
4. Other production changes send the PR state and all probe contracts to
   TypeSafe as one batch of independent Noul questions.
5. Only a probability at or below `0.25` is a strong enough **no** to exclude a
   probe. An unavailable service, missing key, missing answer, or malformed
   answer falls back to all probes. A production change for which every probe
   is excluded also falls back to all rather than pretending an empty run is a
   verdict.

The selector is a development tool. It makes no runtime network request from the
game, and `TYPESAFE_API_KEY` is read only from the process environment.

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

`PROBE_FILES` is the selector's exact-name handoff to `probe-all.mjs`. It is
refused in CI, cannot be combined with `--only` or `PROBE_ONLY`, and every
partial-run banner names that it is partial. A merge receipt still needs the
repository's normal full browser-tier evidence.

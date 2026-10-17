# Output-stage baseline failure found during nebula verification

2026-10-14, Apple M1 Pro, ANGLE Metal, headed hardware Chromium.
Follow-up: [Restore the multisample coverage contract](https://github.com/jcfischer/seelite/issues/975).

The output-stage assertion is unchanged. It compares the fraction of pixels
disagreeing about being lit between 4 samples and 0 samples, against a 1% limit.
It failed both before and after nebula integration, in separate serial runs:

| Revision | Disagreement | Other assertions | Duration |
| --- | --- | --- | --- |
| `82acce706753624d74dd08110228b773bfe5939e` (pre-nebula main checkout) | 1.21% | 13/14 pass | 13.7 s |
| `5b65358bf2c3d41fa517ca4aa0db0271499147b1` plus readiness-wait fix | 1.22% | 13/14 pass | 14.2 s |

Commands, each run alone in the named checkout:

```sh
npm run probe:one -- probe-output-stage.mjs --log /tmp/seelite-685-output-baseline.log
npm run probe:one -- probe-output-stage.mjs --show-output --log /tmp/seelite-685-output-rerun.log
```

Baseline output:

```text
FAIL and it changes the edges without changing what is drawn — 1.21% of pixels disagree about being lit between 4 samples and 0 (80.57% lit against 80.50%)
13/14 checks passed
FAIL probe-output-stage.mjs (13.7s) exit=1 assert · peak load 63.2
```

Branch output:

```text
FAIL and it changes the edges without changing what is drawn — 1.22% of pixels disagree about being lit between 4 samples and 0 (80.52% lit against 80.44%)
13/14 checks passed
FAIL probe-output-stage.mjs (14.2s) exit=1 assert · peak load 84.1
```

The branch's earlier full-run result was 1.21% at peak load 9.8, so the
assertion failure is not attributed to host overload. The isolated baseline
checkout contains only unrelated untracked files. At verification time,
`origin/main` was `e80e8657091d6e3410bf8dea99ada358a6e5a079`.
`git diff --stat 82acce70 e80e8657` lists only four files under
`spikes/asteroid-gallery-952/` and `spikes/asteroid-lod-950/field-render.ts`.
Runtime, dependencies, assets and probe sources are identical between those
two baseline revisions; the exact `e80e8657` checkout was not separately run.

This evidence establishes an existing red, not the absence of every possible
nebula-induced rendering defect. The quarantine keeps this probe running and
reporting its full result, but excludes it from the passing gate count. Neither
the assertion nor its threshold was relaxed. The follow-up owes a diagnosis
and bisect before any recalibration. Nebula-specific texture and reflection
checks and the existing light-rig contract remain gating.

The planet pre-warm and opening probes passed on the same pre-nebula baseline.
Their branch failures were repaired here rather than quarantined.

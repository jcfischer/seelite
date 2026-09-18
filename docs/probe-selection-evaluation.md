# Probe-selection calibration

The reproducible corpus in `scripts/evaluate-probe-selection.mjs` spans flight,
input/UI, rendering, and persistence and holds each expected-contract list. The
`0.25` exclusion threshold lives in the selector. The **expected contracts**
column is checked by name, not inferred from the selected count. A case fails
the safety check if any named probe is absent; extra probes are conservative
cost, not a false negative.

Run date: 2026-09-19. Selector/catalog head:
`b72cf24911e1b86cc7c8c2226e1655c7124c317b`. Requested model: `jev-latest`.
Resolved model: `jev-1.13.0`. Exclusion rule: `p <= 0.25`. Each request asked
all 53 independent Noul questions in one batch, used a reviewer-authored intent
sentence, and sent no PR title, body, or source diff.

| Case | Expected contracts | Observed selection | Latency | Result |
| --- | --- | ---: | ---: | --- |
| Moving-body cruise route | `measure-cruise-detour`, `probe-approach-handoff`, `probe-arrival`, `probe-cruise-detour`, `probe-cruise`, `probe-handoff`, `probe-moving-guard` | 25/53 | 1,068 ms | 7/7 present |
| Controls tab and gamepad folding | `probe-controls-reference`, `probe-key-dispatch`, `probe-pad-panels` | 7/53 | 1,053 ms | 3/3 present |
| Final output-stage dithering | `probe-output-stage`, `probe-frame-attribution`, `probe-planet-surfaces`, `probe-planets`, `probe-station-visuals`, `probe-traffic-mouth` | 24/53 | 1,070 ms | 6/6 present |
| Carrier-knowledge save migration | `probe-save`, `probe-carrier-scan`, `probe-commander`, `probe-death`, `probe-relay` | 28/53 | 1,052 ms | 5/5 present |

Across the four cases, all 21 named expectations were present. This is a small
calibration corpus, not a general accuracy claim. Keep the raw probabilities
visible, expand these cases with real PR outcomes, and raise coverage rather
than lowering it when a false negative appears.

The attached [`probe-selection-evaluation.jsonl`](./probe-selection-evaluation.jsonl)
is the machine-readable receipt from this run, including every returned
probability, action, resolved model, usage count, and fallback status.

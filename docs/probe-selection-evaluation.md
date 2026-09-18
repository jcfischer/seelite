# Probe-selection calibration

These four cases were chosen to span flight, input/UI, rendering, and
persistence. The **expected contracts** column was checked by name, not inferred
from the selected count. A case fails the safety check if any named probe is
absent; extra probes are conservative cost, not a false negative.

Run date: 2026-09-18. Requested model: `jev-latest`. Resolved model:
`jev-1.13.0`. Exclusion rule: `p <= 0.25`. Each request asked all 53 independent
Noul questions in one batch and used no source diff.

| Case | Expected contracts | Observed selection | Latency | Result |
| --- | --- | ---: | ---: | --- |
| Moving-body cruise route | `measure-cruise-detour`, `probe-approach-handoff`, `probe-arrival`, `probe-cruise-detour`, `probe-cruise`, `probe-handoff`, `probe-moving-guard` | 25/53 | 1,077 ms | 7/7 present |
| Controls tab and pad folding | `probe-controls-reference`, `probe-key-dispatch`, `probe-pad-panels` | 8/53 | 890 ms | 3/3 present |
| Final output-stage dithering | `probe-output-stage`, `probe-frame-attribution`, `probe-planet-surfaces`, `probe-planets`, `probe-station-visuals`, `probe-traffic-mouth` | 21/53 | 648 ms | 6/6 present |
| Carrier-knowledge save migration | `probe-save`, `probe-carrier-scan`, `probe-commander`, `probe-death`, `probe-relay` | 20/53 | 496 ms | 5/5 present |

Across the four cases, all 21 named expectations were present. This is a small
calibration corpus, not a general accuracy claim. Keep the raw probabilities
visible, expand these cases with real PR outcomes, and raise coverage rather
than lowering it when a false negative appears.

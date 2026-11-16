# Node #1184: the probe suite defaults to four at a time

Machine: Mac Mini, Apple M5 Pro, 18 cores. Renderer: ANGLE Metal, the hardware
lane. All measurements are from 2026-11-05, on the head of PR #1182, which changes
no game code. Other ranger workers were running throughout, so these are busy-host
figures rather than a controlled comparison.

## What failed

Full runs at six since #1175 set that default:

| node | result | peak load | `bootedGame` timeouts in the log |
|---|---|---:|---:|
| #1129 | 118/118 | 20.3 | 0 |
| #1130 | failed | 31.4 | 180 |
| #1148 | failed | 31.2 | 184 |
| #1160 | failed | 51.2 | 197 |

The peak load is that of the last run in each log. #1175's own three green runs at
six peaked at 16.5, 21.2 and 27.4, so six is not always red. In #1160's first full
run the first timeouts came at a peak load of only 12.5, and the two loads do not
separate cleanly. This receipt does not establish why #1129 passed and #1160 did
not.

## Short runs on the PR head

Seconds per probe. The two probes shown only boot and measure, so they sit closest
to the deadline.

| at a time | gating | `probe-chase-view` | `probe-witchspace` | peak load |
|---:|---|---:|---:|---:|
| 6 | 5/6, `probe-hud` timed out | 19.9 | 22.1 | 17.1 |
| 6 | 6/6 | 17.8 | 18.7 | 26.1 |
| 6 | 6/6 | 16.6 | 18.0 | 27.2 |
| 6, orphans removed | 6/6 | 15.9 | 18.3 | 22.8 |
| 6, orphans removed | 6/6 | 16.1 | 16.7 | 18.1 |
| 4 (8 probes) | 8/8 | 14.5 | 15.0 | 22.3 |
| 4 (8 probes) | 8/8 | 16.8 | 16.3 | 22.9 |
| 3 | 6/6 | 15.0 | 16.1 | 17.1 |
| 1 | 6/6 | 12.4 | 12.6 | 16.8 |

One red in five runs at six is a thin sample. The figure that carries the decision
is the margin: six leaves the deadline little room, and a full run adds its own
load to a busy host.

"Orphans removed" means six `bun test` workers using about five cores and six idle
headless browsers had been killed. They had outlived their ranger workers. The two
runs before their removal were green too, so they did not decide the red.

## Cost

#1175's C4 measured 1252 s at four against 953 s at six, with median per-probe
slowdowns of ×1.13 and ×1.22.

## Not measured here

Whether four holds at the 38 to 51 peak loads of the failed runs. The full run at
four on this change is on the PR, because recording it here would move the head it
was run on.

No test pins the default. A test restating the number would fail only when someone
changes it on purpose; the `4 at a time` line of the full run is the evidence.

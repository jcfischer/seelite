# The seeded station proxies over 2,400 plans: the hand-run half of §9.1.11

Node #662, measured 2026-10-03; re-measured by node #663 on 2026-10-04, after
the pad proxies were cut down into their landing well (`padWellDepthKm`). `collision.md` §2.2 says the outpost's Salvage <!-- glossary-ignore: pad -->
is a grown form whose proxy is one seed-independent envelope, gated on the
twelve plans of `ASSEMBLY_SEEDS` in `npm test` and "measured over a wider
spread by hand". This file is that measurement, so the figure has a ref and an
output behind it rather than a sentence. It records data only.

## What was run

On commit `f0231ab` ("Print the aperture's physical-fit table for the
principal"), on an M1 Pro, headless bun, four runs one after another:

```bash
bun scripts/measure-station-proxy.ts 1200 0 refinery
bun scripts/measure-station-proxy.ts 1200 1200 refinery
bun scripts/measure-station-proxy.ts 1200 0 outpost
bun scripts/measure-station-proxy.ts 1200 1200 outpost
```

Each run builds every plan in its assembly-seed range with the berth on each
side (berth seeds 0 and 1) and holds every drawn vertex outside the opening to
the primitives of its own frame — the walk, the opening and the frame rule are
`tests/helpers/station-proxy-measure.ts`, the same ones the test rows use. A
refinery run took 3 min 24 s, an outpost run 1 min 57 s.

## Output, verbatim

```text
refinery d: assembly 0–1199, berth sides 0, 1, 0 plans past 60 m, worst 44.5 m (asteroid at assembly 0, berth 0)
refinery d: assembly 1200–2399, berth sides 0, 1, 0 plans past 60 m, worst 44.5 m (asteroid at assembly 1200, berth 0)
outpost e: assembly 0–1199, berth sides 0, 1, 0 plans past 60 m, worst 44.4 m (salvage-section-1 at assembly 353, berth 0)
outpost e: assembly 1200–2399, berth sides 0, 1, 0 plans past 60 m, worst 48.3 m (salvage-section-1 at assembly 2060, berth 0)
```

## What it does and does not say

- No plan in assembly seeds 0–2399, berth on either side, stands a vertex past
  the 60 m `PROXY_VERTEX_TOLERANCE_KM`. Worst: the Works 44.5 m, the Salvage
  48.3 m.
- Both moved since #662's run (44.1 m and 36.1 m) because node #663 shrank the
  primitives a cut cannot shorten — the Works' rock, the Salvage's debris and
  its flank ring — to stand on the landing well's floor. The margin to 60 m is
  11.7 m on the Salvage, down from 23.9 m.
- The Works' worst is its asteroid in both ranges. The script names the first
  plan that reached the worst figure, so "assembly 0" and "assembly 1200" are
  where the scan met it first, not where it is uniquely worst.
- A plan outside 0–2399 is not measured. A change to either form's geometry or
  to its proxy makes these figures stale; the script reprints them, and a
  re-run on the new commit replaces this file rather than appending a second
  copy.

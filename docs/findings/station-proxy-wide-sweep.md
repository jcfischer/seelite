# The seeded station proxies over 2,400 plans: the hand-run half of §9.1.11

Node #662, measured 2026-10-03. `collision.md` §2.2 says the outpost's Salvage
is a grown form whose proxy is one seed-independent envelope, gated on the
twelve plans of `ASSEMBLY_SEEDS` in `npm test` and "measured over a wider
spread by hand". This file is that measurement, so the figure has a ref and an
output behind it rather than a sentence. It records data only.

## What was run

On commit `ca85e82` ("Station proxy: say which rows sweep the berth sides, and
drop two unchecked figures"), on an M1 Pro, headless bun, four runs one after
another:

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
refinery run took 3 min 17 s.

## Output, verbatim

```text
refinery d: assembly 0–1199, berth sides 0, 1, 0 plans past 60 m, worst 44.1 m (asteroid at assembly 0, berth 0)
refinery d: assembly 1200–2399, berth sides 0, 1, 0 plans past 60 m, worst 44.1 m (asteroid at assembly 1200, berth 0)
outpost e: assembly 0–1199, berth sides 0, 1, 0 plans past 60 m, worst 36.1 m (salvage-section-2 at assembly 955, berth 0)
outpost e: assembly 1200–2399, berth sides 0, 1, 0 plans past 60 m, worst 28.9 m (salvage-section-1 at assembly 1486, berth 0)
```

## What it does and does not say

- No plan in assembly seeds 0–2399, berth on either side, stands a vertex past
  the 60 m `PROXY_VERTEX_TOLERANCE_KM`. Worst: the Works 44.1 m, the Salvage
  36.1 m.
- The Works' worst is its asteroid in both ranges. The script names the first
  plan that reached the worst figure, so "assembly 0" and "assembly 1200" are
  where the scan met it first, not where it is uniquely worst.
- The commit that adds this file, `Address sage review round 4`, changes no
  geometry, no proxy primitive and not the script's path through
  `vertexOvershootKm`, so the figures stand for it too.
- A plan outside 0–2399 is not measured. A change to either form's geometry or
  to its proxy makes these figures stale; the script reprints them, and a
  re-run on the new commit replaces this file rather than appending a second
  copy.

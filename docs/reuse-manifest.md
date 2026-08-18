# The seekolous reuse manifest

*Executed 2026-08-18, as the resolution of "Bootstrap seelite: execute the
seekolous reuse manifest" ([#2](https://github.com/jcfischer/seelite/issues/2)).*

Reuse from [seekolous](https://github.com/jcfischer/seekolous) is
**copy-in-and-diverge**, per the map's constraint: no shared package, no
dependency, no coupling back. This file is the record of what crossed, in what
condition, and — the half that is easy to lose — what did not and why.

It exists because "we vendored the harness from seekolous" is not a fact anyone
can act on. A later session asking "is our probe runner still the same as
theirs?" or "why don't we have a determinism clock?" needs the answer written
down, not re-derived by diffing two trees.

## Copied unchanged

Byte-identical to their seekolous originals. A fix upstream can be re-applied
here by hand; there is no sync and there will not be one.

| File | What it is |
| --- | --- |
| `src/noise.ts` | Seeded 2D simplex noise + fbm (one comment re-pointed) |
| `scripts/lib/fmt.mjs` | Undefined-safe number formatting for probe evidence |
| `scripts/lib/probe-args.mjs` | `--only` / `PROBE_ONLY` parsing and refusals |
| `scripts/lib/probe-pump.mjs` | Driving the page's own rAF loop from a probe |
| `tests/lib/source-scan.ts` | The shared comment stripper, line numbering intact |
| `tests/probe-args.test.ts` | Guards `probe-args.mjs`; its fixtures are synthetic |
| `tests/noise.test.ts` | Guards `noise.ts` (docstring re-pointed) |
| `tsconfig.json`, `biome.jsonc` | Toolchain config |

## Copied and adapted

| File | What changed, and why |
| --- | --- |
| `src/rng.ts` | Generator, avalanche step and derivation copied exactly. The `STREAMS` table is seelite's: `galaxy`, `system`, `market`, `traffic`, `combat`, `backdrop`. The offsets are new constants — a stream table is a per-project decision, and inheriting seekolous's would have named streams for systems that do not exist. |
| `src/audio.ts` | All machinery kept: context handshake, looping filtered-noise bed with its crossfade, on-change gain writes, mute path, `tone`/`noiseBurst`. The god-game cue list (`fireball`, `lightning`, `raise`, `lower`, `flatten`) was dropped for `laser`, `hit`, `explosion`, `dock`, `hyperspace`, `alert`, `ui`. The wind bed became the engine bed — same graph, different driver. |
| `scripts/probe-guard.mjs` | Two changes. The constant matcher now accepts `export const`: seelite's load-bearing numbers are the unit scheme in `src/units.ts` and every one of them is exported, so without it the guard reads that file as declaring nothing and refuses to run against a correct server. And `seedDemoVillage` became `bootedGame`, which waits for a published handle *and* a drawn frame. |
| `scripts/probe-all.mjs` | `REPORTERS` and `QUARANTINED` emptied — a quarantine inherited from another project is a debt nobody here incurred. Examples re-pointed. One defect fixed: the file filter picked up `probe-guard.mjs`, which is a library, spawned it as a probe, and counted its vacuous exit 0 as a **passing gate**. Seekolous's copy has the same hole. |
| `scripts/check-launcher-wiring.mjs` | `EXPECTED_CALLERS` 40 → 1. A weak floor, honestly weak: at this size it asserts little more than "the scan found `scripts/`". Raise it as probes land. |
| `tests/headless.test.ts` | The pattern kept exactly — set equality between the listed modules and the required ones, plus per-module load tests and leaf assertions. The module list is seelite's. |
| `tests/source-scan.test.ts` | Subjects re-pointed at `src/main.ts` and `scripts/probe-boot.mjs`. |
| `package.json` scripts, `vite.config.ts`, `index.html` | Same shape; `@biomejs/biome` added as a devDependency, because CI gates on `format:check` and seekolous relies on the binary being available ambiently. |
| `.github/workflows/deploy.yml` | Same fast-gate shape. Added `npm test` (bun), since seelite has a headless tier from day one and seekolous's deploy job does not run one. Project name changed. |
| `.github/workflows/probes.yml` | **Deliberately different.** Seekolous's probe suite takes ~24 minutes in CI, so it was moved off the pull-request path to nightly. Seelite's takes ~10 seconds, so it gates on pull requests — with the nightly schedule kept, so the day the suite outgrows a pull-request gate the policy is already there. |

## Deliberately left behind

| Not copied | Why, and what would bring it |
| --- | --- |
| `scripts/lib/deterministic-clock.mjs` and `probe-clock.mjs` | The clock is guarded by its own probe, and the pair is ~30 KB of machinery for making a frame-stepped simulation replayable. Seelite has no frame-stepped simulation yet. **Bring it when the first probe needs to step the world with a fixed `dt` and compare two runs.** Until then it would be unguarded machinery with nothing to clock. |
| `scripts/lib/hallow.mjs`, `scripts/lib/probe-aim.mjs` | God-game page helpers. Nothing generic in them. |
| The 40-odd `probe-*.mjs` scripts | Each is written against seekolous's world. `probe-boot.mjs` is seelite's first, written from scratch against the shape they share. |
| `src/main.ts` and everything else in `src/` | A god game. What crossed from `main.ts` is the *bootstrap pattern* — `WebGLRenderer` with ACES tonemapping, an `EffectComposer` with `UnrealBloomPass` and `OutputPass`, the `?seed=` parse with its empty-string trap, a `window.__<game>` handle for probes, and `step(dt)` as a method so a probe runs the game's frame order rather than its own copy of it. |
| `src/style.css` | Seelite's UI is one HUD line; its styling is inline in `index.html`. |
| Cloudflare Pages project | Not created. `deploy.yml` warns and skips until `CLOUDFLARE_API_TOKEN` is set, so the build and typecheck gate works from the first commit. |

## What the scaffold added that seekolous has no equivalent of

Not vendored, and listed because the reuse story alone would imply the scaffold
is all borrowed:

- `src/units.ts` — the two-layer km unit scheme, a leaf module.
- `src/sim.ts` — the authoritative float64 world, which cannot import Three.js.
- `src/backdrop.ts` — seeded star-field generation, returning plain buffers.
- The three-layer camera-relative renderer in `src/main.ts`.

All four come from the scale research
([#3](https://github.com/jcfischer/seelite/issues/3), `docs/research/space-scale-rendering.md`),
not from seekolous.

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
| `scripts/probe-guard.mjs` | `seedDemoVillage` became `bootedGame`, which waits for a published handle *and* a drawn frame. The tree check has since diverged entirely: seekolous compares top-level numeric constants between the served module and the local file, and #123 caught that passing a sibling worktree — two checkouts off one commit agree on every such constant. Here the dev server declares its own root and the guard compares that (#296), so there is no constant matcher and no file list to vendor back. |
| `scripts/probe-all.mjs` | `REPORTERS` and `QUARANTINED` emptied — a quarantine inherited from another project is a debt nobody here incurred. Examples re-pointed. One defect fixed: the file filter picked up `probe-guard.mjs`, which is a library, spawned it as a probe, and counted its vacuous exit 0 as a **passing gate**. Seekolous's copy has the same hole. |
| `scripts/check-launcher-wiring.mjs` | `EXPECTED_CALLERS` 40 → 1. A weak floor, honestly weak: at this size it asserts little more than "the scan found `scripts/`". Raise it as probes land. |
| `tests/headless.test.ts` | The pattern kept exactly — set equality between the listed modules and the required ones, plus per-module load tests and leaf assertions. The module list is seelite's. |
| `tests/source-scan.test.ts` | Subjects re-pointed at `src/main.ts` and `scripts/probe-boot.mjs`. |
| `package.json` scripts, `vite.config.ts`, `index.html` | Same shape; `@biomejs/biome` added as a devDependency, because CI gates on `format:check` and seekolous relies on the binary being available ambiently. |
| `.github/workflows/ci.yml` | Same fast-gate shape, and named `deploy.yml` until the split into a test stage and a deploy stage. Added `npm test` (bun), since seelite has a headless tier from day one and seekolous's deploy job does not run one. Project name changed. |
| `.github/workflows/probes.yml` | **Deliberately different.** Seekolous's probe suite takes ~24 minutes in CI, so it was moved off the pull-request path to nightly. Seelite's takes ~10 seconds, so it gates on pull requests — with the nightly schedule kept, so the day the suite outgrows a pull-request gate the policy is already there. |

## Deliberately left behind

| Not copied | Why, and what would bring it |
| --- | --- |
| `scripts/lib/deterministic-clock.mjs` and `probe-clock.mjs` | The clock is guarded by its own probe, and the pair is ~30 KB of machinery for making a frame-stepped simulation replayable. Seelite has no frame-stepped simulation yet. **Bring it when the first probe needs to step the world with a fixed `dt` and compare two runs.** Until then it would be unguarded machinery with nothing to clock. |
| `scripts/lib/hallow.mjs`, `scripts/lib/probe-aim.mjs` | God-game page helpers. Nothing generic in them. |
| The 40-odd `probe-*.mjs` scripts | Each is written against seekolous's world. `probe-boot.mjs` is seelite's first, written from scratch against the shape they share. |
| `src/main.ts` and everything else in `src/` | A god game. What crossed from `main.ts` is the *bootstrap pattern* — `WebGLRenderer` with ACES tonemapping, an `EffectComposer` with `UnrealBloomPass` and `OutputPass`, the `?seed=` parse with its empty-string trap, a `window.__<game>` handle for probes, and `step(dt)` as a method so a probe runs the game's frame order rather than its own copy of it. |
| `src/style.css` | Seelite's UI is one HUD line; its styling is inline in `index.html`. |
| Cloudflare Pages project | Not created. `ci.yml`'s publish gate warns and skips until `CLOUDFLARE_API_TOKEN` is set, so the build and typecheck gate works from the first commit. |

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

## Reuse from outside seekolous: Ian Bell's `txtelite.c`

*Added 2026-08-18, executing the galaxy spec's §4.5 instruction as part of
"Implement galaxy & system generation"
([#12](https://github.com/jcfischer/seelite/issues/12)).*

Everything above concerns one upstream. This section exists because the
generator copies from a **second** one, and on different terms: seekolous is our
own code moving between our own projects, while this is a third party's
published work.

| What crossed | Where it lives | Author |
| --- | --- | --- |
| The 32-entry digram table (`pairs`) that system names are built from | `src/names.ts` | Ian Bell, `txtelite.c` v1.4 — his own published reference implementation of Elite's generator |
| The `pairs0` table and its documented run-on into `pairs`, which the random-name token indexes | `src/names.ts` | as above |
| The "goat soup" description grammar — 36 five-way option lists, the 0x33/0x66/0x99/0xCC thresholds, the `<name>ian` trailing-vowel rule | `src/names.ts` | Bell's file, itself adapted there from Christian Pinder's reverse-engineered sources |

Read from the mirror at <https://github.com/richcarl/txtelite>
(`txtelite-1.4.c`); Bell's own page is
<http://www.iancgbell.clara.net/elite/text/>, which 404'd for the direct file
when node [#4](https://github.com/jcfischer/seelite/issues/4) fetched it.

### Licence status: none stated — recorded as an open risk, not as a clearance

**`txtelite.c` carries no licence.** Its header names its authorship and intent
and grants nothing:

> The nature of basic mechanisms used to generate the Elite socio-economic
> universe are now widely known. A competant games programmer should be able to
> produce equivalent functionality. […] This file may be regarded as defining the
> Classic Elite universe.
>
> — `txtelite.c` v1.4, ICGB 13/10/99

That is permission-flavoured prose, and it is not a licence. Nor is the mirror's
existence one: the richcarl repository we read from states no licence either, so
it conveys no terms it does not have.

**The argument for copying anyway** is precedent and intent: Bell published the
file explicitly as a reference implementation of the algorithms, described the
mechanisms as already widely known, and Oolite (GPL, in continuous distribution
since 2004) ships the same tables. Elite's own copyright sits with Bell and
David Braben; nothing here touches the game's code, art or trademarks.

**The counter-case, stated because it is real:** published-as-reference is not
licensed-for-redistribution, and "widely known mechanisms" describes the
*technique*, not the tables. The digram table and the goat-soup word lists are
copied *data* — the part of this that a rewrite could not reproduce, which is
precisely why they were copied and precisely what makes them the copyrightable
part.

**What that means in practice.** This is a private, non-commercial project, and
the exposure is small and reversible: the tables live in one module behind two
functions (`systemName`, `planetDescription`). If a licence is ever required —
distribution beyond a personal deployment, or a request from the author — the
fix is to replace `src/names.ts`'s two tables and leave every caller untouched.
Names and descriptions would change; nothing else would.

Resolving this properly (seek permission, or generate our own pronounceable
table) is a decision, not an implementation detail, and is recorded here rather
than settled in a build.

**Why it is copied data rather than reimplemented technique.** The digram table
is tuned so that any sequence of pairs is pronounceable, and that tuning is
invisible in the data — a hand-rolled 32-entry table produces unsayable names
and no test can tell you why. The grammar's value is likewise its word lists,
not its recursion. Oolite ships the same tables and Bell published the file
explicitly as a reference implementation, so this is well-trodden ground; what
must not happen is the tables appearing in a source file with no attribution,
which is why `src/names.ts` opens with the provenance and points here.

**What is not Bell's.** Where the randomness comes from. `txtelite` drives all
of this by advancing its 48-bit chain seed in place; seelite passes in a stream
drawn from the system's own `NAME` / `DESC` domain, because that chain is the
one thing the hash-per-system substrate exists to be rid of (spec §1). The
2-character minimum in `systemName` is also ours — Bell's emit rule can produce
an empty name, which §9.6 forbids.

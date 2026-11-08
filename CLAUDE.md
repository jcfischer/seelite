# seelite

A browser-playable classic-Elite (1984) trade–fight–explore loop. TypeScript +
Vite + Three.js, static bundle, no backend. Runtime network requests are limited
to the approved list in [docs/stack-and-assets.md](docs/stack-and-assets.md).
Read it before adding a request or an asset.

## Read the map first

Work on this repo is planned as **two work-graph maps**, and both are the
authority on what to build and how. Which one you read is decided by what you
are changing: **#1 is the machine** — rendering, performance, probes, the input
and binding layer, the save format, station geometry, the sky — and **#460 is
the fiction** — missions, the Rama expedition story, combat consequence,
onboarding and the progression ladder.

When a node sits on the line, ask what its answer **changes**: the mechanism that
draws, measures, persists or reads input is #1's, and what a job is worth, means
or costs is #460's. A node on one map may be `--blocked-by` a node on the other:
record the dependency and do not move a node to keep an edge local. The reasoning
and the worked example are in [docs/work-graph-maps.md](docs/work-graph-maps.md).

```bash
# --repo is not optional; see below
soma graph node 1 --repo jcfischer/seelite      # the machine map: destination, constraints, notes, decisions
soma graph frontier 1 --repo jcfischer/seelite  # what is takeable right now on the machine
soma graph node 460 --repo jcfischer/seelite    # the fiction map (split out of #1 on 2026-09-21)
soma graph frontier 460 --repo jcfischer/seelite
```

**`--repo jcfischer/seelite` on every `soma graph` verb.** Without it the verb
resolves `the-metafactory/soma` and silently returns that repo's node of the
same number — it does not error. Read the `(owner/name)` on the first line of
every result before trusting it.

**#460 does not restate #1's Constraints, Notes or delivery SOP** — it inherits
them by reference and adds its own on top, about what the fiction may cost. So
working a #460 node means reading **both** maps, and neither is a summary of
the other: #460 for what it adds, #1 for what binds underneath. What those
constraints say is on #460, and deliberately not here.

#1's **Constraints** section binds every answer — an option that violates one is
not on the table. #1's **Notes** section carries the delivery SOP (claim →
branch → worktree → TDD → PR → sage review → merge), when to stop reviewing, and
the repo's verification culture. Do not restate either here; read them there, so
there is one authoritative copy rather than two that drift. The map owns
constraints and decisions, `docs/specs/` owns ratified structural detail, and
`CONTEXT.md` owns vocabulary with pointers to those specs.

The `orienteer` skill walks the map. Every graph operation is a `soma graph`
verb — never reach past them to `gh issue` for node lifecycle, because the verbs
carry the rules.

## Authored-model integration

Before integrating an approved ship, station, cockpit or interior study, read
[the authored-model integration SOP](docs/model-integration-sop.md). It orders
asset preflight, one complete production integration, measured LOD selection,
verification and review, and supplies a receipt template. It supplements the
live map's delivery SOP; it does not replace its constraints or merge gates.

## Verification, both tiers

Anything arithmetic gets a headless test; anything rendered or spatial gets a
browser probe. A change is not done until both are green — the browser tier
through the PR gate below.

```bash
rtk test npm test               # bun, headless — sim logic, generators, unit scheme
npm run probe                   # GPU default: every browser probe — see the PR gate's ruling
npm run probe:one <name>        # GPU default: one probe
npm run probe:one -- <name> --show-output --log /tmp/p.log  # stream its lines; log written as printed
npm run probe:cpu               # explicit headless/SwiftShader fallback
npx tsc --noEmit                # no errors
rtk lint npm run format:check   # biome, no fixes applied
rtk lint npm run lint           # biome: undeclared names in scripts/
npm run lint:comments           # eslint: no new comments; baseline only shrinks
node scripts/check-launcher-wiring.mjs  # exit 0; `npm run probe` and `npm test` run it
rtk err npm run build           # tsc + vite build
```

### PR browser gate: smoke plus affected contracts

**Principal-approved policy, 2026-10-11 (#891).** For ordinary PRs the browser
merge gate is the repository-selected smoke set plus affected contracts. A green
selected gate satisfies the browser delivery tier; it must report its coverage
and must not be described as a full-suite pass. Headless, build and Sage gates
remain in force. Explicit node-specific acceptance criteria remain in force too.

**Order and scope, the principal's ruling (three sessions, 2026-10-10/11).**
Sage rounds go first; the browser gate runs once, with `probe:pr`, on the final
head. A red is re-run alone with `npm run probe:one <name>`. A parked node's
branch is rebased on `origin/main` before its probes run again. Headless, run the
affected test files and the gates locally; CI runs the full unit suite in four
shards. **Who runs the full suite depends on who is at the keyboard.** In an
interactive session, ask the principal before running `npm run probe` or
`probe:full` by hand. An unattended worker (ranger) runs whatever
`npm run probe:pr` selects — its full-suite fallback included — and never waits
for an answer.

Inspect the change and its selection before launching probes:

```bash
npm run probe:select -- --base origin/main --head HEAD
npm run probe:pr -- --base origin/main --head HEAD
```

Read [docs/verification.md](docs/verification.md) before changing probe selection
or the probe harness, before running the full suite, or when a probe run surprises
you. These rules come up on most PRs:

- **Never manually narrow unknown gameplay impact.** Re-run selection after
  changing the diff or merging main. Documentation and headless-test-only changes
  need no browser run.
- **Do not shorten render windows or remove assertions to make an unrelated PR
  cheaper.**
- **One suite per machine (#84).** Exit 75 with `NOT RUN` is a wait that ran out,
  not a red.
- **A `crash` or `killed` red is unattributed until it is rerun alone:** green
  alone points at the machine, red alone at the code.
- **The probes do not run in CI (#14).** Nothing on GitHub proves the browser tier
  was run. That check is yours, before you merge.

**On a red run `rtk test` prints `N fail` without naming the test.** It tees the
full output and prints the log path — read that file. Re-running the command raw
puts the unfiltered output into context, which is the thing the prefix avoids.

### Visual work has a third tier, and it is a person

A node that changes what the game **looks like** closes on two things and not one:
the canonical view set, and the principal saying yes to it. The agent never stands
in for that yes. The commands and capture rules are in
[docs/verification.md](docs/verification.md).

## Comments

Code says what it does; a comment is a claim that goes stale when the code
moves. `seelite/no-comments` (`scripts/eslint/no-comments.mjs`) fails every new
comment except one holding a URL (point it at the issue or vendor doc behind a
constraint), a `/** doc */` on an export, a `biome-ignore` or `@vite-ignore`
directive, and a license header. The existing ones are baselined in
`eslint-suppressions.json`, which may only shrink: CI fails any file whose
count grows past `origin/main`. Burn it down one slice per PR with the
`no-comments` skill, then `npm run lint:prune`. On a rebase conflict in that
file take main's copy and prune again; never `--suppress-all`.

## Pitfalls

**`docs/pitfalls.md` carries the traps, one heading per subsystem.** Read the
matching heading before changing:

- Sim, economy, hulls and RNG
- Flight and frames
- Stations: geometry, interiors and forms
- Render layers, lighting, surfaces and finishes
- The cockpit cabin
- View-set comparisons
- Measuring a frame: occlusion, cost and GPU timing
- Output stage, multisampling and shader splices
- Probes and the dev server

Three bind every change, so they stay here:

- **`src/units.ts` and `src/vec3.ts` are leaves.** They import nothing, and
  `tests/headless.test.ts` asserts it. A value import into either can close an
  import cycle or drag a renderer into the headless tier.
- **`src/sim.ts` must not import Three.js.** The authoritative world is float64
  kilometres outside the scene graph; the scene graph is display only, and
  nothing reads a position back out of an `Object3D`.
- **Probes read constants off the page** (`window.__seelite.units`) instead of
  restating them. A probe with its own copy of a constant goes falsely red when
  the module changes it.

## Stack

TypeScript, bun for tests, npm-compatible lockfile, biome for formatting,
Playwright for probes. No Python. Procedural everything — no downloaded assets;
audio synthesised via WebAudio, textures generated at load. The exceptions are the
principal's rulings, listed in [docs/stack-and-assets.md](docs/stack-and-assets.md).

- **Spike evidence is not committed** (principal, 2026-11-06). Keep captures, sheets
  and logs outside the repository, and put the figures and the file names in the
  receipt.
- **On a branch that adds or changes a sample or a study binary, run
  `git lfs push origin <branch>` before `git push`.** The reason and the CI check
  are in the same file.

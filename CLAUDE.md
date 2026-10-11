# seelite

A browser-playable classic-Elite (1984) trade–fight–explore loop. TypeScript +
Vite + Three.js, static bundle, no backend, no runtime network requests beyond
Counterscale pageview analytics on each public page load, game launch (#569)
and opened postcard link (#714, `src/visit-count.ts`) — and the natural voice's files from this site's own
origin (#604, `src/bundle-fetch.ts`): its manifest when the question is asked
and on each start with the voice on, and its model when the player
chooses it — once per version where the browser keeps it, at every start in
a private window — and YouTube's player for the home trailer, loaded only when
the player presses its poster (click-to-play, 2026-10-03, `src/public-site.ts`)
— and the music's instrument samples, from this site's own origin: a set's
manifest and only the recordings a loaded song plays, each once a session
(2026-10-06, `src/music-samples.ts`). The voice is
the one trained asset and the samples the one recorded one; the map's
Constraints carry the rulings.

## Read the map first

Work on this repo is planned as **two work-graph maps**, and both are the
authority on what to build and how. Which one you read is decided by what you
are changing: **#1 is the machine** — rendering, performance, probes, the input
and binding layer, the save format, station geometry, the sky — and **#460 is
the fiction** — missions, the Rama expedition story, combat consequence,
onboarding and the progression ladder.

The boundary is engine against fiction, not player against world. A pilot
presses a key and the game saves, so *controls* and *save* are #1's even though
a pilot does both; what the fiction asks of a pilot — what work there is, what
it means, what the world does about it — is #460's. When a node sits on the
line, ask what its answer **changes**: the mechanism that draws, measures,
persists or reads input is #1's, and what a job is worth, means or costs is
#460's. Combat consequence is the worked example — a consequence is persisted
state, so the save format carrying it is #1's while what being struck *costs a
pilot* is #460's, and the two are separate nodes rather than one node on two
maps.

A node on one map may be `--blocked-by` a node on the other: blocking is a
native edge between nodes and knows nothing about membership, so it crosses the
split and holds the blocked node off its own map's frontier until the blocker
closes. Record the dependency; do not move a node to keep an edge local.

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

This file exists because it is **tracked**, so it is present in every git
worktree the SOP tells you to create. Per-agent memory is not: a worktree is its
own project scope and loads none of it.

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

Selection follows declared contract roots and their transitive imports in both
revisions. Reviewed, body-only Game method changes can use narrower ownership;
unmapped methods, new collaborators, boot wiring, shared simulation, build and
harness changes expand to all probes. Unknown paths and catalog drift also expand
to all. A change that only adds a probe's catalog and roots entries, or edits
`scripts/lib/probe-quarantine.mjs`, selects those probes plus smoke. Never
manually narrow unknown gameplay impact. For selection-policy or
probe-organization changes, a reviewed diff that leaves game code and browser
launch behavior unchanged may use routing tests, changed probe contracts and
smoke instead of the infrastructure fallback. Record that scope and its evidence
in the PR; do not describe it as an automatic selection or a full-suite pass.
Documentation/headless-test-only changes need no browser run; changed probe
scripts still run their own checks.

The PR runner requires a clean checkout at the selected HEAD. Its printed base
and head identify the evidence. Re-run selection after changing the diff or
merging main. No service or credential is required for git-based selection.
`--changed-file` and the legacy TypeSafe evaluator remain diagnostic tools;
path-only evidence cannot run a PR gate.

`npm run probe:full` is for broad infrastructure changes or unresolved impact,
before a release, and as a weekly regression check on the hardware machine. The
selector falls back to every probe on its own (the selector reports it); who runs
that fallback follows the ruling above. This is a local hardware operation,
not a GitHub-hosted browser job. The full suite retains every contract, including
offline music bands and cinematic camera checks. GPU probes remain serial.

Music is two contracts: `probe-music` owns offline synth/bands and
`probe-music-game` owns live unlock, beds and docking integration. Opening is
`probe-opening` for skip/save/bypass/fallback and
`probe-opening-cinematic` for watched frames and camera geometry. Do not shorten
render windows or remove assertions to make an unrelated PR cheaper.

The `rtk` prefixes exist because a green run's output is re-read on every later
turn of the session. Measured on a passing tree: `npm test` 702 bytes raw and
112 through `rtk test`, `npm run build` 627 and 76, `format:check` 88 and 22 —
a full green pass drops from 1,988 bytes to 781. Exit codes survive the filter
in both directions.

**On a red run `rtk test` prints `N fail` without naming the test.** It tees the
full output and prints the log path — read that file. Re-running the command raw
puts the unfiltered output into context, which is the thing the prefix avoids.

**The hook rewrites `npx tsc --noEmit` to `rtk tsc`.** Measured 2026-10-11 on
rtk 0.40.0: exit 0 and `TypeScript: No errors found` on a clean tree, exit 2
with every error listed on a broken one. Read the whole output — `| tail -1`
keeps only the `N errors in M files` count. `npm run probe` stays unprefixed: it
has no rtk filter, and a green run is already 19 lines.

`npm run probe` (also `probe:full`) is the full regression command; the ruling
above says when it runs.
For PR development and delivery, use `probe:pr` above. `npm run probe` uses the GPU lane,
which forces headed Chromium and refuses to start unless a fresh WebGL canvas
identifies a non-software renderer; every child probe repeats that check.
`npm run probe:cpu` preserves the former renderer-unasserted command for a
displayless or portability check.

**One suite per machine (#84).** `probe-all` and `npm run views` hold a lock
at `/tmp/seelite-probe.lock`, shared by every worktree and clone that carries
it — a checkout from before #84 runs unlocked, and only its load shows. A second run
waits and names the holder. **Exit 75 with `NOT RUN` is a wait that ran out,
not a red**; `scripts/lib/probe-lock.mjs` owns the limit and the rules. A probe
run directly does not take the lock, which is how a red is re-run alone — and
it does not wait on it either, so a rerun is alone only while
`/tmp/seelite-probe.lock` is absent. Since #882 it no longer asks you to know
that: a direct run finds the lock held by someone else and **names the holder on
stderr**, and says its own seconds are not evidence. Nor does a direct run pick a
renderer lane: with `SEELITE_PROBE_RENDERER` unset it gets the software page
`probe:cpu` names deliberately, several times slower than the GPU default the
suite runs on — #882 measured the gap, and
`docs/receipts/node-882-probe-wall-clock.md` §2 carries the figures — and it now
says so, which is why `npm run probe:one <name>` is the way to re-run one red.
Each
red prints its kind and the peak load it ran under, and since #882 so does each
**green over a minute** — only reds carried a figure before, which is how a suite
run beside another agent's probes came to read as a slow suite rather than a
starved one; the measured figures are in
`docs/receipts/node-882-probe-wall-clock.md`. The summary names the
slowest probes and what share of the run they were, because a hundred lines in
alphabetical order answer nothing. Neither names a cause —
no load threshold has been measured, and a regression that throws reads
`crash` as readily as a starved navigation does — so a `crash` or `killed` red
is unattributed until it is rerun alone: green alone points at the machine,
red alone at the code. Load from outside a suite (a `sage review`, `npm test`)
is reported, not locked out; sage runs before the browser gate (above).

### Visual work has a third tier, and it is a person

A probe cannot fail on *this looks flat*. #35 and #36 both closed green and
produced the look #98 then set out to change; #36's receipt records that every
rendered form of its outline rule was measuring bloom. So a node that changes
what the game **looks like** closes on two things and not one: the canonical
view set, and the principal saying yes to it. The agent never stands in for
that yes.

```bash
npm run dev                          # in one shell
npm run views -- --label before      # in another, at the base commit
npm run views -- --label after       # again, with the change
open view-set/index.html             # the contact sheet, side by side
```

Views on a fixed seed — bar one that declares its own — in
`scripts/lib/view-set.mjs`, each naming
the levers it is evidence for, and `tests/view-set.test.ts` goes red if a lever
in that file has no view. **The count is deliberately not repeated here**: it
said fifteen while the set held seventeen, which is the third-copy drift this
file warns about elsewhere. `view-set.mjs` states it and
`tests/view-set.test.ts` asserts it as a literal, so a view deleted by accident
is a red run there. It cannot check that the view *shows* the surface, nor
that a lever added to the map reached the file; both are a person's job, which
is the point. A run that drops a view refuses to build a sheet at all, because a
sheet with a hole in it reads exactly like a whole one.

**Capture launches headed and then checks what it got.** It boots the page,
reads the real renderer back, and refuses to write a single frame unless that
renderer can be *shown* not to be a software rasteriser — an unreadable name
counts as unproven. So it needs a display, but the guarantee is about the
renderer rather than about headedness, and a displayless machine gets a full
boot before the refusal. The browser-probe default now uses the same hardware
lane; `npm run probe:cpu` is the deliberate SwiftShader fallback. `view-set/`
is gitignored — before/after is two runs at two refs, not a baseline in the
repo.

`scripts/probe-guard.mjs` refuses to measure a dev server that is not serving
this working tree — the failure it prevents is a probe passing against someone
else's checkout on the same port.

**The probes do not run in CI** (#14). GitHub installs a browser per run, which
cost minutes per push and once hung for twenty-five; the runner has no GPU, so
everything it renders is software-rasterised anyway. `.github/workflows/ci.yml`
gates a pull request on format, lint, wiring, typecheck, unit tests (in four
shards) and build; its deploy stage runs on `main` and nowhere else. Nothing on
GitHub proves the browser tier was run. That check is yours, before you merge.

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
audio synthesised via WebAudio, textures generated at load. The one exception
is the natural voice (#604), by the principal's ruling in the map's
Constraints: `node scripts/fetch-voice-model.mjs` puts it in
`public/voice-model/` (git-ignored), and `scripts/measure-neural-voice.mjs`
— manual, by the principal's ruling — needs it there; `probe-neural-voice`
gates without it. `public/social-preview.jpg` (#714) is the one tracked image:
a frame of the Docking Waltz film, which the game's own code drew, served only
for the link previews a crawler fetches. No page and no game loads it, and
`src/social-preview.ts` says where it came from. The music's instrument
samples are the other exception, by the principal's ruling of 2026-10-06 in
the map's Constraints — open-licensed (CC0 or CC BY) recordings, chosen by
ear in blind auditions: `scripts/fetch-music-samples.mjs` prepares them into
`public/music-samples/` and records each file's source and checksum, and the
chosen sets are **tracked in Git LFS** (`.gitattributes`). This repository
sets the LFS filters locally and installs no LFS hooks, because
`core.hooksPath` here is global, so **run `git lfs push origin <branch>`
before `git push`** on a branch that adds or changes a sample, or the remote
holds pointers with no objects. The deploy pulls them only when it publishes.

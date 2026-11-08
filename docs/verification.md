# Verification: the full detail

`CLAUDE.md` holds the commands, the PR gate's ruling and the rules most PRs need.
This file holds everything else about the browser tier. Where the text below says
"above" or "the ruling", it means the *PR browser gate* section of `CLAUDE.md`.

## Probe selection

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
scripts still run their own checks. So do study files under `spikes/` (node
#1081, the spike rule): a `spikes/` path outside the transitive import closure
of `src/` and probe scripts that no string literal in that closure names, in
either revision, as the file, an ancestor directory, an import stem or a glob
prefix, is a study file, and a diff confined to them selects no probe. Glob
prefixes match everything before the first wildcard, including part of a
filename. Git snapshots include spike sources so transitive imports keep their
owners; URL references without an owner still expand to all.
`src/coriolis-spike-viewer.ts` and
`src/courier-cockpit-viewer.ts` name their spike assets by URL, so those stay
runtime. `isStudyFile` in `scripts/lib/probe-impact.mjs` owns the rule.

The PR runner requires a clean checkout at the selected HEAD. Its printed base
and head identify the evidence. Re-run selection after changing the diff or
merging main. No service or credential is required for git-based selection.
`--changed-file` and the legacy TypeSafe evaluator remain diagnostic tools;
path-only evidence cannot run a PR gate.

## The full suite and split contracts

`npm run probe:full` is for broad infrastructure changes or unresolved impact,
before a release, and as a weekly regression check on the hardware machine. The
selector falls back to every probe on its own (the selector reports it); who runs
that fallback follows the ruling above. This is a local hardware operation,
not a GitHub-hosted browser job. The full suite retains every contract, including
offline music bands and cinematic camera checks. Probes run four at a time,
longest first, and the load-sensitive ones run alone afterwards (#1175, #1184;
`scripts/lib/probe-schedule.mjs` owns the list and the receipts the numbers).

Music is two contracts: `probe-music` owns offline synth/bands and
`probe-music-game` owns live unlock, beds and docking integration. Opening is
`probe-opening` for skip/save/bypass/fallback and
`probe-opening-cinematic` for watched frames and camera geometry. Do not shorten
render windows or remove assertions to make an unrelated PR cheaper.

## Output filtering

The `rtk` prefixes exist because a green run's output is re-read on every later
turn of the session. Measured on a passing tree: `npm test` 702 bytes raw and
112 through `rtk test`, `npm run build` 627 and 76, `format:check` 88 and 22 —
a full green pass drops from 1,988 bytes to 781. Exit codes survive the filter
in both directions.

**The hook rewrites `npx tsc --noEmit` to `rtk tsc`.** Measured 2026-10-11 on
rtk 0.40.0: exit 0 and `TypeScript: No errors found` on a clean tree, exit 2
with every error listed on a broken one. Read the whole output — `| tail -1`
keeps only the `N errors in M files` count. `npm run probe` stays unprefixed: it
has no rtk filter, and a green run is already 19 lines.

## Running probes

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

## Visual work has a third tier, and it is a person

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

# Node #1125: the shipyard probe's saved hull

The regression starts at `f9ce50523cb925bd817328df7f572774b207568d`
(“Add the cargo scoop module and gate every pickup from space on it”,
node #1096, PR #1109). The defect is in the probe's fixture.

## Cause and repair

The probe buys an interceptor, then fabricates an explorer waiting for launch
by replacing only `commander.hull`. Since `f9ce5052`, a stock Commander has a
cargo scoop. The purchase transfers that scoop into the interceptor's `i4`
slot, which accepts cargo modules. The explorer's `i4` accepts survival
modules, so retaining that loadout makes the fabricated explorer invalid.

`serializeSave` rejects the loadout with `module does not fit i4`.
`Game.saveFlush` reports the error and preserves the previous save. The old
probe neither awaited a successful flush nor read the stored record: its
“the save records the explorer” row inspected the live `saveEnvelope()`.
The subsequent boot therefore loaded the older courier save.

The fixture now uses the production `transferLoadout` function when it creates
the waiting explorer, including any overflow fittings. The scoop moves to
the explorer's cargo-compatible `i3`. The probe awaits `SaveStore.flush` and
reads `live` from IndexedDB through `parseSave` before closing the page.
The conflicting-URL and no-URL saved-hull assertions remain intact.

No game code changes. Existing `tests/flown-hull.test.ts` already pins saved
hull authority; the new regression check belongs to the browser probe because
the fault was in its fixture and its claim about persisted bytes.
This is internal probe work under `src/changelog.ts`'s major-change definition.

## Regression evidence

All browser runs used ANGLE Metal on the host's Apple M1 Pro, serially, with
`npm run probe:one -- probe-shipyard --show-output --log <path>`.
Historical sources were extracted with `git archive` into separate temporary
directories and served by each snapshot's own Vite server. No branch switched.

| Revision | Result | Local log |
| --- | --- | --- |
| `22ab9dc51d36470e012eccaa6b2a55a4afb52407` (`f9ce5052^`) | 24/24 checks pass | `/tmp/node-1125-pre-scoop-probe.log` |
| `f9ce50523cb925bd817328df7f572774b207568d` | Saved-hull reload fails at line 393, flying courier | `/tmp/node-1125-scoop-probe.log` |
| Worker base `297e9c60ecfa2c47e7b507545273a49219aa8eb5` | Same saved-hull reload failure | `/tmp/node-1125-base-probe.log` |
| Base with the awaited flush and stored-record check, before fixture repair | `page.evaluate: Error: module does not fit i4`, from `SaveStore.flush` | `/tmp/node-1125-save-check-red.log` |
| Repaired fixture and stored-record check | 24/24 checks pass | `/tmp/node-1125-fixed-probe-repeat.log` |

The earlier loadout migration, `2e827635`, was also checked: both that commit
and its parent round-trip this fabricated explorer. It did not introduce
the failure. A headless serialization replay at `f9ce5052` and its parent
reproduces the same valid/invalid boundary as the browser pair.

Probe selection for `scripts/probe-shipyard.mjs` names only `probe-shipyard`.
These runs establish that contract, not a full browser-suite pass.

One repaired run reached the successful IndexedDB readback, then timed out
at the reload's 20-second boot-readiness wait. The unchanged repeat passed
all 24 checks. No timing threshold changed. Both logs remain under
`/tmp/node-1125-fixed-probe*.log`.

`bun test tests/flown-hull.test.ts tests/loadout.test.ts tests/save-envelope.test.ts`:
39 pass, 0 fail. The fixture, hull choice, serialization and loadout-transfer
checks remain in their existing tiers.

The required full host `npm test` ran once with Bun 1.4.2: 7,242 pass,
1 fail. `tests/exact-amount.test.ts`'s “bit-pattern corpus spans every finite
exponent and both signs” timed out at 5,192.60 ms against Bun's 5,000 ms
default. The full log is
`~/Library/Application Support/rtk/tee/1793320274_test.log`.

That file passes alone on both the extracted worker base and this worktree
with the same Bun 1.4.2 binary: 10 pass, 0 fail each. The source and test
are byte-identical to the worker base, as are all `src/`, `tests/`, test
configuration and package files. The full-suite timeout did not reproduce
in isolation; a baseline full-suite failure is therefore not claimed.

Build (including typecheck), format, lint, comment lint, launcher wiring and
`git diff --check` pass.

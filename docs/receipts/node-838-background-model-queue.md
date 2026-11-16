# Node #838: background model queue

## Contract and implementation

Ordinary Game construction awaits only the cockpit and the home station's
authored exterior, through the existing progress/Retry view. A new game's home
is its trade station; a docked save names its own station. Procedural forms have
no file to await. The restore-failure constructor arm selects the fresh world's
home again. The Commander overlay opens before these downloads start.

`src/model-queue.ts` is a renderer-free serial queue. Pending work follows the
current system's station forms, flown/cached hulls and complete home/inbound
Traffic roster, then the plotted next hop, then the remaining catalog. An active
download is not cancelled when priorities change. Destination contents and both
Traffic plan sets are available before arrival; the jump path never awaits the
queue. Existing loader memoization and shared decoded templates retain models
for the document's lifetime, with no eviction.

Successful installs refresh live station and hull caches, including Traffic,
fleet, tender and wreck roots. Hull roots keep their identity and pose; station
replacement checks the current system and root after asynchronous warm-up.
Existing sliced interior installation stays in use. Longwall B now uses miner/a
as a temporary stand-in, rather than blocking boot. The envelope, collision and
vent tables stay fixed at their authored measurements in `HULL_SPECS`; the
stand-in does not change those tables. Chase muzzles are measured on the
procedural miner before install, then invalidated and measured on Longwall B
when the mesh is rebuilt. The earlier version of this receipt incorrectly
claimed that muzzles used the authored model throughout the cold-load window.
The cold-install headless row explicitly removes the preload, ray-checks both
sets of muzzles against their respective meshes, checks fixed hull data across
the swap, and verifies that the second rebuild does nothing.

A background failure is terminal for that model in the queue: warn once, keep
the stand-in, continue. Sharing a postcard explicitly retries failed required
models through the Retry view rather than silently exporting a stand-in.
Mesh-refresh failures have a separate warning and keep the template's installed
state; readiness still waits until the refresh finishes or fails. A postcard
therefore does not download an already installed template again after a refresh
failure.

## Deterministic readiness

- Live current-system readiness: `window.__seelite.modelsSettled()`. This includes
  mesh refresh completion and counts failed models as settled stand-ins. It does
  not wait for unrelated catalog entries.
- Full-catalog boot: `?boot=direct&models-full`. Every catalog loader completes
  before Game construction; failures use Retry. `gameUrl` adds this to direct
  measurement boots, and the canonical capture's `MODEL_BOOT_PARAMS` requests it.
  Cold-download probes explicitly pass `"models-full": false`.
- Existing per-family readiness handles and explicit URL flags remain compatible
  but all their background loads now use this queue.
- A postcard viewer derives its station and Traffic model set from its recipe,
  requires those models before construction, and mounts its one-frame viewer
  only after interior installation. No catalog/store/input/loop is added.

## Verification at the initial implementation

Affected headless files: **151 passed**, including queue priority changes during
a held load, terminal failure/continuation, current-set settlement independent
of unrelated work, refresh completion, boot-set selection across station roles,
complete Traffic selection, miner stand-in rebuilding, URLs and probe selection.

GPU lane, ANGLE Metal / Apple M1 Pro, serial Vite development-module runs:

| Probe | Result | Evidence |
| --- | --- | --- |
| `probe-model-queue` | 8/8 | Held optional responses across boot and the shipped jump charge/cut; settlement after release; no refetch on return; failure; full-set boot has no renderer canvas while a non-boot hull is held; launch frame is in flight |
| `probe-model-download` | 24/24 | Overlay/progress/Retry and one-time player/Traffic courier and tug replacement |
| `probe-station-interior-kit` | 39/39 | Cold sliced installs, failure, postcard wait, repeat installation and existing production-bay LOD checks |
| `probe-postcard` | 47/47 | Sender/viewer frame agreement, held/failed hull Retry, unchanged stored bytes and read-only viewer |

The download probe now waits for its route's first held request before counting
it; the overlay can appear earlier. The postcard probe expects the shared
"postcard models" loading label. No pixel or timing threshold was widened.

Typecheck, formatting, lint, launcher wiring and production build pass. The
build's emitted files pass the existing 25 MiB guard. No model bytes, geometry,
LOD settings or lighting were changed. This is loading/performance work under
`src/changelog.ts`'s definition, so it adds no public changelog entry.

Full headless suite at the initial implementation: its final `npm test` run
passed **6,370 tests, 0 failures**, across 368 files (host run; 713.50 seconds). Full output:
`/tmp/seelite-838-full-tests.log`.

## Review round 1

The miner measurement claim is corrected above and in `ship-mesh.ts`. Its
cold-install row now measures the stand-in and authored muzzles against their
respective metal, checks unchanged authoritative hull data, and checks one-time
replacement. Removing the miner's muzzle-cache invalidation makes that row fail.
The queue refresh test fails against the reviewed queue, then passes with load
and refresh failures separated. A refresh failure keeps its decoded template
installed, emits its own warning, and lets remaining work continue.

The Three-free model catalog owns the authored hull list and both station-family
lists. The Game, ship builder and system model selection read that shared list.
`trafficRosterHulls` owns the complete home/inbound roster projection used by
next-hop prefetch and postcard boot; the restore-fault arm uses `freshWorld`.

Optional early cockpit fetching was skipped: the memoized loader registers only
its first caller's progress listener, so starting it without one would lose
byte-progress reporting. The per-form loader factory nit was also skipped;
explicit entries keep the precise catalog keys visible without another helper.

Affected headless checks: **72 passed**, across five files. The expanded
`probe-model-queue` passed **10/10** on the GPU lane (ANGLE Metal / Apple M1 Pro),
including a held Longwall response and one-time replacement of the live miner.
`probe-postcard` passed **47/47** on the same lane, including sender/viewer frame
agreement, required-model Retry and unchanged stored bytes. Both runs were
manual affected-probe filters; neither is a full-suite or PR-gate pass.
The two deliberately broken headless runs each failed as expected; logs:
`/tmp/seelite-838-review-queue-red.log` and
`/tmp/seelite-838-review-miner-red.log`. Browser log:
`/tmp/seelite-838-review-model-queue.log` and
`/tmp/seelite-838-review-postcard.log`.

The single final full headless run for this review pass passed **6,372 tests,
0 failures**, across 368 files (host run; 911.15 seconds). Full output:
`/tmp/seelite-838-review-full-tests.log`. Typecheck, production build (including
the emitted-file size guard), formatting, lint and launcher wiring also pass.

## Handoff

This is affected browser coverage, not a full-suite or PR-gate pass. The selector
reports broad coverage for the boot/harness changes. Under the worker contract,
the supervisor owns the final full browser run, push, PR and review. No graph
node was edited, and principal merge/visual approval remains pending.

Local, ignored evidence is reproducible with `npm run probe:one --
probe-model-queue`: `probe-shots/model-queue/arrival-stand-ins.png`,
`arrival-installed.png` and `launch-installed.png`. These show the jump arrival
and a completed launch for principal inspection; they are not a canonical
before/after contact sheet or an approval. The worker's temporary dev server
was stopped.

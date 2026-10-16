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
as a temporary stand-in, rather than blocking boot. Its authoritative envelope,
vents and muzzle measurements still use the authored model.

A background failure is terminal for that model in the queue: warn once, keep
the stand-in, continue. Sharing a postcard explicitly retries failed required
models through the Retry view rather than silently exporting a stand-in.

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

## Verification

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

Full headless suite: the single final `npm test` run passed **6,370 tests,
0 failures**, across 368 files (host run; 713.50 seconds). Full output:
`/tmp/seelite-838-full-tests.log`.

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

# Node #1171 — target-panel paint

## Diagnosis

The defect was in the probe fixture. The panel was painted. The sampler required
`fillText` at exactly `y === 78` and compared rows 54–84 with a control that
suppressed only text at that same fixed baseline. Model-owned cockpit screens
changed the target canvas from 512×256 to 512×302. The painter scales its
baseline with the canvas height: `302 * 78 / 256 = 92.015625`. Neither arm of the
old sampler removed the designation at that position, so their pixels agreed.

PR #1176, commit `dda0b64c6fad174d1d12c6e523a0cf32723cd6e8`, already repaired
that fixture before this worker started. It observes the designation's actual
draw position and suppresses the matching string in the control. This node
retains that repair and the greater-than-50 changed-pixel floor.

Captured on main `0ac662f10629ab0066cda17654f90f366d0a7d30`, seed 42,
default courier, 1440×900, hardware lane:
`ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)`.
This is a different hardware host from the original M1 Pro report.

- [Full rendered frame](node-1171-target-panel/default-frame.png).
- [Target canvas at native resolution](node-1171-target-panel/target-face.png).
- [Panel state and all sampler results](node-1171-target-panel/diagnosis.json).

The frame visibly shows TARGET / STATION · TRADE / ARTEQUGE. Both target mount
and face are visible; the model's target screen measures 0.1220800161 ×
0.0719999989 km in the cabin coordinate scale. Its aspect produces the 512×302
canvas. No renderer or layout change is needed.

Replaying `designationFrames` from the reported main revision
`ec561ec59834003da9e3a2164c440e82400dd9df` against this live canvas reproduces
all eight original failures: `seen:false, fits:false, changed:0`. Running main's
repaired sampler on the same page produces the table below. The courier cockpit
GLB is unchanged between those two main revisions, and the reported revision
already derives the target canvas height from the same model-frame aspect.
The instrument's baseline formula is also unchanged; subsequent font changes
do not account for a fixed-y sampler suppressing no designation at all.

| Designation | Changed pixels | Missing-panel control |
| --- | ---: | ---: |
| STAR | 479 | 0 |
| PLANET | 715 | 0 |
| STATION · TRADE | 1465 | 0 |
| STATION · REFINERY | 1871 | 0 |
| STATION · SHIPYARD | 1798 | 0 |
| STATION · OUTPOST | 1634 | 0 |
| SHIP · INTERCEPTOR · UNKNOWN | 2872 | 0 |
| SHIP · INTERCEPTOR · HOSTILE | 2602 | 0 |

## Regression control

Eight new browser assertions run the same sampler with all target-canvas
painting suppressed by an empty canvas clip. The renderer still issues the
matching text calls and reports fitting text in every case. Both arms read the
same pixel band; all eight differences must be zero and all eight original
paint predicates must reject them. Canvas state and the intercepted method are
restored after each case. The other 31 assertions remain intact.

Before implementing suppression, the new controls rejected 0/8 cases and exited
1: the existing sampler ignored the suppression argument and still measured
479–2872 changed pixels. With suppression implemented, they reject 8/8 and exit
0, while `seen` and `fits` remain true. Thus call metadata alone cannot satisfy
the paint contract.

## Verification and quarantine

The isolated hardware command is:

```sh
npm run probe:one -- probe-display-contacts.mjs --show-output
```

No display-contacts quarantine entry was installed at the worker's starting
main. The fixed-y paint failure has already been repaired there; adding a stale
quarantine would hide new failures. The unrelated output-stage entry stays as
it was.

This is probe-only work, so it does not meet `src/changelog.ts`'s definition of a
major player-visible change.

The unchanged main probe passed alone: **39/39**, 75.2 seconds, peak load 9.9
on 18 cores ([complete output](node-1171-target-panel/main-probe.txt)). Two
earlier attempts hit the existing 20-second boot wait, one after the default
paint rows had passed. The successful rerun used the unchanged boot wait; this
node changes no readiness timeout.

The pre-commit path diagnostic selected exactly `probe-display-contacts.mjs`:
only that probe and non-runtime evidence changed. No full browser-suite claim
is made.

The final probe passed **47/47**: the original 39 and eight missing-panel
controls, 73.4 seconds, peak load 11.4 on 18 cores
([complete output](node-1171-target-panel/final-probe.txt)). All eight positive
rows retained their measured changed-pixel counts; every absent-panel row
reported `seen:true, fits:true, changed:0` and was rejected by the same paint
predicate.

Final local gates passed: `npm test` ran once, **7449 pass, 0 fail**, across 460
files; `npm run build` (including typecheck and bundle-size gate),
`npm run format:check`, `npm run lint`, and `npm run lint:comments` all exited 0.
The browser run also passed launcher wiring. Regression coverage is in the
browser probe because this contract measures actual canvas paint.

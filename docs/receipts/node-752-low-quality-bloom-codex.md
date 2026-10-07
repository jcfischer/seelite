# Node #752 — quality owns bloom

Author: Codex ranger implement worker, 2026-10-07.

`LIGHT_RIG.quality` now declares bloom on High and off on Low. The bloom pass
is constructed before `buildLights` calls the existing boot-time
`applyQuality`, so that same method applies the saved preference before frame
one and every live quality change. Its composer position, threshold, strength,
radius and resolution are unchanged. The perf panel still toggles the pass
directly; reset reads the same live Game bloom-default getter as `applyQuality`.

The table test had 0/2 passing before implementation and 2/2 afterward.
`probe-quality-bloom.mjs` had 4/9 passing before implementation and 9/9 afterward:
High boot, three live switches, Low and High diagnostic overrides and resets,
and saved Low with bloom disabled at frame one. The cold-boot reader is a new
page, with queued animation callbacks held until Game is published; its
constructor still draws the first frame normally, and the probe requires
`frames === 1` in that captured state. The writer saves Low through the real
settings store; the reader never switches quality to repair its initial state.

Hardware browser runs passed the focused bloom probe and the existing
light-rig, occlusion and output-stage probes. Renderer: ANGLE Metal, Apple M1
Pro. These are partial runs, not the supervisor's final full-suite receipt.
The mandatory selector reported all 93 probes because the new probe requires
a catalog entry; the worker contract reserves that full run for the supervisor.
No major changelog entry: this is quality/performance tuning under
`src/changelog.ts`'s definition.

Local gates: `npm test` — 5,521 pass, 0 fail across 300 files;
`npm run format:check`, `npm run lint`, `npm run check:wiring` and
`npm run build` — exit 0. The build includes TypeScript checking.

## Sage round 1

Game's live `bloomDefault` getter now owns the quality lookup for both
`applyQuality` and diagnostic reset. The perf panel accepts a boolean getter
and no longer imports the lighting table or quality type. The updated browser
probe failed at the old reset before this change, then passed all nine checks
on ANGLE Metal / Apple M1 Pro. Its comment says gamepad, its High override label
states that the toggle turns bloom off, and the earlier counts above now
explicitly name passing checks.

Round 1 reran the local gates listed above: 5,521 tests passed with no failures;
format, lint, wiring and build passed. The focused browser run remains partial
evidence; the supervisor owns the final full suite.

Bloom render targets remain allocated on Low to support immediate live
quality changes and diagnostic overrides. Shrinking targets would also need
to restore their size on a diagnostic override and coordinate composer resize;
this pass accepts the memory cost and keeps that behavior unchanged.

## Visual evidence pending

Two baseline attempts with `npm run views -- --quality low --label
node-752-low-before` stopped after 23 of 69 views at the existing chart
hover-clear guard in `scripts/capture-views.mjs`. Both reported:

```text
chart placer: {"index":44,"contested":4} was still labelled with the pointer off the chart
```

The after attempt (`--label node-752-low-after`) stopped at the same guard,
also after 23 of 69 views. The next view was `chart-hover-isolated` in all
three attempts. The captures used ANGLE Metal on the Apple M1 Pro.

Production code was unchanged during both baseline attempts. Both versions
were captured in this worktree at parent ref `1de4adf`; the after run includes
the uncommitted implementation described above. Partial PNGs remain in ignored
`view-set/node-752-low-before/` and `view-set/node-752-low-after/`. An explicitly
incomplete comparison is `view-set/node-752-partial.html`; no complete manifest
or canonical contact sheet was produced. The principal's visual acceptance
remains outstanding, and these partial captures do not satisfy the visual gate.

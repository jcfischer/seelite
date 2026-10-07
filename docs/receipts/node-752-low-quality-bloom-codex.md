# Node #752 — quality owns bloom

Author: Codex ranger implement worker, 2026-10-07.

`LIGHT_RIG.quality` now declares bloom on High and off on Low. The bloom pass
is constructed before `buildLights` calls the existing boot-time
`applyQuality`, so that same method applies the saved preference before frame
one and every live quality change. Its composer position, threshold, strength,
radius and resolution are unchanged. The perf panel still toggles the pass
directly; reset reads the current quality row through a live getter.

The table test failed 0/2 before implementation and passes 2/2 afterward.
`probe-quality-bloom.mjs` failed 4/9 before implementation and passes after it:
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

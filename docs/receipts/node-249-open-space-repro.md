# Node 249: the open-space frame that did not reproduce

**Answer.** The build did not move and neither did the shot. The 3.740 ms figure
came from a harness that was never committed, and no build reproduces it. #242's
own two figures reproduce exactly. They disagreed with the table for two
separate reasons, one per row:

- the table was about 2 ms high in every row;
- #242's bay control had the occlusion pair **on**, because its instrument left
  the pair to #241's gate, and the gate is open in a bay.

The bay row "agreed within 4%" because those two errors roughly cancel. The
open-space row has only the first, so it showed. That is the asymmetry the node
asked about.

The raw output of every run is in [node-249-runs.txt](node-249-runs.txt).

## Findings

**F1. 3.740 is #241's figure, not #242's, and its instrument was never
committed.** It first appears in the message of d00dc94c, the first commit of
PR #243 (node #241). That message says "six shuffled blocks of 120 frames, every
arm separating 36/36". No committed version of `measure-occlusion-cost.mjs` has
that design:

- at d00dc94c it has 12 blocks and no open-space framing;
- 33e07ba3 adds `sky-only` and says the instrument "did not have" it before;
- its shipped table runs 5 blocks.

`git grep '36/36'` and `git log --all --grep '36/36'` find only that table and
the commit that wrote it. The harness cannot be rerun, so the method behind
3.740 is not recoverable. Only the builds are.

**F2. The same PR's committed instrument already read about 1.7.** 33e07ba3's
message records its first open-space run: shipped 2.378 ms against a pinned-off
**1.710**, with the gate shut. The table written into `src/` by that same commit
says 3.740.

**F3. One instrument on two builds: they agree, and neither reproduces the
table.** `scripts/measure-open-space-repro.mjs`, byte-identical in both
checkouts, final revision (runs 3 and 4). Each cell is the median of six
120-frame blocks. Every pair-on arm separates 36/36 from its pair-off arm.

| framing | arm | 33e07ba3 (#241) | 2e3086d (#242) | #241's table | #242's figure |
|---|---|---:|---:|---:|---:|
| sky-only | pair off, 0 samples | 1.666 | 1.659 | 3.740 | — |
| sky-only | pair on, 0 samples | 3.776 | 3.758 | 7.303 | — |
| sky-only | pair off, 2x | 6.662 | 6.645 | 11.552 | — |
| sky-only | pair on, 2x | 10.815 | 10.874 | 18.681 | — |
| sky-only | **gate live**, 0 samples | 1.663 (shut) | 1.659 (shut) | — | **1.677** |
| cockpit-arrival | pair off, 0 samples | 1.728 | 1.730 | 3.784 | — |
| cockpit-arrival | gate live, 0 samples | 1.727 (shut) | 1.730 (shut) | — | 1.743 |
| berth-free-look | pair off, 0 samples | 36.864 | 36.866 | 38.861 | — |
| berth-free-look | pair on, 0 samples | 40.264 | 40.262 | 41.909 | — |
| berth-free-look | pair off, 2x | 45.830 | 45.835 | 48.025 | — |
| berth-free-look | pair on, 2x | 51.697 | 51.787 | 54.228 | — |
| berth-free-look | **gate live**, 0 samples | 40.266 (open) | 40.273 (open) | — | **40.287** |

The two builds agree to within 0.6% in every cell, and the bay to within 0.2%.
Runs 1 and 2, with the earlier two-arm revision and in the opposite build order,
read the same: 1.660 / 1.668 sky-only and 36.914 / 36.936 bay. The table's
pair-off bay, 38.861, is also high, by 2.00 ms. The drained re-measure in #241's
own instrument comment reads 37.100 and 37.113.

**F4. The asymmetry is the gate.** `measure-bay-frame-cost.mjs` "leaves every
optional term where the build puts it" (its own printed line) and never calls
`setOcclusion`. With `quality: high` and `ao: on` the gate is shut in open space
and open in the bay. #242's 1.677 is therefore a pair-off figure and its 40.287
a pair-on one. The gate-live arm reproduces both, at 1.659 and 40.273. Node
#249's statement that the gate being shut "is the same as #242 pinning the
occlusion off" is true for the open-space row and false for the bay row. The
printed settings could not show it, because the gate is not a setting.

**F5. The table's error is not one shape.** Table minus re-measure is +2.07,
+3.53, +4.89 and +7.87 ms in open space, and +2.00, +1.65, +2.20 and +2.53 in
the bay. That is neither a fixed per-frame overhead nor a fixed ratio. The
table's open-space pair-off cell (3.740) is within 1% of the re-measured
pair-on cell (3.776), but no other cell follows that pattern: the bay's pair-on
is 40.26 against the table's pair-off 38.861. So mislabelled arms are not shown.
The cause stays unattributed, because the harness is gone.

**F6. The builds between did not move the open-space frame.** 33e07ba3 predates
the merge of #235's ambient occlusion row (754d63b1). 2e3086d contains it and
#241's final thresholds. Neither moved a cell beyond 0.6%. The node's first
candidate, "the two runs are not the same build", is real: d00dc94c-era WIP
against 2e3086d. But building it made no difference. The second candidate is
out too. `scripts/lib/view-placement.mjs` is unchanged between the two builds,
so `OCCLUSION_FRAMINGS.deepSky` is one shot. The third, the warm-up, is a
property of the lost harness. The fourth, the floor, is real but does not
explain anything here: both instruments read the same floor.

## Today's build, for scale

The same file on this branch's base (5726c865, run 5): sky-only pair off
1.709 ms, pair on 3.787, at 2x 7.443 and 11.647. `cockpit-arrival` reads 2.025
pair off. The bay is pair off 10.401 and gate live 13.900. The 2x off figures
and the bay have moved since 2e3086d: the cabin has its own pass (#651), and a
frame-filling planet draws at half resolution (#211). These are why
`src/occlusion.ts`'s table is labelled as #241's build and not the current one.

## Corrected where the claim was made

- `src/occlusion.ts`: the table now holds the re-measured #241 build and says
  where the old one came from. The "57 fps keeping the AO" figure is withdrawn
  (not re-measured). The "6.9 ms at 2x / 54 fps" at `cockpit-arrival` is now
  4.3 ms (10.99 against 6.68).
- `tests/occlusion.test.ts`: the gate block's comment.
- `CLAUDE.md`: the pair's cost, which was +3.563 / +7.130 ms (differences of the
  withdrawn table), is now +2.110 / +4.152.
- `scripts/measure-occlusion-cost.mjs`: the same pair of figures in its header.
- `scripts/measure-bay-frame-cost.mjs`: its header attributed 3.740 to #242, and
  its settings comment did not say the bay control is pair-on. Both are fixed.

The qualitative claims survive. The pair more than doubles the open-space frame
(×2.27, where the table gave ×1.95). Its cost roughly doubles at 2x (+2.110 to
+4.152, ×1.97). #242's headline "ten times the open-space frame" is wrong in
both directions on one build: pair off is 36.86 against 1.67 (22×), and gate
live is 40.27 against 1.66 (24×). That headline is node prose, not repository
text, so it is reported here rather than edited.

## The other figures taken the same way

The `36/36` signature appears only in the withdrawn table and the commit that
wrote it. Every figure derived from that table has been listed above and
corrected or withdrawn.

`src/settings.ts` quotes `cockpit-arrival` at 1.85–2.03 ms without the pair, and
the pair at +2.32–2.46. Those came from the committed instrument before #241,
and they agree with this re-measure (1.73, +2.19).

The other committed timing instruments were checked for the warm-up fault #241
found:

- `measure-bay-frame-cost.mjs` and `measure-cabin-pass-cost.mjs` drain before
  the clock starts.
- `measure-light-cost.mjs` and `measure-witchspace-cost.mjs` time after one
  undrained warm frame. That puts at most one frame's queued GPU work inside a
  120-frame block, about 0.8% of the block's frame cost. Any GPU-side pipeline
  build that a setting switch triggers on that frame would add to it, and that
  part is **not measured** here.

## Not established

- What the uncommitted harness did differently. The principal's flown report of
  empty space falling from 60 fps to about 40 at 2x is not explained either. The
  withdrawn table's 18.681 ms (54 fps) sat closer to that report than the
  re-measured 10.8 ms (92 fps) does. A tight `render(0)` loop with the warm-up
  drained is not the player's frame. Nobody has measured how the two relate in
  open space.
- Whether the gate's open-space saving is the same on today's build at 2x. Run 5
  says the pair costs +4.205 ms there with the gate shut, so it is spared. It
  has not been flown.

## How the runs were made

```bash
git worktree add --detach /private/tmp/seelite-249-33e07ba3 33e07ba3
git worktree add --detach /private/tmp/seelite-249-2e3086d 2e3086d
# node_modules cloned (cp -cR); the instrument and scripts/lib/game-url.mjs copied in
npx vite --port 5241 --strictPort   # in each checkout, its own port
/usr/sbin/lsof -a -p <pid> -d cwd   # confirmed before every run
PROBE_ORIGIN=http://localhost:5241 node scripts/measure-open-space-repro.mjs
```

The load average is printed at the start of every run and every framing:
3.2–8.5 during the runs, with other agents active on the machine. No probe
lock was held during any run. Order seed 20261005.

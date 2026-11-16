# Node #637: what NPC plumes cost a frame

`scripts/measure-npc-plume-cost.mjs`, on the GPU lane: ANGLE Metal, Apple M1
Pro, headed, 1440x900 at 2x, cockpit view off the duel's raider's stern.

**Subject.** Six raider hulls drawn in both arms (the duel's raider and five
built beside it), so the difference is the plumes, not the meshes. A raider set
is one `THREE.Points` of 24 throats x (1 + `PLUME_PARTICLES`) = 264 points, one
draw call. `quiet`: every table empty. `firing`: every vent of every hull at
full level, each set rewritten every frame — the worst a table can ask. The
firing arm paints 225,899 pixels (4.36% of the frame) at least 24 codes
brighter than the quiet arm, so the arms differ on screen.

**Figures.** 12 blocks of 60 frames per arm, each block fenced by a 1x1
`readPixels`, medians and Mann-Whitney pairings:

| shuffle seed | quiet | firing | firing − quiet | per set | firing slower in |
| --- | --- | --- | --- | --- | --- |
| 637 | 4.501 ms | 4.483 ms | −0.017 ms | −0.003 ms | 79/144 |
| 637 | 4.611 ms | 4.853 ms | +0.242 ms | +0.040 ms | 97/144 |
| 638 | 4.462 ms | 4.778 ms | +0.316 ms | +0.053 ms | 110/144 |

The first run is the script before its painted-pixel readback was added; the
arms and the frames are otherwise the same.

**Load.** The machine was shared: 1-minute load 52–59 on 10 cores across the
three runs, which the script prints. The figures are an upper-bound reading
under contention, not a quiet-machine figure, and the first run's null shows
the spread is as wide as the difference.

**Reading.** Six hulls firing every vent at once cost between nothing and
about a third of a millisecond — at most about 0.05 ms a hull. A real fight
fires a fraction of a hull's vents, and only the raider and engaged Traffic
fire at all: projected Traffic is a schedule, not a Hull step, has no firing
table, and `NpcPlumes` builds no set for it.

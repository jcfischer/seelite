# Work-graph maps: the reasoning

`CLAUDE.md` says which map to read and how. This file holds the reasoning behind
the split between #1 and #460.

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

This file exists because it is **tracked**, so it is present in every git
worktree the SOP tells you to create. Per-agent memory is not: a worktree is its
own project scope and loads none of it.

# Resting pairs and in-frame carrier handoff

Node #664, Codex repair of Sage round 9, 2026-10-06.

Two touching carriers with one turning took different damage when their pair
order was reversed. The ship/world sweep exempted the swept ship's own turn
but charged its partner's. The specific resting rule in `collision.md` §3.1
resolves the ship's own turn by moving its box out; both ships now receive
that exemption. Start-of-step translation still bills, swept impacts still
read both impact-point velocities, and a moving world surface still bills its
angular motion. The resting end-velocity hold uses the same distinction:
otherwise some hulls acquired translation from a turn in only one pair order.

A courier ram also pushed a projected freighter into another projected
freighter 1 m away. Eligibility still used the original projection flags,
although the first hit had handed the struck carrier to flight (§6). Pair
eligibility now reads landed impacts. Each newly eligible unordered pair is
queued once, including further handoffs; role changes preserve ghost identity.
The final separation pass revisits earlier pairs a later correction reopened,
without replaying impacts. It freezes the world's correction before these
passes so another ship's correction cannot become a false world constraint.
The passes are bounded; this is not an exact general multi-body solver or a
claim that an impossible squeeze has a solution.

`collision-pair-resting.test.ts` checks both orders and turn signs across four
hulls, damage, velocity, final separation, a translated impact, and the world
control. `collision-handoff.test.ts` starts an isolated courier ram and checks
two/three carriers in both fleet orders, one-time impacts, an unbilled resting
neighbour retaining its route pose, and an initial-overlap ghost retaining its
exemption. The failures were reproduced before their respective corrections.
These regressions supplement the existing world-clearance and corpus rows;
they do not replace canonical browser certification or final Sage review.

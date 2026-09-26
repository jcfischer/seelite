/**
 * The page-side setup #532's instruments share: a charge to the nearest other
 * system, through the shipped course and charge.
 *
 * One copy, because the probe, the view-set placer and the cost instrument each
 * carried their own and a change to how the target is chosen would have needed
 * three edits (sage round 1 on #533). It runs inside the page, so it is
 * installed there with `page.evaluate(installChargeToNearest)` — which has to be
 * repeated after every navigation — and then called as
 * `window.__chargeToNearest()` from inside the caller's own `evaluate`.
 */
export function installChargeToNearest() {
	window.__chargeToNearest = () => {
		const g = window.__seelite;
		const here = g.world.system.record;
		const d = (a, b) =>
			Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
		const near = g.world.galaxy.systems
			.filter((s) => s.index !== here.index)
			.sort((a, b) => d(a, here) - d(b, here))[0];
		g.dropOut("witchspace");
		g.encounter = null;
		const committed = g.commitCourseTo(near.index);
		const charged = g.chargeJump();
		return {
			from: here.index,
			fromName: here.name,
			to: near.index,
			toName: near.name,
			committed,
			charged,
			notice: g.jumpNotice,
		};
	};
}

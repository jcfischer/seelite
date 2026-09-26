/**
 * The page-side setup #537's instruments share: a real cruise leg to the
 * farthest body from the start, through the shipped target and engage.
 *
 * One copy, because the probe and the view-set placer each carried their own
 * (sage round 1 on #538). It runs inside the page, so it is installed there with
 * `page.evaluate(installCruiseLeg)` — repeated after every navigation — and then
 * called as `window.__cruiseLeg({ render })` from inside the caller's own
 * `evaluate`. `render` also draws each frame, which is what runs the light
 * shift's display-side ease; a placer that holds the look does not need it.
 */
export function installCruiseLeg() {
	window.__cruiseLeg = ({ render = false } = {}) => {
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		const frame = () => {
			g.step(dt);
			if (render) g.render(dt);
		};
		g.resetFlightToStart();
		const ship = g.world.ship.pos;
		const far = g.world.system.bodies
			.filter((b) => b.kind !== "star")
			.map((b) => ({
				b,
				d: Math.hypot(b.pos.x - ship.x, b.pos.y - ship.y, b.pos.z - ship.z),
			}))
			.sort((a, b) => b.d - a.d)[0].b;
		g.targetId = far.id;
		g.faceTarget?.();
		g.engageCruise();
		for (let i = 0; i < 100 && g.regime !== "cruise"; i++) frame();
		for (let i = 0; i < 150; i++) frame();
		return { to: far.name, regime: g.regime };
	};
}

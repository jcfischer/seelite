import { resetToFixture } from "./fixture-reset.mjs";

/**
 * Remember a flight fixture after boot, with view placement/framing installed.
 * Reuse only within the same seed, hull and boot flags. This restores commander,
 * commerce, flight, docking and Traffic state; it does not replay page startup,
 * restore settings/storage or undo patched methods. Boot/load claims need a boot.
 */
export async function rememberFlightFixture(page) {
	await page.evaluate(() => window.__rememberBootPosition());
	const fixture = await page.evaluateHandle(() => {
		const g = window.__seelite;
		return {
			commander: structuredClone(g.commander),
			commerceWorld: g.commerceWorld,
			view: g.view,
		};
	});
	return async () => {
		await page.evaluate((initial) => {
			const g = window.__seelite;
			g.commander = structuredClone(initial.commander);
			g.commerceWorld = initial.commerceWorld;
			g.resetDock();
			g.clearSystemScopedState();
			g.resetFlightToStart();
			g.trafficSystemIndex = -1;
			g.ensureTrafficActors();
			g.view = initial.view;
			g.setHeadLook("forward");
		}, fixture);
		await resetToFixture(page, 0);
	};
}

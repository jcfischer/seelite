/** Node #754: read the canonical placer's actual camera facts in the live page. */
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { assertHorizonFacts } from "./lib/horizon-framing.mjs";
import { SEED, VIEWPORT, VIEWS } from "./lib/view-set.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const passes = (fn) => {
	try {
		fn();
		return true;
	} catch {
		return false;
	}
};
try {
	const page = await browser.newPage({ viewport: VIEWPORT });
	watch(page);
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
	await bootedGame(page);
	for (const view of VIEWS.filter((v) => v.shot.kind === "horizon")) {
		const placed = await page.evaluate(
			(s) => window.__horizonView(s),
			view.shot,
		);
		// Read again after settling. The shot holds the simulation while the
		// frame loop draws, so camera and orbit facts must survive to the shutter.
		await page.evaluate(
			() =>
				new Promise((r) =>
					requestAnimationFrame(() => requestAnimationFrame(r)),
				),
		);
		const measured = await page.evaluate(
			(s) => window.__measureHorizon(s),
			view.shot,
		);
		const valid = passes(() => {
			assertHorizonFacts(placed, view.shot);
			assertHorizonFacts(measured, view.shot);
		});
		check(
			`${view.name}: measured limb 20–45%, sun elevation 0–20°, and subject framing`,
			valid,
			JSON.stringify({ placed, measured }),
		);
		if (!view.shot.station) {
			// Keep the eye and attitude fixed, but move only the hull inside the
			// approach shell. The camera facts alone must not accept this pose.
			const unreachable = await page.evaluate((s) => {
				const g = window.__seelite;
				const body = window.__bodyById(s.body);
				const pos = { ...g.world.ship.pos };
				const cameraPos = g.cameraPos;
				const eye = g.cameraPos();
				try {
					g.cameraPos = () => eye;
					g.world.ship.pos = {
						x: body.pos.x + (pos.x - body.pos.x) * 0.99,
						y: body.pos.y + (pos.y - body.pos.y) * 0.99,
						z: body.pos.z + (pos.z - body.pos.z) * 0.99,
					};
					return window.__measureHorizon(s);
				} finally {
					g.cameraPos = cameraPos;
					g.world.ship.pos = pos;
				}
			}, view.shot);
			check(
				"planet-boundary: an unreachable hull is refused even with a correctly framed eye",
				!passes(() => assertHorizonFacts(unreachable, view.shot)),
				JSON.stringify(unreachable),
			);
		}
		// Negative control: aim at the body's centre and ask the same page reader.
		// A reader echoing the requested 32% would let this broken framing pass.
		const misAimed = await page.evaluate((s) => {
			const g = window.__seelite;
			const body = window.__bodyById(s.body);
			const p = g.cameraPos();
			const direction = g.nearScene.position
				.clone()
				.set(body.pos.x - p.x, body.pos.y - p.y, body.pos.z - p.z)
				.normalize();
			g.orientation.setFromUnitVectors(
				g.nearScene.position.clone().set(0, 0, -1),
				direction,
			);
			g.render(0);
			return window.__measureHorizon(s);
		}, view.shot);
		const refused = !passes(() => assertHorizonFacts(misAimed, view.shot));
		check(
			`${view.name}: a centre aim is refused by the actual camera readback`,
			refused,
			JSON.stringify(misAimed),
		);
	}
} finally {
	await browser.close();
}
exit();

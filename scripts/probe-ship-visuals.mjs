/** Prove the live renderer exposes #35's hull identity only where it is useful:
 * chase view. Cockpit remains the instrument-first flight view. */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const VIEWPORTS = [
	{ name: "desktop", width: 1280, height: 760 },
	{ name: "narrow", width: 390, height: 844 },
];

// `main.ts` has the numeric render constants probe-guard fingerprints. The hull
// module deliberately exposes no tuning literals: its named live geometry is
// asserted below, which is a more direct check than inventing a sentinel number.
await guardedOrigin(ORIGIN, ["src/main.ts"]);
const browser = await launchChromium();
const { check, exit } = tally();

function state() {
	const game = window.__seelite;
	const ship = game.shipMesh;
	const cockpit = document.querySelector("[data-live-cockpit]");
	return {
		view: game.view,
		shipVisible: ship.visible,
		hullId: ship.userData.hullId,
		variant: ship.userData.variant,
		chaseYaw: game.chaseYaw,
		// The near camera sits at the origin, so the hull's own position is the
		// camera-relative one. That makes it the honest observable for an orbit:
		// a camera swinging round the ship must turn this vector without
		// changing its length.
		shipOffset: ship.position.toArray(),
		courierCore: Boolean(ship.getObjectByName("courier-dorsal-hull")),
		exhausts: ship.children.filter((child) => child.name.includes("exhaust"))
			.length,
		// Chase shows the player's hull and nothing else. The count is asserted
		// rather than the absence of two old names, so a future extra hull
		// parented here has to be a deliberate change to this line.
		hulls: game.nearScene.children.filter(
			(child) => child.userData.hullId !== undefined,
		).length,
		liveCockpit:
			cockpit instanceof HTMLElement &&
			getComputedStyle(cockpit).display !== "none",
		physicalCockpit:
			Boolean(game.nearScene.getObjectByName("cockpit")?.visible) &&
			["flight-instrument", "target-instrument", "scanner"].every((name) =>
				Boolean(game.nearScene.getObjectByName(name)),
			),
		duplicateDomFloor: Boolean(document.querySelector("[data-live-floor]")),
	};
}

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
	page.on("pageerror", (error) =>
		check(`${viewport.name}: no page error (${error.message})`, false),
	);
	await page.goto(`${ORIGIN}/?seed=42`, { waitUntil: "load" });
	await page.waitForFunction(() => window.__seelite?.frames > 1);
	const cockpit = await page.evaluate(state);
	check(
		`${viewport.name}: cockpit keeps the hull out of the flight view`,
		cockpit.view === "cockpit" &&
			!cockpit.shipVisible &&
			cockpit.liveCockpit &&
			cockpit.physicalCockpit &&
			!cockpit.duplicateDomFloor,
	);
	await page.keyboard.press("v");
	await page.waitForFunction(() => window.__seelite?.view === "chase");
	const chase = await page.evaluate(state);
	check(
		`${viewport.name}: chase exposes the named courier silhouette`,
		chase.view === "chase" &&
			chase.shipVisible &&
			chase.hullId === "courier" &&
			chase.variant === "a" &&
			chase.courierCore &&
			chase.exhausts === 2 &&
			chase.hulls === 1 &&
			!chase.liveCockpit,
	);
	// Orbit to port and hold until the camera has swung a good part of a
	// quarter turn, rather than sleeping for a guessed number of frames.
	await page.keyboard.down("1");
	const orbitMoved = await page
		.waitForFunction(() => window.__seelite?.chaseYaw < -0.6, null, {
			timeout: 4000,
		})
		.then(
			() => true,
			() => false,
		);
	await page.keyboard.up("1");
	const orbited = await page.evaluate(state);
	const length = (v) => Math.hypot(v[0], v[1], v[2]);
	const alignment =
		orbited.shipOffset.reduce((sum, n, i) => sum + n * chase.shipOffset[i], 0) /
		(length(orbited.shipOffset) * length(chase.shipOffset));
	check(
		`${viewport.name}: chase orbit turns the camera round the hull at a fixed range`,
		orbitMoved &&
			orbited.view === "chase" &&
			orbited.shipVisible &&
			orbited.chaseYaw < -0.6 &&
			alignment < 0.95 &&
			Math.abs(length(orbited.shipOffset) - length(chase.shipOffset)) < 1e-6,
	);

	await page.keyboard.press("2");
	const centred = await page.evaluate(state);
	check(
		`${viewport.name}: 2 returns the chase camera astern`,
		centred.chaseYaw === 0 &&
			centred.shipOffset.every(
				(n, i) => Math.abs(n - chase.shipOffset[i]) < 1e-6,
			),
	);

	await page.keyboard.press("v");
	await page.waitForFunction(() => window.__seelite?.view === "cockpit");
	// The orbit is a chase control. Holding it in the cockpit must not quietly
	// steer a camera the player cannot see moving.
	await page.keyboard.down("1");
	await page.waitForTimeout(220);
	await page.keyboard.up("1");
	const returned = await page.evaluate(state);
	check(
		`${viewport.name}: the orbit key does not move the camera in cockpit view`,
		returned.chaseYaw === 0,
	);
	check(
		`${viewport.name}: returning to cockpit restores instrument priority`,
		returned.view === "cockpit" &&
			!returned.shipVisible &&
			returned.liveCockpit &&
			returned.physicalCockpit &&
			!returned.duplicateDomFloor,
	);
	await page.close();
}

await browser.close();
exit();

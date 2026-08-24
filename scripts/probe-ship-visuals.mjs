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
		courierCore: Boolean(ship.getObjectByName("courier-core")),
		exhausts: ship.children.filter((child) => child.name.includes("exhaust"))
			.length,
		trafficDisplayOnly:
			ship.getObjectByName("visual-traffic")?.userData.displayOnly === true,
		interceptor: Boolean(ship.getObjectByName("traffic-interceptor")),
		freighter: Boolean(ship.getObjectByName("traffic-freighter")),
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
			chase.courierCore &&
			chase.exhausts === 2 &&
			chase.trafficDisplayOnly &&
			chase.interceptor &&
			chase.freighter &&
			!chase.liveCockpit,
	);
	await page.keyboard.press("v");
	await page.waitForFunction(() => window.__seelite?.view === "cockpit");
	const returned = await page.evaluate(state);
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

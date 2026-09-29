/**
 * Node 583 (and 584). The Shipyard tab in a running game: the rows a shipyard
 * prints, a press that buys a hull, the flown hull following the purchase
 * mid-session, a hull delivered at the launch crossing, and a reload that
 * flies the saved hull whatever `?hull=` says.
 *
 * Headless rows own the arithmetic (`tests/hull-sale.test.ts`,
 * `tests/flown-hull.test.ts`); this owns what only the page can show — that
 * the rendered row is the offer, that the press reaches the till, and that
 * the mesh, handling, condition and berth all follow the hull that was bought.
 *
 * Every figure is read off the page's own modules, never restated here.
 */
import { mkdirSync } from "node:fs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const origin = process.env.PROBE_ORIGIN ?? "http://127.0.0.1:5343";
const out = process.env.SHIPYARD_EVIDENCE ?? "/tmp/seelite-583-evidence";
const headed = process.env.HEADED === "1";
mkdirSync(out, { recursive: true });
await guardedOrigin(origin);
const browser = await launchChromium({ headless: !headed });
const t = tally();
let passed = 0;
const check = (name, ok, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
	if (!ok) throw new Error(name);
	passed += 1;
};
// Seed 2's start system has a shipyard. **Not a pinned `?system=`**, which
// `probe-ladders` uses: a pinned system writes no save (§11.6, #432), and the
// reload arm below needs the purchase saved.
const SEED = 2;

/** The flown hull as every consumer sees it, read off the page. */
const flownState = (page) =>
	page.evaluate(async () => {
		const g = window.__seelite;
		const H = await import("/src/hull.ts");
		const S = await import("/src/sim.ts");
		const id = g.playerHull.id;
		const perf = S.flightPerformance(id);
		return {
			id,
			commanderHull: g.commander.hull,
			meshHull: g.shipMesh.userData.hullId,
			meshName: g.shipMesh.name,
			meshInScene: g.shipMesh.parent !== null,
			shipRows: g.markedOcclusion.filter(([name]) => name === "ship").length,
			performanceMatches:
				JSON.stringify(g.playerHull.performance) === JSON.stringify(perf),
			// The hull term, not the whole record: energy, heat and the struck
			// clock are stepped every frame, so they never equal a fresh one.
			conditionIsWhole:
				g.condition.hullMax === H.HULL_SPECS[id].integrity &&
				g.condition.hull === g.condition.hullMax,
			envelopeMatches:
				JSON.stringify(g.flownEnvelope) ===
				JSON.stringify(H.HULL_SPECS[id].env),
			chargeAu: g.chargeAu,
			fuelLy: g.commander.fuelLy,
			phase: g.dockPhase,
			berthId: g.dock.berthId,
		};
	});

const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
});
const warnings = [];
try {
	const page = await context.newPage();
	t.watchShaders(page, "shipyard");
	page.on("pageerror", (e) => {
		throw e;
	});
	page.on("console", (msg) => {
		if (msg.type() === "warning") warnings.push(msg.text());
	});
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: SEED }), {
		waitUntil: "load",
	});
	await bootedGame(page);

	// -------------------------------------------------------------------
	// Docked at a shipyard: the tab, and one reason per row.
	// -------------------------------------------------------------------
	const yard = await page.evaluate(async () => {
		const g = window.__seelite;
		const id = g.world.system.bodies.find(
			(b) => b.kind === "station" && b.stationType === "shipyard",
		)?.id;
		if (!id) throw Error("no shipyard in this system");
		await window.__parkInBerth(id, g.berthIdsOfStation(id)[0]);
		g.setHeadLook("forward");
		g.updateCockpit();
		return { id, phase: g.dock.phase, hull: g.playerHull.id };
	});
	check("the ship is docked at the shipyard", yard.phase === "docked", yard.id);
	const before = await flownState(page);
	check(
		"a fresh game with no ?hull= flies the baseline, and every consumer agrees",
		before.id === "courier" &&
			before.meshHull === "courier" &&
			before.commanderHull === "courier" &&
			before.performanceMatches &&
			before.envelopeMatches,
		JSON.stringify(before),
	);
	await page.locator('[data-live-station-tab="Shipyard"]').click();
	const rows = await page.evaluate(async () => {
		const H = await import("/src/hull.ts");
		const R = await import("/src/hull-reach.ts");
		const g = window.__seelite;
		return {
			purchasable: [...H.PURCHASABLE_HULL_IDS],
			rows: [...document.querySelectorAll("[data-live-hull-row]")].map(
				(row) => ({
					hull: row.getAttribute("data-live-hull-row"),
					reason: row.getAttribute("data-live-hull-reason"),
					note: row.querySelector("[data-live-hull-note]")?.textContent ?? "",
					buy:
						row.querySelector('[data-live-station-action="buy-hull"]') !== null,
					reach: R.hullReachFrom(
						g.world.galaxy.systems,
						g.world.system.record,
						row.getAttribute("data-live-hull-row"),
					),
				}),
			),
		};
	});
	check(
		"the Shipyard tab lists every purchasable hull, in roster order",
		JSON.stringify(rows.rows.map((r) => r.hull)) ===
			JSON.stringify(rows.purchasable),
		rows.rows.map((r) => r.hull).join(","),
	);
	const flown = rows.rows.find((r) => r.hull === "courier");
	check(
		"the flown hull's row says so and draws no BUY",
		flown?.reason === "hull-owned" && !flown.buy,
		JSON.stringify(flown),
	);
	const locked = rows.rows.find((r) => r.hull === "interceptor");
	const gate = await page.evaluate(async () => {
		const L = await import("/src/ladder.ts");
		const gate = L.gateOf("interceptor");
		return `${gate.ladder.toUpperCase()} ${gate.rung} · ${L.RUNG_NAMES[gate.ladder][gate.rung].toUpperCase()}`;
	});
	check(
		"on a new game's rungs a gated hull is locked, naming its ladder and rung, with no BUY",
		locked?.reason === "hull-locked" && locked.note === gate && !locked.buy,
		JSON.stringify(locked),
	);
	check(
		"no row is refused for reach here, and the check is not empty",
		rows.rows.length === 7 && rows.rows.every((r) => r.reach.ok),
		rows.rows.map((r) => `${r.hull}:${r.reach.systems}`).join(","),
	);
	await page.screenshot({ path: `${out}/00-shipyard-new-game.png` });

	// -------------------------------------------------------------------
	// Open the rungs, fund the pilot, fill the hold: every row open.
	// -------------------------------------------------------------------
	await page.evaluate(async () => {
		const L = await import("/src/ladder.ts");
		const g = window.__seelite;
		const banked = Object.fromEntries(
			L.LADDERS.map((l) => [l, L.threshold(l, L.TOP_RUNG)]),
		);
		g.ladders = { ...g.ladders, banked };
		g.commander = {
			...g.commander,
			credits: 100_000,
			cargo: { Food: 20 },
		};
		g.stationConsoleRevision += 1;
		g.updateCockpit();
	});
	const open = await page.evaluate(async () => {
		const R = await import("/src/hull-reach.ts");
		const g = window.__seelite;
		return [...document.querySelectorAll("[data-live-hull-row]")].map((row) => {
			const hull = row.getAttribute("data-live-hull-row");
			const reach = R.hullReachFrom(
				g.world.galaxy.systems,
				g.world.system.record,
				hull,
			);
			return {
				hull,
				reason: row.getAttribute("data-live-hull-reason"),
				note: row.querySelector("[data-live-hull-note]")?.textContent ?? "",
				systems: reach.ok ? reach.systems : 0,
			};
		});
	});
	const others = open.filter((r) => r.hull !== "courier");
	check(
		"at the top rungs every other row is open and prints its reach from here, read from hullReachFrom",
		others.length === 6 &&
			others.every(
				(r) =>
					r.reason === "" &&
					r.note.startsWith(
						`REACHES ${r.systems} SYSTEM${r.systems === 1 ? "" : "S"}`,
					),
			),
		others.map((r) => `${r.hull}:${r.note}`).join(" | "),
	);
	const interceptorNote =
		open.find((r) => r.hull === "interceptor")?.note ?? "";
	check(
		"a hull with a smaller hold says what it will sell",
		interceptorNote.includes("SELLS 12 t"),
		interceptorNote,
	);
	const tradeIn = await page.locator("[data-live-hull-trade-in]").innerText();
	check(
		"the trade-in line names the flown hull and its 90%",
		tradeIn.includes("COURIER") && tradeIn.includes("31,500 Cr"),
		tradeIn,
	);
	await page.screenshot({ path: `${out}/01-shipyard-open.png` });

	// -------------------------------------------------------------------
	// A press buys it, and the ship becomes it.
	// -------------------------------------------------------------------
	// Damage the courier first, so a whole condition afterwards is the
	// purchase resetting it rather than a ship that was never struck.
	const purse = await page.evaluate(() => {
		const g = window.__seelite;
		g.condition = { ...g.condition, hull: 10 };
		return g.commander.credits;
	});
	await page
		.locator(
			'[data-live-hull-row="interceptor"] [data-live-station-action="buy-hull"]',
		)
		.click();
	const bought = await flownState(page);
	const expected = await page.evaluate(async () => {
		const H = await import("/src/hull.ts");
		return {
			charge: H.HULL_SPECS.interceptor.chargeAu,
			tank: H.HULL_SPECS.interceptor.tankLy,
			hold: H.HULL_SPECS.interceptor.holdT,
		};
	});
	const after = await page.evaluate(() => ({
		credits: window.__seelite.commander.credits,
		cargo: window.__seelite.commander.cargo,
		trade: window.__seelite.ladders.banked.trade,
	}));
	check(
		"the press bought the interceptor and the commander owns it",
		bought.commanderHull === "interceptor" && bought.id === "interceptor",
		JSON.stringify(bought),
	);
	check(
		"the mesh was rebuilt as the interceptor, in the scene, with one occlusion row",
		bought.meshHull === "interceptor" &&
			bought.meshName === "ship" &&
			bought.meshInScene &&
			bought.shipRows === 1,
		JSON.stringify(bought),
	);
	check(
		"handling, envelope and a whole condition follow the new hull",
		bought.performanceMatches &&
			bought.envelopeMatches &&
			bought.conditionIsWhole,
		JSON.stringify(bought),
	);
	check(
		"the charge is the new hull's full charge and the tank clamps to it",
		bought.chargeAu === expected.charge && bought.fuelLy <= expected.tank,
		`${bought.chargeAu} AU · ${bought.fuelLy} LY`,
	);
	check(
		"it stays in the berth it was bought in (D7: it fits)",
		bought.phase === "docked" && bought.berthId === before.berthId,
		`${before.berthId} → ${bought.berthId}`,
	);
	check(
		"the overflow was sold through the till and the shipyard paid the difference",
		after.cargo.Food === expected.hold && after.credits > purse + 11_500,
		`${purse} → ${after.credits} Cr · ${JSON.stringify(after.cargo)}`,
	);
	const rowNow = await page
		.locator('[data-live-hull-row="interceptor"]')
		.getAttribute("data-live-hull-reason");
	check(
		"the tab repriced: the interceptor row is now the flown one",
		rowNow === "hull-owned",
		rowNow ?? "",
	);
	await page.screenshot({ path: `${out}/02-bought-interceptor.png` });

	// -------------------------------------------------------------------
	// D10: a hull waiting for the launch takes over at the crossing.
	// No berth refuses a purchasable hull today, so the wait is set directly;
	// what this measures is the launch hook, and `deliverHull`'s choice of it
	// is `tests/flown-hull.test.ts`'s.
	// -------------------------------------------------------------------
	const waiting = await page.evaluate(() => {
		const g = window.__seelite;
		g.commander = { ...g.commander, hull: "explorer" };
		g.hullOnLaunch = "explorer";
		g.setHeadLook("forward");
		g.launch();
		const onRails = { phase: g.dockPhase, id: g.playerHull.id };
		for (let i = 0; i < 600 && g.dockPhase !== "flying"; i++) {
			g.skipDockTraversal();
			g.step(1 / 60);
		}
		return { onRails, flying: g.dockPhase, pending: g.hullOnLaunch };
	});
	const delivered = await flownState(page);
	check(
		"the launch flies out as the old hull",
		waiting.onRails.phase === "launching" &&
			waiting.onRails.id === "interceptor",
		JSON.stringify(waiting.onRails),
	);
	check(
		"and the waiting hull takes over at the crossing, mesh and all",
		waiting.flying === "flying" &&
			waiting.pending === null &&
			delivered.id === "explorer" &&
			delivered.meshHull === "explorer" &&
			delivered.shipRows === 1,
		JSON.stringify({ waiting, delivered }),
	);

	// -------------------------------------------------------------------
	// #584: a reload flies the saved hull, and ?hull= is reported, not obeyed.
	// -------------------------------------------------------------------
	await page.evaluate(() => {
		const g = window.__seelite;
		g.saveStore?.markDirty();
		g.saveFlush("dock");
	});
	await page.evaluate(() => window.__seelite.saveStore?.settled());
	const savedHull = await page.evaluate(
		() => window.__seelite.saveEnvelope().commander.state.hull,
	);
	check("the save records the explorer", savedHull === "explorer", savedHull);
	await page.close();
	warnings.length = 0;
	const reloaded = await context.newPage();
	t.watchShaders(reloaded, "shipyard-reload");
	reloaded.on("console", (msg) => {
		if (msg.type() === "warning") warnings.push(msg.text());
	});
	await reloaded.goto(gameUrl(origin, { seed: SEED, hull: "courier" }), {
		waitUntil: "load",
	});
	await bootedGame(reloaded);
	const loaded = await flownState(reloaded);
	check(
		"a loaded Commander flies its saved hull over a conflicting ?hull=",
		loaded.id === "explorer" &&
			loaded.commanderHull === "explorer" &&
			loaded.meshHull === "explorer" &&
			loaded.performanceMatches &&
			loaded.envelopeMatches &&
			loaded.conditionIsWhole,
		JSON.stringify(loaded),
	);
	check(
		"and says the URL was ignored",
		warnings.some((w) => w.includes("?hull=courier") && w.includes("explorer")),
		warnings.join(" | "),
	);
	await reloaded.close();

	// A fresh game still honours ?hull= — the affordance's own purpose.
	const fresh = await context.newPage();
	t.watchShaders(fresh, "shipyard-fresh");
	await fresh.goto(
		gameUrl(origin, { seed: SEED, hull: "freighter", "no-save": true }),
		{ waitUntil: "load" },
	);
	await bootedGame(fresh);
	const freshState = await flownState(fresh);
	check(
		"a fresh game flies a valid ?hull=, and every consumer agrees",
		freshState.id === "freighter" &&
			freshState.meshHull === "freighter" &&
			freshState.commanderHull === "freighter" &&
			freshState.performanceMatches,
		JSON.stringify(freshState),
	);
	await fresh.close();
} finally {
	await context.close();
	await browser.close();
}
// `check` throws, so reaching here means every one passed; `watchShaders` is
// what is left to read.
console.log(`\n${passed}/${passed} checks passed · captures in ${out}`);
if (t.failures) process.exit(1);

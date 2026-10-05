/**
 * Node 696, #473's ruling on the live Market tab: `MAX` on a capped shelf and
 * a HELD column, with the per-good list taken off the Market tab's bottom line.
 *
 * Every assertion about the tab reads rendered text or a rendered attribute.
 * The cap and the hover sentence are read off the page's own modules rather
 * than restated here, because #689 may move the cap and a probe carrying its
 * own 63 would go falsely red when it does.
 *
 * Four checks are setup gates — the dock phase, a tonne good with two or more
 * on its shelf, a job posting entrusted cargo, and that consignment aboard —
 * and each reads the thing it gates.
 */
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
const headed = process.env.HEADED === "1";
await guardedOrigin(origin);
const browser = await launchChromium({ headless: !headed });
const t = tally();
let passed = 0;
const check = (name, ok, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
	if (!ok) throw new Error(name);
	passed += 1;
};
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	t.watchShaders(page, "market-shelf");
	page.on("pageerror", (e) => {
		throw e;
	});
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: 42 }), { waitUntil: "load" });
	await bootedGame(page);

	const station = await page.evaluate(async () => {
		const g = window.__seelite;
		const id =
			g.world.system.bodies.find(
				(b) => b.kind === "station" && b.stationType === "trade",
			)?.id ?? g.world.system.bodies.find((b) => b.kind === "station")?.id;
		if (!id) throw Error("no station");
		await window.__parkInBerth(id, g.berthIdsOfStation(id)[0]);
		g.setHeadLook("forward");
		g.updateCockpit();
		return id;
	});
	const dockPhase = await page.evaluate(() => window.__seelite.dock.phase);
	check(
		"the ship is docked with the station console up",
		dockPhase === "docked" &&
			(await page.locator("[data-live-station-console]").isVisible()),
		`${station} · ${dockPhase}`,
	);
	await page.locator('[data-live-station-tab="Market"]').click();

	// The page's own figures: the cap and the sentence built from it.
	const rule = await page.evaluate(async () => {
		const { QUANTITY_CAP } = await import("/src/market.ts");
		const { SHELF_MAX_MARK, SHELF_MAX_TITLE } = await import(
			"/src/station-console.ts"
		);
		return { cap: QUANTITY_CAP, mark: SHELF_MAX_MARK, title: SHELF_MAX_TITLE };
	});

	/** Every listed row as the glass draws it. */
	const readRows = () =>
		page.evaluate(() =>
			[...document.querySelectorAll("[data-live-market-row]")].map((row) => {
				const shelf = row.querySelector("[data-live-shelf]");
				const mark = row.querySelector("[data-live-shelf-max]");
				const held = row.querySelector("[data-live-held]");
				return {
					name: row.getAttribute("data-live-market-row"),
					listed: row.getAttribute("data-live-listed") === "true",
					count: shelf?.firstChild?.textContent ?? null,
					shelf: shelf?.textContent ?? null,
					mark: mark?.textContent ?? null,
					title: mark?.getAttribute("title") ?? null,
					held: held?.textContent ?? null,
				};
			}),
		);

	// ---------------------------------------------------------------------
	// MAX: on a capped shelf, with its hover text, and nowhere else.
	// ---------------------------------------------------------------------
	const rows = await readRows();
	const capped = rows.filter((row) => row.mark !== null);
	const gold = rows.find((row) => row.name === "Gold");
	// Gold's generated quantity is always the cap (#473 D2), so with no trade
	// at this station it is the row that must carry the mark.
	check(
		"an untraded Gold row reads its count, then MAX",
		gold?.listed === true &&
			gold.count === `${rule.cap} kg` &&
			gold.shelf?.startsWith(`${rule.cap} kg ${rule.mark}`) === true &&
			gold.mark?.trim() === rule.mark,
		JSON.stringify(gold),
	);
	check(
		"the MAX mark carries the hover text, with the cap read off QUANTITY_CAP",
		gold?.title === rule.title && rule.title.includes(`${rule.cap}-unit`),
		`${gold?.title} || ${rule.title}`,
	);
	// Keyed on the count and nothing else: every marked row reads the cap, and
	// no listed row at the cap goes unmarked.
	const misplaced = rows.filter(
		(row) =>
			row.listed &&
			(row.mark !== null) !== (row.count?.startsWith(`${rule.cap} `) ?? false),
	);
	check(
		"MAX is on exactly the rows whose shelf reads the cap",
		capped.length > 0 && misplaced.length === 0,
		`marked ${capped.map((row) => row.name).join(", ")} · misplaced ${JSON.stringify(misplaced)}`,
	);

	// ---------------------------------------------------------------------
	// HELD: blank with nothing aboard, the units after a real buy.
	// ---------------------------------------------------------------------
	check(
		"with an empty hold every HELD cell is drawn and blank",
		rows.length === 17 && rows.every((row) => row.held === ""),
		JSON.stringify(rows.filter((row) => row.held !== "")),
	);
	const header = await page
		.locator("[data-live-station-market] .lc-station-head")
		.innerText();
	check(
		"the header reads GOOD BUY SELL SHELF HELD ACTION",
		/^GOOD\s+BUY\s+SELL\s+SHELF\s+HELD\s+ACTION$/.test(header.trim()),
		header,
	);

	const mine = await page.evaluate(() => {
		const row = [...document.querySelectorAll("[data-live-market-row]")].find(
			(el) =>
				el.getAttribute("data-live-listed") === "true" &&
				el.querySelector('[data-live-station-action="buy-commodity"]') &&
				// Two buys follow, so the shelf must hold at least two: a 1 t
				// shelf would refuse the second for a setup reason.
				Number(
					/^(\d+)\s*t\b/.exec(
						el.querySelector("[data-live-shelf]")?.textContent ?? "",
					)?.[1] ?? 0,
				) >= 2,
		);
		const good = row?.getAttribute("data-live-market-row") ?? null;
		if (!good) return null;
		window.__seelite.commander.credits = 100_000;
		window.__seelite.stationConsoleRevision += 1;
		window.__seelite.updateCockpit();
		return good;
	});
	check(
		"a tonne good with two or more on the shelf is on the board to buy",
		mine !== null,
	);
	const buy = page.locator(
		`[data-live-station-action="buy-commodity"][data-live-station-name="${mine}"]`,
	);
	await buy.click();
	await buy.click();
	const afterBuy = await readRows();
	const bought = afterBuy.find((row) => row.name === mine);
	check(
		"after two bought tonnes the good's HELD cell reads 2 t",
		bought?.held === "2 t",
		JSON.stringify(bought),
	);
	check(
		"every other HELD cell stays blank",
		afterBuy.every((row) => row.name === mine || row.held === ""),
		JSON.stringify(afterBuy.filter((row) => row.name !== mine && row.held)),
	);

	// ---------------------------------------------------------------------
	// The bottom line: credits only on Market, the whole line elsewhere.
	// Read with cargo aboard, which is the state where the list would show.
	// ---------------------------------------------------------------------
	const marketLine = (
		await page.locator("[data-live-commander]").innerText()
	).trim();
	check(
		"the Market tab's bottom line is the credits and no per-good list",
		/^\d+\.\d Cr$/.test(marketLine) && !marketLine.includes(mine),
		marketLine,
	);
	await page.locator('[data-live-station-tab="Equipment"]').click();
	const equipmentLine = (
		await page.locator("[data-live-commander]").innerText()
	).trim();
	check(
		"the Equipment tab keeps the whole line, goods included",
		new RegExp(`^\\d+\\.\\d Cr · HOLD .*${mine} 2\\b`).test(equipmentLine),
		equipmentLine,
	);

	// ---------------------------------------------------------------------
	// A consignment aboard: dropping the Market tab's per-good list hides
	// nothing entrusted. The list never carried a job's lot; the hold line
	// above the rows carries its tonnes, on Market as on every tab.
	// ---------------------------------------------------------------------
	await page.locator('[data-live-station-tab="Requests"]').click();
	const offerId = await page.evaluate(
		() =>
			window.__seelite.requestsView().offers.find((o) => o.operand?.entrusted)
				?.id ?? null,
	);
	check("the board posts a job with entrusted cargo", offerId !== null);
	await page
		.locator(
			`[data-live-station-console] [data-live-request-action="details"][data-live-request-id="${offerId}"]`,
		)
		.click();
	await page
		.locator('[data-live-station-console] [data-live-request-action="accept"]')
		.click();
	const entrustedT = await page.evaluate(() =>
		Object.values(
			window.__seelite.commanderRecord().requests.entrustedByLotId,
		).reduce((sum, lot) => sum + lot.aboardT, 0),
	);
	check("the consignment is aboard", entrustedT > 0, `${entrustedT} t`);
	await page.locator('[data-live-station-tab="Market"]').click();
	const holdLine = (
		await page.locator("[data-live-station-hold]").innerText()
	).trim();
	check(
		"on Market the hold line says a job's cargo is aboard",
		holdLine.includes(`${entrustedT} t entrusted`),
		holdLine,
	);
	const withLot = await readRows();
	check(
		"the consignment moves no HELD cell: it is the requester's, not the pilot's",
		withLot.every(
			(row) => row.held === afterBuy.find((r) => r.name === row.name)?.held,
		),
		JSON.stringify(withLot.filter((row) => row.held)),
	);
	const lotLine = (
		await page.locator("[data-live-commander]").innerText()
	).trim();
	check(
		"with a consignment aboard the Market bottom line is still the credits",
		/^\d+\.\d Cr$/.test(lotLine),
		lotLine,
	);

	await page.close();
} finally {
	await browser.close();
}
// `check` throws, so reaching here means every check passed; a shader that
// fails to link is a `console.error`, and `watchShaders` is what counts it.
console.log(`\n${passed}/${passed} checks passed`);
if (t.failures) process.exit(1);

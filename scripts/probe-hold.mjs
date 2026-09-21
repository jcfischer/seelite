/**
 * Node 445. The Hold page on the right-hand console, flown in both states.
 *
 * The hold was the one thing a pilot has to reason about that no screen
 * showed, and #411 made that sharper by putting an 8 t consignment in it that
 * cannot be sold and could not be seen. #443 put a line on the trade screen
 * and #446 put ownership into the words on a control; this is the full
 * hold page, and it has to be readable **away from a station** as well as at
 * one — which is why it lives on the flight console rather than the station's.
 *
 * Every assertion **about the page** reads rendered text, not a state object
 * (#411 round 3). Three checks are setup gates rather than claims about the
 * page — the dock phase, the offer the board named, and that there is a tonne
 * good with a shelf to buy — and each reads the thing it gates rather than a
 * proxy for it.
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
// The screenshots this writes are the node's third tier — a person reads them
// and says yes or no — so the path is named here and in the PR, and
// `HOLD_EVIDENCE` overrides it for a run whose captures have to go elsewhere.
const out = process.env.HOLD_EVIDENCE ?? "/tmp/seelite-445-evidence";
const headed = process.env.HEADED === "1";
mkdirSync(out, { recursive: true });
await guardedOrigin(origin);
const browser = await launchChromium({ headless: !headed });
const t = tally();
// **A counter, not a list.** `check` throws, so every entry it could hold
// would be `ok: true` and nothing reads the rest — dead state a reader has to
// rule out.
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
	t.watchShaders(page, "hold");
	page.on("pageerror", (e) => {
		throw e;
	});
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: 42 }), { waitUntil: "load" });
	await bootedGame(page);

	/** Turn the head and open the page. The right console is `display: none`
	 *  until the head is turned, so a probe that only clicked the tab would be
	 *  reading a hidden element (#405's two-surfaces lesson). */
	const openHold = async () => {
		await page.evaluate(() => window.__seelite.setHeadLook("right"));
		await page.evaluate(() => {
			const tab = document.querySelector('[data-live-right-tab="Hold"]');
			if (!(tab instanceof HTMLElement)) throw new Error("no Hold tab");
			tab.click();
		});
	};
	const holdText = (selector) =>
		page.locator(`[data-live-panel="right"] ${selector}`).innerText();

	// ---------------------------------------------------------------------
	// In flight: the page is readable, and the value column is honest.
	// ---------------------------------------------------------------------
	await openHold();
	check(
		"the Hold page is on the right console and visible with the head turned",
		await page.locator("[data-live-hold]").isVisible(),
	);
	// One read, tested twice and reported from the same read: three CDP
	// round-trips read three separately re-rendered pages.
	const emptyLine = await holdText("[data-live-hold-empty]");
	check(
		"an empty hold is a sentence and still says the capacity",
		/nothing aboard/i.test(emptyLine) && /\d+ t/.test(emptyLine),
		emptyLine,
	);
	const capacityInFlight = await holdText("[data-live-hold-capacity]");
	check(
		"capacity comes first: used, total and free",
		/^\d+ \/ \d+ t · -?\d+ t free/.test(capacityInFlight),
		capacityInFlight,
	);
	check(
		"an empty page promises no values, because it draws no column",
		!/Values/.test(capacityInFlight),
		capacityInFlight,
	);
	await page.screenshot({ path: `${out}/00-hold-in-flight.png` });

	// ---------------------------------------------------------------------
	// Docked, with a consignment aboard and a tonne of the pilot's own.
	// ---------------------------------------------------------------------
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
	// The **dock phase**, not the id the setup returned: a ship parked but not
	// docked would pass an is-it-a-string row and fail something later with a
	// less legible message.
	const dockPhase = await page.evaluate(() => window.__seelite.dock.phase);
	check(
		"the ship is docked",
		dockPhase === "docked" &&
			(await page.locator("[data-live-station-console]").isVisible()),
		`${station} · ${dockPhase}`,
	);

	await page.locator('[data-live-station-tab="Requests"]').click();
	const offerRow = page
		.locator('[data-live-station-console] [data-live-request-action="details"]')
		.first();
	check("the board is not empty", (await offerRow.count()) >= 1);
	const offerId = await offerRow.getAttribute("data-live-request-id");
	const offer = await page.evaluate(
		(i) => window.__seelite.requestsView().offers.find((o) => o.id === i),
		offerId,
	);
	// Named before the first field read: a miss here surfaced as an opaque
	// TypeError three checks later.
	check(
		"the offer row names an offer the board knows",
		offerId !== null && offer != null && typeof offer.tonnes === "number",
		`${offerId}`,
	);
	await offerRow.click();
	await page
		.locator('[data-live-station-console] [data-live-request-action="accept"]')
		.click();

	// One tonne of the pilot's own, through the till, so the page has a line of
	// each ownership and the value column has something to price.
	await page.locator('[data-live-station-tab="Market"]').click();
	const mine = await page.evaluate(() => {
		const row = [...document.querySelectorAll("[data-live-market-row]")].find(
			(el) =>
				el.getAttribute("data-live-listed") === "true" &&
				el.querySelector('[data-live-station-action="buy-commodity"]') &&
				/^[1-9]\d*\s*t\b/.test(
					el.querySelector("[data-live-shelf]")?.textContent ?? "",
				),
		);
		const good = row?.getAttribute("data-live-market-row") ?? null;
		if (!good) return null;
		window.__seelite.commander.credits = 100_000;
		window.__seelite.stationConsoleRevision += 1;
		window.__seelite.updateCockpit();
		return good;
	});
	check("a tonne good with a shelf is on the board to buy", mine !== null);
	await page
		.locator(
			`[data-live-station-action="buy-commodity"][data-live-station-name="${mine}"]`,
		)
		.click();

	await openHold();
	const capacityDocked = await holdText("[data-live-hold-capacity]");
	check(
		"docked, the capacity line names the entrusted share",
		capacityDocked.includes(`${offer.tonnes} t entrusted`),
		capacityDocked,
	);
	check(
		"and it says the values are this station's bid",
		/this station's bid/i.test(capacityDocked),
		capacityDocked,
	);

	// **Selected by the offer id**, not by ownership alone: two consignments of
	// one good can be aboard at once, and an owner-only locator then resolves
	// to two nodes and throws instead of measuring either.
	const requesterRow = page.locator(
		`[data-live-panel="right"] [data-live-hold-offer="${offerId}"]`,
	);
	const requesterText = await requesterRow.innerText();
	check(
		"the requester's line names the job and where the goods must reach",
		requesterText.includes(offer.title) &&
			requesterText.includes(offer.reportName) &&
			/cannot be sold/i.test(requesterText),
		requesterText,
	);
	const requesterValue = await requesterRow
		.locator("[data-live-hold-value]")
		.innerText();
	check(
		"and it carries no price, because it is not the pilot's to sell",
		!/Cr/.test(requesterValue),
		requesterValue,
	);

	const pilotRow = page.locator(
		`[data-live-panel="right"] [data-live-hold-row="${mine}"][data-live-hold-owner="pilot"]`,
	);
	const pilotValue = await pilotRow
		.locator("[data-live-hold-value]")
		.innerText();
	const pilotText = await pilotRow.innerText();
	check(
		"the pilot's line says the goods are theirs and what they fetch here",
		/yours/i.test(pilotText) && /\d+\.\d Cr/.test(pilotValue),
		`${pilotText} · ${pilotValue}`,
	);
	await page.screenshot({ path: `${out}/01-hold-docked.png` });

	// **The bid column does not belong to the Market tab.** Everything above
	// was read with that tab open, which is the one state where the priced
	// rows are certainly on screen; a column that went blank behind the
	// Requests tab would have passed every check so far.
	await page.evaluate(() => window.__seelite.setHeadLook("forward"));
	await page.locator('[data-live-station-tab="Requests"]').click();
	await openHold();
	const pilotValueElsewhere = await page
		.locator(
			`[data-live-panel="right"] [data-live-hold-row="${mine}"][data-live-hold-owner="pilot"] [data-live-hold-value]`,
		)
		.innerText();
	// **Still a price, not the same price.** The two reads are seconds of game
	// time apart and §5.2's response decays, so the figure legitimately moves —
	// 3.6 Cr to 3.5 Cr on the run that first caught this. Pinning equality
	// would be pinning the clock.
	check(
		"the bid survives a station-console tab change",
		/\d+\.\d Cr/.test(pilotValueElsewhere),
		`${pilotValue.split("\n")[0]} → ${pilotValueElsewhere.split("\n")[0]}`,
	);

	// ---------------------------------------------------------------------
	// The page and the trade screen agree, because they read one projection.
	// ---------------------------------------------------------------------
	await page.evaluate(() => window.__seelite.setHeadLook("forward"));
	await page.locator('[data-live-station-tab="Market"]').click();
	const tradeLine = await page.locator("[data-live-station-hold]").innerText();
	// **The capacity line, not every figure on the page.** The trade screen
	// draws no per-good rows, so there is nothing there to compare them
	// against; what one projection buys is that used, capacity, free and the
	// entrusted share agree, and that is what this reads.
	const capacityFigures = capacityDocked.split("\n")[0];
	check(
		"the trade screen's hold line and the Hold page quote the same capacity",
		tradeLine.includes(capacityFigures),
		`${tradeLine} || ${capacityFigures}`,
	);

	await page.close();
} finally {
	await browser.close();
}
// **`check` throws**, so reaching here means every one of them passed and a
// `failed` tally would be a constant zero. A shader that fails to link is a
// `console.error` rather than a page error, and `watchShaders` is the only
// thing that sees it — that count is what is left to read.
console.log(`\n${passed}/${passed} checks passed`);
if (t.failures) process.exit(1);

/**
 * Node 445. The Hold page on the right-hand console, flown in both states.
 *
 * The hold was the one thing a pilot has to reason about that no screen
 * showed, and #411 made that sharper by putting an 8 t consignment in it that
 * cannot be sold and could not be seen. #443 put a line on the trade screen
 * and #446 put ownership into the words on a control; this is the full
 * manifest, and it has to be readable **away from a station** as well as at
 * one — which is why it lives on the flight console rather than the station's.
 *
 * Every assertion reads **rendered text**, not a state object (#411 round 3).
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
const checks = [];
const check = (name, ok, detail = "") => {
	checks.push({ name, ok: !!ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
	if (!ok) throw new Error(name);
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
	check(
		"an empty hold is a sentence and still says the capacity",
		/nothing aboard/i.test(await holdText("[data-live-hold-empty]")) &&
			/\d+ t/.test(await holdText("[data-live-hold-empty]")),
		await holdText("[data-live-hold-empty]"),
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
	check(
		"the ship is docked",
		typeof station === "string" && station.length > 0,
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

	const requesterRow = page.locator(
		'[data-live-panel="right"] [data-live-hold-row][data-live-hold-owner="requester"]',
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

	// ---------------------------------------------------------------------
	// The page and the trade screen agree, because they read one projection.
	// ---------------------------------------------------------------------
	await page.evaluate(() => window.__seelite.setHeadLook("forward"));
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
console.log(`\n${checks.length}/${checks.length} checks passed`);
if (t.failures) process.exit(1);

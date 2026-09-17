/**
 * `hud-and-scanner.md` §8.6's eight browser obligations — 1, 2, 5, 7, 9, 10,
 * 11 and 12.
 *
 * §8.6 opens by saying this section owes §7 a docked gallery state, and that
 * `probe-state-gallery.mjs` cannot express it: every state that probe visits is
 * a *flying* one and it asserts a flight floor on each. M10 takes the floor
 * away, so `docked` is measured here instead of being bolted onto a loop whose
 * every check contradicts it.
 *
 * Two of the eight are negatives — M4's and M7's — and a decision whose whole
 * content is "this does not appear" regresses in silence. Obligation 11 is
 * therefore asserted **during** the arrival, and the arrival it observes is one
 * the probe *starts* — the re-dock control — rather than the one that happens
 * to be running at page load. Reading the phase after a boot raced a five-second
 * arrival against the load and reported a slow machine as a build defect.
 */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";
import { workbenchUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";

/** `economy-trade.md` §4's scoped class. Named here rather than read off the
 *  page: a probe that learns which goods are illegal from the markup it is
 *  checking would agree with any answer the markup gave. */
const ILLEGAL = ["Slaves", "Narcotics", "Firearms"];

/** The row the gallery leaves a §5.2 mark on — `CONSOLE_STATIONS`' `moved`. */
const MOVED_GOOD = "Computers";

/**
 * M7's shape, not M7's words. A countdown is a clock or an announcement of a
 * refresh; matching only the literal string "epoch" would pass a screen that
 * said "prices reset in 04:12".
 */
const COUNTDOWN_WORDS = [
	"epoch",
	"refresh",
	"countdown",
	"resets",
	"reset in",
	"next roll",
	"re-roll",
	"expires",
];
const CLOCK = /\b\d{1,2}:\d{2}\b/;

function measureConsole() {
	const isVisible = (element) => {
		if (!(element instanceof HTMLElement)) return false;
		const style = getComputedStyle(element);
		const rect = element.getBoundingClientRect();
		return (
			style.display !== "none" &&
			style.visibility !== "hidden" &&
			Number(style.opacity) > 0 &&
			rect.width > 0 &&
			rect.height > 0
		);
	};
	const consoleEl = document.querySelector("[data-gallery-station-console]");
	const wrap = document.querySelector("[data-gallery-dock-phase]");
	// The header row carries no `data-gallery-market-row`, so the selector
	// already excludes it — an earlier filter for it removed nothing.
	const rows = [...document.querySelectorAll("[data-gallery-market-row]")].map(
		(row) => ({
			name: row.getAttribute("data-gallery-market-row"),
			listed: row.getAttribute("data-gallery-listed") === "true",
			illegal: Boolean(row.querySelector("[data-gallery-illegal]")),
			// **Two prices, not one.** #191 D3 ruled the spread visible rather than
			// folded into a midpoint, so the row that used to carry a single
			// `data-gallery-price` now carries both columns — and a probe reading one
			// figure would be reading a build that quietly went back to one.
			buy: row.querySelector("[data-gallery-buy]")?.textContent?.trim() ?? null,
			sell:
				row.querySelector("[data-gallery-sell]")?.textContent?.trim() ?? null,
			priceDelta:
				row.querySelector("[data-gallery-price-delta]")?.textContent?.trim() ??
				null,
			shelfDelta:
				row.querySelector("[data-gallery-shelf-delta]")?.textContent?.trim() ??
				null,
			priceDeltaVisible: isVisible(
				row.querySelector("[data-gallery-price-delta]"),
			),
			shelfDeltaVisible: isVisible(
				row.querySelector("[data-gallery-shelf-delta]"),
			),
		}),
	);
	const box = (element) => {
		if (!(element instanceof HTMLElement)) return null;
		const r = element.getBoundingClientRect();
		return {
			left: r.left,
			top: r.top,
			right: r.right,
			bottom: r.bottom,
			width: r.width,
			height: r.height,
		};
	};
	return {
		phase: wrap?.getAttribute("data-gallery-dock-phase") ?? null,
		epoch: wrap?.getAttribute("data-gallery-market-epoch") ?? null,
		clockMin: wrap?.getAttribute("data-gallery-clock-min") ?? null,
		consolePresent: Boolean(consoleEl),
		consoleVisible: isVisible(consoleEl),
		consoleBox: box(consoleEl),
		cockpitBox: box(document.querySelector("[data-gallery-cockpit]")),
		pageScrollsSideways: document.documentElement.scrollWidth > innerWidth + 1,
		consoleText: consoleEl?.textContent ?? "",
		activeTab:
			consoleEl?.getAttribute("data-gallery-console-active-tab") ?? null,
		activeStation:
			consoleEl?.getAttribute("data-gallery-console-station") ?? null,
		rows,
		notTradedHead: Boolean(document.querySelector("[data-gallery-not-traded]")),
		// M10's three, and the director the flying glass carries.
		floor: Boolean(document.querySelector("[data-gallery-floor]")),
		scanner: Boolean(document.querySelector("[data-gallery-scanner]")),
		director: Boolean(document.querySelector("[data-gallery-director]")),
		equipment: [
			...document.querySelectorAll("[data-gallery-equipment-item]"),
		].map((el) => el.getAttribute("data-gallery-equipment-item")),
		unavailableHead: Boolean(
			document.querySelector("[data-gallery-unavailable]"),
		),
		hullsHead: Boolean(document.querySelector("[data-gallery-hulls]")),
		hullsEmptyVisible: isVisible(
			document.querySelector("[data-gallery-hulls-empty]"),
		),
		unavailable: [
			...document.querySelectorAll("[data-gallery-unavailable-item]"),
		].map((el) => ({
			name: el.getAttribute("data-gallery-unavailable-item"),
			reason:
				el
					.querySelector("[data-gallery-unavailable-reason]")
					?.textContent?.trim() ?? "",
			visible: isVisible(el.querySelector("[data-gallery-unavailable-reason]")),
		})),
		launchVisible: isVisible(document.querySelector("[data-gallery-launch]")),
		launchEnabled: (() => {
			const button = document.querySelector("[data-gallery-launch]");
			return button instanceof HTMLButtonElement && !button.disabled;
		})(),
		inertReadouts: (() => {
			const list = document.querySelector("[data-gallery-inert]");
			if (!isVisible(list)) return null;
			return [...list.querySelectorAll("span")].map((row) =>
				row.textContent?.trim(),
			);
		})(),
		leftPanelVisible: (() => {
			const panel = document.querySelector('[data-gallery-panel="left"]');
			return (
				panel instanceof HTMLElement &&
				getComputedStyle(panel).display !== "none"
			);
		})(),
		headLook: document
			.querySelector("[data-gallery-cockpit]")
			?.getAttribute("data-gallery-head-look"),
		viewport: { width: innerWidth, height: innerHeight },
	};
}

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
watch(page, "docked");
await page.goto(workbenchUrl(ORIGIN, { seed: 42, "hud-gallery": "docked" }), {
	waitUntil: "load",
});
await page.waitForSelector("#state-gallery");

// --- Obligation 11 - M4's negative, asserted inside an arrival we start ----
await page.waitForSelector("[data-gallery-station-console]", {
	timeout: 20_000,
});
await page.locator("[data-gallery-redock]").click();
const arriving = await page.evaluate(measureConsole);
check(
	"11: re-docking puts the cockpit back into an arrival",
	arriving.phase === "arriving",
	`phase was ${arriving.phase}`,
);
check(
	"11: the station console is not up during the arrival",
	arriving.phase === "arriving" && !arriving.consolePresent,
);
// The other half: it is not simply never up. Without this the check above
// passes on a build that renders no console at all.
await page.waitForSelector("[data-gallery-station-console]", {
	timeout: 20_000,
});
const docked = await page.evaluate(measureConsole);
check(
	"11: the console arrives when the arrival ends",
	docked.phase === "docked" && docked.consoleVisible,
);

// --- Obligation 1 — the docked state, with no flight floor and no scanner --
check(
	"1: ?hud-gallery=docked renders the station console on the forward wall",
	docked.consoleVisible &&
		docked.headLook === "forward" &&
		docked.consoleBox.width > docked.viewport.width * 0.5,
);
check(
	"1: M10 takes the flight floor, the compact scanner and the director away",
	!docked.floor && !docked.scanner && !docked.director,
	`floor ${docked.floor}, scanner ${docked.scanner}, director ${docked.director}`,
);

// --- Obligation 2 — seventeen rows, priced iff the station lists the good ---
for (const station of ["trade", "fence", "yard"]) {
	await page.locator(`[data-gallery-station="${station}"]`).click();
	const measured = await page.evaluate(measureConsole);
	check(
		`2: ${station} shows seventeen commodity rows`,
		measured.activeStation === station && measured.rows.length === 17,
		`${measured.rows.length} rows at ${measured.activeStation}`,
	);
	const marked = measured.rows.filter((row) => row.illegal).map((r) => r.name);
	check(
		`2: ${station} marks exactly §4's three illegal goods`,
		marked.length === ILLEGAL.length &&
			ILLEGAL.every((name) => marked.includes(name)),
		`marked ${marked.join(", ")}`,
	);
	// The biconditional §8.6 asks for, and not the constant fourteen: a row is
	// priced exactly when the station lists it, which away from a fence is every
	// legal good and at one is all seventeen.
	const expectListed = (row) => !row.illegal || station === "fence";
	check(
		`2: ${station} prices a row iff the station lists the good`,
		measured.rows.every(
			(row) =>
				row.listed === expectListed(row) &&
				(row.buy !== null) === expectListed(row) &&
				(row.sell !== null) === expectListed(row),
		),
		measured.rows
			.filter(
				(row) =>
					row.listed !== expectListed(row) ||
					(row.buy !== null) !== expectListed(row) ||
					(row.sell !== null) !== expectListed(row),
			)
			.map((row) => row.name)
			.join(", "),
	);
	check(
		`2: ${station} ${station === "fence" ? "needs no" : "names its"} not-traded block`,
		measured.notTradedHead === (station !== "fence"),
	);
	// **#191 D3's browser-tier half, in the loop that already visits every station.**
	// Here rather than in a pass of its own because this loop is what leaves the page
	// on a named station, and a second pass of clicks would hand obligation 12 a
	// console for a station it does not expect. And in the *browser* tier because no
	// headless row can see a second column: what is asserted is that a player at a
	// market screen is shown two prices, rather than a midpoint with the wedge taken
	// invisibly somewhere in the arithmetic.
	const priced = measured.rows.filter((row) => row.listed);
	const cr = (text) => Number.parseFloat(text ?? "");
	const under = priced.filter((row) => cr(row.sell) < cr(row.buy));
	const margins = priced.map((row) => 1 - cr(row.sell) / cr(row.buy));
	check(
		`§5.6: ${station} shows every listed row's bid below its ask`,
		priced.length > 0 &&
			under.length === priced.length &&
			priced.every((row) => cr(row.sell) > 0),
		// The spread *range* is printed, not just the count, because a row whose bid
		// has been cut down to §3's price step has no spread left at all — and a check
		// that only counts rows with the bid under the ask would pass a build where
		// the wedge had vanished on every cheap good.
		`${under.length}/${priced.length} with the bid under the ask, spread ` +
			`${(100 * Math.min(...margins)).toFixed(1)}–${(100 * Math.max(...margins)).toFixed(1)}%`,
	);
}

// --- Obligation 5 — M6's deltas reach the glass ---------------------------
await page.locator('[data-gallery-station="trade"]').click();
const withDelta = await page.evaluate(measureConsole);
const movedRow = withDelta.rows.find((row) => row.name === MOVED_GOOD);
const unmovedRows = withDelta.rows.filter(
	(row) => row.listed && row.name !== MOVED_GOOD,
);
check(
	"5: the moved row carries a visible signed price and shelf delta",
	Boolean(movedRow) &&
		movedRow.priceDeltaVisible &&
		movedRow.shelfDeltaVisible &&
		/^[↑↓]\d/.test(movedRow.priceDelta ?? "") &&
		/^[↑↓]\d/.test(movedRow.shelfDelta ?? ""),
	`${MOVED_GOOD}: price ${movedRow?.priceDelta}, shelf ${movedRow?.shelfDelta}`,
);
check(
	"5: an unmoved row carries no delta at all",
	unmovedRows.length > 0 &&
		unmovedRows.every(
			(row) => row.priceDelta === null && row.shelfDelta === null,
		),
	unmovedRows
		.filter((row) => row.priceDelta !== null || row.shelfDelta !== null)
		.map((row) => row.name)
		.join(", "),
);

// --- Obligation 12 — M7's negative, across a market roll -------------------
const beforeRoll = await page.evaluate(measureConsole);
await page.locator("[data-gallery-advance-clock]").click();
const afterRoll = await page.evaluate(measureConsole);
check(
	"12: the clock actually crossed an epoch boundary",
	beforeRoll.epoch !== afterRoll.epoch,
	`epoch ${beforeRoll.epoch} → ${afterRoll.epoch}`,
);
for (const [when, measured] of [
	["before", beforeRoll],
	["after", afterRoll],
]) {
	// **The positive first.** Both assertions below read `consoleText`, which is
	// `""` when no console renders, so on a console-less build they would hold
	// for the same reason they hold on a correct one — the exact vacuity this
	// file's header claims to have designed out for obligation 11 and had not
	// for 12. The epoch guard above reads the wrap element, not the console, so
	// it does not close this either.
	check(
		`12: ${when} the roll, there is a market tab to find nothing on`,
		measured.consolePresent &&
			measured.rows.length === 17 &&
			measured.consoleText.includes("Food"),
		`${measured.rows.length} rows, ${measured.consoleText.length} chars`,
	);
	const text = measured.consoleText.toLowerCase();
	const hit = COUNTDOWN_WORDS.find((word) => text.includes(word));
	check(
		`12: ${when} the roll, the market tab announces no refresh`,
		hit === undefined && !CLOCK.test(measured.consoleText),
		hit ?? measured.consoleText.match(CLOCK)?.[0] ?? "",
	);
}

// --- Obligation 7 — the unavailable block and its reasons -----------------
await page.locator('[data-gallery-console-tab="Equipment"]').click();
const equipment = await page.evaluate(measureConsole);
check(
	"7: the equipment tab lists what a TL 4 trade station sells",
	equipment.activeTab === "Equipment" && equipment.equipment.length > 0,
	`${equipment.equipment.length} items`,
);
check(
	"7: the unavailable block is on the glass with a reason on every entry",
	equipment.unavailableHead &&
		equipment.unavailable.length > 0 &&
		equipment.unavailable.every(
			(entry) => entry.visible && entry.reason.length > 0,
		),
	equipment.unavailable
		.filter((entry) => !entry.visible || entry.reason.length === 0)
		.map((entry) => entry.name)
		.join(", "),
);
check(
	"7: M8's three reason shapes are all readable at one frontier station",
	["requires TL", "refineries only", "shipyards only"].every((shape) =>
		equipment.unavailable.some((entry) => entry.reason.includes(shape)),
	),
	equipment.unavailable.map((entry) => entry.reason).join(" | "),
);

// --- §8.3 / §8.7's joint 4 — the empty hull heading a player will see ------
await page.locator('[data-gallery-station="yard"]').click();
const yard = await page.evaluate(measureConsole);
check(
	"§8.3: a shipyard draws the hull heading, empty until #26 prices hulls",
	yard.activeTab === "Equipment" && yard.hullsHead && yard.hullsEmptyVisible,
);
check(
	"§8.3: a trade station draws no hull heading at all",
	!equipment.hullsHead,
);
await page.locator('[data-gallery-station="trade"]').click();

// --- Obligation 9 — launch is on the Flight console, the rest is inert -----
await page.locator('[data-gallery-look="right"]').click();
const right = await page.evaluate(measureConsole);
check(
	"9: turning the head right exposes a live launch control",
	right.headLook === "right" && right.launchVisible && right.launchEnabled,
);
check(
	"9: the Flight console's throttle and assist readouts say they are inert",
	Array.isArray(right.inertReadouts) &&
		right.inertReadouts.some((line) => /THROTTLE\s*INERT/i.test(line ?? "")) &&
		right.inertReadouts.some((line) => /ASSIST\s*INERT/i.test(line ?? "")),
	JSON.stringify(right.inertReadouts),
);
check(
	"9: the station console is not on the right wall — it hangs forward",
	!right.consoleVisible,
);
// E5 suspends flight, not one tab of it. An earlier round gated the INERT
// attribute on Flight alone, which left Drive saying THROTTLE INERT with
// nothing marking it.
await page.locator('[data-gallery-right-tab="Drive"]').click();
const drive = await page.evaluate(measureConsole);
check(
	"E5: the right console's readouts are marked inert on its other tabs too",
	Array.isArray(drive.inertReadouts) &&
		drive.inertReadouts.some((line) => /THROTTLE\s*INERT/i.test(line ?? "")),
	JSON.stringify(drive.inertReadouts),
);
check(
	"M9: the launch control is on Flight and on no other tab",
	!drive.launchVisible,
);
await page.locator('[data-gallery-right-tab="Flight"]').click();
// The other side of E5's boundary. M2 keeps the left console's job unchanged,
// and E5 suspends *flight* — which is what the right console carries and the
// left one does not. Asserted so that "the left console stays live" is a
// measured decision rather than the half of it nobody looked at.
await page.locator('[data-gallery-look="left"]').click();
const left = await page.evaluate(measureConsole);
check(
	"M2/E5: the left console is not marked inert — flight is not what it carries",
	left.leftPanelVisible && left.inertReadouts === null,
	JSON.stringify(left.inertReadouts),
);
await page.locator('[data-gallery-look="right"]').click();

check(
	"9: the launch control is live - pressing it returns the flying cockpit",
	// Rendered-and-not-disabled is not "live". §12.2's motion is #77's; what
	// this asserts is the state change M9's control is the trigger for.
	await (async () => {
		await page.locator("[data-gallery-launch]").click();
		const flying = await page.evaluate(measureConsole);
		return (
			flying.phase === "flying" &&
			!flying.consolePresent &&
			flying.floor &&
			flying.scanner
		);
	})(),
);
// Back to docked for the remaining checks, through the same door a player uses.
await page.locator('[data-gallery-state="docked"]').click();
await page.waitForSelector("[data-gallery-station-console]", {
	timeout: 20_000,
});

// --- Obligation 10 — forward returns the console, not flying glass --------
await page.locator('[data-gallery-look="forward"]').click();
const forward = await page.evaluate(measureConsole);
check(
	"10: looking forward while docked returns the station console",
	forward.headLook === "forward" &&
		forward.consoleVisible &&
		!forward.floor &&
		!forward.scanner &&
		!forward.director,
);

// --- §6's responsive rule, for the state §7's inventory never had ---------
// Back to Market first: obligation 7 left the Equipment tab up, and the media
// query this measures is `.sg-market-row`'s seventeen-row grid.
await page.locator('[data-gallery-console-tab="Market"]').click();
await page.setViewportSize({ width: 390, height: 844 });
const narrow = await page.evaluate(measureConsole);
await page.locator('[data-gallery-look="right"]').click();
const narrowRight = await page.evaluate(measureConsole);
check(
	"narrow: M9's launch control and its INERT readouts both survive the layout",
	// The narrow rule drops `.sg-console-list` to make room, which left LAUNCH
	// on a console saying nothing about why it was the only live thing on it.
	// Measured at 390 px because that is where the rule applies.
	narrowRight.launchVisible &&
		Array.isArray(narrowRight.inertReadouts) &&
		narrowRight.inertReadouts.some((line) =>
			/THROTTLE\s*INERT/i.test(line ?? ""),
		),
	JSON.stringify(narrowRight.inertReadouts),
);
await page.locator('[data-gallery-look="forward"]').click();

check(
	"narrow: the market grid is what is measured, not the equipment list",
	narrow.activeTab === "Market" && narrow.rows.length === 17,
	`${narrow.activeTab}, ${narrow.rows.length} rows`,
);
check(
	"narrow: the console fits the cockpit shell and never scrolls the page sideways",
	// Inside the cockpit rather than inside the viewport: the gallery page
	// scrolls vertically by design, and a seventeen-row table on a 390 px
	// screen is meant to scroll *itself*. Sideways is the one that is always a
	// defect.
	narrow.consoleVisible &&
		!narrow.pageScrollsSideways &&
		narrow.consoleBox.left >= narrow.cockpitBox.left - 1 &&
		narrow.consoleBox.right <= narrow.cockpitBox.right + 1 &&
		narrow.consoleBox.top >= narrow.cockpitBox.top - 1 &&
		narrow.consoleBox.bottom <= narrow.cockpitBox.bottom + 1,
	`console ${JSON.stringify(narrow.consoleBox)} in cockpit ${JSON.stringify(narrow.cockpitBox)}`,
);

await browser.close();
exit();

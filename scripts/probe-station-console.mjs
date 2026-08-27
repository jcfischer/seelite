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
 * therefore asserted **during** the arrival rather than after it, and the probe
 * refuses rather than passes if it arrives too late to see one.
 */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

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
	const rows = [...document.querySelectorAll("[data-gallery-market-row]")]
		.filter((row) => !row.classList.contains("sg-market-head"))
		.map((row) => ({
			name: row.getAttribute("data-gallery-market-row"),
			listed: row.getAttribute("data-gallery-listed") === "true",
			illegal: Boolean(row.querySelector("[data-gallery-illegal]")),
			price:
				row.querySelector("[data-gallery-price]")?.textContent?.trim() ?? null,
			priceDelta:
				row.querySelector("[data-gallery-price-delta]")?.textContent?.trim() ??
				null,
			shelfDelta:
				row.querySelector("[data-gallery-shelf-delta]")?.textContent?.trim() ??
				null,
			deltaVisible: isVisible(row.querySelector("[data-gallery-price-delta]")),
		}));
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
		headLook: document
			.querySelector("[data-gallery-cockpit]")
			?.getAttribute("data-gallery-head-look"),
		viewport: { width: innerWidth, height: innerHeight },
	};
}

// `station-console.ts` declares no top-level numbers of its own — round 1 moved
// its two constant blocks to the layers that own them — so the guard reads the
// modules it draws from instead.
await guardedOrigin(ORIGIN, ["src/state-gallery.ts", "src/market.ts"]);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
watch(page, "docked");
await page.goto(`${ORIGIN}/?seed=42&hud-gallery=docked`, { waitUntil: "load" });
await page.waitForSelector("#state-gallery");

// --- Obligation 11 — M4's negative, asserted inside the arrival ------------
const arriving = await page.evaluate(measureConsole);
check(
	"11: the probe caught the arrival while it was still running",
	arriving.phase === "arriving",
	`phase was ${arriving.phase} — too late to assert M4's negative`,
);
check(
	"11: the station console is not up during the arrival",
	arriving.phase === "arriving" && !arriving.consolePresent,
);
// The other half: it is not simply never up. Without this the check above
// passes on a build that renders no console at all.
await page.waitForSelector("[data-gallery-station-console]", {
	timeout: 15_000,
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
				(row.price !== null) === expectListed(row),
		),
		measured.rows
			.filter(
				(row) =>
					row.listed !== expectListed(row) ||
					(row.price !== null) !== expectListed(row),
			)
			.map((row) => row.name)
			.join(", "),
	);
	check(
		`2: ${station} ${station === "fence" ? "needs no" : "names its"} not-traded block`,
		measured.notTradedHead === (station !== "fence"),
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
		movedRow.deltaVisible &&
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
await page.setViewportSize({ width: 390, height: 844 });
const narrow = await page.evaluate(measureConsole);
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

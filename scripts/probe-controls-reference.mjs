/**
 * The Controls tab (#372): `?` opens it and closes it, a real click folds a
 * group, the pad folds one with `A`, and the tree is legible at 600 px.
 *
 * The headless tier owns the arithmetic — the law of `?`, the tree, the cursor's
 * hand-off, what prints — in `tests/controls-reference.test.ts`, and the
 * catalogue's completeness against the source in `tests/controls-catalogue.test.ts`.
 * This probe owns what only a page can answer: that the key reaches the game
 * through a real keyboard, that the head turns and the tab is drawn, that a
 * **real** `page.mouse.click` lands on a group header, and that the layout holds
 * at the narrow breakpoint.
 *
 * **Launched on `channel: "chromium"`, for #371's reason**, which
 * `probe-pointer-lock.mjs`'s header owns: on the default launcher no pointer lock
 * is ever granted, so a click on a head-turned console would land whether or not
 * the game released the lock, and the fold row would be green over the exact
 * defect #371 fixed. The first row asserts the lock is held before `?` so the
 * release after it means something. Like that probe, no row here reads a pixel.
 *
 * **Not measured here: `?` while docked.** Reaching a docked cockpit is a
 * scripted arrival measured in minutes elsewhere; the abstention is one branch of
 * `controlsKeyMove`, which the headless tier reaches directly, and `main.ts`
 * calls it with `this.dock.phase` and nothing else.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { STANDARD_INDEX, installFakePad } from "./lib/fake-pad.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const origin = await guardedOrigin(ORIGIN);
const { check, watch, exit } = tally();

const SEED = 42;

const settle = (page) =>
	page.evaluate(
		() =>
			new Promise((done) =>
				requestAnimationFrame(() => requestAnimationFrame(done)),
			),
	);

const lockHolder = (page) =>
	page.evaluate(() => document.pointerLockElement?.tagName ?? null);

/** What the game says about the head and the right console. */
const state = (page) =>
	page.evaluate(() => ({
		head: window.__seelite.headLook,
		tab: window.__seelite.rightTab,
		view: window.__seelite.view,
		throttle: window.__seelite.throttle,
	}));

/** Whether the tab's body is drawn where a player can see it, not only present. */
const controlsShown = (page) =>
	page.evaluate(
		() =>
			document.querySelector("[data-live-controls-body]")?.checkVisibility() ===
			true,
	);

/** A click on bare glass; see `probe-pointer-lock.mjs` for the pacing. */
const clickGlass = async (page) => {
	await page.waitForTimeout(2200);
	const at = await page.evaluate(() => {
		const r = window.__seelite.renderer.domElement.getBoundingClientRect();
		return {
			x: Math.round(r.left + r.width * 0.03),
			y: Math.round(r.top + r.height * 0.5),
		};
	});
	await page.mouse.click(at.x, at.y);
	await settle(page);
};

/** A real click at the centre of `selector`, answering what the hit test named. */
const clickAt = async (page, selector) => {
	const at = await page.evaluate((css) => {
		const el = document.querySelector(css);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		const x = Math.round(r.left + r.width / 2);
		const y = Math.round(r.top + r.height / 2);
		return { x, y, hit: document.elementFromPoint(x, y)?.closest(css) === el };
	}, selector);
	if (at) await page.mouse.click(at.x, at.y);
	await settle(page);
	return at;
};

const expanded = (page, group) =>
	page.evaluate(
		(g) =>
			document
				.querySelector(`[data-live-controls-group="${g}"]`)
				?.getAttribute("aria-expanded") ?? null,
		group,
	);

const rowCount = (page, selector = "[data-live-controls-row]") =>
	page.evaluate((css) => document.querySelectorAll(css).length, selector);

/**
 * `?` as a hand makes it: Shift down, a beat, `/`, a beat, Shift up.
 *
 * `press("Shift+Slash")` delivers all four events inside one task, so no frame
 * ever sees Shift held — and Shift is `THROTTLE_UP`. Paced, the frames between
 * the two keydowns do see it, which is what a player's chord does too.
 */
const pressQuestion = async (page) => {
	await page.keyboard.down("Shift");
	await page.waitForTimeout(120);
	await page.keyboard.press("Slash");
	await page.waitForTimeout(80);
	await page.keyboard.up("Shift");
	await settle(page);
};

const pressPad = async (page, name) => {
	await page.evaluate((i) => window.__pad.hold(i), STANDARD_INDEX[name]);
	await settle(page);
	await page.evaluate((i) => window.__pad.release(i), STANDARD_INDEX[name]);
	await settle(page);
};

const browser = await launchChromium({ channel: "chromium" });

// ---------------------------------------------------------------------------
// The key, from a locked forward view.
// ---------------------------------------------------------------------------
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
watch(page);
await page.addInitScript(installFakePad);
await page.goto(gameUrl(origin, { seed: SEED }), { waitUntil: "load" });
await bootedGame(page);

await clickGlass(page);
check(
	"the glass is locked before ?, so the release after it means something",
	(await lockHolder(page)) === "CANVAS",
	`lock=${await lockHolder(page)}`,
);

// Put the right console on Drive the way a player would, so the restore has a
// tab to restore that is not the default.
await page.keyboard.press("3");
await settle(page);
await clickAt(page, '[data-live-right-tab="Drive"]');
await page.keyboard.press("2");
await settle(page);
const before = await state(page);
check(
	"the right console was left on Drive, head forward",
	before.tab === "Drive" && before.head === "forward",
	JSON.stringify(before),
);

await pressQuestion(page);
const opened = await state(page);
check(
	"? turns the head to starboard and selects Controls",
	opened.head === "right" && opened.tab === "Controls",
	JSON.stringify(opened),
);
check(
	"and the tab is drawn, not only mounted",
	await controlsShown(page),
	`shown=${await controlsShown(page)}`,
);
check(
	"and the pointer is the console's, so the tree can be clicked",
	(await lockHolder(page)) === null,
	`lock=${await lockHolder(page)}`,
);
const header = await page.evaluate(
	() =>
		document.querySelector("[data-live-controls-body] .lc-controls-head")
			?.textContent ?? "",
);
check(
	"the header names the default layout, the chord and the layout it assumes",
	header.includes("DEFAULT LAYOUT") &&
		header.includes("Shift + /") &&
		header.includes("US") &&
		!/your layout/i.test(header),
	JSON.stringify(header),
);
check(
	"the tab sits between Drive and Tuning",
	(
		await page.evaluate(() =>
			[
				...document.querySelectorAll(
					'[data-live-panel="right"] [data-live-right-tab]',
				),
			].map((b) => b.dataset.liveRightTab),
		)
	).join(",") === "Flight,Drive,Controls,Tuning",
);
// #370 R1: `THROTTLE_UP` is Shift, so the chord's modifier is itself a held
// binding. Reported, not asserted either way: the reading is what #369 and the
// principal decide on.
console.log(
	`  NOTE  throttle across the chord: ${before.throttle} -> ${opened.throttle}`,
);

// ---------------------------------------------------------------------------
// The fold, by a real click.
// ---------------------------------------------------------------------------
const allRows = await rowCount(page);
const flyRows = await rowCount(page, '[data-live-controls-row="pitch"]');
const fold = await clickAt(page, '[data-live-controls-group="fly"]');
check(
	"a real click on the FLY header lands on it",
	fold?.hit === true,
	JSON.stringify(fold),
);
const afterFold = await rowCount(page);
check(
	"and folds the group: its header says so and its rows are gone",
	(await expanded(page, "fly")) === "false" &&
		flyRows === 1 &&
		(await rowCount(page, '[data-live-controls-row="pitch"]')) === 0 &&
		afterFold < allRows,
	`rows ${allRows} -> ${afterFold}, expanded=${await expanded(page, "fly")}`,
);
await clickAt(page, '[data-live-controls-group="fly"]');
check(
	"a second click opens it again",
	(await expanded(page, "fly")) === "true" &&
		(await rowCount(page)) === allRows,
	`rows=${await rowCount(page)}`,
);

// ---------------------------------------------------------------------------
// The fold, by the pad: the cursor walks onto the header and A folds it.
// ---------------------------------------------------------------------------
const ringOn = () =>
	page.evaluate(() => {
		const el = document.querySelector('[data-live-focus="true"]');
		return (
			el?.dataset.liveControlsGroup ??
			(el?.dataset.liveControlsRow ? `row:${el.dataset.liveControlsRow}` : null)
		);
	});
// The cursor may already be on the header the click left it on; walk it to a
// known place: down onto the first row, then up onto the header.
await pressPad(page, "down");
await pressPad(page, "up");
const onHeader = await ringOn();
await pressPad(page, "a");
check(
	"the pad's A on a group header folds it",
	onHeader === "fly" && (await expanded(page, "fly")) === "false",
	`ring=${onHeader} expanded=${await expanded(page, "fly")}`,
);
check(
	"and the ring stays on that header",
	(await ringOn()) === "fly",
	`ring=${await ringOn()}`,
);
await pressPad(page, "a");
check(
	"A again opens it",
	(await expanded(page, "fly")) === "true",
	`expanded=${await expanded(page, "fly")}`,
);

// Hand-off: the ring on a row of the group, the group folded by the mouse.
await pressPad(page, "down");
await pressPad(page, "down");
const onRow = await ringOn();
await clickAt(page, '[data-live-controls-group="fly"]');
check(
	"folding a group while the cursor is on one of its rows hands the cursor to the header",
	typeof onRow === "string" &&
		onRow.startsWith("row:") &&
		(await ringOn()) === "fly",
	`before=${onRow} after=${await ringOn()}`,
);
await clickAt(page, '[data-live-controls-group="fly"]');

// ---------------------------------------------------------------------------
// Closing restores the tab you were reading.
// ---------------------------------------------------------------------------
await pressQuestion(page);
const closed = await state(page);
check(
	"? again turns the head forward and gives Drive back",
	closed.head === "forward" && closed.tab === "Drive",
	JSON.stringify(closed),
);
check(
	"and nothing re-takes the pointer on the way back; the next click does",
	(await lockHolder(page)) === null,
	`lock=${await lockHolder(page)}`,
);

// ---------------------------------------------------------------------------
// Silent in chase.
// ---------------------------------------------------------------------------
await page.keyboard.press("v");
await settle(page);
const chase = await state(page);
await pressQuestion(page);
const chaseAfter = await state(page);
check(
	"? does nothing in chase view",
	chase.view === "chase" &&
		chaseAfter.head === chase.head &&
		chaseAfter.tab === chase.tab,
	`${JSON.stringify(chase)} -> ${JSON.stringify(chaseAfter)}`,
);
await page.keyboard.press("v");
await settle(page);
await page.close();

// ---------------------------------------------------------------------------
// Legible at the 600 px breakpoint: nothing wider than its row, and every group
// reachable by scrolling the panel.
// ---------------------------------------------------------------------------
const narrow = await browser.newPage({ viewport: { width: 600, height: 760 } });
watch(narrow);
await narrow.goto(gameUrl(origin, { seed: SEED }), { waitUntil: "load" });
await bootedGame(narrow);
await pressQuestion(narrow);
const layout = await narrow.evaluate(() => {
	const panel = document.querySelector('[data-live-panel="right"]');
	const rows = [...document.querySelectorAll("[data-live-controls-row]")];
	const overflowing = rows
		.filter((row) => row.scrollWidth > row.clientWidth + 1)
		.map((row) => row.dataset.liveControlsRow);
	// Every element in the tree, not the rows alone: the notes and the key caps
	// set their own sizes (sage round 1).
	const smallest = Math.min(
		...[
			...document.querySelectorAll(
				"[data-live-controls-tree], [data-live-controls-tree] *",
			),
		].map((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
	);
	return {
		panelOverflowX: panel ? panel.scrollWidth > panel.clientWidth + 1 : null,
		rows: rows.length,
		overflowing,
		smallest,
	};
});
check(
	"at 600 px no row is wider than itself and the panel does not scroll sideways",
	layout.rows > 0 &&
		layout.overflowing.length === 0 &&
		layout.panelOverflowX === false,
	JSON.stringify(layout),
);
check(
	"and no text in the tree is set below 10 px, the size the station console's rows take at this width",
	layout.smallest >= 10,
	`smallest=${layout.smallest}px`,
);
const lastGroup = await narrow.evaluate(() => {
	const el = document.querySelector('[data-live-controls-group="system"]');
	el?.scrollIntoView({ block: "nearest" });
	if (!el) return null;
	const r = el.getBoundingClientRect();
	return r.top >= 0 && r.bottom <= window.innerHeight;
});
check(
	"the last group's header can be scrolled into view",
	lastGroup === true,
	`inView=${lastGroup}`,
);

await browser.close();
exit();

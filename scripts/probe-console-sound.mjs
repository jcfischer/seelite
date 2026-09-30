/**
 * The consoles, by ear, in the running game (#546): a console press plays a
 * press, a refused one a refusal, a cursor move a tick, and station control's
 * answer a message — each through `Game.play`, the one dispatcher — and
 * `?consolesound=legacy` plays none of them.
 *
 *   npm run probe:one probe-console-sound
 *
 * What each cue *sounds* like is `probe-audio-cues.mjs`'s bands and the
 * principal's ear. This checks the wiring: which cue the game asks for, at the
 * seam where the outcome is known.
 */
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const SEED = 42;
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const open = async (params) => {
	const page = await browser.newPage({
		viewport: { width: 1200, height: 800 },
	});
	watch(page);
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: SEED, raider: "off", ...params }), {
		waitUntil: "load",
	});
	await bootedGame(page);
	await page.evaluate(() => {
		const g = window.__seelite;
		g.audio.ensure();
		// Every cue the game plays, in order, through the one dispatcher.
		g.__cues = [];
		// The station every block uses: the first trade station, or any.
		window.__station = () => {
			const bodies = g.world.system.bodies;
			const id =
				bodies.find((b) => b.kind === "station" && b.stationType === "trade")
					?.id ?? bodies.find((b) => b.kind === "station")?.id;
			if (!id) throw Error("no station");
			return id;
		};
		const play = g.play.bind(g);
		g.play = (cue) => {
			g.__cues.push(cue.kind === "notify" ? `notify:${cue.tone}` : cue.kind);
			play(cue);
		};
	});
	return page;
};

/** The cues played while `act` runs in the page. */
const cuesOf = async (page, act) => {
	await page.evaluate(() => {
		window.__seelite.__cues = [];
	});
	await act();
	return page.evaluate(() => [...window.__seelite.__cues]);
};

/** A row that names the exact cues an act played, in order. */
const checkCues = (name, got, want) =>
	check(
		name,
		JSON.stringify(got) === JSON.stringify(want),
		JSON.stringify(got),
	);

const clickIn = (page, selector) =>
	page.evaluate((s) => {
		const el = document.querySelector(s);
		if (!(el instanceof HTMLElement)) throw new Error(`no ${s}`);
		el.click();
	}, selector);

/** Dock at `__station()`, head forward on its console. */
const dock = (page) =>
	page.evaluate(async () => {
		const g = window.__seelite;
		const id = window.__station();
		await window.__parkInBerth(id, g.berthIdsOfStation(id)[0]);
		g.setHeadLook("forward");
		g.updateCockpit();
		return g.dock.phase;
	});

/** Ask `__station()` for clearance twice from its aperture axis. A page of its
 *  own: a grant reserves the berth `dock` parks in. */
const askClearanceTwice = (page) =>
	cuesOf(page, () =>
		page.evaluate(async () => {
			const g = window.__seelite;
			const id = window.__station();
			g.targetId = id;
			// On the aperture axis, co-moving: inside clearance range.
			await window.__viewAlongAxis(id, 5);
			g.requestDockingClearance();
			g.requestDockingClearance();
		}),
	);

/** The cues of one purchase press, with the commander holding `credits`. */
const buyWith = (page, credits) =>
	cuesOf(page, async () => {
		await page.evaluate((cr) => {
			const g = window.__seelite;
			g.commander = { ...g.commander, credits: cr };
			g.updateCockpit();
		}, credits);
		await page.waitForTimeout(100);
		await clickIn(page, '[data-live-station-action="buy-commodity"]');
	});

const tabPress = (page) =>
	cuesOf(page, () => clickIn(page, '[data-live-station-tab="Market"]'));

const cursorTwice = (page) =>
	cuesOf(page, () =>
		page.evaluate(() => {
			const g = window.__seelite;
			g.panelCommand("panel.cursorDown", null);
			g.panelCommand("panel.cursorDown", null);
		}),
	);

/**
 * Enter row 0, row 0 again and row 1, counting the `consoleFocus("hover")`
 * calls as well as the cues, so "silent" cannot be "not wired" (sage
 * round 2).
 */
const hoverRows = async (page) => {
	const cues = await cuesOf(page, () =>
		page.evaluate(() => {
			const g = window.__seelite;
			const shipped = g.consoleFocus.bind(g);
			g.__hoverCalls = 0;
			g.consoleFocus = (source) => {
				if (source === "hover") g.__hoverCalls++;
				return shipped(source);
			};
			const rows = document.querySelectorAll("[data-live-station-action]");
			const over = (el) =>
				el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
			over(rows[0]);
			over(rows[0]);
			over(rows[1]);
		}),
	);
	const calls = await page.evaluate(() => window.__seelite.__hoverCalls);
	return { cues, calls };
};

try {
	// ---------------------------------------------------------------------
	// The defaults.
	// ---------------------------------------------------------------------
	{
		const page = await open({});
		const phase = await dock(page);
		check("the ship is docked", phase === "docked", phase);
		checkCues("a console tab is a press", await tabPress(page), ["press"]);
		checkCues(
			"a purchase the till refuses is a refusal, not a press",
			await buyWith(page, 0),
			["refuse"],
		);
		checkCues(
			"a purchase the till takes is a press",
			await buyWith(page, 1e5),
			["press"],
		);
		checkCues("a cursor move is a tick, each one", await cursorTwice(page), [
			"focus",
			"focus",
		]);
		const hover = await hoverRows(page);
		check(
			"a hover reaches the game and is silent on the default arm",
			hover.calls === 2 && hover.cues.length === 0,
			`${hover.calls} call(s), cues ${JSON.stringify(hover.cues)}`,
		);
		await page.close();
	}

	// ---------------------------------------------------------------------
	// Station control answers a clearance request, once per change of
	// answer. On `every`, so the gap cannot silence a repeat and the row
	// measures the change-of-answer rule alone (sage round 2).
	// ---------------------------------------------------------------------
	{
		const page = await open({ consolesound: "every" });
		const answer = await askClearanceTwice(page);
		check(
			"a clearance answer is one message, and asking again is not news",
			answer.length === 1 && answer[0].startsWith("notify:"),
			JSON.stringify(answer),
		);
		await page.close();
	}

	// ---------------------------------------------------------------------
	// hover: once per row entered.
	// ---------------------------------------------------------------------
	{
		const page = await open({ consolesound: "hover" });
		await dock(page);
		checkCues(
			"on hover, entering a row ticks once, and another row again",
			(await hoverRows(page)).cues,
			["focus", "focus"],
		);
		await page.close();
	}

	// ---------------------------------------------------------------------
	// legacy: the silent consoles before #546, on every act the defaults
	// sound (sage round 3). A hail on legacy is `alert`, which
	// `probe-witnesses` does not fly and `tests/console-sound.test.ts` holds.
	// ---------------------------------------------------------------------
	{
		const page = await open({ consolesound: "legacy" });
		checkCues(
			"legacy: a clearance answer is silent",
			await askClearanceTwice(page),
			[],
		);
		await page.close();
	}
	{
		const page = await open({ consolesound: "legacy" });
		await dock(page);
		const acts = {
			tab: await tabPress(page),
			refused: await buyWith(page, 0),
			bought: await buyWith(page, 1e5),
			cursor: await cursorTwice(page),
			hover: (await hoverRows(page)).cues,
		};
		check(
			"legacy: a tab, a refused and a taken purchase, a cursor move and a hover are all silent",
			Object.values(acts).every((cues) => cues.length === 0),
			JSON.stringify(acts),
		);
		await page.close();
	}
} finally {
	await browser.close();
}
exit();

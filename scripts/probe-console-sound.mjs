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

const clickIn = (page, selector) =>
	page.evaluate((s) => {
		const el = document.querySelector(s);
		if (!(el instanceof HTMLElement)) throw new Error(`no ${s}`);
		el.click();
	}, selector);

/** Dock at the first trade station, head forward on its console. */
const dock = (page) =>
	page.evaluate(async () => {
		const g = window.__seelite;
		const id =
			g.world.system.bodies.find(
				(b) => b.kind === "station" && b.stationType === "trade",
			)?.id ?? g.world.system.bodies.find((b) => b.kind === "station")?.id;
		if (!id) throw Error("no station");
		await window.__parkInBerth(id, g.berthIdsOfStation(id)[0]);
		g.setHeadLook("forward");
		g.updateCockpit();
		return g.dock.phase;
	});

try {
	// ---------------------------------------------------------------------
	// The defaults.
	// ---------------------------------------------------------------------
	const page = await open({});

	const phase = await dock(page);
	check("the ship is docked", phase === "docked", phase);

	const tab = await cuesOf(page, () =>
		clickIn(page, '[data-live-station-tab="Market"]'),
	);
	check(
		"a console tab is a press",
		JSON.stringify(tab) === '["press"]',
		JSON.stringify(tab),
	);

	/** The cues of one purchase press, with the commander holding `credits`. */
	const buyWith = (credits) =>
		cuesOf(page, async () => {
			await page.evaluate((cr) => {
				const g = window.__seelite;
				g.commander = { ...g.commander, credits: cr };
				g.updateCockpit();
			}, credits);
			await page.waitForTimeout(100);
			await clickIn(page, '[data-live-station-action="buy-commodity"]');
		});

	// A purchase the till refuses: no credits.
	const refused = await buyWith(0);
	check(
		"a purchase the till refuses is a refusal, not a press",
		JSON.stringify(refused) === '["refuse"]',
		JSON.stringify(refused),
	);

	const bought = await buyWith(100000);
	check(
		"a purchase the till takes is a press",
		JSON.stringify(bought) === '["press"]',
		JSON.stringify(bought),
	);

	const walked = await cuesOf(page, () =>
		page.evaluate(() => {
			const g = window.__seelite;
			g.panelCommand("panel.cursorDown", null);
			g.panelCommand("panel.cursorDown", null);
		}),
	);
	check(
		"a cursor move is a tick, each one",
		JSON.stringify(walked) === '["focus","focus"]',
		JSON.stringify(walked),
	);

	// The hover reaches the game and the arm silences it: counting the calls
	// as well as the cues, so "silent" cannot be "not wired" (sage round 2).
	const hovered = await cuesOf(page, () =>
		page.evaluate(() => {
			const g = window.__seelite;
			const shipped = g.consoleFocus.bind(g);
			g.__hoverCalls = 0;
			g.consoleFocus = (source) => {
				if (source === "hover") g.__hoverCalls++;
				return shipped(source);
			};
			const row = document.querySelector("[data-live-station-action]");
			row.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
		}),
	);
	const hoverCalls = await page.evaluate(() => window.__seelite.__hoverCalls);
	check(
		"a hover reaches the game and is silent on the default arm",
		hoverCalls === 1 && hovered.length === 0,
		`${hoverCalls} call(s), cues ${JSON.stringify(hovered)}`,
	);
	await page.close();

	// ---------------------------------------------------------------------
	// Station control answers a clearance request, once per change of
	// answer. A page of its own: a grant reserves the berth `dock` parks in.
	// On `every`, so the gap cannot silence a repeat and the row measures
	// the change-of-answer rule alone (sage round 2).
	// ---------------------------------------------------------------------
	{
		const page = await open({ consolesound: "every" });
		const answer = await cuesOf(page, () =>
			page.evaluate(async () => {
				const g = window.__seelite;
				const station = g.world.system.bodies.find(
					(b) => b.kind === "station" && b.stationType === "trade",
				);
				g.targetId = station.id;
				// On the aperture axis, co-moving: inside clearance range.
				await window.__viewAlongAxis(station.id, 5);
				g.requestDockingClearance();
				g.requestDockingClearance();
			}),
		);
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
		const p = await open({ consolesound: "hover" });
		await dock(p);
		const over = await cuesOf(p, () =>
			p.evaluate(() => {
				const tabs = document.querySelectorAll("[data-live-station-action]");
				const over = (el) =>
					el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
				over(tabs[0]);
				over(tabs[0]);
				over(tabs[1]);
			}),
		);
		check(
			"on hover, entering a row ticks once, and another row again",
			JSON.stringify(over) === '["focus","focus"]',
			JSON.stringify(over),
		);
		await p.close();
	}

	// ---------------------------------------------------------------------
	// legacy: the silent consoles before #546.
	// ---------------------------------------------------------------------
	{
		const p = await open({ consolesound: "legacy" });
		await dock(p);
		const silent = await cuesOf(p, async () => {
			await clickIn(p, '[data-live-station-tab="Market"]');
			await p.evaluate(() => {
				window.__seelite.panelCommand("panel.cursorDown", null);
			});
		});
		check(
			"legacy plays nothing for a tab or a cursor move",
			silent.length === 0,
			JSON.stringify(silent),
		);
		await p.close();
	}
} finally {
	await browser.close();
}
exit();

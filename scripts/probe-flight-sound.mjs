/**
 * The flight sound is driven by the running game (#544).
 *
 * `tests/flight-sound.test.ts` holds the mapping and `tests/thrust-share.test.ts`
 * the thrust shares; `probe-audio-cues.mjs` renders the loops offline. What only
 * the page can answer is the **wiring**: that the frame loop reads the flight
 * state the step left and hands the mix to the engine. So every row here runs
 * on the page's own `requestAnimationFrame` loop — nothing calls `step` — and
 * reads back the levels `AudioFX.flight` last wrote.
 *
 * It proves the levels move, not that they sound right; that is the capture
 * (`npm run sounds`) and the principal's ear, flown.
 *
 * - **a burn is heard, and holding speed is not** — the default `thrust` arm:
 *   the assist commands a speed, so a ship at its setpoint has an idle drive.
 * - **a turn fires the thrusters**.
 * - **cruise spools, engages, and drops** — the wind-up rises, the engage and
 *   drop cues go through `Game.play` once each.
 * - **`?flightsound=legacy` plays the bed before #544 and none of this**.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const SEED = 19;
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/** Real time on the page's own loop. */
const wait = (page, ms) => page.waitForTimeout(ms);

const open = async (params) => {
	const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
	watch(page);
	await page.goto(gameUrl(origin, { seed: SEED, raider: "off", ...params }));
	await bootedGame(page);
	const unlocked = await page.evaluate(() => {
		const g = window.__seelite;
		g.audio.ensure();
		// Every cue the game plays, in order, through the one dispatcher.
		g.__cues = [];
		const play = g.play.bind(g);
		g.play = (cue) => {
			g.__cues.push(cue.kind);
			play(cue);
		};
		return !g.audio.silent;
	});
	return { page, unlocked };
};

/** What the engine last wrote, and whether each graph exists. `AudioFX`'s
 *  private fields: a rename makes the read `undefined`, which fails a row. */
const levels = (page) =>
	page.evaluate(() => {
		const a = window.__seelite.audio;
		return {
			mix: a.flightLevels,
			graph: a.flightGraph !== null && a.flightGraph !== undefined,
			bed: a.bed !== null && a.bed !== undefined,
		};
	});

{
	const { page, unlocked } = await open({});
	check("the page's audio context runs", unlocked);

	// A burn from rest along the nose.
	await page.evaluate(() => {
		const g = window.__seelite;
		g.assist = true;
		g.world.ship.vel = { ...g.assistFrame().vel };
		g.throttle = 1;
	});
	await wait(page, 600);
	const burn = await levels(page);
	check(
		"a burn is heard: the drive is up and the hum is on",
		burn.graph && burn.mix?.drive > 0.9 && burn.mix?.hum === 1,
		JSON.stringify(burn.mix),
	);

	// At the setpoint: the lever still open, the ship holding its speed.
	await page.evaluate(() => {
		const g = window.__seelite;
		g.throttle = 0.5;
		const n = g.nose();
		const f = g.assistFrame().vel;
		const cap = g.assistCapKms;
		g.world.ship.vel = {
			x: f.x + n.x * cap * 0.5,
			y: f.y + n.y * cap * 0.5,
			z: f.z + n.z * cap * 0.5,
		};
	});
	await wait(page, 400);
	const holding = await levels(page);
	check(
		"holding speed is not heard: the drive is idle with the lever open",
		holding.mix?.drive < 0.05 && holding.mix?.hum === 1,
		JSON.stringify(holding.mix),
	);

	// A yaw, held on the key the pilot would use.
	const rcs = await page.evaluate(async () => {
		const g = window.__seelite;
		let peak = 0;
		g.rates = { pitch: 0, yaw: 0, roll: 0 };
		const held = g.held.bind(g);
		g.held = (action) => action === "fly.yawPort" || held(action);
		const t0 = performance.now();
		while (performance.now() - t0 < 400) {
			await new Promise(requestAnimationFrame);
			peak = Math.max(peak, g.audio.flightLevels?.rcs ?? 0);
		}
		g.held = held;
		return peak;
	});
	check("a turn fires the thrusters", rcs > 0.3, `rcs peak ${rcs.toFixed(3)}`);

	// Cruise: spool, engage, drop.
	const cruise = await page.evaluate(async () => {
		const g = window.__seelite;
		g.throttle = 0;
		const station = g.world.system.bodies.find((b) => b.kind === "station");
		g.targetId = station.id;
		g.__cues.length = 0;
		g.engageCruise();
		let spoolRise = [];
		const t0 = performance.now();
		while (g.regime !== "cruise" && performance.now() - t0 < 6000) {
			await new Promise(requestAnimationFrame);
			const s = g.audio.flightLevels?.spool ?? 0;
			if (s > 0) spoolRise.push(s);
		}
		for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
		const inCruise = { ...g.audio.flightLevels, regime: g.regime };
		g.dropOut("probe");
		for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
		spoolRise = [spoolRise[0], spoolRise.at(-1)];
		return {
			spoolRise,
			inCruise,
			afterDrop: { ...g.audio.flightLevels, regime: g.regime },
			cues: g.__cues.filter((c) => c.startsWith("cruise")),
		};
	});
	check(
		"cruise spools up: the wind-up rises",
		cruise.spoolRise[0] > 0 && cruise.spoolRise[1] > cruise.spoolRise[0] + 0.5,
		JSON.stringify(cruise.spoolRise),
	);
	check(
		"in cruise the bed replaces the drive",
		cruise.inCruise.regime === "cruise" &&
			cruise.inCruise.cruise > 0.5 &&
			cruise.inCruise.drive === 0 &&
			cruise.inCruise.spool === 0,
		JSON.stringify(cruise.inCruise),
	);
	check(
		"engage and drop are one cue each, through the dispatcher",
		JSON.stringify(cruise.cues) ===
			JSON.stringify(["cruiseEngage", "cruiseDrop"]) &&
			cruise.afterDrop.cruise === 0,
		JSON.stringify(cruise),
	);
	await page.close();
}

{
	const { page } = await open({ flightsound: "legacy" });
	await page.evaluate(() => {
		window.__seelite.throttle = 1;
	});
	await wait(page, 400);
	const legacy = await levels(page);
	check(
		"?flightsound=legacy plays the bed before #544 and no flight loops",
		legacy.bed && !legacy.graph && legacy.mix == null,
		JSON.stringify(legacy),
	);
	await page.close();
}

await browser.close();
exit();

/**
 * Weapons and damage are driven by the running game (#545).
 *
 * `tests/weapon-sound.test.ts` holds the mapping and `probe-audio-cues.mjs`
 * renders the voices and duels offline. What only the page can answer is the
 * **wiring**: that `step` reads the gun, the ship's own condition and the
 * selected target, sends the cues through `Game.play`, and hands the loops to
 * the engine. So a live duel is reached on fixed steps and each row steps the
 * game itself, reading the cues that reached `AudioFX.play` and the levels
 * `AudioFX.weapons` last wrote.
 *
 * It proves the cues and levels move, not that they sound right; that is the
 * capture (`npm run sounds`) and the principal's ear, flown.
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
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/** A page in a live duel on fixed steps, with every cue that reaches the
 *  engine recorded on the way through. */
const duel = async (weaponsound) => {
	const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
	watch(page);
	await page.goto(
		gameUrl(origin, { seed: 42, ...(weaponsound ? { weaponsound } : {}) }),
	);
	await bootedGame(page);
	const setup = await page.evaluate(() => {
		const g = window.__seelite;
		g.audio.ensure();
		const dt = g.units.MAX_DT;
		g.resetFlightToStart();
		let far = null;
		let farKm = 0;
		for (const b of g.world.system.bodies) {
			const d = Math.hypot(
				b.pos.x - g.world.ship.pos.x,
				b.pos.y - g.world.ship.pos.y,
				b.pos.z - g.world.ship.pos.z,
			);
			if (b.kind !== "star" && d > farKm) {
				far = b;
				farKm = d;
			}
		}
		g.targetId = far.id;
		g.faceTarget?.();
		g.engageCruise();
		for (let i = 0; i < 100 && g.regime !== "cruise"; i++) g.step(dt);
		g.forceRaider("ahead", 0.5, 12);
		for (let i = 0; i < 900 && g.encounter?.phase !== "duel"; i++) g.step(dt);
		// Hold the page's own loop off the clock, so only the rows' steps move it.
		g.clockHeld = true;
		window.__cues = [];
		const play = g.audio.play.bind(g.audio);
		g.audio.play = (cue) => {
			window.__cues.push(cue);
			play(cue);
		};
		return {
			phase: g.encounter?.phase ?? null,
			audible: !g.audio.silent,
		};
	});
	return { page, setup };
};

/** Run `before` in the page, then step `n` fixed steps; hand back the cues
 *  that reached the engine and the weapon levels last written. */
const steps = async (page, n, before = null) => {
	await page.evaluate(() => {
		window.__cues = [];
	});
	if (before) await page.evaluate(before);
	return page.evaluate((n) => {
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		for (let i = 0; i < n; i++) {
			g.step(dt);
			g.audio.weapons(g.weaponMix);
		}
		return {
			cues: window.__cues.map((c) => ({ ...c })),
			written: { ...g.audio.weaponWritten },
		};
	}, n);
};
const kinds = (r) => r.cues.map((c) => c.kind);

{
	const { page, setup } = await duel("beam");
	check(
		"the probe reaches a live duel with sound running",
		setup.phase === "duel" && setup.audible,
		JSON.stringify(setup),
	);

	// Let any hit from the approach go quiet.
	await steps(page, 120);

	const fore = await steps(page, 2, () =>
		window.__seelite.takeDamage(10, "fore", "probe"),
	);
	const shield = fore.cues.find((c) => c.kind === "shieldHit");
	check(
		"a hit taken on the fore shield plays, and names its pool",
		shield?.pool === "fore" && shield.sided === true && shield.share < 1,
		JSON.stringify(fore.cues),
	);

	await steps(page, 60);
	const through = await steps(page, 2, () =>
		window.__seelite.takeDamage(400, "aft", "probe"),
	);
	check(
		"a hit through the shield plays on the hull too",
		kinds(through).includes("hullHit"),
		JSON.stringify(through.cues),
	);

	// The gate #552 said `Game.play` owed: a condition replaced downward, with
	// no strike behind it, is not a hit.
	await steps(page, 120);
	const replaced = await steps(page, 2, () => {
		const g = window.__seelite;
		g.condition = {
			...g.condition,
			fore: 1,
			aft: 1,
			hull: g.condition.hull - 5,
		};
	});
	check(
		"a condition replaced downward plays no hit",
		!kinds(replaced).some((k) => k === "shieldHit" || k === "hullHit"),
		JSON.stringify(replaced.cues),
	);

	// The beam arm: a loop while the gun fires, and silent when it stops.
	const firing = await steps(page, 10, () => {
		const g = window.__seelite;
		g.condition = { ...g.condition, heat: 0, heatLocked: false, energy: 1e6 };
		g.keys.add(" ");
	});
	const released = await steps(page, 5, () =>
		window.__seelite.keys.delete(" "),
	);
	check(
		"on beam, a held trigger holds the beam loop and plays no shot cue",
		firing.written.beam === 1 && !kinds(firing).includes("laser"),
		JSON.stringify({ written: firing.written, cues: kinds(firing) }),
	);
	check(
		"and letting go lets the beam go",
		released.written.beam === 0,
		JSON.stringify(released.written),
	);

	// A hit landed on the selected raider.
	const landed = await steps(page, 2, () => {
		const g = window.__seelite;
		g.targetId = g.raiderContact.id;
		g.step(g.units.MAX_DT);
		const r = g.encounter.raider;
		r.condition = {
			...r.condition,
			fore: r.condition.fore * 0.5,
			aft: r.condition.aft * 0.5,
		};
	});
	check(
		"a hit landed on the selected raider plays",
		landed.cues.some((c) => c.kind === "hitLanded" && c.on === "shield"),
		JSON.stringify(landed.cues),
	);
	await page.close();
}

{
	const { page } = await duel("crack");
	const shot = await steps(page, 3, () => {
		const g = window.__seelite;
		g.condition = { ...g.condition, heat: 0, heatLocked: false };
		g.keys.add(" ");
	});
	check(
		"on crack, a held trigger plays the crack",
		shot.cues.some((c) => c.kind === "laser" && c.voice === "crack"),
		JSON.stringify(shot.cues),
	);
	await page.close();
}

{
	const { page } = await duel("legacy");
	await steps(page, 120);
	const hit = await steps(page, 2, () =>
		window.__seelite.takeDamage(400, "fore", "probe"),
	);
	check(
		"?weaponsound=legacy plays no hit, as before #545",
		!kinds(hit).some((k) => k === "shieldHit" || k === "hullHit"),
		JSON.stringify(hit.cues),
	);
	await page.close();
}

await browser.close();
exit();

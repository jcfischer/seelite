/**
 * Weapons and damage are driven by the running game (#545).
 *
 * `tests/weapon-sound.test.ts` holds the mapping and `probe-audio-cues.mjs`
 * renders the voices and duels offline. What only the page can answer is the
 * **wiring**: that `step` reads the gun, the ship's own condition and the
 * selected target, sends the cues through `Game.play`, and hands the loops to
 * the engine. So a live duel is reached on fixed steps, the cue rows step the
 * game themselves and read the cues that reached `AudioFX.play`, and the loop
 * rows let the page's own frame loop run and read the levels it wrote through
 * `AudioFX.weapons` — the probe never calls that itself (sage round 2), so a
 * frame loop that stopped handing the loops over is a red row.
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
		// The gun cool and the trigger held, for every row that fires.
		window.__fireGun = () => {
			g.condition = { ...g.condition, heat: 0, heatLocked: false };
			g.keys.add(" ");
		};
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

/** Run `before(arg)` in the page, then step `n` fixed steps; hand back the cues
 *  that reached the engine. */
const steps = async (page, n, before = null, arg = null) => {
	await page.evaluate(() => {
		window.__cues = [];
	});
	if (before) await page.evaluate(before, arg);
	return page.evaluate((n) => {
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		for (let i = 0; i < n; i++) g.step(dt);
		return { cues: window.__cues.map((c) => ({ ...c })) };
	}, n);
};
const kinds = (r) => r.cues.map((c) => c.kind);

/** Exercise shield and hull cues without ending the duel and reloading its
 * page (#702). Read the live pools, and refuse an already destroyed fixture. */
const throughShield = (side) => {
	const g = window.__seelite;
	if (g.dead || !(g.condition.hull > 0))
		throw new Error("sound fixture needs a live hull");
	g.takeDamage(
		g.condition[side] + Math.min(5, g.condition.hull / 4),
		side,
		"probe",
	);
	if (g.dead || !(g.condition.hull > 0))
		throw new Error("sound fixture destroyed the hull");
};

{
	// `given` on: the landed rows below need it, and `nogiven` is the default.
	const { page, setup } = await duel("beam,given");
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
	const through = await steps(page, 2, throughShield, "aft");
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

	// The beam arm, on the page's own loop: a loop while the gun fires, silent
	// when it stops, and silent on a held clock.
	/** Let the clock run for `ms` of real time after `before`; hand back the
	 *  cues and what the frame loop last wrote. */
	const live = async (ms, before, held = false) => {
		await page.evaluate((held) => {
			window.__cues = [];
			window.__seelite.clockHeld = held;
		}, held);
		if (before) await page.evaluate(before);
		await page.waitForTimeout(ms);
		return page.evaluate(() => ({
			cues: window.__cues.map((c) => ({ ...c })),
			written: { ...window.__seelite.audio.weaponWritten },
		}));
	};
	const firing = await live(400, () => window.__fireGun());
	const paused = await live(300, null, true);
	const released = await live(300, () => window.__seelite.keys.delete(" "));
	check(
		"on beam, a held trigger holds the beam loop and plays no shot cue",
		firing.written.beam === 1 && !kinds(firing).includes("laser"),
		JSON.stringify({ written: firing.written, cues: kinds(firing) }),
	);
	check(
		"a held clock silences the beam with the trigger still held",
		paused.written.beam === 0,
		JSON.stringify(paused.written),
	);
	check(
		"and letting go lets the beam go",
		released.written.beam === 0,
		JSON.stringify(released.written),
	);

	// Idle loops are torn down (sage round 1): once every level has been silent
	// for `WEAPON_IDLE_S` on the audio clock, the frame loop's next write stops
	// the graph's sources.
	const idle = await page.evaluate(async () => {
		const g = window.__seelite;
		g.clockHeld = true;
		const built = g.audio.weaponGraph !== null;
		const { WEAPON_IDLE_S } = await import("/src/audio.ts");
		await new Promise((r) => setTimeout(r, (WEAPON_IDLE_S + 0.7) * 1000));
		return { built, after: g.audio.weaponGraph };
	});
	check(
		"a weapon graph silent for its idle time is torn down",
		idle.built === true && idle.after === null,
		JSON.stringify(idle),
	);

	// A fall on the selected raider. The trigger is let go and the step is told
	// the gun fired on its last reading, so no real shot can land inside the
	// row and the raider falls only by the hand below: once struck, as
	// `applyDamage` leaves it (`sinceStruckS` 0), and once not (sage round 3).
	// So this proves the wiring and both gates, not that a shot hit.
	await page.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		g.keys.delete(" ");
		g.targetId = g.raiderContact.id;
		g.step(g.units.MAX_DT);
	});
	const dropRaider = (sinceStruckS) =>
		steps(
			page,
			1,
			(sinceStruckS) => {
				const g = window.__seelite;
				g.weaponSoundState = { ...g.weaponSoundState, firedLast: true };
				const r = g.encounter.raider;
				r.condition = {
					...r.condition,
					fore: r.condition.fore * 0.5,
					aft: r.condition.aft * 0.5,
					sinceStruckS,
				};
			},
			sinceStruckS,
		);
	const unstruck = await dropRaider(30);
	const landed = await dropRaider(0);
	check(
		"a struck fall on the selected raider, with the gun just fired, plays a landed hit",
		landed.cues.some((c) => c.kind === "hitLanded" && c.on === "shield"),
		JSON.stringify(landed.cues),
	);
	check(
		"and the same fall with no strike behind it plays none",
		!kinds(unstruck).includes("hitLanded"),
		JSON.stringify(unstruck.cues),
	);
	await page.close();
}

{
	const { page } = await duel("crack");
	const shot = await steps(page, 3, () => window.__fireGun());
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
	const hit = await steps(page, 2, throughShield, "fore");
	check(
		"?weaponsound=legacy plays no hit, as before #545",
		!kinds(hit).some((k) => k === "shieldHit" || k === "hullHit"),
		JSON.stringify(hit.cues),
	);
	await page.close();
}

await browser.close();
exit();

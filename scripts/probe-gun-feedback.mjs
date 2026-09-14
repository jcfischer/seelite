/**
 * The pulse laser, fired the way a player fires it (#324).
 *
 * **Why this probe exists.** `probe-interdiction.mjs` fires with
 * `g.keys.add(" ")` and reads the ship's heat, and that stayed green while the
 * principal's first flight found Space and the mouse dead. They were not dead:
 * a real key press moved heat from 0 to 1.3 in 0.8 s. The screen showed nothing,
 * and no sound played. So every check here drives a **real** input — the
 * keyboard, the mouse, or the fake pad the gamepad probes use — and reads what
 * the player gets: tracer pixels on the overlay and the shot sound.
 *
 * It also holds the controller mapping the principal set: L1/R1 trim the
 * throttle, R2 fires, L2 selects the next target.
 */
import { installFakePad, STANDARD_INDEX } from "./lib/fake-pad.mjs";
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

const W = 900;
const H = 620;
const page = await browser.newPage({ viewport: { width: W, height: H } });
watch(page);
await page.addInitScript(installFakePad);
await page.goto(gameUrl(origin, { seed: 42 }));
await bootedGame(page);

// A live duel, flown to on fixed steps, then left to the game's own loop so the
// real inputs below are read the way a player's are.
const setup = await page.evaluate(() => {
	const g = window.__seelite;
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
	for (let i = 0; i < 900 && g.encounter?.phase !== "duel"; i++) {
		g.step(dt);
		g.render(dt);
	}
	window.__shots = 0;
	const laser = g.audio.laser.bind(g.audio);
	g.audio.laser = () => {
		window.__shots += 1;
		laser();
	};
	return { phase: g.encounter?.phase ?? null, view: g.view };
});
check(
	"the probe reaches a live duel in the cockpit",
	setup.phase === "duel" && setup.view === "cockpit",
	JSON.stringify(setup),
);

/**
 * Tracer pixels, sampled on the tracer's own line halfway from the left port to
 * the sightline, and the state that drew them. Read off the page's constants
 * would be better; the fractions are the module's and are restated once here
 * because the overlay is the thing being judged.
 */
const sample = () =>
	page.evaluate(
		([w, h]) => {
			const g = window.__seelite;
			const overlay = document.getElementById("overlay");
			const ctx = overlay.getContext("2d", { willReadFrequently: true });
			const x = Math.round(w * ((0.24 + 0.5) / 2));
			const y = Math.round(h * ((0.64 + 0.5) / 2));
			const data = ctx.getImageData(x - 6, y - 6, 12, 12).data;
			let cyan = 0;
			for (let i = 0; i < data.length; i += 4)
				if (
					data[i + 3] > 40 &&
					data[i] < 170 &&
					data[i + 1] > 215 &&
					data[i + 2] > 235
				)
					cyan++;
			return {
				cyan,
				tracerLeftS: g.gunFeedback.tracerLeftS,
				heat: g.condition.heat,
				shots: window.__shots,
			};
		},
		[W, H],
	);
const settle = (ms) => page.waitForTimeout(ms);

// ---------------------------------------------------------------------------
// The keyboard.
// ---------------------------------------------------------------------------
await settle(400);
const quiet = await sample();
await page.keyboard.down("Space");
await settle(350);
const spaceHeld = await sample();
await page.keyboard.up("Space");
await settle(600);
const spaceReleased = await sample();
check(
	"no tracer is drawn before the trigger is pulled",
	quiet.cyan === 0 && quiet.tracerLeftS === 0,
	JSON.stringify(quiet),
);
check(
	"a real Space press draws the tracer on the glass",
	spaceHeld.cyan > 0 && spaceHeld.heat > quiet.heat,
	JSON.stringify(spaceHeld),
);
check(
	"and plays the shot sound, paced rather than once per frame",
	spaceHeld.shots > quiet.shots && spaceHeld.shots - quiet.shots < 20,
	`${spaceHeld.shots - quiet.shots} sounds in 350 ms`,
);
check(
	"releasing Space clears the tracer",
	spaceReleased.cyan === 0 && spaceReleased.tracerLeftS === 0,
	JSON.stringify(spaceReleased),
);

// ---------------------------------------------------------------------------
// The mouse.
// ---------------------------------------------------------------------------
await page.mouse.move(W / 2, H * 0.3);
await page.mouse.down();
await settle(350);
const clickHeld = await sample();
await page.mouse.up();
await settle(600);
const clickReleased = await sample();
check(
	"a real left click held on the canvas draws the tracer and sounds",
	clickHeld.cyan > 0 && clickHeld.shots > spaceReleased.shots,
	JSON.stringify(clickHeld),
);
check(
	"releasing the mouse clears it",
	clickReleased.cyan === 0,
	JSON.stringify(clickReleased),
);

// ---------------------------------------------------------------------------
// The controller: R2 fires, L1/R1 trim the throttle, L2 selects next target.
// ---------------------------------------------------------------------------
await page.evaluate((i) => window.__pad.hold(i, 1), STANDARD_INDEX.r2);
await settle(350);
const padHeld = await sample();
await page.evaluate((i) => window.__pad.release(i), STANDARD_INDEX.r2);
await settle(600);
const padReleased = await sample();
check(
	"R2 held fires the pulse laser, with the tracer and the sound",
	padHeld.cyan > 0 && padHeld.shots > clickReleased.shots,
	JSON.stringify(padHeld),
);
check(
	"releasing R2 clears the tracer",
	padReleased.cyan === 0,
	JSON.stringify(padReleased),
);

const throttleBefore = await page.evaluate(() => window.__seelite.throttle);
await page.evaluate((i) => window.__pad.hold(i, 1), STANDARD_INDEX.r1);
await settle(400);
await page.evaluate((i) => window.__pad.release(i), STANDARD_INDEX.r1);
const throttleUp = await page.evaluate(() => window.__seelite.throttle);
await page.evaluate((i) => window.__pad.hold(i, 1), STANDARD_INDEX.l1);
await settle(400);
await page.evaluate((i) => window.__pad.release(i), STANDARD_INDEX.l1);
const throttleDown = await page.evaluate(() => window.__seelite.throttle);
check(
	"R1 opens the throttle and L1 closes it",
	throttleUp > throttleBefore && throttleDown < throttleUp,
	`${throttleBefore.toFixed(3)} → ${throttleUp.toFixed(3)} → ${throttleDown.toFixed(3)}`,
);

const r2Throttle = await page.evaluate(async (i) => {
	const before = window.__seelite.throttle;
	window.__pad.hold(i, 1);
	await window.__frames(20);
	window.__pad.release(i);
	return { before, after: window.__seelite.throttle };
}, STANDARD_INDEX.r2);
check(
	"R2 no longer moves the throttle",
	Math.abs(r2Throttle.after - r2Throttle.before) < 1e-9,
	JSON.stringify(r2Throttle),
);

const target = await page.evaluate(async (i) => {
	const g = window.__seelite;
	const before = g.targetId;
	window.__pad.hold(i, 1);
	await window.__frames(4);
	window.__pad.release(i);
	await window.__frames(4);
	return { before, after: g.targetId, count: g.selectable().length };
}, STANDARD_INDEX.l2);
check(
	"L2 selects the next target",
	target.count > 1 && target.after !== target.before,
	JSON.stringify(target),
);

await browser.close();
exit();

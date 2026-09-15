/**
 * The raider's assist holds speed in the player's local frame (#324).
 *
 * `tests/raider-flight-rules.test.ts` owns the controller half: given a frame,
 * the raider's speed in it stays under the cap. What only the page can answer
 * is the wiring — that `Game` hands the duel the frame its own assist uses.
 * Without it the raider held speed in the star's frame, and beside a station
 * moving at orbital speed it could not keep up with a player at rest there.
 *
 * The duel is set up by hand at the start station, in normal flight, which is
 * where the local frame moves fastest and the difference is largest.
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

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await page.goto(gameUrl(origin, { seed: 42 }));
await bootedGame(page);

const duel = await page.evaluate(() => {
	const g = window.__seelite;
	const dt = g.units.MAX_DT;
	const len = (a) => Math.hypot(a.x, a.y, a.z);
	const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
	g.resetFlightToStart();
	// **Parked beside the station, co-moving.** The start point is not inside
	// any body's frame, so a check run there compared the star's frame with
	// itself and read a local frame of 0 km/s.
	const station = g.world.system.bodies.find((b) => b.kind === "station");
	g.world.ship.pos = {
		x: station.pos.x + 20,
		y: station.pos.y,
		z: station.pos.z,
	};
	g.world.ship.vel = { ...g.stationVelocity(station.id) };
	g.throttle = 0;
	for (let i = 0; i < 10; i++) {
		g.step(dt);
		g.render(dt);
	}
	const frameKms = len(g.localFrame());
	g.forceRaider("ahead", 0, 3);
	const nose = g.nose();
	g.encounter = {
		...g.encounter,
		phase: "duel",
		raider: null,
		offset: { x: nose.x * 3, y: nose.y * 3, z: nose.z * 3 },
	};
	let fastest = 0;
	let frames = 0;
	for (let i = 0; i < Math.round(3 / dt) && g.encounter; i++) {
		// **The frame the step flew in**, read before it (sage #345): `Game`
		// reads it at the start of the frame, and after the step the station's
		// frame has moved on by up to 7.7e-4 km/s, more than this row's margin.
		const frame = g.localFrame();
		g.step(dt);
		g.render(dt);
		const r = g.encounter?.raider;
		if (!r) continue;
		frames++;
		fastest = Math.max(fastest, len(sub(r.flight.ship.vel, frame)));
	}
	return {
		regime: g.regime,
		phase: g.encounter?.phase ?? null,
		frameKms,
		frames,
		fastestInFrameKms: fastest,
		cap: g.assistCapKms,
	};
});
check(
	"beside a moving station the raider's speed in the player's frame stays under the cap",
	// The frame must move well past the cap, or this asserts nothing.
	duel.frameKms > 5 * duel.cap &&
		duel.frames >= 20 &&
		duel.fastestInFrameKms <= duel.cap + 1e-6,
	JSON.stringify(duel),
);

await browser.close();
exit();

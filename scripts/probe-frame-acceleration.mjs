/**
 * A ship at rest beside an orbiting station stays at rest beside it (#529).
 *
 * `tests/sim.test.ts` owns the law: given a frame's velocity at both ends of a
 * step, flight in it is flight in a still frame. What only the page can answer
 * is the wiring — that `Game` hands the flight model the frame it names, at
 * both ends of the step, from one body.
 *
 * The case is the one the principal could not dock at: seed 3852403550, whose
 * start system USBISO has its shipyard low over a gas giant, accelerating at
 * ~71.7 m/s². Before #529 a ship parked there with the throttle at zero kept
 * ~0.087 km/s of speed against it and slid kilometres off in a minute; with
 * the assist off it fell behind at the station's whole acceleration.
 *
 * Both rows print the frame-relative speed and separation they read, so the
 * same probe run at two refs is the before/after.
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
const SEED = 3852403550;
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await page.goto(gameUrl(origin, { seed: SEED }));
await bootedGame(page);

/** Park co-moving on the shipyard's axis and hold the throttle at zero. */
const hold = (assist) =>
	page.evaluate(
		({ assist, seconds, rangeKm }) => {
			const g = window.__seelite;
			const dt = g.units.MAX_DT;
			const len = (a) => Math.hypot(a.x, a.y, a.z);
			const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
			const station = g.world.system.bodies.find(
				(b) => b.kind === "station" && b.id.endsWith("station-shipyard"),
			);
			if (!station) return { error: "no shipyard in this system" };
			// The station's acceleration, from its own velocity across one step,
			// so the row asserts nothing on a system where the frame is still.
			const v0 = g.stationVelocity(station.id);
			const axis = g.apertureFrameOf(station.id).axis;
			g.world.ship.pos = {
				x: station.pos.x + axis.x * rangeKm,
				y: station.pos.y + axis.y * rangeKm,
				z: station.pos.z + axis.z * rangeKm,
			};
			g.world.ship.vel = { ...v0 };
			g.throttle = 0;
			g.assist = assist;
			g.step(dt);
			g.render(dt);
			const accelKms2 = len(sub(g.stationVelocity(station.id), v0)) / dt;
			const offset0 = sub(g.world.ship.pos, station.pos);
			let fastest = 0;
			const frameIds = new Set();
			for (let i = 0; i < Math.round(seconds / dt); i++) {
				g.step(dt);
				g.render(dt);
				frameIds.add(g.frameBody?.id ?? null);
				fastest = Math.max(
					fastest,
					len(sub(g.world.ship.vel, g.stationVelocity(station.id))),
				);
			}
			return {
				station: station.id,
				frames: [...frameIds],
				regime: g.regime,
				assist: g.assist,
				accelKms2,
				fastestRelKms: fastest,
				driftKm: len(sub(sub(g.world.ship.pos, station.pos), offset0)),
				gateKms: g.dockingTolerances.V_GATE_KMS,
			};
		},
		{ assist, seconds: 60, rangeKm: 20 },
	);

for (const assist of [true, false]) {
	const r = await hold(assist);
	console.log(`assist ${assist ? "on " : "off"}: ${JSON.stringify(r)}`);
	const framed =
		!r.error &&
		r.regime === "normal" &&
		r.assist === assist &&
		r.frames.length === 1 &&
		r.frames[0] === r.station &&
		// Well past a trade station's few m/s², or the row asserts nothing.
		r.accelKms2 > 0.05;
	check(
		`assist ${assist ? "on" : "off"}: parked in the shipyard's frame, it stays parked`,
		framed && r.fastestRelKms < r.gateKms / 100 && r.driftKm < 0.05,
		JSON.stringify(r),
	);
}

await browser.close();
exit();

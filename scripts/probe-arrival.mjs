/**
 * Cruise arrives at a station its planet used to hide — spec §12, flown in the
 * browser.
 *
 *   npm run dev                       # in one shell
 *   node scripts/probe-arrival.mjs    # in another
 *
 * ## Why this is not a case in `probe-cruise.mjs`
 *
 * That probe flies `?seed=42`, whose trade station is in clear space by a wide
 * margin, and it is about the *seam* — layer handoff, apparent size, exit
 * velocity. It would pass unchanged with #30's defect still in place, and did.
 *
 * The defect is a **geometry** one, so the probe that catches it is chosen by
 * geometry: `?seed=481` has both shapes in a single system.
 *
 * - `station-trade` orbits a 6,326 km planet whose centre sits 6,593 km across
 *   the line of sight — outside the planet and *inside* the 1.05 × radius shell
 *   it used to project (1.042 ×). The station is in clear space and cruise
 *   ended against its host thousands of km short, at thousands of km/s.
 * - `station-shipyard` orbits a 35,192 km planet and is genuinely behind it.
 *   That leg must still be stopped, and stopped *outside* the surface: a rule
 *   that reaches this one is one that flies through planets.
 *
 * **It was `?seed=47` until #118.** The reshape moved every system, so that
 * seed's system no longer has either shape and both checks went red for having
 * lost their fixture. Seed 481 was found by re-running the same classification
 * `scripts/measure-cruise-arrival.ts` uses — host between arrival point and
 * station at leg start — over seeds 1..3000, and it is the one seed in that
 * range that reproduces *both* geometries including the 1.0-1.05 shell band the
 * first claim turns on. A probe whose subject is a generated fixture is
 * invalidated by any regeneration; the re-pick is a scan, not a guess.
 *
 * Both legs are flown by `Game.step`, the same path the player takes.
 *
 * ## The claims
 *
 * 1. The clear-space station is reached: the drop-out fires inside the drop
 *    radius, and not against the host.
 * 2. The occluded one is not: cruise ends against the host, with the ship
 *    outside its surface and inside the shell it no longer projects there.
 * 3. Neither path goes inside a planet, sampled every stepped frame.
 * 4. A station that sat *inside* its host's shell — 49 of 337 in the corpus
 *    before #32, every gas giant among them — could be cruised away from.
 *    Node #32's orbit floor (STATION_ORBIT_R_OVER_R, 1.5) removed that
 *    geometry from the generator, so this claim no longer has a browser
 *    fixture and the probe no longer carries one. The population behind it
 *    is a sweep claim, and the sweep ships: `bun run
 *    scripts/measure-station-shells.ts [seeds]` re-derives, at the t0 placed
 *    positions, that across seeds 1..8000 no station sits inside its own
 *    host's or any foreign body's 1.05 shell (closest own-host approach
 *    1.500 R — the floor itself; the closest pair of any kind is two
 *    co-orbiting stations at 3.2 core radii, still outside every shell).
 *    The rules the
 *    deleted block exercised are pinned headlessly instead:
 *    `tests/cruise.test.ts`, "being inside a shell does not pin the ship
 *    there", for the release rule, and `tests/station-orbits.test.ts` for
 *    the t0 clearance over seeds 1..1500 — so the deleted case fails closed.
 */
import {
	bootedGame,
	guardedOrigin,
	installCamSim,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
/** The seed is the fixture: see the header. A different one is a different
 *  claim, so it is not configurable. */
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=481`;
/** Sim seconds a leg is given. Generous against the ~60 s legs both are. */
const LIMIT_S = 300;

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/** Every fixture in this probe is a named body in a named seed, so a missing
 *  one is a broken probe rather than a failing game — reported once, here. */
async function bailIfMissing(result, label) {
	if (!result.missing) return;
	check(label, false);
	await browser.close();
	exit();
}

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await installCamSim(page);
await page.goto(URL, { waitUntil: "load" });
await bootedGame(page);

const dt = await page.evaluate(() => window.__seelite.units.MAX_DT);

/** Fly one leg to a named station, sampling how close the path came to every
 *  planet, and report the state it ended in. */
async function flyTo(stationId) {
	return page.evaluate(
		async ([stationId, dt, limitS]) => {
			const g = window.__seelite;
			const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
			// The ray a frame's displacement traces. Declared inside the evaluate
			// callback because that is the scope it runs in — the page's, not
			// Node's.
			const segmentRay = (from, to) => {
				const seg = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
				const segLen = Math.hypot(seg.x, seg.y, seg.z);
				return {
					segLen,
					nose:
						segLen === 0
							? { x: 1, y: 0, z: 0 }
							: { x: seg.x / segLen, y: seg.y / segLen, z: seg.z / segLen },
				};
			};
			const station = g.world.system.byId.get(stationId);
			if (!station) return { missing: true };

			g.targetId = stationId;
			g.faceTarget();
			// The host, asked of the page rather than re-derived here: `sim.ts`'s
			// `stationHostIdOf` owns the rule and `targetParentId()` is the handle's
			// spelling of it, so this probe cannot state it differently from the
			// game it is checking.
			const hostId = g.targetParentId();
			const host = hostId ? g.world.system.byId.get(hostId) : null;
			const startKm = dist(station.pos, g.world.ship.pos);
			g.engageCruise();

			// The closest the flown path came to each planet's centre, as a
			// multiple of its radius, sampled per stepped frame from the **sim**
			// position — nothing reads a position back out of an `Object3D`, and a
			// probe that claimed to be measuring the scene graph would be lying
			// about where its numbers come from. `render` is still called every
			// frame because that is the loop the game runs, and it is what makes
			// the page-error handler above worth having.
			let closestRatio = Number.POSITIVE_INFINITY;
			let closestId = null;
			let elapsed = 0;
			let everCruised = false;
			let previous = { ...g.world.ship.pos };
			for (let i = 0; i < limitS / dt; i++) {
				// Re-aimed every frame: the perfect pilot, so that what this probe
				// reports is the geometry and not a steering error. A player steers
				// with the mouse continuously; a nose set once at 1.2 AU and held is
				// neither the game nor the claim, and it grazes the host by drift
				// alone.
				g.faceTarget();
				g.step(dt);
				g.render(dt);
				elapsed += dt;
				if (g.regime === "cruise") everCruised = true;
				// **Swept, not sampled at the endpoints.** One cruise frame covers
				// hundreds of thousands of km, so reading the range once per frame
				// would miss a planet the ship went straight through — the same
				// argument §8.1 makes for the drop-out being a ray test.
				//
				// The arithmetic is `cruise.ts`'s own `closestApproachKm`, reached
				// through the handle: a probe with its own copy of the geometry can
				// go green on a game whose copy differs.
				const now = g.world.ship.pos;
				const { nose, segLen } = segmentRay(previous, now);
				for (const b of g.world.system.bodies) {
					if (b.kind !== "planet" && b.kind !== "star") continue;
					const ratio =
						g.rayMath.closestApproachKm(previous, nose, segLen, b.pos) /
						b.radiusKm;
					if (ratio < closestRatio) {
						closestRatio = ratio;
						closestId = b.id;
					}
				}
				previous = { ...now };
				if (everCruised && g.regime === "normal") break;
			}

			const end = g.world.system.byId.get(stationId);
			const hostNow = hostId ? g.world.system.byId.get(hostId) : null;
			return {
				hostId,
				startKm,
				elapsed,
				exit: g.lastExit,
				regime: g.regime,
				missKm: dist(end.pos, g.world.ship.pos),
				hostRadiusKm: host ? host.radiusKm : null,
				hostRangeRatio: hostNow
					? dist(hostNow.pos, g.world.ship.pos) / hostNow.radiusKm
					: null,
				closestRatio,
				closestId,
				dropRadiusKm: g.cruiseParams.dropRadiusKm,
				surfaceMargin: g.surfaceMargin,
				clearanceKm: g.hostClearanceKm,
			};
		},
		[stationId, dt, LIMIT_S],
	);
}

// ---------------------------------------------------------------- clear space

const clear = await flyTo("station-trade");
await bailIfMissing(
	clear,
	"seed 47 has the trade station this probe is written against",
);
console.log(
	`\nstation-trade: host ${clear.hostId}, ${(clear.startKm / 1e6).toFixed(2)}M km leg, ` +
		`${clear.elapsed.toFixed(1)} s, exit ${clear.exit}\n`,
);

check(
	"a station in clear space is reached, not stopped by its host",
	clear.exit.startsWith("arrived at") && clear.missKm <= clear.dropRadiusKm + 5,
	`${clear.exit} at ${clear.missKm.toFixed(1)} km (radius ${clear.dropRadiusKm} km)`,
);
check(
	"and the path to it stayed outside every planet",
	clear.closestRatio >= 1 - 1e-6,
	`closest was ${clear.closestId} at ${clear.closestRatio.toFixed(6)} × its radius`,
);

// ------------------------------------------------------------------ occluded

await page.reload({ waitUntil: "load" });
await bootedGame(page);
const behind = await flyTo("station-shipyard");
await bailIfMissing(
	behind,
	"seed 47 has the shipyard this probe is written against",
);
console.log(
	`\nstation-shipyard: host ${behind.hostId}, ${(behind.startKm / 1e6).toFixed(2)}M km leg, ` +
		`${behind.elapsed.toFixed(1)} s, exit ${behind.exit}\n`,
);

check(
	"a station genuinely behind its planet is still stopped by it",
	behind.exit === `dropped by proximity to ${behind.hostId}`,
	`${behind.exit} at ${(behind.missKm / 1000).toFixed(0)}k km from the station`,
);
check(
	"the stop is at the host's standoff, not at the shell it no longer projects there",
	behind.hostRangeRatio !== null &&
		behind.hostRangeRatio >= 1 &&
		behind.hostRangeRatio < 1 + (behind.surfaceMargin - 1) / 10,
	`${behind.hostRangeRatio?.toFixed(5)} × the host's radius — the standoff is ` +
		`${behind.clearanceKm} km on a ${(behind.hostRadiusKm / 1000).toFixed(0)}k km world, ` +
		`against the ${behind.surfaceMargin} shell every other body keeps`,
);
check(
	"and that path stayed outside every planet too",
	behind.closestRatio >= 1 - 1e-6,
	`closest was ${behind.closestId} at ${behind.closestRatio.toFixed(6)} × its radius`,
);

await browser.close();
exit();

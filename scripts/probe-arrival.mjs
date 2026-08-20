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
 * geometry: `?seed=47` has one station of each kind in a single system.
 *
 * - `station-trade` orbits a 7,046 km planet whose centre sits 7,086 km across
 *   the line of sight — outside the planet and *inside* the 1.05 × radius shell
 *   it used to project. The station is in clear space and cruise ended against
 *   its host thousands of km short, at thousands of km/s.
 * - `station-shipyard` orbits a 33,002 km planet whose centre is 10,504 km
 *   across the line of sight, so the station is genuinely behind 33,000 km of
 *   world. That leg must still be stopped, and stopped *outside* the surface:
 *   a rule that reaches this one is one that flies through planets.
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
 * 4. A station that sits *inside* its host's shell — 49 of 337 in the corpus,
 *    every gas giant among them — can be cruised away from. Before #30 the
 *    sweep fired on the first sub-step of every engagement there, whatever
 *    heading the ship took. That case needs its own seed, and its own page
 *    load, which is why this probe visits two.
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
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=47`;
/** Sim seconds a leg is given. Generous against the ~60 s legs both are. */
const LIMIT_S = 300;

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, exit } = tally();

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
page.on("pageerror", (e) => check(`no page error (${e.message})`, false));
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
			const station = g.world.system.byId.get(stationId);
			if (!station) return { missing: true };

			g.targetId = stationId;
			g.faceTarget();
			// The host, asked of the page rather than re-derived here: `sim.ts`'s
			// `hostIdOf` owns the rule and `targetParentId()` is the handle's
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
				for (const b of g.world.system.bodies) {
					if (b.kind !== "planet" && b.kind !== "star") continue;
					const ratio = dist(b.pos, g.world.ship.pos) / b.radiusKm;
					if (ratio < closestRatio) {
						closestRatio = ratio;
						closestId = b.id;
					}
				}
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
			};
		},
		[stationId, dt, LIMIT_S],
	);
}

// ---------------------------------------------------------------- clear space

const clear = await flyTo("station-trade");
if (clear.missing) {
	check("seed 47 has the trade station this probe is written against", false);
	await browser.close();
	exit();
}
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
if (behind.missing) {
	check("seed 47 has the shipyard this probe is written against", false);
	await browser.close();
	exit();
}
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
	"the stop is at the host's surface, not at the shell it no longer projects there",
	behind.hostRangeRatio !== null &&
		behind.hostRangeRatio >= 1 - 1e-6 &&
		behind.hostRangeRatio < 1 + (behind.surfaceMargin - 1) / 10,
	`${behind.hostRangeRatio?.toFixed(4)} × the host's radius ` +
		`(the shell every other body keeps is ${behind.surfaceMargin})`,
);
check(
	"and that path stayed outside every planet too",
	behind.closestRatio >= 1 - 1e-6,
	`closest was ${behind.closestId} at ${behind.closestRatio.toFixed(6)} × its radius`,
);

// ------------------------------- a station inside its host's shell can cruise out

/**
 * A different seed, because the case is a different geometry.
 *
 * `?seed=118`'s shipyard orbits a 65,977 km gas giant 2,784 km *inside* the
 * 1.05 shell that giant projects — the worst of the 49 such stations in the
 * corpus. Before #30 the sweep fired on the first sub-step of every engagement
 * from there, whatever heading the ship took, and the only way out was to crawl
 * those 2,784 km at the 2 km/s assist cap: twenty-three minutes.
 *
 * Flown from the station rather than from a drop point, and that distinction is
 * the check: a ship dropped *at* a shell sits on its boundary and the spool-up
 * carries it clear, so a probe written there is green against the old rule too.
 * This one is not.
 */
await page.goto(`${ORIGIN}/?seed=118`, { waitUntil: "load" });
await bootedGame(page);

const escape = await page.evaluate(
	async ([dt]) => {
		const g = window.__seelite;
		g.targetId = "station-shipyard";
		const hostId = g.targetParentId();
		if (!hostId) return { missing: true };
		const station = g.world.system.byId.get("station-shipyard");
		const host = g.world.system.byId.get(hostId);
		const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
		const shellGapKm =
			host.radiusKm * g.surfaceMargin - dist(station.pos, host.pos);

		// Undocked, at the station. §6 allows free cruise with nothing selected,
		// and what is measured is whether the guard releases the ship.
		g.world.ship.pos = { ...station.pos };
		g.targetId = null;
		g.faceAway(hostId);
		g.engageCruise();
		const start = { ...g.world.ship.pos };
		for (let i = 0; i < 10 / dt; i++) {
			g.step(dt);
			g.render(dt);
		}
		return {
			shellGapKm,
			hostRadiusKm: host.radiusKm,
			travelledKm: dist(start, g.world.ship.pos),
			regime: g.regime,
		};
	},
	[dt],
);

if (escape.missing) {
	check("seed 118 has the shipyard this probe is written against", false);
	await browser.close();
	exit();
}

check(
	"the fixture station really is inside its host's shell",
	escape.shellGapKm > 1000,
	`${escape.shellGapKm.toFixed(0)} km inside the shell of a ` +
		`${(escape.hostRadiusKm / 1000).toFixed(0)}k km giant — ` +
		`${(escape.shellGapKm / 2 / 60).toFixed(0)} minutes of crawling at the assist cap`,
);
check(
	"and cruise engages from it, aimed outward",
	escape.travelledKm > 1e5,
	`${(escape.travelledKm / 1e6).toFixed(2)}M km in ten seconds`,
);

await browser.close();
exit();

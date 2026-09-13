/**
 * Cruise reaches stations beside and behind their host planets — spec §12,
 * flown in the browser.
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
 * - `station-shipyard` orbits a 35,192 km planet whose centre sits 17,758 km
 *   across the line of sight — 0.505 × the radius, so the sight line passes
 *   half a planet deep and the station is genuinely behind 35,000 km of world.
 *   Automatic guidance must route around that host without changing the
 *   selected station or flying through the planet.
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
 * 2. The occluded one is reached by automatic detour while retaining safe
 *    clearance from the host surface.
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
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
/** The seed is the fixture: see the header. A different one is a different
 *  claim, so it is not configurable. */
const SEED = 481;
const URL = gameUrl(
	ORIGIN,
	{ seed: SEED },
	{ override: process.env.PROBE_URL },
);
/** Sim seconds a leg is given. Generous against the ~60 s legs both are. */
const LIMIT_S = 300;

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/** Straight-line distance between two sim positions, driver-side. `flyTo` has
 *  its own copy inside the `evaluate` callback because that runs in the page's
 *  scope, not this one. */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Every fixture in this probe is a named body in a named seed, so a missing
 *  one is a broken probe rather than a failing game — reported once, here.
 *
 *  The caller passes the *subject* and not the sentence: the seed comes from
 *  {@link FIXTURE}, which the page reports, so the one line a reader sees when
 *  the fixture is gone cannot name a seed the probe did not fly. */
async function bailIfMissing(result, subject) {
	if (!result.missing) return;
	check(`${FIXTURE} has ${subject} this probe is written against`, false);
	await browser.close();
	exit();
}

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await installCamSim(page);
await page.goto(URL, { waitUntil: "load" });
await bootedGame(page);

const dt = await page.evaluate(() => window.__seelite.units.MAX_DT);

/** How the bail messages below name the fixture — **the seed the page reports
 *  building its world from**, not the one this script asked for. Read rather
 *  than restated, because a restatement is what #118's re-pick left behind:
 *  both messages went on naming the seed the header records as retired, long
 *  after the probe stopped flying it, and a bail message is the one line a
 *  reader trusts to say where to go and look (#169).
 *
 *  Reading it off the page rather than off {@link URL} is the same rule the
 *  `dt` above follows, and here it is also the only correct source: `?seed=`
 *  is normalised (`Math.abs(Math.trunc())`) and an unusable one is *ignored*
 *  for a random world (`seedFromQuery`, `src/main.ts`), so a `PROBE_URL`
 *  carrying `-481.9` or `abc` flies a world the query string does not name. */
const FIXTURE = `seed ${await page.evaluate(() => window.__seelite.world.seed)}`;

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
				// Direct cruise still needs the perfect pilot this geometry probe has
				// always supplied. Once automatic guidance owns a detour, though,
				// re-aiming at the selected station would fight it every frame.
				if (!g.detour) g.faceTarget();
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
				endPos: { ...g.world.ship.pos },
				endNose: { ...g.nose() },
				gameTimeAtEnd: g.world.gameTime,
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

/**
 * The state a leg starts from — what the reset has to put back.
 *
 * Read through the handle rather than recomputed here: a probe with its own
 * copy of what boot state is can agree with itself while disagreeing with the
 * game.
 */
/** The session fields the reset is checked on, named once. Two lists is how a
 *  sixth field gets read and never compared. */
const SESSION_FIELDS = [
	"regime",
	"chargeAu",
	"spoolLeftS",
	"lastExit",
	"targetId",
];

async function startState() {
	return page.evaluate((fields) => {
		const g = window.__seelite;
		const session = Object.fromEntries(fields.map((f) => [f, g[f]]));
		return {
			...session,
			pos: { ...g.world.ship.pos },
			vel: { ...g.world.ship.vel },
			// The nose. `step` turns the ship by mutating `orientation` in place,
			// which is how the first version of the reset came to restore position
			// and velocity and leave the attitude from the previous leg.
			nose: { ...g.nose() },
			gameTime: g.world.gameTime,
		};
	}, SESSION_FIELDS);
}

// ---------------------------------------------------------------- clear space

const booted = await startState();
const clear = await flyTo("station-trade");
await bailIfMissing(clear, "the trade station");
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

// --------------------------------------------------------------- the reset

/**
 * **No navigation between the legs**, which is the map constraint #121 added:
 * a page under measurement is never navigated. This used to be a `page.reload`
 * and it timed out at 30 s — six times a slow cold boot — because the leg above
 * runs its whole step-and-render loop inside one `page.evaluate` with no
 * `await`, so a navigation is the first call that has to interrupt whatever
 * that left running and the timeout lands there rather than on the cause.
 *
 * The reset is the game's own `resetFlightToStart`, guarded on the headless tier by
 * `tests/world-reset.test.ts` (the world half, against a real `makeWorld`) and
 * `tests/leg-reset-coverage.test.ts` (the renderer's own session fields). What
 * *this* file adds is the one thing neither of those can see: that the reset
 * ran in this browser, on this page, after a leg that actually moved the ship.
 */
await page.evaluate(() => window.__seelite.resetFlightToStart());
const back = await startState();

const drift = dist(back.pos, booted.pos);
const flown = dist(clear.endPos, booted.pos);

check(
	"the reset puts the ship back at the arrival point the fixture was chosen against",
	// A tolerance rather than `=== 0`, to match the nose check beside it. The
	// exact form held only because this fixture's arrival point has no body
	// inside `NEAR_FAR_KM`, so the assist's local frame is zero and a ship at
	// rest truly does not move between boot and the snapshot. On a fixture where
	// it is non-zero that check reddens for a reason that is not the reset.
	drift < 1e-6,
	`${drift.toExponential(2)} km from where the first leg started`,
);
check(
	"and the leg above had moved it, so that is not a comparison of nothing",
	flown > 1e6,
	`the first leg ended ${(flown / 1e6).toFixed(1)}M km away`,
);
check(
	"and the nose is a fresh boot's, not the heading the last leg finished on",
	dist(back.nose, booted.nose) < 1e-9 &&
		dist(clear.endNose, booted.nose) > 1e-3,
	`${dist(back.nose, booted.nose).toExponential(1)} from boot, against ` +
		`${dist(clear.endNose, booted.nose).toFixed(3)} at the end of the leg`,
);
/**
 * The discrete session fields, one by one, so a failure names the field.
 *
 * The clock is **not** among them and that is not an oversight. This page is a
 * running game: `requestAnimationFrame` keeps stepping between the reset and
 * the read, so `gameTime` is already off zero by the time anything can look at
 * it — the snapshot above was taken at 0.1 s for the same reason. An exact
 * equality there would be asserting that two reads of a moving number agree,
 * which is a flake dressed as a check. What the clock owes is below.
 */
const session = SESSION_FIELDS.map((field) => [
	field,
	back[field],
	booted[field],
]);
// `undefined !== undefined` is false, so a field renamed on `Game` would make
// both sides `undefined` and the check would go green having compared nothing —
// on the one field the headless tier does not cover. A missing read is a
// failure, not a match.
const wrong = session.filter(
	([, got, want]) => got === undefined || got !== want,
);
check(
	"and the session state is a fresh boot's",
	wrong.length === 0,
	wrong.length
		? wrong
				.map(
					([f, got, want]) =>
						`${f} is ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
				)
				.join("; ")
		: session.map(([f, got]) => `${f} ${JSON.stringify(got)}`).join(", "),
);
check(
	"and the clock went back to the t0 the fixture was classified at",
	// Against the clock *before* the reset, and against zero — not against a
	// fraction of the leg. A reset that left the bodies at 40% of the leg would
	// have satisfied the first version of this check, and 40% of a leg is a `t`
	// the seed-481 classification was never run at.
	//
	// The margin is **ten** max-length frames, not one: `dt` is `MAX_DT`, which
	// is also `animate`'s per-frame clamp, so this admits 1.0 s of rAF slack
	// across the CDP round trip between the reset and this read. Wide, and
	// deliberately so — the leg it is separating from is 66 s. An earlier
	// version of this comment said one frame while the code said ten.
	back.gameTime < clear.gameTimeAtEnd && back.gameTime <= dt * 10,
	`${back.gameTime.toFixed(2)} s, down from ${clear.gameTimeAtEnd.toFixed(1)} s at the end of the leg`,
);

// ------------------------------------------------------------------ occluded

const behind = await flyTo("station-shipyard");
await bailIfMissing(behind, "the shipyard");
console.log(
	`\nstation-shipyard: host ${behind.hostId}, ${(behind.startKm / 1e6).toFixed(2)}M km leg, ` +
		`${behind.elapsed.toFixed(1)} s, exit ${behind.exit}\n`,
);

check(
	"a station genuinely behind its planet is reached by automatic detour",
	behind.exit.startsWith("arrived at") &&
		behind.missKm <= behind.dropRadiusKm + 5,
	`${behind.exit} at ${(behind.missKm / 1000).toFixed(0)}k km from the station`,
);
check(
	"the automatic detour clears the host surface",
	behind.closestRatio >= 1 - 1e-6,
	`closest was ${behind.closestId} at ${behind.closestRatio.toFixed(6)} × its radius`,
);
check(
	"and that path stayed outside every planet too",
	behind.closestRatio >= 1 - 1e-6,
	`closest was ${behind.closestId} at ${behind.closestRatio.toFixed(6)} × its radius`,
);

await browser.close();
exit();

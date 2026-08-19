/**
 * Cruise, flown — spec §9.9, and the check node #14 was created to make
 * possible.
 *
 *   npm run dev                      # in one shell
 *   node scripts/probe-cruise.mjs    # in another
 *
 * ## What this measures that `probe-handoff.mjs` cannot
 *
 * That probe *places* the ship at multiples of `HANDOFF_KM` and reads a frame,
 * because when it was written nothing in the game could travel far enough to
 * arrive at one under its own power. It answers "is the seam continuous when
 * you stand on either side of it".
 *
 * This one flies the seam. §8.2 is explicit that cruise is the first thing that
 * will ever cross `HANDOFF_KM`, at ~7,450 km/s with the last 10,000 km taking
 * under four seconds, and that a scale pop there would be *seen*. The
 * difference between the two probes is the difference between a static
 * measurement and a moving one: the frame the body changes layer on is chosen
 * by the renderer here, not by the probe, and it is the frame where a
 * reparent-without-rescale shows up.
 *
 * ## How it flies without taking a minute per run
 *
 * `Game.step(dt)` and `Game.render(dt)` are called directly in a loop, with a
 * fixed delta, rather than waiting on the frame loop. That is the reason both
 * are methods taking a `dt` rather than statements inside `animate` — a probe
 * runs exactly what the game runs, at its own pace. A 1.3 AU leg is ~68 s of
 * sim time, which is ~700 iterations and about a second of wall clock.
 *
 * The page's own `requestAnimationFrame` loop keeps running underneath and
 * steps the world with real deltas of a few milliseconds. That is noise on the
 * clock, not on the claim: every sample below is read in the same evaluate as
 * the position it is checked against, so no sample mixes two frames.
 *
 * ## The claims
 *
 * 1. Cruise engages only after the spool-up, and the leg is really flown at
 *    superluminal speed (otherwise every check below is measuring normal
 *    flight).
 * 2. The target body changes layer during the approach — the crossing happened
 *    at all.
 * 3. Apparent size is continuous across it: consecutive samples either side of
 *    `HANDOFF_KM` agree to within what their separation in distance explains.
 *    This is §9.9, and the failure it catches is a 10⁵ pop on one frame.
 * 4. The drop-out fires inside the drop radius, and the ship leaves cruise at or
 *    below the assist cap (§1, §3) — the exit state, measured rather than
 *    asserted from the unit tests.
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
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=42`;

/** Sim seconds per stepped frame — the game's own `MAX_DT`, read off the page
 *  below rather than restated here. The run is therefore the worst case for
 *  anything that sub-steps, whatever that constant becomes. */
/** Sim seconds the leg is given before the run is called a failure. Generous
 *  against the spec's 68 s typical leg and its 186 s outer-planet one. */
const LIMIT_S = 400;

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, exit } = tally();

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
page.on("pageerror", (e) => check(`no page error (${e.message})`, false));
// The shared camera recovery, installed as an init script — `probe-boot.mjs`
// uses the same one, and re-deriving `shipSim - shipMesh` in each probe is one
// more place for the camera-relative contract to be restated slightly wrong.
await installCamSim(page);
await page.goto(URL, { waitUntil: "load" });
await bootedGame(page);

const dt = await page.evaluate(() => window.__seelite.units.MAX_DT);

const flight = await page.evaluate(
	async ([dt, limitS]) => {
		const g = window.__seelite;
		const handoffKm = g.units.HANDOFF_KM;
		const farScale = g.units.FAR_SCALE;

		// A station: small enough that every sample sits outside its radius, which
		// is what keeps `radius / distance` an unambiguous angle. Same subject as
		// `probe-handoff.mjs`, for the same reason.
		// Small helpers rather than six spelled-out `Math.hypot` blocks — the
		// distance between two points and the length of a vector, which is all
		// this probe ever measures.
		const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
		const mag = (v) => Math.hypot(v.x, v.y, v.z);

		const station = g.world.system.bodies.find((b) => b.kind === "station");
		if (!station) return { noStation: true };
		g.targetId = station.id;
		g.faceTarget();

		const startKm = dist(station.pos, g.world.ship.pos);
		// The tank as the page has it, not as this file remembers it: §7's
		// capacity is one of the numbers #14 exists to retune, and a probe holding
		// its own copy goes falsely red the day it moves.
		const chargeBefore = g.chargeAu;

		g.engageCruise();
		const samples = [];
		let peakC = 0;
		let engagedAtS = null;
		let elapsed = 0;
		const startedGameTime = g.world.gameTime;

		// Until the ship is back in normal flight *having been* in cruise — the
		// regime starts normal, so a bare `regime !== "normal"` exits before the
		// spool-up has even run.
		for (let i = 0; i < limitS / dt; i++) {
			if (engagedAtS !== null && g.regime === "normal") break;
			// Re-aim every frame: the station is on an orbit and the ship is
			// nose-locked (§1), so a course set once misses by more than the drop
			// radius over a 68 s leg. A player watching the HUD does the same thing
			// with the stick.
			g.faceTarget();
			// **No reference pilot.** Full throttle, nose on the target, nothing
			// else — and it arrives. Two rounds ago this loop carried a
			// hand-written approach controller (lead pursuit, a throttle curve, a
			// closing-speed budget) because without one the ship sailed past the
			// drop radius at thousands of km/s every time. The approach clamp
			// inside `cruise.ts` is what replaced it, and *this* is the check that
			// it did: if the clamp regresses, the probe stops arriving.
			g.setThrottle(1);
			g.step(dt);
			g.render(dt);
			elapsed += dt;
			if (g.regime === "cruise" && engagedAtS === null) engagedAtS = elapsed;
			peakC = Math.max(peakC, g.cruiseSpeedKms / g.units.C_KMS);

			const body = g.world.system.byId.get(station.id);
			if (!body) continue;
			// The camera's sim position, from `probe-guard`'s shared recovery — read
			// in the same evaluate as everything else, so it is the same frame.
			const cam = window.__recoverCamSim();
			if (!cam) continue;
			const trueDistance = dist(body.pos, cam);
			// Only the neighbourhood of the seam is worth carrying back: a whole
			// leg is thousands of samples, and the claim is about the crossing.
			if (trueDistance > handoffKm * 4 || trueDistance < handoffKm * 0.05)
				continue;
			const nearMesh = g.nearScene.getObjectByName(station.id);
			const mesh = nearMesh ?? g.farScene.getObjectByName(station.id);
			if (!mesh) continue;
			samples.push({
				layer: nearMesh ? "near" : "far",
				trueDistance,
				drawnRadius: mesh.scale.x,
				drawnDistance: Math.hypot(
					mesh.position.x,
					mesh.position.y,
					mesh.position.z,
				),
				radiusKm: body.radiusKm,
			});
		}

		const target = g.world.system.byId.get(station.id);
		const missKm = dist(target.pos, g.world.ship.pos);

		// **After** the drop-out, fly normal flight for a while with the throttle
		// shut and see whether the station is still there. This is the check the
		// exit clamp is really making: the previous version compared
		// `ship.vel` against the cap on the same frame `exitVelocity` wrote it,
		// which restates the clamp rather than measuring anything. Holding station
		// under the 2 km/s cap is a property of the *frame* the ship was left in,
		// and it fails outright against an absolute clamp — the station leaves at
		// its orbital speed and normal flight cannot follow.
		// Read **before** the hold loop: `ship.vel` thirty seconds later is what
		// the assist has made of it, not what cruise left behind.
		const exitSpeedKms = mag(g.world.ship.vel);
		const exitClosingKms = mag({
			x: g.world.ship.vel.x - g.targetVelocity().x,
			y: g.world.ship.vel.y - g.targetVelocity().y,
			z: g.world.ship.vel.z - g.targetVelocity().z,
		});

		// Everything the arrival is judged on is read here, before the hold loop
		// runs: thirty seconds of normal flight advance the clock and regenerate
		// the tank (§7), and a check that read them afterwards would be measuring
		// the hold rather than the leg.
		const gameTimeAdvanced = g.world.gameTime - startedGameTime;
		const chargeAfterLeg = g.chargeAu;

		const holdStartKm = missKm;
		g.setThrottle(0);
		for (let i = 0; i < 300; i++) {
			g.step(dt);
			g.render(dt);
		}
		const holdEndKm = dist(
			g.world.system.byId.get(station.id).pos,
			g.world.ship.pos,
		);
		return {
			handoffKm,
			farScale,
			id: station.id,
			startKm,
			startAu: startKm / g.units.AU_KM,
			elapsed,
			engagedAtS,
			legS: g.lastLegS,
			gameTimeAdvanced,
			peakC,
			regime: g.regime,
			exit: g.lastExit,
			missKm,
			exitSpeedKms,
			// The figure the cap is actually stated against: the ship's velocity in
			// the destination's frame. The absolute one beside it is ~30 km/s and
			// always will be — that is the station going round its star, not the
			// ship going anywhere.
			exitClosingKms,
			holdStartKm,
			holdEndKm,
			holdSeconds: 300 * dt,
			// Off the page, like every other constant here.
			assistCapKms: g.assistCapKms,
			chargeBefore,
			dropRadiusKm: g.cruiseParams.dropRadiusKm,
			chargeAu: chargeAfterLeg,
			samples,
		};
	},
	[dt, LIMIT_S],
);

if (flight.noStation) {
	check("the system has a station to cruise to", false);
	await browser.close();
	exit();
}

console.log(
	`\n${flight.id}: ${flight.startAu.toFixed(2)} AU leg, ` +
		`${flight.elapsed.toFixed(1)} s of sim time, peak ${flight.peakC.toFixed(1)} c, ` +
		`${flight.samples.length} samples near the seam\n`,
);

// (1) The regime really engaged, after the spool-up, and really went
// superluminal. Without this every check below could be measuring a ship that
// never left normal flight.
check(
	"cruise engaged only after the spool-up",
	flight.engagedAtS !== null && flight.engagedAtS >= 2.5,
	`engaged at t+${flight.engagedAtS?.toFixed(1)}s`,
);
check(
	"the leg was flown at superluminal speed",
	flight.peakC > 1,
	`peak ${flight.peakC.toFixed(1)} c`,
);
check(
	"sim time was not compressed — the clock advanced by the sim seconds flown",
	Math.abs(flight.gameTimeAdvanced - flight.elapsed) < flight.elapsed * 0.25,
	`clock +${flight.gameTimeAdvanced.toFixed(1)}s over ${flight.elapsed.toFixed(1)}s flown`,
);

// (2) The crossing happened. Every continuity check is vacuous against a
// renderer that never changed the body's layer.
const layers = new Set(flight.samples.map((s) => s.layer));
check(
	"the target crossed the layer handoff during the approach",
	layers.size === 2,
	`layers seen: ${[...layers].join(", ") || "none"}`,
);

// (3) §9.9: apparent size is continuous across it. Consecutive samples are
// compared against what their own separation in distance explains — at
// 7,450 km/s and a 0.1 s step the ship covers 745 km, so neighbouring samples
// can legitimately differ by ~7% in apparent size. A layer pop is 10⁵.
let worst = null;
for (let i = 1; i < flight.samples.length; i++) {
	const a = flight.samples[i - 1];
	const b = flight.samples[i];
	if (a.layer === b.layer) continue;
	const angleA = a.drawnRadius / a.drawnDistance;
	const angleB = b.drawnRadius / b.drawnDistance;
	// What the distance alone accounts for, plus a fifth for the frame the swap
	// happens on. The bar is nowhere near a factor of 10⁵.
	const explained = (a.trueDistance / b.trueDistance) * 1.2;
	const ratio = angleB / angleA;
	if (!worst || Math.abs(Math.log(ratio)) > Math.abs(Math.log(worst.ratio))) {
		worst = { ratio, explained, a, b };
	}
}
check(
	"apparent size is continuous across the layer swap, in flight",
	worst !== null &&
		worst.ratio > 1 / worst.explained &&
		worst.ratio < worst.explained,
	worst
		? `swap at ${worst.a.trueDistance.toFixed(0)} → ${worst.b.trueDistance.toFixed(0)} km, ` +
				`apparent size ×${worst.ratio.toFixed(3)} (distance alone explains ×${worst.explained.toFixed(3)})`
		: "no layer swap was sampled",
);

// The scale factor each layer applied, over the whole approach — the check
// `probe-handoff.mjs` found the first version of itself could not make, kept
// here because this run crosses the seam under power rather than by placement.
let factorsAgree = true;
let factorIsLayers = true;
for (const s of flight.samples) {
	const kRadius = s.drawnRadius / s.radiusKm;
	const kPosition = s.drawnDistance / s.trueDistance;
	if (Math.abs(kRadius - kPosition) > 1e-3 * Math.max(kRadius, kPosition))
		factorsAgree = false;
	const want = s.layer === "near" ? 1 : flight.farScale;
	if (Math.abs(kPosition - want) > 1e-2 * want) factorIsLayers = false;
}
check(
	"radius and position are scaled by the same factor, every frame",
	factorsAgree,
);
check(
	"and it is the factor that frame's layer is supposed to use",
	factorIsLayers,
);

// (4) The exit state, §1 and §3 — measured in the browser rather than inferred
// from the headless suite, because this is the path the player actually takes.
check(
	"the drop-out fired inside the drop radius",
	flight.regime === "normal" && flight.missKm <= flight.dropRadiusKm + 5,
	`${flight.exit} at ${flight.missKm.toFixed(1)} km ` +
		`(radius ${flight.dropRadiusKm} km)`,
);
check(
	"the ship left cruise at or below the assist cap, relative to its destination",
	flight.exitClosingKms <= flight.assistCapKms + 1e-6,
	`${flight.exitClosingKms.toFixed(3)} km/s closing against a ${flight.assistCapKms} km/s cap ` +
		`(${flight.exitSpeedKms.toFixed(1)} km/s absolute — the station's own orbit)`,
);
check(
	"the leg cost charge in proportion to its length",
	Math.abs(flight.chargeBefore - flight.chargeAu - flight.startAu) < 0.25,
	`${(flight.chargeBefore - flight.chargeAu).toFixed(2)} AU spent on a ` +
		`${flight.startAu.toFixed(2)} AU leg, from a ${flight.chargeBefore} AU tank`,
);

// And the arrival is one you can stay at. Under an absolute clamp the station
// simply leaves — at ~30 km/s it is 900 km away after half a minute, and normal
// flight tops out at 2 km/s.
check(
	"the ship can hold station after the drop-out",
	flight.holdEndKm <
		flight.holdStartKm + flight.assistCapKms * flight.holdSeconds,
	`${flight.holdStartKm.toFixed(1)} km → ${flight.holdEndKm.toFixed(1)} km over ` +
		`${flight.holdSeconds.toFixed(0)} s with the throttle shut`,
);

console.log(
	`\nleg time: ${flight.legS === null ? "—" : `${flight.legS.toFixed(1)} s`} ` +
		`for ${flight.startAu.toFixed(2)} AU — the number #14 is here to judge\n`,
);

await browser.close();
exit();

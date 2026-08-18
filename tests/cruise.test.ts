/**
 * The cruise regime's arithmetic — spec §9.1–§9.6, everything in
 * `docs/specs/in-system-travel.md` that can be checked without a browser.
 *
 * Written first, against the spec's own numbers, because this node exists to
 * find out which of those numbers are wrong: a test that was written after the
 * integrator would be a test of the integrator, and the whole point is to be
 * able to change `V_MAX` and `EXPONENT` and see what breaks. What must *not*
 * break under retuning is asserted as a property (monotonicity, no tunnelling,
 * exit clamped, charge conserved); what the spec derived numerically is
 * asserted against `DEFAULT_CRUISE` so that changing the defaults is a visible,
 * deliberate edit here rather than a silent drift.
 *
 * §9.7 (interdiction symmetry) and §9.8 (spool-up cancelled by damage) are not
 * here: interdiction is #8's, and this node's text puts it out of scope.
 */
import { expect, test } from "bun:test";
import {
	ASSIST_CAP_KMS,
	CHARGE_CAPACITY_AU,
	CHARGE_REGEN_AU_PER_S,
	DEFAULT_CRUISE,
	SUBSTEP_FRACTION,
	advanceCruise,
	chargeAfterRegen,
	closingSpeed,
	cruiseSpeed,
	exitVelocity,
	nearestMass,
} from "../src/cruise";
import { ARRIVAL_CLEARANCE_AU, MAX_ORBIT_AU } from "../src/system";
import { AU_KM, HANDOFF_KM } from "../src/units";
import { type Vec3, add, length, scale, sub, v3 } from "../src/vec3";

const P = DEFAULT_CRUISE;

/** A unit vector from `a` to `b`, in float64 — the ship's nose, in the tests
 *  that fly straight at something. */
function towards(a: Vec3, b: Vec3): Vec3 {
	const d = sub(b, a);
	return scale(d, 1 / length(d));
}

/** A star at the origin and one planet, which is the geometry every pacing
 *  claim in §2.3 is implicitly stated against: one mass, straight at it. */
function oneMassAt(pos: Vec3, radiusKm = 6000) {
	return [{ id: "planet", pos, radiusKm }];
}

/**
 * Fly from `from` towards `target` until the drop-out fires or `limitS` runs
 * out, at full throttle, in `dt` steps.
 *
 * The runner the pacing and tunnelling claims share. It returns what a probe
 * would want to read off the HUD — elapsed seconds, distance travelled, the
 * closest the ship ever came to each mass — rather than only a pass/fail, so a
 * failure prints the number that was wrong.
 */
function fly(opts: {
	from: Vec3;
	target: { pos: Vec3; radiusKm: number };
	masses: { id: string; pos: Vec3; radiusKm: number }[];
	dt: number;
	limitS?: number;
	params?: typeof DEFAULT_CRUISE;
	throttle?: number;
	/** Hold the nose where it started instead of re-aiming at the target every
	 *  frame. What an overshoot actually looks like: the player was pointed at
	 *  the station and sailed past it, not a homing missile. */
	fixedNose?: boolean;
}) {
	const params = opts.params ?? P;
	const limitS = opts.limitS ?? 600;
	let pos = opts.from;
	let t = 0;
	let travelledKm = 0;
	let dropped = false;
	let minApproach = Number.POSITIVE_INFINITY;
	let maxSubsteps = 0;
	let speedKms = 0;
	const startNose = towards(opts.from, opts.target.pos);
	while (t < limitS && !dropped) {
		const step = advanceCruise({
			pos,
			nose: opts.fixedNose ? startNose : towards(pos, opts.target.pos),
			throttle: opts.throttle ?? 1,
			dt: opts.dt,
			masses: opts.masses,
			target: opts.target,
			params,
		});
		pos = step.pos;
		travelledKm += step.travelledKm;
		dropped = step.dropped;
		speedKms = step.speedKms;
		maxSubsteps = Math.max(maxSubsteps, step.substeps);
		t += opts.dt;
		for (const m of opts.masses) {
			minApproach = Math.min(minApproach, length(sub(pos, m.pos)) - m.radiusKm);
		}
	}
	return { t, pos, travelledKm, dropped, minApproach, maxSubsteps, speedKms };
}

// ---------------------------------------------------------------- §9.1 speed law

test("the speed law matches the spec's table at every sampled distance", () => {
	// §2.3's key speeds, which are the spec's own arithmetic — so this is the
	// check that the implementation is the law that was argued, not a different
	// curve that happens to feel similar.
	const at = (km: number) => cruiseSpeed(km, P);
	expect(at(AU_KM)).toBeCloseTo(P.vMaxKms, 0); // ≥ d_ref: capped
	expect(at(P.dRefKm)).toBeCloseTo(P.vMaxKms, 0);
	expect(at(HANDOFF_KM) / 7450).toBeCloseTo(1, 1); // the layer handoff
	expect(at(1000) / 1327).toBeCloseTo(1, 1);
	expect(at(50) / 140).toBeCloseTo(1, 1); // where the drop-out fires
});

test("the speed law is clamped at both ends and monotonic between them", () => {
	// The property that has to survive retuning: this node is expected to change
	// `vMaxKms` and `exponent`, and neither end of the clamp nor the direction of
	// the curve is a tuning question.
	expect(cruiseSpeed(1e9, P)).toBe(P.vMaxKms);
	expect(cruiseSpeed(0, P)).toBe(P.vMinKms);
	expect(cruiseSpeed(-1, P)).toBe(P.vMinKms);
	let previous = 0;
	for (let km = 1; km < P.dRefKm; km *= 1.7) {
		const v = cruiseSpeed(km, P);
		expect(v).toBeGreaterThanOrEqual(previous);
		previous = v;
	}
});

test("speed keys off the nearest star or planet, never a moon or a station", () => {
	// §2.1: a station's own planet would otherwise throttle the final approach
	// permanently, and the exclusion is what keeps the last kilometres flyable.
	const masses = oneMassAt(v3(AU_KM, 0, 0));
	const near = nearestMass(v3(AU_KM - 1000, 0, 0), masses);
	expect(near?.id).toBe("planet");
	expect(near?.km).toBeCloseTo(1000, 6);
	// No masses at all — deep space between systems, or a caller that filtered
	// the list down to nothing. The law has to answer something, and the answer
	// is "nothing is near", not a crash.
	expect(nearestMass(v3(), [])).toBe(null);
	expect(cruiseSpeed(Number.POSITIVE_INFINITY, P)).toBe(P.vMaxKms);
});

// ------------------------------------------------------------------ §9.2 pacing

// §2.3's table, with the geometry it is stated against: one mass at the
// destination, the ship flying straight in from `legAu` away. The tolerance is
// the spec's own 10%.
test.each([
	["short hop", 0.2, 38],
	["typical leg", 1.3, 68],
	["outer planet", 6.0, 186],
])("a %s (%p AU) takes about %p s", (_name, legAu, wantS) => {
	const target = { pos: v3(), radiusKm: 6000 };
	const from = v3(legAu * AU_KM, 0, 0);
	const flight = fly({
		from,
		target,
		masses: oneMassAt(target.pos, target.radiusKm),
		dt: 0.1,
		limitS: wantS * 3,
	});
	expect(flight.dropped).toBe(true);
	expect(flight.t).toBeGreaterThan(wantS * 0.9);
	expect(flight.t).toBeLessThan(wantS * 1.1);
});

test("the pacing is the same at every frame delta up to MAX_DT", () => {
	// A crossing whose duration depends on the frame rate is a simulation that
	// cannot be tuned by flying it — the number the principal judges would be a
	// property of his display. Sub-stepping is what makes this hold; it is the
	// claim §8.1 is really making.
	const target = { pos: v3(), radiusKm: 6000 };
	const from = v3(1.3 * AU_KM, 0, 0);
	const times = [0.016, 0.033, 0.1].map(
		(dt) =>
			fly({
				from,
				target,
				masses: oneMassAt(target.pos, target.radiusKm),
				dt,
				limitS: 300,
			}).t,
	);
	for (const t of times) expect(Math.abs(t - times[0])).toBeLessThan(1.0);
});

// ------------------------------------------------------------- §9.3 no tunnelling

test("a cruise line past a planet never places the ship inside it", () => {
	// §9.3 as the spec states it: a line *passing* within one radius. The law
	// slows the ship as it nears the mass, so the pass costs time and the
	// trajectory bends around nothing — it simply never gets there fast enough
	// to step across the body between ticks.
	const planet = { id: "planet", pos: v3(), radiusKm: 6000 };
	for (const dt of [0.016, 0.05, 0.1]) {
		for (const missKm of [6000, 9000, 20000]) {
			const flight = fly({
				from: v3(0.3 * AU_KM, missKm, 0),
				// A target far past the planet, so nothing drops the ship out early:
				// the run is the full 60 s of flying the line.
				target: { pos: v3(-0.3 * AU_KM, missKm, 0), radiusKm: 1 },
				masses: [planet],
				dt,
				limitS: 60,
				fixedNose: true,
			});
			expect(
				flight.minApproach,
				`miss ${missKm} km at dt=${dt}`,
			).toBeGreaterThan(0);
		}
	}
});

test("flying head-on at a planet crawls in rather than teleporting through", () => {
	// The case §9.3 does *not* cover, pinned so it is a known behaviour rather
	// than a surprise: aimed at the centre with the throttle open, the ship
	// converges on the body asymptotically — each sub-step covers a fixed
	// fraction of what is left — and there is no collision to stop it. It ends up
	// inside the sphere at a crawl.
	//
	// What must hold is the *tunnelling* claim, which is narrower than "never
	// inside": no single tick ever moves the ship further than its distance to
	// the mass, so it never appears on the far side without having been inside.
	// Collision is #8's, and the drop-out (§3) is what a player aimed at a
	// station actually meets first.
	const planet = { id: "planet", pos: v3(), radiusKm: 6000 };
	let pos = v3(0.05 * AU_KM, 0, 0);
	const nose = towards(pos, planet.pos);
	for (let i = 0; i < 600; i++) {
		const before = length(sub(pos, planet.pos));
		// Stop once the ship is within a kilometre of the *centre* — six thousand
		// kilometres inside a planet that has no collision, where the arithmetic is
		// no longer describing anything a player can do. Below a millimetre the
		// sub-step floor does eventually carry the ship across the centre point,
		// which is a property of the epsilon and not a claim about flight.
		if (before < 1) break;
		const step = advanceCruise({
			pos,
			nose,
			throttle: 1,
			dt: 0.1,
			masses: [planet],
			target: null,
			params: P,
		});
		expect(step.travelledKm).toBeLessThan(before);
		pos = step.pos;
	}
	// And it really did end up deep inside, which is the honest half of the claim.
	expect(length(sub(pos, planet.pos))).toBeLessThan(planet.radiusKm);
});

test("a grazing pass costs time rather than passing through", () => {
	// §2.1's second claim: scenery bodies are navigation features, so a line that
	// grazes a gas giant covers less ground in the same twenty seconds than the
	// same line in clear space.
	const from = v3(0.5 * AU_KM, 0, 0);
	const target = { pos: v3(-0.5 * AU_KM, 0, 0), radiusKm: 1 };
	const run = (masses: { id: string; pos: Vec3; radiusKm: number }[]) =>
		fly({ from, target, masses, dt: 0.1, limitS: 20, fixedNose: true })
			.travelledKm;
	const clear = run(oneMassAt(v3(0, 5 * AU_KM, 0)));
	const grazing = run(oneMassAt(v3(0, 8000, 0), 6000));
	expect(grazing).toBeLessThan(clear);
});

// ---------------------------------------------------------------- §9.4 sub-stepping

test("the drop-out fires inside the drop radius for every approach speed", () => {
	// §9.4's swept sweep. The failure it guards is the one §8.1 predicts: at
	// 50 km the per-tick displacement is 28% of the remaining distance, so a
	// point-sampled test steps clean past the threshold and cruise never ends.
	for (const legAu of [0.05, 0.2, 0.7, 1.3, 3.0]) {
		for (const dt of [0.016, 0.1]) {
			const target = { pos: v3(), radiusKm: 6000 };
			const flight = fly({
				from: v3(legAu * AU_KM, 0, 0),
				target,
				masses: oneMassAt(target.pos, target.radiusKm),
				dt,
				limitS: 400,
			});
			expect(flight.dropped, `${legAu} AU at dt=${dt}`).toBe(true);
			const missKm = length(sub(flight.pos, target.pos));
			expect(missKm, `${legAu} AU at dt=${dt}`).toBeLessThanOrEqual(
				P.dropRadiusKm + 5,
			);
		}
	}
});

test("a sub-step never moves further than its fraction of the nearest distance", () => {
	// The rule itself, rather than one of its consequences: §8.1's
	// `v·dt > 0.1·d` is what the two claims above both rest on.
	const target = { pos: v3(), radiusKm: 6000 };
	let pos = v3(0.1 * AU_KM, 0, 0);
	for (let i = 0; i < 2000; i++) {
		const before = length(sub(pos, target.pos));
		const step = advanceCruise({
			pos,
			nose: towards(pos, target.pos),
			throttle: 1,
			dt: 0.1,
			masses: oneMassAt(target.pos, target.radiusKm),
			target,
			params: P,
		});
		// Each *whole frame* may cover more than the fraction — that is what
		// sub-stepping is for — but never more than the fraction times the number
		// of sub-steps it took to get there.
		expect(step.travelledKm).toBeLessThanOrEqual(
			SUBSTEP_FRACTION * before * step.substeps + 1e-6,
		);
		pos = step.pos;
		if (step.dropped) break;
	}
});

// ------------------------------------------------------------------ §9.5 exit state

test("exit velocity is along the nose and no faster than the assist cap", () => {
	const nose = towards(v3(), v3(1, 2, 3));
	for (const speed of [1e6, 1000, 3, 2, 0.5]) {
		const v = exitVelocity(nose, speed);
		expect(length(v)).toBeLessThanOrEqual(ASSIST_CAP_KMS + 1e-9);
		// Along the nose: the cross product is zero, checked as the component
		// perpendicular to it being nothing.
		const along = scale(nose, length(v));
		expect(length(sub(v, along))).toBeLessThan(1e-9);
	}
	// A ship that was already slower than the cap keeps its speed rather than
	// being accelerated to it by dropping out.
	expect(length(exitVelocity(nose, 0.5))).toBeCloseTo(0.5, 9);
});

// --------------------------------------------------------------- §9.6 drive charge

test("charge is spent per AU travelled, not per second", () => {
	// §7's honest unit: crawling through a gravity well already costs time, and
	// metering by the second would charge twice for the same detour.
	const target = { pos: v3(), radiusKm: 6000 };
	const flight = fly({
		from: v3(1.3 * AU_KM, 0, 0),
		target,
		masses: oneMassAt(target.pos, target.radiusKm),
		dt: 0.1,
		limitS: 300,
	});
	// Distance travelled is the leg, to within the drop radius it stopped short by.
	expect(flight.travelledKm / AU_KM).toBeCloseTo(1.3, 2);
});

test("regeneration restores one AU a minute and stops at capacity", () => {
	expect(CHARGE_REGEN_AU_PER_S * 60).toBeCloseTo(1, 9);
	expect(chargeAfterRegen(0, 60)).toBeCloseTo(1, 6);
	expect(chargeAfterRegen(CHARGE_CAPACITY_AU - 0.1, 600)).toBe(
		CHARGE_CAPACITY_AU,
	);
	// Twelve minutes for a full tank from empty — §7's stated penalty.
	expect(chargeAfterRegen(0, 12 * 60)).toBeCloseTo(CHARGE_CAPACITY_AU, 6);
});

test("a ship at zero charge in deep space can always reach a station", () => {
	// The anti-stranding property, asserted directly rather than inferred from
	// the regeneration rate — §7 calls it not optional, and what makes it
	// load-bearing is that the alternative is an unwinnable save.
	//
	// Eighty seconds buys enough range to reach a station an AU away — §7's own
	// stated penalty, and the case that actually happens.
	expect(chargeAfterRegen(0, 80)).toBeGreaterThan(1);

	// The worst case on the map is wider than the tank, and that is a finding
	// rather than a failure. The widest leg the generator can produce is a body
	// at `MAX_ORBIT_AU` and one diametrically opposite, plus the arrival
	// clearance: 12.25 AU against §7's 12 AU capacity. So the guarantee cannot be
	// "any leg in one hop" — it is "any leg, in hops, because regeneration has no
	// ceiling in time".
	const worstLegAu = 2 * MAX_ORBIT_AU + ARRIVAL_CLEARANCE_AU;
	expect(worstLegAu).toBeGreaterThan(CHARGE_CAPACITY_AU);
	// Two full charges clear it with room to spare, so the stranding case is a
	// wait, never a dead end.
	expect(2 * CHARGE_CAPACITY_AU).toBeGreaterThan(worstLegAu);
	// And the wait for one full tank is §7's twelve minutes, not an hour.
	expect(chargeAfterRegen(0, 12 * 60)).toBe(CHARGE_CAPACITY_AU);
});

test("cruise does not move a ship with no charge", () => {
	// The charge is metered by the caller (the renderer holds the tank), so what
	// this pins is the other half: a zero-charge engage is refused rather than
	// silently free.
	const target = { pos: v3(), radiusKm: 6000 };
	const step = advanceCruise({
		pos: v3(0.5 * AU_KM, 0, 0),
		nose: towards(v3(0.5 * AU_KM, 0, 0), target.pos),
		throttle: 1,
		dt: 0.1,
		masses: oneMassAt(target.pos, target.radiusKm),
		target,
		params: P,
		chargeAu: 0,
	});
	expect(step.travelledKm).toBe(0);
	expect(step.starved).toBe(true);
});

// ------------------------------------------------------------------- the throttle

test("the throttle sets magnitude only, and zero throttle holds position", () => {
	const target = { pos: v3(), radiusKm: 6000 };
	const from = v3(1.0 * AU_KM, 0, 0);
	const still = advanceCruise({
		pos: from,
		nose: towards(from, target.pos),
		throttle: 0,
		dt: 0.1,
		masses: oneMassAt(target.pos, target.radiusKm),
		target,
		params: P,
	});
	expect(still.travelledKm).toBe(0);
	expect(still.pos).toEqual(from);

	// Half throttle is half the speed the law allows at that distance — nose-
	// locked, so the direction is the nose whatever the throttle is.
	const half = advanceCruise({
		pos: from,
		nose: towards(from, target.pos),
		throttle: 0.5,
		dt: 0.1,
		masses: oneMassAt(target.pos, target.radiusKm),
		target,
		params: P,
	});
	expect(half.speedKms / cruiseSpeed(length(from), P)).toBeCloseTo(0.5, 3);
	const moved = sub(half.pos, from);
	expect(
		length(add(moved, scale(towards(from, target.pos), -length(moved)))),
	).toBeLessThan(1e-6);
});

test("the ship overshoots rather than stopping when it arrives too fast", () => {
	// §3: failure to slow means overshooting and looping back, and it never
	// causes damage. With the drop-out's speed threshold set below the arrival
	// speed, the ship must sail past the target rather than be caught by it.
	const target = { pos: v3(), radiusKm: 6000 };
	const strict = { ...P, dropSpeedKms: 1 };
	const from = v3(0.2 * AU_KM, 0, 0);
	const flight = fly({
		from,
		target,
		masses: oneMassAt(target.pos, target.radiusKm),
		dt: 0.1,
		limitS: 120,
		params: strict,
		fixedNose: true,
	});
	expect(flight.dropped).toBe(false);
	// Past it: the ship is on the far side of the target from where it started.
	expect(flight.pos.x).toBeLessThan(0);
});

// ------------------------------------- arrival is relative (this node's finding)

test("the exit clamp is on the velocity relative to the destination", () => {
	// The largest thing flying this found. A station on a 1 AU orbit moves at
	// ~30 km/s; clamping the ship's *absolute* velocity to the 2 km/s assist cap
	// at the drop-out leaves the destination receding at 28 km/s, which normal
	// flight can never close. The arrival succeeds and docking becomes
	// impossible — a failure that looks like a win.
	const nose = towards(v3(), v3(0, 0, -1));
	const stationVel = v3(0, 30, 0);
	const v = exitVelocity(nose, 1e6, stationVel);
	expect(length(sub(v, stationVel))).toBeCloseTo(ASSIST_CAP_KMS, 6);
	// The ship is left *with* the station, not next to it: its absolute speed is
	// the station's plus at most the cap.
	expect(length(v)).toBeGreaterThan(ASSIST_CAP_KMS);
	expect(length(v)).toBeLessThanOrEqual(length(stationVel) + ASSIST_CAP_KMS);
	// With a stationary destination the two forms agree, which is why every
	// earlier assertion in this file still stands.
	expect(length(exitVelocity(nose, 1e6))).toBeCloseTo(ASSIST_CAP_KMS, 9);
});

test("the drop-out threshold is judged in the destination's frame too", () => {
	// Matching velocities counts as slow, however fast both are going; sitting
	// still while the station leaves at 30 km/s does not.
	const nose = towards(v3(), v3(0, 0, -1));
	const stationVel = scale(nose, 30);
	expect(closingSpeed(nose, 30, stationVel)).toBeCloseTo(0, 9);
	expect(closingSpeed(nose, 0, stationVel)).toBeCloseTo(30, 9);
	expect(closingSpeed(nose, 30)).toBeCloseTo(30, 9);
});

test("a moving target is arrived at, not chased forever", () => {
	// The end-to-end version: the same approach that stalls against an absolute
	// threshold completes against a relative one. The target drifts sideways at
	// a station's orbital speed while the ship flies in.
	const stationVel = v3(0, 30, 0);
	const params = { ...P, dropSpeedKms: 50 };
	let pos = v3(5e3, 0, 0);
	let targetPos = v3();
	let t = 0;
	let dropped = false;
	const dt = 0.1;
	while (t < 200 && !dropped) {
		const target = { pos: targetPos, radiusKm: 1.2, vel: stationVel };
		// The pilot aims at the **velocity to fly**, not at the target: it wants
		// the station's own motion plus a closing rate along the line of sight.
		// Pointing straight at a crossing target instead is a pursuit curve, and a
		// nose-locked ship flying one arrives with a relative speed of
		// √(closing² + station²) — which never drops below the threshold however
		// gently it closes. That is a HUD consequence rather than a physics one:
		// the panel has to show the *closing* speed, or the player is flying a
		// number that cannot tell them whether they will arrive.
		const remaining = length(sub(targetPos, pos));
		const los = towards(pos, targetPos);
		const closingRate = Math.min(remaining / 6, 200);
		const fly = add(stationVel, scale(los, closingRate));
		const speed = length(fly);
		const nose = scale(fly, 1 / speed);
		const law = cruiseSpeed(remaining, params);
		const step = advanceCruise({
			pos,
			nose,
			throttle: Math.min(1, speed / law),
			dt,
			masses: oneMassAt(targetPos, 1.2),
			target,
			params,
		});
		pos = step.pos;
		dropped = step.dropped;
		targetPos = add(targetPos, scale(stationVel, dt));
		t += dt;
	}
	expect(dropped).toBe(true);
	expect(length(sub(pos, targetPos))).toBeLessThanOrEqual(
		params.dropRadiusKm + 5,
	);
});

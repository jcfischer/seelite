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
	CHARGE_CAPACITY_AU,
	type CruiseParams,
	CHARGE_PER_AU,
	CHARGE_REGEN_AU_PER_S,
	DEFAULT_CRUISE,
	SUBSTEP_FRACTION,
	SURFACE_MARGIN,
	advanceCruise,
	chargeAfterRegen,
	chargeAfterTravel,
	closingSpeed,
	cruiseSpeed,
	legSeconds,
	speedFor,
	exitVelocity,
	nearestMass,
} from "../src/cruise";
import { ASSIST_CAP_KMS } from "../src/sim";
import { ARRIVAL_CLEARANCE_AU, MAX_ORBIT_AU } from "../src/system";
import { AU_KM, HANDOFF_KM } from "../src/units";
import { type Vec3, add, length, scale, sub, v3 } from "../src/vec3";

const P = DEFAULT_CRUISE;

/**
 * #10's own parameters, kept as a fixture.
 *
 * The defaults have moved: #14 flew them and the principal ruled on both the
 * exponent and the leg time, so `DEFAULT_CRUISE` is now 23 c at 0.60. §2.3's
 * table is still a claim worth checking — it is the arithmetic the spec was
 * argued from — but it is a claim about *these* numbers, and asserting it
 * against whatever the defaults happen to be would turn a check of the spec
 * into a check that the file agrees with itself.
 */
const SPEC_LAW: CruiseParams = {
	// Every field written out, not spread from `DEFAULT_CRUISE`. A fixture that
	// inherited `dRefKm`, `vMinKms`, `dropRadiusKm` and `dropSpeedKms` from the
	// values it is supposed to be pinned against would let a retune of any of
	// them silently move the table it is checking — which is the exact failure
	// this fixture exists to prevent, and it had it for one round.
	vMaxKms: 6.0e6, // §2: 20 c
	exponent: 0.75, // §2.2
	dRefKm: 0.5 * AU_KM, // §2
	vMinKms: 100, // §2, the safety floor
	dropRadiusKm: 50, // §3
	dropSpeedKms: 200, // not in #10 — see `cruise.ts` on §2.3 vs §3
	// Both #14's, and switched off here: the clamp is not something #10 argued,
	// so a claim about #10's law is measured without it.
	vicinityKm: 0,
	approachLeadS: 3,
};

/** A unit vector from `a` to `b`, in float64 — the ship's nose, in the tests
 *  that fly straight at something. */
function towards(a: Vec3, b: Vec3): Vec3 {
	const d = sub(b, a);
	return scale(d, 1 / length(d));
}

/**
 * One mass, which is the geometry every pacing claim in §2.3 is implicitly
 * stated against: fly straight at it.
 *
 * The default radius is **1 km — a point mass**, and deliberately so. §2.3's
 * table is arithmetic about the *law*, which reads a distance and knows nothing
 * about radii; giving these fixtures a real 6,000 km planet would have the
 * surface rule (`SURFACE_MARGIN`) end every run 6,300 km out and the table's
 * numbers would never be reached. The surface rule has its own tests below,
 * with a real planet in them.
 */
function oneMassAt(pos: Vec3, radiusKm = 1) {
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
	/** The body the target orbits — #30's rule reads it. */
	targetParentId?: string | null;
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
	let exit: string | null = null;
	let exitBodyId: string | undefined;
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
			targetParentId: opts.targetParentId,
		});
		pos = step.pos;
		travelledKm += step.travelledKm;
		dropped = step.dropped;
		if (step.dropped) {
			exit = step.exit;
			exitBodyId = step.exitBodyId;
		}
		speedKms = step.speedKms;
		maxSubsteps = Math.max(maxSubsteps, step.substeps);
		t += opts.dt;
		for (const m of opts.masses) {
			minApproach = Math.min(minApproach, length(sub(pos, m.pos)) - m.radiusKm);
		}
	}
	return {
		t,
		pos,
		travelledKm,
		dropped,
		minApproach,
		maxSubsteps,
		speedKms,
		exit,
		exitBodyId,
	};
}

// ---------------------------------------------------------------- §9.1 speed law

test("the speed law matches the spec's table at every sampled distance", () => {
	// §2.3's key speeds, which are the spec's own arithmetic — so this is the
	// check that the implementation is the law that was argued, not a different
	// curve that happens to feel similar.
	const at = (km: number) => cruiseSpeed(km, SPEC_LAW);
	expect(at(AU_KM)).toBeCloseTo(SPEC_LAW.vMaxKms, 0); // ≥ d_ref: capped
	expect(at(SPEC_LAW.dRefKm)).toBeCloseTo(SPEC_LAW.vMaxKms, 0);
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

/**
 * §2.3's table is a claim about the **law**, so it is measured with the
 * approach clamp switched off (`vicinityKm: 0`).
 *
 * The clamp is not in #10 — it came out of flying (see `vicinityKm`) — and it
 * adds a deliberate `approachLeadS · ln(vicinityKm / dropRadiusKm)` of
 * deceleration to every arrival, about 16 s at the defaults. Folding that into
 * these numbers would quietly restate the spec's pacing as whatever the clamp
 * happens to cost; the honest split is the law here, and the arrival cost
 * asserted on its own below.
 */
/** #10's law, with the clamp already off — `SPEC_LAW` is that. Kept as a name
 *  because the tests that use it are making a point about the *clamp* rather
 *  than about the spec's parameters. */
const NO_CLAMP = SPEC_LAW;

// §2.3's table, with the geometry it is stated against: one mass at the
// target, the ship flying straight in from `legAu` away. The tolerance is
// the spec's own 10%.
test.each([
	["short hop", 0.2, 38],
	["typical leg", 1.3, 68],
	["outer planet", 6.0, 186],
])("a %s (%p AU) takes about %p s", (_name, legAu, wantS) => {
	const target = { pos: v3(), radiusKm: 1.2 };
	const from = v3(legAu * AU_KM, 0, 0);
	const flight = fly({
		from,
		target,
		masses: oneMassAt(target.pos),
		dt: 0.1,
		limitS: wantS * 3,
		params: NO_CLAMP,
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
	const target = { pos: v3(), radiusKm: 1.2 };
	const from = v3(1.3 * AU_KM, 0, 0);
	const times = [0.016, 0.033, 0.1].map(
		(dt) =>
			fly({
				from,
				target,
				masses: oneMassAt(target.pos),
				dt,
				limitS: 300,
				params: NO_CLAMP,
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
		// Outside `SURFACE_MARGIN × radius` (6,300 km): closer than that is not a
		// pass, it is a collision, and the surface rule ends the run there by
		// design. §9.3's claim is about lines that *go by*.
		for (const missKm of [7000, 9000, 20000]) {
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
			const target = { pos: v3(), radiusKm: 1.2 };
			const flight = fly({
				from: v3(legAu * AU_KM, 0, 0),
				target,
				masses: oneMassAt(target.pos),
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
	const target = { pos: v3(), radiusKm: 1.2 };
	let pos = v3(0.1 * AU_KM, 0, 0);
	for (let i = 0; i < 2000; i++) {
		const before = length(sub(pos, target.pos));
		const step = advanceCruise({
			pos,
			nose: towards(pos, target.pos),
			throttle: 1,
			dt: 0.1,
			masses: oneMassAt(target.pos),
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
	// §7's honest unit: crawling slowly through a gravity well already costs
	// time, and metering by the second would charge twice for the same detour.
	//
	// Two legs of the **same length** — one crossed in deep space at the cap, one
	// crawled through a gravity well over many times as long — must cost the same
	// charge. An earlier version of this test asserted only that the ship covered
	// the distance it set out to, which a per-second meter would have passed
	// unchanged.
	const legKm = 2e6;
	const spend = (massAt: Vec3) => {
		const target = { pos: v3(), radiusKm: 1.2 };
		let pos = v3(legKm, 0, 0);
		let charge = CHARGE_CAPACITY_AU;
		let seconds = 0;
		while (seconds < 900 && pos.x > legKm * 0.02) {
			const step = advanceCruise({
				pos,
				nose: v3(-1, 0, 0),
				throttle: 1,
				dt: 0.1,
				masses: oneMassAt(massAt),
				target,
				params: { ...P, dropSpeedKms: 0 },
				chargeAu: charge,
			});
			pos = step.pos;
			charge = chargeAfterTravel(charge, step.travelledKm);
			seconds += 0.1;
		}
		return { spent: CHARGE_CAPACITY_AU - charge, seconds, endX: pos.x };
	};

	// The well sits just off the line, so the same kilometres take far longer.
	const fast = spend(v3(0, 30 * AU_KM, 0));
	const slow = spend(v3(legKm * 0.5, 2e4, 0));
	// Both legs decelerate near the target now that the law reads the target
	// as well as the mass, and the tuned exponent (0.60, shallower than the
	// spec's 0.75) narrows the gap further — the claim is that the well costs
	// time, not how much.
	expect(slow.seconds).toBeGreaterThan(fast.seconds * 1.5);
	// Per kilometre, because the two runs stop on the same *position* test and a
	// sub-step lands them a little differently — the claim is the rate, not the
	// total.
	const rate = (r: typeof fast) => r.spent / (legKm - r.endX);
	expect(rate(slow)).toBeCloseTo(rate(fast), 12);
	// And that rate is one unit per AU, not something merely proportional to it.
	expect(rate(fast)).toBeCloseTo(CHARGE_PER_AU / AU_KM, 12);
});

test("the meter itself is per AU, and never goes below empty", () => {
	expect(chargeAfterTravel(12, AU_KM)).toBeCloseTo(12 - CHARGE_PER_AU, 9);
	expect(chargeAfterTravel(12, 0)).toBe(12);
	expect(chargeAfterTravel(0.5, 3 * AU_KM)).toBe(0);
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
	const target = { pos: v3(), radiusKm: 1.2 };
	const step = advanceCruise({
		pos: v3(0.5 * AU_KM, 0, 0),
		nose: towards(v3(0.5 * AU_KM, 0, 0), target.pos),
		throttle: 1,
		dt: 0.1,
		masses: oneMassAt(target.pos),
		target,
		params: P,
		chargeAu: 0,
	});
	expect(step.travelledKm).toBe(0);
	expect(step.starved).toBe(true);
});

// ------------------------------------------------------------------- the throttle

test("the throttle sets magnitude only, and zero throttle holds position", () => {
	const target = { pos: v3(), radiusKm: 1.2 };
	const from = v3(1.0 * AU_KM, 0, 0);
	const still = advanceCruise({
		pos: from,
		nose: towards(from, target.pos),
		throttle: 0,
		dt: 0.1,
		masses: oneMassAt(target.pos),
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
		masses: oneMassAt(target.pos),
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
	const target = { pos: v3(), radiusKm: 1.2 };
	// §3's claim, measured against the law it was written about: the clamp is off
	// here, because the clamp is precisely what removes this failure in play —
	// a straight-in run can no longer arrive too fast to be caught.
	const strict = { ...NO_CLAMP, dropSpeedKms: 1 };
	const from = v3(0.2 * AU_KM, 0, 0);
	const flight = fly({
		from,
		target,
		// The mass is elsewhere: a target that is also a body would end the
		// run on its surface rather than by sailing past, which is a different
		// claim (and has its own test).
		masses: oneMassAt(v3(0, 3 * AU_KM, 0)),
		dt: 0.1,
		limitS: 120,
		params: strict,
		fixedNose: true,
	});
	expect(flight.dropped).toBe(false);
	// Past it: the ship is on the far side of the target from where it started.
	expect(flight.pos.x).toBeLessThan(0);
});

// ------------------------------------------ what flying it turned up (#14/#21)

test("the law is keyed to the nearer of the mass and the target", () => {
	// §2.1 rejected a target-*only* law because it tunnels; the minimum of
	// the two keeps that argument — the speed is still bounded by the mass
	// distance — and gives the approach its deceleration. Without it a station's
	// speed is set by its planet tens of thousands of km away and the ship
	// arrives still doing thousands of km/s.
	const planet = { id: "planet", pos: v3(), radiusKm: 6000 };
	// A station 60,000 km from its planet, and the ship 50 km from the station.
	const station = { pos: v3(6e4, 0, 0), radiusKm: 1.2 };
	const pos = v3(6e4 + 50, 0, 0);
	const step = advanceCruise({
		pos,
		nose: towards(pos, station.pos),
		throttle: 1,
		dt: 0.1,
		masses: [planet],
		target: station,
		// Clamp off: this is the *law's* claim. In play the approach clamp is
		// slower still — it governs everything inside `vicinityKm` — and it has
		// its own tests; what is being pinned here is that the law reads the
		// target at all.
		params: NO_CLAMP,
	});
	// §2.3's own figure for 50 km out, rather than the ~44,000 km/s the planet's
	// distance alone would allow.
	expect(step.speedKms / 140).toBeCloseTo(1, 1);
	expect(step.dropped).toBe(true);
	expect(step.exit).toBe("arrival");
});

test("a body's surface stops cruise instead of being flown through", () => {
	// The exploit the principal found: the law slows an approach asymptotically
	// and nothing collides, so flying through a planet was the most effective
	// brake in the game. A body has to be an obstacle for the nearest-mass law to
	// read as gravity.
	const planet = { id: "planet", pos: v3(), radiusKm: 6000 };
	let pos = v3(0.05 * AU_KM, 0, 0);
	const nose = towards(pos, planet.pos);
	let exit: string | null = null;
	for (let i = 0; i < 2000 && !exit; i++) {
		const step = advanceCruise({
			pos,
			nose,
			throttle: 1,
			dt: 0.1,
			masses: [planet],
			target: null,
			params: P,
		});
		pos = step.pos;
		if (step.dropped) exit = step.exit;
	}
	expect(exit).toBe("proximity");
	// Just clear of the surface, never inside it.
	const km = length(sub(pos, planet.pos));
	expect(km).toBeGreaterThanOrEqual(planet.radiusKm);
	expect(km).toBeLessThan(planet.radiusKm * SURFACE_MARGIN * 1.01);
});

test("a grazing pass still passes, rather than dropping the ship every time", () => {
	// The other half of the same rule: `SURFACE_MARGIN` must not turn every
	// scenery body into a tripwire, or §2.1's "a line that grazes a gas giant
	// costs time" becomes "a line that grazes a gas giant ends your journey".
	const planet = { id: "planet", pos: v3(), radiusKm: 6000 };
	const from = v3(0.2 * AU_KM, planet.radiusKm * 1.4, 0);
	const flight = fly({
		from,
		target: { pos: v3(-0.2 * AU_KM, planet.radiusKm * 1.4, 0), radiusKm: 1 },
		masses: [planet],
		dt: 0.1,
		limitS: 300,
		fixedNose: true,
	});
	expect(flight.minApproach).toBeGreaterThan(0);
});

// ------------------------------------- arrival is relative (this node's finding)

test("the exit clamp is on the velocity relative to the target", () => {
	// The largest thing flying this found. A station on a 1 AU orbit moves at
	// ~30 km/s; clamping the ship's *absolute* velocity to the 2 km/s assist cap
	// at the drop-out leaves the target receding at 28 km/s, which normal
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
	// With a stationary target the two forms agree, which is why every
	// earlier assertion in this file still stands.
	expect(length(exitVelocity(nose, 1e6))).toBeCloseTo(ASSIST_CAP_KMS, 9);
});

test("the drop-out threshold is judged in the target's frame too", () => {
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

// --------------------------------- the approach clamp (the principal's fourth flight)

test("inside the vicinity the speed is held to the seconds-to-target", () => {
	// The fix for "the drop out doesn't happen automatically, I guess I never hit
	// within 50 km": a 50 km sphere seen from 60,000 km subtends 0.05°, and a
	// nose-locked ship doing hundreds of km/s cannot be hand-aimed at it.
	const station = { pos: v3(), radiusKm: 1.2 };
	// A frame short enough to be one sub-step: `speedKms` reports the *last*
	// sub-step of the frame, and at these speeds a 0.1 s frame is several,
	// each one closer and therefore slower. The rule being checked is the speed
	// at a distance, not the speed at the end of a tenth of a second.
	const at = (km: number) => {
		const pos = v3(km, 0, 0);
		return advanceCruise({
			pos,
			nose: towards(pos, station.pos),
			throttle: 1,
			dt: 1e-4,
			masses: oneMassAt(v3(0, 6e4, 0)),
			target: station,
			params: P,
		}).speedKms;
	};
	// Outside the vicinity the law is untouched — the clamp is an approach rule,
	// not a global speed limit.
	expect(at(P.vicinityKm * 4)).toBeCloseTo(cruiseSpeed(P.vicinityKm * 4, P), 0);
	// Inside it, distance over the lead time, all the way down.
	expect(at(P.vicinityKm)).toBeCloseTo(P.vicinityKm / P.approachLeadS, 0);
	expect(at(1000)).toBeCloseTo(1000 / P.approachLeadS, 0);
	expect(at(200)).toBeCloseTo(200 / P.approachLeadS, 0);
});

test("a straight-in approach at full throttle now arrives by itself", () => {
	// End to end, and the claim that matters: no throttle management, no lead
	// pursuit, no reference pilot — point the nose at a moving station from
	// outside the vicinity and hold the throttle open. Before the clamp this
	// sailed past at thousands of km/s, every time.
	const stationVel = v3(0, 30, 0);
	let targetPos = v3();
	let pos = v3(6e4, 0, 0);
	let t = 0;
	let exit: string | null = null;
	const dt = 0.1;
	while (t < 300 && !exit) {
		const step = advanceCruise({
			pos,
			nose: towards(pos, targetPos),
			throttle: 1,
			dt,
			masses: oneMassAt(v3(0, 2e6, 0)),
			target: { pos: targetPos, radiusKm: 1.2, vel: stationVel },
			params: P,
		});
		pos = step.pos;
		if (step.dropped) exit = step.exit;
		targetPos = add(targetPos, scale(stationVel, dt));
		t += dt;
	}
	expect(exit).toBe("arrival");
	// And it ends up somewhere a 2 km/s ship can finish from: §3 bounds the drop
	// radius from below by exactly this argument, so a capture that left the ship
	// thousands of km out would have solved nothing.
	expect(length(sub(pos, targetPos))).toBeLessThan(P.dropRadiusKm * 2);
});

test("a pass that misses ends at closest approach rather than looping", () => {
	// The other half: aimed a few hundred km off, the ship still ends its run at
	// the nearest point of the pass instead of sailing on and coming round again
	// — which is the loop the fourth session described as "overshooting like
	// crazy".
	const station = { pos: v3(), radiusKm: 1.2 };
	const missKm = 400;
	let pos = v3(6e4, missKm, 0);
	const nose = towards(pos, v3(0, missKm, 0));
	let t = 0;
	let exit: string | null = null;
	while (t < 300 && !exit) {
		const step = advanceCruise({
			pos,
			nose,
			throttle: 1,
			dt: 0.1,
			masses: oneMassAt(v3(0, 2e6, 0)),
			target: station,
			params: P,
		});
		pos = step.pos;
		if (step.dropped) exit = step.exit;
		t += 0.1;
	}
	expect(exit).toBe("arrival");
	const endKm = length(sub(pos, station.pos));
	// At the miss distance, not at the drop radius — the ship was never going to
	// get closer on that line, and it is left where its own flying put it.
	expect(endKm).toBeGreaterThan(missKm * 0.9);
	expect(endKm).toBeLessThan(missKm * 1.5);
});

test("the clamp's cost is what the arithmetic says it is", () => {
	// The clamp buys a capture the player can actually hit, and it is paid for in
	// seconds — `approachLeadS · ln(vicinityKm / dropRadiusKm)`, about 16 s at
	// the defaults. Stated here because #10's §2.3 pacing no longer includes it
	// and the difference is a third of a short hop.
	const target = { pos: v3(), radiusKm: 1.2 };
	const from = v3(0.2 * AU_KM, 0, 0);
	const run = (params: typeof DEFAULT_CRUISE) =>
		fly({
			from,
			target,
			masses: oneMassAt(target.pos),
			dt: 0.1,
			limitS: 300,
			params,
		});
	const clamped = run(P);
	const bare = run({ ...P, vicinityKm: 0 });
	expect(clamped.dropped).toBe(true);
	expect(bare.dropped).toBe(true);

	// What the clamp adds is the integral of `distance / lead` from the vicinity
	// down to the drop radius, less the time the law would have taken over the
	// same stretch. The first term dominates and is worth stating exactly.
	const clampS = P.approachLeadS * Math.log(P.vicinityKm / P.dropRadiusKm);
	expect(clamped.t - bare.t).toBeGreaterThan(clampS * 0.6);
	expect(clamped.t - bare.t).toBeLessThan(clampS * 1.4);
});

test("the tuned defaults put a typical leg just under a minute", () => {
	// #14's conclusion, as arithmetic. The principal flew four sessions and
	// asked for "slightly less than 60 s"; the benchmark is §2.3's own 1.3 AU
	// typical leg rather than the 0.84 AU one he happened to be flying, because
	// legs across a system run 0.2–6 AU and the median is the more general fit —
	// his own call, made against the table in `scripts/measure-cruise-pacing.ts`.
	//
	// Measured with the clamp **on**, because that is the leg the player flies.
	const target = { pos: v3(), radiusKm: 1.2 };
	const leg = (au: number) =>
		fly({
			from: v3(au * AU_KM, 0, 0),
			target,
			masses: oneMassAt(target.pos),
			dt: 0.1,
			limitS: 400,
		});

	const typical = leg(1.3);
	expect(typical.dropped).toBe(true);
	expect(typical.t).toBeGreaterThan(54);
	expect(typical.t).toBeLessThan(60);

	// And the shape of the curve either side of it: a short hop is not
	// instantaneous and the outer system is a real trip, both of which the
	// exponent and the clamp decide together.
	expect(leg(0.2).t).toBeGreaterThan(20);
	expect(leg(6).t).toBeLessThan(200);
});

test("a shut throttle still arrives, and reports the honest closing speed", () => {
	// §3's cut-the-throttle mode is what the `dropSpeedKms` dial exists to
	// evaluate, and for one round it could not happen: the zero-throttle branch
	// returned before the arrival test, so a ship sitting inside the drop radius
	// with the throttle closed never dropped out.
	const stationVel = v3(0, 30, 0);
	const target = { pos: v3(), radiusKm: 1.2, vel: stationVel };
	const pos = v3(20, 0, 0);
	const step = advanceCruise({
		pos,
		nose: towards(pos, target.pos),
		throttle: 0,
		dt: 0.1,
		masses: oneMassAt(v3(0, 6e4, 0)),
		target,
		params: P,
	});
	expect(step.dropped).toBe(true);
	expect(step.exit).toBe("arrival");
	expect(step.travelledKm).toBe(0);
	// Not zero: nose-locked and stationary beside a station doing 30 km/s is not
	// station-keeping, it is being left behind, and the panel says so.
	expect(step.closingKms).toBeCloseTo(30, 6);

	// With the dial tightened below the station's own motion, the same state is
	// *not* an arrival — which is the mode being evaluated, working.
	const strict = advanceCruise({
		pos,
		nose: towards(pos, target.pos),
		throttle: 0,
		dt: 0.1,
		masses: oneMassAt(v3(0, 6e4, 0)),
		target,
		params: { ...P, dropSpeedKms: 2 },
	});
	expect(strict.dropped).toBe(false);
});

test("the leg estimate agrees with the leg actually flown", () => {
	// The HUD's headline number (§5.1) against the ship's own arithmetic. The
	// renderer held a second copy of the law for one round and it had already
	// diverged — keyed to the nearest mass alone, it read ~30× too fast over a
	// station's final approach and omitted the clamp's 16 s. `legSeconds` and
	// `advanceCruise` now call the same `speedFor`, and this is the check that
	// they keep agreeing.
	const target = { pos: v3(), radiusKm: 1.2 };
	const masses = oneMassAt(v3(0, 3e5, 0));
	for (const legAu of [0.2, 0.84, 1.3, 6]) {
		const from = v3(legAu * AU_KM, 0, 0);
		const estimate = legSeconds(from, target, masses, P);
		const flown = fly({ from, target, masses, dt: 0.1, limitS: 600 });
		expect(flown.dropped, `${legAu} AU`).toBe(true);
		// Within 5%: the estimate integrates a straight line while the flight
		// sub-steps one, so they are the same arithmetic sampled differently.
		expect(Math.abs(estimate - flown.t) / flown.t, `${legAu} AU`).toBeLessThan(
			0.05,
		);
	}
});

test("speedFor is the whole law, clamp included", () => {
	// The single definition both of them read. Outside the vicinity it is §2's
	// curve keyed to the nearer distance; inside, the clamp governs.
	const far = speedFor(1e6, 5e6, P);
	expect(far).toBeCloseTo(cruiseSpeed(1e6, P), 6);
	// Keyed to the target when the target is nearer — §2.1's law is a bound, not
	// a target-blind rule.
	expect(speedFor(5e6, 1e6, P)).toBeCloseTo(cruiseSpeed(1e6, P), 6);
	// Inside the vicinity, distance over the lead time, plus what the
	// target itself is doing.
	expect(speedFor(1e9, 1000, P, 30)).toBeCloseTo(
		30 + 1000 / P.approachLeadS,
		6,
	);
	// And the throttle is a multiplier on the law, never on the clamp's floor.
	expect(speedFor(1e6, 5e6, P, 0, 0.5)).toBeCloseTo(
		cruiseSpeed(1e6, P) * 0.5,
		6,
	);
});

test("the capture is a near miss, not the whole vicinity", () => {
	// §11.5's table used to state the capture unconditionally; the gate is
	// `closing <= dropSpeedKms`, and under the clamp closing speed is roughly
	// `distance / approachLeadS` — so the band is ~600 km at the defaults, not
	// the 10,000 km vicinity. Both sides of that boundary, because a rule whose
	// extent is only asserted from inside is a rule whose extent is unknown.
	const station = { pos: v3(), radiusKm: 1.2 };
	const passAt = (missKm: number) => {
		let pos = v3(6e4, missKm, 0);
		const nose = towards(pos, v3(0, missKm, 0));
		let t = 0;
		let exit: string | null = null;
		while (t < 300 && !exit) {
			const step = advanceCruise({
				pos,
				nose,
				throttle: 1,
				dt: 0.1,
				masses: oneMassAt(v3(0, 2e6, 0)),
				target: station,
				params: P,
			});
			pos = step.pos;
			if (step.dropped) exit = step.exit;
			t += 0.1;
		}
		return exit;
	};
	// Inside the band: the pass ends as an arrival.
	expect(passAt(400)).toBe("arrival");
	// The band itself, stated as the arithmetic it is.
	const bandKm = P.dropSpeedKms * P.approachLeadS;
	expect(bandKm).toBeCloseTo(600, 0);
	// Outside it — still well inside the vicinity — the ship flies on, which is
	// the honest behaviour for a course that was never going to arrive.
	expect(passAt(P.vicinityKm * 0.5)).toBe(null);
});

test("a proximity drop names the body, so an intended one can be arrived at", () => {
	// Cruising *to* a planet is a target like any other. The exit reports
	// which body's surface ended the run, because dropping against the selected
	// one should leave the ship in that body's frame — leaving it in the star's
	// beside a planet moving at 30 km/s strands it exactly the way an absolute
	// clamp strands an arrival at a station.
	const planet = { id: "planet-3", pos: v3(), radiusKm: 6000 };
	let pos = v3(0.05 * AU_KM, 0, 0);
	const nose = towards(pos, planet.pos);
	let step = advanceCruise({
		pos,
		nose,
		throttle: 1,
		dt: 0.1,
		masses: [planet],
		target: null,
		params: P,
	});
	for (let i = 0; i < 2000 && !step.dropped; i++) {
		pos = step.pos;
		step = advanceCruise({
			pos,
			nose,
			throttle: 1,
			dt: 0.1,
			masses: [planet],
			target: null,
			params: P,
		});
	}
	expect(step.exit).toBe("proximity");
	expect(step.exitBodyId).toBe("planet-3");
});

// ----------------------------------------- #30: the guard is scaled to the wrong thing

/**
 * The geometry every test below is built on.
 *
 * A station orbits at `|o|` from its host's centre, and what decides whether a
 * distant ship can reach it in a straight line is not that distance but its
 * **perpendicular offset** `o⊥` from the line of sight: an inbound leg at 1 AU
 * is effectively parallel, so the host hides the station exactly when
 * `o⊥ < radius` and it is on the far side. Between `radius` and
 * `SURFACE_MARGIN × radius` is the band #30 is about — the station is in clear
 * space and the shell its planet projects is not.
 *
 * `PLANET_R` and an altitude of 400 km are `system.ts`'s own minimum, so the
 * band is not a contrivance: it is where a real station sits.
 */
const PLANET_R = 6000;
const ORBIT_R = PLANET_R + 400;

/** A station at perpendicular offset `perp`, on the far side of its host by
 *  whatever the orbital radius has left over. The ship comes in along +x. */
function stationAt(perp: number) {
	const behind = Math.sqrt(ORBIT_R * ORBIT_R - perp * perp);
	return { pos: v3(-behind, perp, 0), radiusKm: 1 };
}

test("a station in clear space is reached, not stopped by its host's shell", () => {
	// The defect, in its simplest form: `o⊥` is 6,150 km — outside the planet
	// and inside `1.05 × 6,000 = 6,300`. The station is in clear space and the
	// sweep against its own host fires first, thousands of km short and still
	// doing thousands of km/s. Measured across 200 systems this is 15% of all
	// legs to a planet-orbiting station.
	const planet = { id: "planet", pos: v3(), radiusKm: PLANET_R };
	const station = stationAt(6150);
	expect(station.pos.x).toBeLessThan(0); // genuinely on the far side
	const flight = fly({
		from: v3(0.3 * AU_KM, 0, 0),
		target: station,
		masses: [planet],
		dt: 0.1,
		targetParentId: "planet",
	});
	expect(flight.exit).toBe("arrival");
	expect(length(sub(flight.pos, station.pos))).toBeLessThanOrEqual(
		P.dropRadiusKm,
	);
});

test("a host still stops a ship aimed at a station behind it", () => {
	// The other half, and why the host cannot simply be exempted: at `o⊥` of
	// 3,000 km the station is *behind six thousand kilometres of planet*, and a
	// rule that arrives there is one that flies through worlds — which is the
	// brake #14 closed, handed back for the one world the player most wants to
	// shed speed at.
	const planet = { id: "planet", pos: v3(), radiusKm: PLANET_R };
	const flight = fly({
		from: v3(0.3 * AU_KM, 0, 0),
		target: stationAt(3000),
		masses: [planet],
		dt: 0.1,
		targetParentId: "planet",
	});
	expect(flight.exit).toBe("proximity");
	expect(flight.exitBodyId).toBe("planet");
	// Stopped *at* the surface rather than 5% out — the host has no shell to
	// project against its own station, so the drop is as close as it can be.
	// The bound is a tenth of the shell it replaces, which is what makes this an
	// assertion about the new rule rather than one the old rule also satisfied.
	expect(flight.minApproach).toBeGreaterThanOrEqual(0);
	expect(flight.minApproach).toBeLessThan(
		(PLANET_R * (SURFACE_MARGIN - 1)) / 10,
	);
});

test("every body that is not the host keeps its shell", () => {
	// The exemption is scoped to the body the target orbits, and to nothing
	// else. A planet the leg happens to pass through is still an obstacle, or
	// selecting a station anywhere in the system would turn the whole map
	// permeable.
	const planet = { id: "planet", pos: v3(), radiusKm: PLANET_R };
	const other = { id: "other", pos: v3(0.15 * AU_KM, 0, 0), radiusKm: 4000 };
	const flight = fly({
		from: v3(0.3 * AU_KM, 0, 0),
		target: stationAt(6150),
		masses: [planet, other],
		dt: 0.1,
		targetParentId: "planet",
	});
	expect(flight.exit).toBe("proximity");
	expect(flight.exitBodyId).toBe("other");
});

test("being inside a shell does not pin the ship there", () => {
	// What the report was actually about. `sphereEntry` returns 0 for a step
	// that *starts* inside the sphere, so a ship dropped at a shell was dropped
	// again on the first sub-step of every engagement after it: measured over
	// 200 systems, a second cruise from the drop point covered 1 km before it
	// was stopped, in 124 legs out of 124. Being stopped by a planet was
	// terminal rather than a detour, and the only way on was the 2 km/s crawl
	// the drop radius is bounded from below to avoid.
	//
	// So the guard fires on **crossing inward**, not on being inside: a ship
	// pointed away from the body it is beside is not flying into anything.
	const planet = { id: "planet", pos: v3(), radiusKm: PLANET_R };
	const inside = v3(PLANET_R * 1.02, 0, 0); // inside the shell, clear of the surface
	const away = fly({
		from: inside,
		target: { pos: v3(0.3 * AU_KM, 0, 0), radiusKm: 1 },
		masses: [planet],
		dt: 0.1,
		limitS: 5,
	});
	expect(away.travelledKm).toBeGreaterThan(1000);
	expect(away.exit).not.toBe("proximity");

	// And the converse, or the rule would be an exemption rather than a
	// direction: still pointed at the body, still stopped.
	const into = fly({
		from: inside,
		target: { pos: v3(-0.3 * AU_KM, 0, 0), radiusKm: 1 },
		masses: [planet],
		dt: 0.1,
		limitS: 5,
	});
	expect(into.exit).toBe("proximity");
	expect(into.exitBodyId).toBe("planet");
});

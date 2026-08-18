/**
 * The cruise regime: `docs/specs/in-system-travel.md` as arithmetic.
 *
 * ## Why it is its own module
 *
 * Two reasons, and neither is tidiness.
 *
 * **It must be checkable without a browser.** Every number in the spec is
 * derived rather than felt — §10 says so in as many words — so this node exists
 * to change them and see what happens. A speed law living in the renderer can
 * only be checked by opening one, and a curve nobody can assert is a curve that
 * drifts. `tests/cruise.test.ts` is the spec's §9 read back.
 *
 * **It must not import Three.js**, for the same reason `sim.ts` must not: the
 * authoritative world is float64 kilometres outside the scene graph. Cruise
 * covers 600,000 km in a tick, which is where float32 stops being a rounding
 * question and starts being the difference between arriving and missing the
 * system.
 *
 * ## What is a parameter and what is a rule
 *
 * The split is the point of a prototype node. `CruiseParams` is everything the
 * spec derived and expects to be wrong — `vMaxKms`, `exponent`, `dRefKm`,
 * `dropRadiusKm`, `dropSpeedKms` — and it is passed in rather than read from a
 * constant, so the renderer can offer them as live dials and the tests can
 * sweep them. Everything else here is a *rule*: nose-locked velocity, the
 * nearest-mass key, sub-stepping, the exit clamp. Those came out of the
 * argument in #10 and are not tuning questions.
 *
 * ## Where the assist cap comes from
 *
 * `ASSIST_CAP_KMS` is imported from `sim.ts` and **not re-exported**. The cap is
 * a property of assisted flight (#5), not of cruise — cruise only has to land
 * inside it (§1) — and a second public spelling of one constant is how two
 * modules end up disagreeing about what the number is. It lived here for one
 * round while the flight model was still the scaffold's stand-in, which had the
 * third regime deciding what the first two were allowed to do.
 *
 * ## The one place the spec is ambiguous, and what this does about it
 *
 * §2.3's table has the drop-out firing at 50 km while the ship is still doing
 * 140 km/s; §3 says cruise ends when the ship is inside the drop radius **and**
 * below a speed threshold. Those are different games: the first arrives for
 * you, the second asks you to have cut the throttle. Both are implemented, with
 * `dropSpeedKms` as the dial between them — set it above the arrival speed and
 * §2.3's behaviour is what you get, tighten it and §3's is. Which one is
 * *satisfying* is exactly the sort of question this node is supposed to answer
 * by flying, so it is a parameter rather than a decision made here.
 */

import { ASSIST_CAP_KMS } from "./sim";
import { AU_KM } from "./units";
import { type Vec3, add, dot, length, scale, sub } from "./vec3";

/**
 * The tunable half of the spec — §2's speed law and §3's arrival.
 *
 * An object rather than module constants because the renderer hands the player
 * live dials over it. A module constant would make retuning a rebuild, and a
 * comparison ("is 23 c better than 20?") something you do from memory across
 * two sessions rather than by pressing a key twice.
 */
export interface CruiseParams {
	/** §2: the deep-space cap, km/s. 6.0e6 is 20 c. */
	vMaxKms: number;
	/** §2.2: the dial between a decelerating crawl and a fractional-second
	 *  arrival. 1 is linear, 0.5 is square-root. */
	exponent: number;
	/** §2: the distance at which the cap is reached, km. */
	dRefKm: number;
	/** §2: the safety floor, km/s. The drop-out fires well above it. */
	vMinKms: number;
	/** §3: how close to the target cruise ends, km. Bounded from below by
	 *  normal flight — 1,000 km is an eight-minute crawl at 2 km/s. */
	dropRadiusKm: number;
	/** §3: and how slow. See the module docstring — this is the dial between
	 *  §2.3's arrive-for-you and §3's cut-the-throttle. */
	dropSpeedKms: number;
}

/** The spec's own figures, §2 and §3. The starting point of the tuning, not
 *  its conclusion (§10). */
export const DEFAULT_CRUISE: CruiseParams = {
	vMaxKms: 6.0e6,
	exponent: 0.75,
	dRefKm: 0.5 * AU_KM,
	vMinKms: 100,
	dropRadiusKm: 50,
	// Above the 140 km/s §2.3's table arrives at, so the default is the table's
	// behaviour: the drop fires on proximity. Lower it to demand a throttle.
	dropSpeedKms: 200,
};

/**
 * #5's assist cap, re-exported from the flight model that owns it.
 *
 * The cap is a property of assisted flight, not of cruise — cruise only has to
 * *land inside* it (§1). It lived here for one round while the flight model was
 * still the scaffold's stand-in, which had the third regime deciding what the
 * first two were allowed to do; #21 built the model and it moved.
 */

/** §7: the drive charge, in AU of cruise range. */
export const CHARGE_CAPACITY_AU = 12;
/** §7: passive regeneration, ~1 AU/min, in AU per second. The anti-stranding
 *  rule, and not optional. */
export const CHARGE_REGEN_AU_PER_S = 1 / 60;
/** §7: one unit of charge per AU travelled in cruise — distance, not time. */
export const CHARGE_PER_AU = 1;

/**
 * §8.1's rule: sub-step whenever a step would cover more than this fraction of
 * the distance to the nearest thing that matters.
 *
 * "Nearest thing that matters" is the smaller of the nearest mass and the
 * selected target, which is a refinement on the spec: §8.1 writes `0.1·d`
 * against the speed law's `d`, which is the mass distance. Using only that
 * steps clean past a *station* — the drop-out's own threshold — because a
 * station sits beside its planet and the planet's distance says the step is
 * fine. The failure is the one §9.4 is written to catch, so the fix belongs
 * here rather than in the test.
 */
export const SUBSTEP_FRACTION = 0.1;

/**
 * How many sub-steps one frame may take before the loop gives up on the rest
 * of that frame.
 *
 * The cap exists because the sub-step rule is a *fraction* of the remaining
 * distance, so flying straight into a mass converges geometrically and never
 * terminates on its own: the ship gets closer forever and each frame needs more
 * sub-steps than the last. 96 is far above what any real approach uses — a
 * 6 AU leg at 0.1 s frames peaks in single digits — so hitting it means the
 * player is pointed at a planet with the throttle open, where the honest
 * behaviour is to stop rather than to spend the frame budget arriving nowhere.
 */
export const MAX_SUBSTEPS = 96;

/**
 * How close to a body's surface cruise is allowed, as a multiple of its radius.
 *
 * Crossing it drops the ship into normal flight where it is, rather than
 * letting it continue. This is not in #10 — it is what flying the prototype
 * turned up: the speed law slows an approach asymptotically and there is no
 * collision, so a ship pointed at a planet crawls *inside* it, and the
 * principal found that the fastest way to shed speed near a station was to fly
 * through its planet a few times. A body has to be an obstacle for the
 * nearest-mass law to read as gravity rather than as an exploit.
 *
 * 1.05 rather than 1.0 so the drop happens just clear of the surface: the far
 * layer hands a body over at `HANDOFF_KM`, and dropping *at* the surface would
 * leave the ship inside a sphere it is being drawn the inside of.
 */
export const SURFACE_MARGIN = 1.05;

/** Anything the speed law keys off: §2 counts stars and planets, and
 *  deliberately not moons, stations or belts (§2.1). */
export interface Mass {
	id: string;
	pos: Vec3;
	radiusKm: number;
}

/**
 * The nearest of them, and how far it is — surface-agnostic, centre to centre.
 *
 * Returns `null` for an empty list rather than an infinity, so the caller has
 * to say what "nothing is near" means for it. For the speed law that is the
 * cap; for the HUD it is a blank field.
 */
export function nearestMass(
	pos: Vec3,
	masses: readonly Mass[],
): { id: string; km: number } | null {
	// Squared distances from inline components, one square root at the end. This
	// is the innermost operation of both hot paths — up to `MAX_SUBSTEPS` calls a
	// frame from `advanceCruise` and one per sample from the HUD's ETA integrator
	// — and the obvious `length(sub(pos, m.pos))` allocates a vector per mass per
	// call, which at ~9 masses is several hundred short-lived objects a frame.
	let bestId: string | null = null;
	let bestSq = Number.POSITIVE_INFINITY;
	for (const m of masses) {
		const dx = pos.x - m.pos.x;
		const dy = pos.y - m.pos.y;
		const dz = pos.z - m.pos.z;
		const sq = dx * dx + dy * dy + dz * dz;
		if (sq < bestSq) {
			bestSq = sq;
			bestId = m.id;
		}
	}
	return bestId === null ? null : { id: bestId, km: Math.sqrt(bestSq) };
}

/**
 * §2's law: `v(d) = clamp(v_max · (d/d_ref)^exponent, v_min, v_max)`.
 *
 * `d` is the distance to the nearest star or planet, never to the destination —
 * §2.1 argues that at length, and the short version is that a destination-keyed
 * law flies through worlds between ticks and a mass-keyed one cannot.
 */
export function cruiseSpeed(distanceKm: number, p: CruiseParams): number {
	if (!(distanceKm > 0)) return p.vMinKms;
	const v = p.vMaxKms * (distanceKm / p.dRefKm) ** p.exponent;
	return Math.min(p.vMaxKms, Math.max(p.vMinKms, v));
}

/**
 * §1's exit: velocity along the nose, clamped to the assist cap.
 *
 * A clamp rather than an assignment — a ship that dropped out below the cap is
 * not accelerated to it by the act of dropping out, which would be the regime
 * giving away speed on the way out of itself.
 */
export function exitVelocity(
	nose: Vec3,
	speedKms: number,
	targetVel: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 {
	// The clamp is on the velocity **relative to the destination**, and that is
	// this node's largest finding rather than a detail. A station on a 1 AU
	// orbit is carried around the star at ~30 km/s — fifteen times the assist
	// cap. Clamping the ship's *absolute* velocity to 2 km/s at the drop-out
	// hands the player a destination receding at 28 km/s, which normal flight
	// can never close: the arrival works and docking is then impossible, which
	// is the worst shape a bug can have. Measured in `probe-cruise.mjs`, which
	// could not complete an approach until this changed.
	const relative = sub(scale(nose, speedKms), targetVel);
	const speed = length(relative);
	if (speed <= ASSIST_CAP_KMS) return add(targetVel, relative);
	return add(targetVel, scale(relative, ASSIST_CAP_KMS / speed));
}

/**
 * The speed the drop-out is judged at: the ship's, in the destination's frame.
 *
 * Same argument as `exitVelocity`. Against an absolute threshold, a station's
 * orbital motion alone exceeds any threshold worth having, so the drop-out
 * would fire on proximity or never.
 */
export function closingSpeed(
	nose: Vec3,
	speedKms: number,
	targetVel: Vec3 = { x: 0, y: 0, z: 0 },
): number {
	return length(sub(scale(nose, speedKms), targetVel));
}

/** §7's regeneration, saturating at the tank. */
export function chargeAfterRegen(chargeAu: number, dt: number): number {
	return Math.min(CHARGE_CAPACITY_AU, chargeAu + CHARGE_REGEN_AU_PER_S * dt);
}

/** §7's consumption: one unit per AU travelled in cruise, never below zero. */
export function chargeAfterTravel(chargeAu: number, km: number): number {
	return Math.max(0, chargeAu - (CHARGE_PER_AU * km) / AU_KM);
}

/**
 * Where along a straight step the ship first comes within `radiusKm` of
 * `centre`, or `null` if it never does — §8.1's "swept, not point-sampled",
 * written out.
 *
 * The arithmetic is a ray–sphere intersection, and the reason it is worth
 * having rather than testing the endpoints is the table in §8.1: at 50 km out
 * the per-tick displacement is 28% of the remaining distance, and in deep space
 * at 20 c a single tick covers 600,000 km against a 50 km target. Endpoint tests
 * miss the sphere entirely at both ends of that range; the sweep is exact at
 * any step size, which is what lets the sub-step rule be sized for the *speed
 * law's* accuracy instead of for the drop-out's.
 *
 * Returns 0 when the step starts inside the sphere. `nose` must be a unit
 * vector, which is the caller's invariant everywhere else in this module.
 */
export function sphereEntry(
	from: Vec3,
	nose: Vec3,
	stepKm: number,
	centre: Vec3,
	radiusKm: number,
): number | null {
	const toCentre = sub(centre, from);
	// Distance along the step at which the ship is closest to the centre.
	const closestAt = dot(toCentre, nose);
	const startKm = length(toCentre);
	if (startKm <= radiusKm) return 0;
	// The sphere is behind the ship, or past the end of this step.
	if (closestAt < 0) return null;
	const missSq = startKm * startKm - closestAt * closestAt;
	const halfChordSq = radiusKm * radiusKm - missSq;
	if (halfChordSq < 0) return null;
	const entry = closestAt - Math.sqrt(halfChordSq);
	return entry <= stepKm ? Math.max(0, entry) : null;
}

/** How a frame of cruise ended, or `null` if it did not. */
export type CruiseExit = "arrival" | "proximity" | null;

export interface CruiseInput {
	pos: Vec3;
	/** Unit vector. §1 nose-locks velocity, so this *is* the direction of
	 *  travel — there is no separate velocity to disagree with it. */
	nose: Vec3;
	/** 0…1. §1: magnitude only. */
	throttle: number;
	dt: number;
	masses: readonly Mass[];
	/** What the drop-out is measured against. `null` is free cruise with nothing
	 *  selected, which §6 explicitly allows — you can point anywhere and go. */
	target: { pos: Vec3; radiusKm: number; vel?: Vec3 } | null;
	params: CruiseParams;
	/** Remaining drive charge, AU. Omitted means "not metered", which is what
	 *  the tests of the speed law want; the renderer always passes it. */
	chargeAu?: number;
}

export interface CruiseStep {
	pos: Vec3;
	/** Kilometres covered this frame — what §7 meters the charge against. */
	travelledKm: number;
	/** Whether cruise ended this frame — for any of the reasons below. */
	dropped: boolean;
	/** *Why* it ended, when it did. `arrival` is §3's drop-out; `proximity` is a
	 *  body's surface, which cruise refuses to cross. */
	exit: CruiseExit;
	/** Speed at the end of the frame, km/s. The HUD's headline number. */
	speedKms: number;
	/** The same speed in the destination's frame — what the drop-out is judged
	 *  at, and the honest figure for "am I going to arrive or sail past". */
	closingKms: number;
	/** How many sub-steps the frame took. Read by a probe to show §8.1's rule
	 *  doing work rather than being asserted in prose. */
	substeps: number;
	/** The drive charge ran out mid-frame, so the ship is coasting on nothing
	 *  and cruise is over. */
	starved: boolean;
}

/**
 * One frame of cruise, sub-stepped.
 *
 * Pure in its input: no clock is read, no state is kept between calls. Every
 * frame recomputes the speed from where the ship *is*, which is what makes the
 * law position-dependent rather than an integration with momentum to get wrong
 * — and what lets a test replay a leg at three frame rates and demand the same
 * duration.
 *
 * The sub-step size comes from the distance to the nearest **of the mass and
 * the target**, per `SUBSTEP_FRACTION`'s docstring: the mass alone is what §8.1
 * writes and it is not enough to keep a station's drop radius from being
 * stepped over.
 */
export function advanceCruise(input: CruiseInput): CruiseStep {
	const p = input.params;
	let pos = input.pos;
	let remaining = input.dt;
	let travelledKm = 0;
	let substeps = 0;
	let dropped = false;
	let exit: CruiseExit = null;
	let speedKms = 0;
	let closingKms = 0;
	let charge = input.chargeAu;

	// One shape for every exit, so a new field on `CruiseStep` is added once
	// rather than in the four places this function returns from.
	const halt = (over: Partial<CruiseStep> = {}): CruiseStep => ({
		pos,
		travelledKm,
		dropped,
		speedKms,
		closingKms,
		substeps,
		starved: false,
		exit,
		...over,
	});

	if (charge !== undefined && charge <= 0) return halt({ starved: true });
	if (input.throttle <= 0) return halt();

	while (remaining > 0 && !dropped && substeps < MAX_SUBSTEPS) {
		const mass = nearestMass(pos, input.masses);
		const massKm = mass ? mass.km : Number.POSITIVE_INFINITY;
		const targetKm = input.target
			? length(sub(pos, input.target.pos))
			: Number.POSITIVE_INFINITY;

		// **The law is keyed to the nearer of the mass and the destination.**
		//
		// §2.1 rejected a destination-*only* law, and rightly: it flies through
		// worlds between ticks. Taking the minimum of the two keeps that argument
		// intact — the speed is still bounded by the mass distance, so nothing
		// tunnels — while giving the approach the deceleration it obviously needed.
		//
		// Found by flying it. Without this, a station's speed is set by its planet
		// tens of thousands of km away, so the ship arrives at the drop radius
		// still doing thousands of km/s and sails past; the principal's report was
		// "overshooting station like crazy", and the way he eventually docked was
		// to fly *through the planet* repeatedly to use its gravity well as a
		// brake. With it, the ship is doing §2.3's own 140 km/s at 50 km out and
		// the drop-out fires the way that table always said it would.
		const keyedKm = Math.min(massKm, targetKm);
		speedKms =
			cruiseSpeed(keyedKm, p) * Math.min(1, Math.max(0, input.throttle));
		if (speedKms <= 0) break;

		// Speed in the destination's own frame — see `closingSpeed`. Against an
		// absolute threshold a station's 30 km/s orbital motion decides the
		// drop-out on its own.
		const closing = input.target
			? closingSpeed(input.nose, speedKms, input.target.vel)
			: speedKms;
		closingKms = closing;

		// Already inside the radius when the frame begins, and slow enough: end
		// cruise here rather than flying one more step out of it.
		if (
			input.target &&
			targetKm <= p.dropRadiusKm &&
			closing <= p.dropSpeedKms
		) {
			dropped = true;
			exit = "arrival";
			break;
		}

		// The sub-step is sized off whichever distance the law is reading, which is
		// what keeps `v` accurate along the curve. It is **not** what finds the
		// drop-out: closing on a 50 km radius at 20 c would need more sub-steps
		// every frame than the last, and the run stalls against `MAX_SUBSTEPS` a
		// few thousand km short. Both the drop-out and the surfaces below are
		// **swept** instead (§8.1's own word), which is exact at any step size.
		const cap = Number.isFinite(keyedKm)
			? (SUBSTEP_FRACTION * keyedKm) / speedKms
			: remaining;
		const dt = Math.min(remaining, Math.max(cap, 1e-9));
		let stepKm = speedKms * dt;

		// Sweep the step against the drop sphere: where along this segment, if
		// anywhere, does the ship first come within the drop radius of the target?
		if (input.target && closing <= p.dropSpeedKms) {
			const entryKm = sphereEntry(
				pos,
				input.nose,
				stepKm,
				input.target.pos,
				p.dropRadiusKm,
			);
			if (entryKm !== null) {
				stepKm = entryKm;
				dropped = true;
				exit = "arrival";
			}
		}

		// And against every body's surface. A planet has to *stop* you — the law
		// alone does not, because it slows the ship asymptotically and there is no
		// collision, so a ship aimed at a world crawls into it and out the far
		// side. Flying through a planet turned out to be the most effective brake
		// in the game, which is a mechanic nobody designed.
		//
		// Swept, and taken **before** the drop-out if it happens first, so the
		// nearer event is the one that fires.
		for (const m of input.masses) {
			const entryKm = sphereEntry(
				pos,
				input.nose,
				stepKm,
				m.pos,
				m.radiusKm * SURFACE_MARGIN,
			);
			if (entryKm !== null && entryKm <= stepKm) {
				stepKm = entryKm;
				dropped = true;
				exit = "proximity";
			}
		}

		pos = add(pos, scale(input.nose, stepKm));
		travelledKm += stepKm;
		remaining -= dt;
		substeps++;

		if (charge !== undefined) {
			charge = chargeAfterTravel(charge, stepKm);
			if (charge <= 0) return halt({ starved: true });
		}
	}

	return halt();
}

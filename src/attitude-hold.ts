/**
 * Holding an attitude through the vents: what a computer asks of the stick to
 * bring a hull's nose and up onto a wanted pair (#619).
 *
 * `flight-model.md` §3.6: an autopilot emits axis-level demands and the sim
 * composes them into vent firings — no caller turns a hull except through that
 * composition. The docking computer used to *place* the attitude by slewing it
 * at the hull's peak rate and zeroing the rates; that turned a hull no vent
 * turned. This is what it asks for instead, and `stepAngular` with the assist
 * on is what turns the hull.
 *
 * The law is the raider's (`combat-enemy.ts`'s `stoppingStick`) applied to
 * every axis: on each, the fastest rate that can still stop on the wanted
 * attitude under the axis's authority. A wanted attitude that moves — a slot
 * spinning with its station — is followed with the small lag that rate needs:
 * `ω² / 2α`, under a degree for the courier at 3 rpm.
 *
 * Pure, no Three.js: the body axes are the Hull step's (`sim.ts`
 * `turnAttitude`), pitch about starboard, yaw about dorsal and roll about aft
 * (`-nose`).
 */

import type { Angular, Attitude, FlightPerformance } from "./sim";
import {
	type Vec3,
	add,
	clamp,
	cross,
	dot,
	length,
	rotateAbout,
	scale,
	sub,
	v3,
} from "./vec3";

/** The nose's arc onto `want`: a unit axis and an angle. Half a turn away
 *  the axis vanishes and any perpendicular will do, so `up` stands in. */
const noseArc = (from: Attitude, want: Vec3): { axis: Vec3; angle: number } => {
	const c = clamp(dot(from.nose, want), -1, 1);
	const arc = cross(from.nose, want);
	const n = length(arc);
	return { axis: n > 1e-12 ? scale(arc, 1 / n) : from.up, angle: Math.acos(c) };
};

/**
 * The rotation that takes `from` onto `want`, as a world rotation vector:
 * the nose's arc first, then the roll about the nose that lays `up` on the
 * wanted up.
 */
/** The roll about `nose` that lays `up` on `wantUp` once that is laid across
 *  `nose`, radians, signed about aft (`-nose`), the sense `main.ts` rolls. */
const bankAbout = (up: Vec3, wantUp: Vec3, nose: Vec3): number => {
	const across = sub(wantUp, scale(nose, dot(wantUp, nose)));
	return Math.atan2(dot(cross(up, across), scale(nose, -1)), dot(up, across));
};

export function attitudeError(from: Attitude, want: Attitude): Vec3 {
	const { axis: arc, angle: off } = noseArc(from, want.nose);
	const swung = off > 0 ? rotateAbout(from.up, arc, off) : from.up;
	const bank = bankAbout(swung, want.up, want.nose);
	return add(scale(arc, off), scale(want.nose, -bank));
}

/**
 * A stick, −1…1 per axis, that brings `from` onto `want` without overshooting
 * it: on each body axis, the rate that can still stop on the error under that
 * axis's authority, as a share of the axis's peak rate.
 *
 * **And no faster than closes the error in one step of `dt`.** The stopping
 * rate `√(2αe)` has no bound on its gain at zero, so on its own it hunts round
 * the target at a step's worth of authority and fires a vent on every frame;
 * capped at `e / dt` the last step lands instead.
 *
 * `wantSpin` is how fast the wanted attitude itself turns, as a world angular
 * velocity — a slot spinning with its station. It is asked for on top, so a
 * moving target is followed rather than chased: without it the stopping law
 * trails a spin by `ω² / 2α`, which cost the miner two rpm of the spin it
 * could dock at.
 */
export function attitudeStick(
	from: Attitude,
	want: Attitude,
	perf: FlightPerformance,
	dt: number,
	wantSpin: Vec3 = v3(),
): Angular {
	const right = cross(from.nose, from.up);
	const aft = scale(from.nose, -1);
	// The nose's arc, on pitch and yaw; and the roll about the **current**
	// nose that lays up on the wanted up. Taken about the wanted nose instead,
	// an unmet bank leaks into pitch and yaw while the nose is off, and a hull
	// that cannot match a fast spin cones round its heading for good.
	const arc = noseArc(from, want.nose);
	const nose = scale(arc.axis, arc.angle);
	const bank = bankAbout(from.up, want.up, from.nose);
	const stick = (e: number, carry: number, axis: keyof Angular) => {
		const close =
			Math.sign(e) *
			Math.min(
				Math.sqrt(2 * perf.angularAuthority[axis] * Math.abs(e)),
				dt > 0 ? Math.abs(e) / dt : Number.POSITIVE_INFINITY,
			);
		return clamp((close + carry) / perf.angularMax[axis], -1, 1);
	};
	return {
		pitch: stick(dot(nose, right), dot(wantSpin, right), "pitch"),
		yaw: stick(dot(nose, from.up), dot(wantSpin, from.up), "yaw"),
		roll: stick(bank, dot(wantSpin, aft), "roll"),
	};
}

/** The world angular velocity that turns `before` into `after` over `dt`: a
 *  wanted attitude's own spin, read off two of its samples. */
export const attitudeSpin = (
	before: Attitude,
	after: Attitude,
	dt: number,
): Vec3 => (dt > 0 ? scale(attitudeError(before, after), 1 / dt) : v3());

/**
 * A computer following a wanted attitude from one frame to the next: the
 * stick, with the wanted attitude's own spin read off its last sample (#619).
 *
 * One object for `main.ts`'s docking computer and the harness that flies
 * it headlessly, so the two cannot drift apart. `reset` on every frame the
 * computer does not fly: a sample from before a release, read against one
 * after it, is a spin nobody asked for.
 */
export class AttitudeFollower {
	private last: Attitude | null = null;

	/** `asked` need not be orthogonal: a computer states a nose and an up
	 *  separately. Its up is laid across its nose here, and one parallel to
	 *  the nose keeps the hull's own; a zero nose keeps the hull's nose. */
	stick(
		from: Attitude,
		asked: Attitude,
		perf: FlightPerformance,
		dt: number,
	): Angular {
		// A degenerate command keeps the hull's own nose rather than a NaN.
		const asks = length(asked.nose);
		const nose = asks < 1e-12 ? from.nose : scale(asked.nose, 1 / asks);
		const across = sub(asked.up, scale(nose, dot(asked.up, nose)));
		const want = {
			nose,
			up: length(across) < 1e-12 ? from.up : scale(across, 1 / length(across)),
		};
		const spin = this.last ? attitudeSpin(this.last, want, dt) : v3();
		this.last = want;
		return attitudeStick(from, want, perf, dt, spin);
	}

	reset(): void {
		this.last = null;
	}
}

/** `F`'s turn is over once the nose is this close to the target, radians… */
export const FACE_SETTLED_RAD = (0.1 * Math.PI) / 180;
/** …and the hull is turning no faster than this, rad/s. */
export const FACE_SETTLED_RATE = 0.002;

/**
 * The stick that turns the nose onto `want`, a unit vector, through the vents:
 * `F`'s turn, which used to place the attitude in one frame. Pitch and yaw
 * only — the nose's arc, with the roll left where it is. `null` once the nose
 * is on and the hull has stopped turning, which is when the turn lets go.
 */
export function noseTurnStick(
	from: Attitude,
	want: Vec3,
	rates: Angular,
	perf: FlightPerformance,
	dt: number,
): Angular | null {
	if (
		dot(from.nose, want) >= Math.cos(FACE_SETTLED_RAD) &&
		Math.hypot(rates.pitch, rates.yaw) <= FACE_SETTLED_RATE
	)
		return null;
	const stick = attitudeStick(from, { nose: want, up: from.up }, perf, dt);
	return { ...stick, roll: 0 };
}

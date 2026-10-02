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
 * Pure, no Three.js: the body axes follow `main.ts`'s quaternion step, pitch
 * about starboard, yaw about dorsal and roll about aft (`-nose`).
 */

import type { Angular, FlightPerformance } from "./sim";
import {
	type Vec3,
	add,
	cross,
	dot,
	length,
	rotateAbout,
	scale,
	sub,
	v3,
} from "./vec3";

/** A hull's attitude as its two axes, unit and orthogonal. */
export interface Attitude {
	nose: Vec3;
	up: Vec3;
}

const clamp = (v: number, lo: number, hi: number): number =>
	Math.min(hi, Math.max(lo, v));

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
export function attitudeError(from: Attitude, want: Attitude): Vec3 {
	const { axis: arc, angle: off } = noseArc(from, want.nose);
	const swung = off > 0 ? rotateAbout(from.up, arc, off) : from.up;
	// The wanted up, laid in the plane across the wanted nose.
	const wantUp = sub(want.up, scale(want.nose, dot(want.up, want.nose)));
	const aft = scale(want.nose, -1);
	const bank = Math.atan2(dot(cross(swung, wantUp), aft), dot(swung, wantUp));
	return add(scale(arc, off), scale(aft, bank));
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
	const wantUp = sub(want.up, scale(from.nose, dot(want.up, from.nose)));
	const bank = Math.atan2(
		dot(cross(from.up, wantUp), aft),
		dot(from.up, wantUp),
	);
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
	 *  the nose keeps the hull's own. */
	stick(
		from: Attitude,
		asked: Attitude,
		perf: FlightPerformance,
		dt: number,
	): Angular {
		const nose = scale(asked.nose, 1 / length(asked.nose));
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

/**
 * Turn an attitude by body rates over `dt`: the world rotation `main.ts`'s
 * quaternion step makes, as an axis and an angle. For a harness that flies a
 * hull without a quaternion.
 */
export function turnAttitude(
	from: Attitude,
	rates: Angular,
	dt: number,
): Attitude {
	const right = cross(from.nose, from.up);
	const spin = add(
		add(scale(right, rates.pitch), scale(from.up, rates.yaw)),
		scale(from.nose, -rates.roll),
	);
	const w = length(spin);
	if (w === 0 || dt <= 0) return from;
	const axis = scale(spin, 1 / w);
	const nose = rotateAbout(from.nose, axis, w * dt);
	const up = rotateAbout(from.up, axis, w * dt);
	const n = scale(nose, 1 / length(nose));
	const u = sub(up, scale(n, dot(up, n)));
	return { nose: n, up: scale(u, 1 / length(u)) };
}

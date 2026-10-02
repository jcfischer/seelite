/**
 * #5's flight laws as `src/sim.ts` ran them before the vent substrate (#619),
 * kept runnable as the reference `tests/vents.test.ts` holds the vents to.
 *
 * Copied, not imported: the module they lived in no longer has them. Two
 * things in them are gone on purpose, and the tests say where the vents part
 * from them: the renormalisation of the total to the cap (§3.10), and an
 * ease-out with no bound on its authority (§3.8).
 */

import { ASSIST_CAP_KMS, type Angular } from "../../src/sim";
import { type Vec3, add, dot, length, scale, sub } from "../../src/vec3";

const clamp = (v: number, lo: number, hi: number): number =>
	Math.min(hi, Math.max(lo, v));

export interface LegacyPerformance {
	thrustKms2: number;
	assistLateralTauS: number;
	angularMax: Angular;
	angularAccel: number;
	angularDampTauS: number;
}

/** `assistedRelative` at `origin/main` 9e12404. */
export function legacyAssisted(
	relative: Vec3,
	nose: Vec3,
	throttle: number,
	dt: number,
	perf: LegacyPerformance,
): Vec3 {
	const along = dot(relative, nose);
	const lateral = sub(relative, scale(nose, along));
	const damped = scale(lateral, Math.exp(-dt / perf.assistLateralTauS));
	const want = throttle * ASSIST_CAP_KMS;
	const authority = perf.thrustKms2 * dt;
	const next = along + clamp(want - along, -authority, authority);
	const assisted = add(scale(nose, next), damped);
	const speed = length(assisted);
	return speed > ASSIST_CAP_KMS
		? scale(assisted, ASSIST_CAP_KMS / speed)
		: assisted;
}

/** `stepAngular` at `origin/main` 9e12404, both regimes. */
export function legacyAngular(
	rates: Angular,
	command: Angular,
	impulse: Angular,
	assist: boolean,
	dt: number,
	perf: LegacyPerformance,
): Angular {
	if (dt <= 0) return rates;
	const decay = Math.exp(-dt / perf.angularDampTauS);
	const axis = (rate: number, want: number, kick: number, max: number) => {
		if (assist && Math.abs(rate) > max)
			return (
				Math.sign(rate) * Math.max(max, Math.abs(rate) - perf.angularAccel * dt)
			);
		let next = rate + kick;
		if (want !== 0) {
			const target = clamp(want, -1, 1) * max;
			next += clamp(
				target - next,
				-perf.angularAccel * dt,
				perf.angularAccel * dt,
			);
		} else if (assist) next *= decay;
		return clamp(next, -max, max);
	};
	return {
		pitch: axis(
			rates.pitch,
			command.pitch,
			impulse.pitch,
			perf.angularMax.pitch,
		),
		yaw: axis(rates.yaw, command.yaw, impulse.yaw, perf.angularMax.yaw),
		roll: axis(rates.roll, command.roll, impulse.roll, perf.angularMax.roll),
	};
}

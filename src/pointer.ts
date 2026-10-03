/**
 * The pointer's turn (#641): what a mouse delta asks of the attitude vents.
 *
 * A delta is a demand for a change of rate (`flight-model.md` §3.8.2, ruled),
 * and `stepAngular` pays at most the couple's authority a step; what it cannot
 * pay is lost. So a fast movement is clipped twice: by `MOUSE_MAX_STEP` here,
 * a frame's spike guard, and by the couple there, `angularAuthority × dt`. The
 * couple's clip binds first on every hull at 60 Hz and is frame-rate
 * invariant: it is `A / MOUSE_RAD_PER_PX` pixels a second.
 * `tests/pointer.test.ts` prints it per hull.
 *
 * A `carry` arm that banked the unpaid part and asked for it again was flown
 * against this law on #641 and the principal kept this one.
 */

import type { Angular } from "./sim";

/** Radians a second of rate one pixel of pointer movement asks for. */
export const MOUSE_RAD_PER_PX = 0.0022;

/** How far a single frame's mouse movement may turn the ship, radians. A
 *  flicked pointer or a re-focused window can deliver a delta of hundreds of
 *  pixels in one event, and without this the ship spins. */
export const MOUSE_MAX_STEP = 0.12;

/** A rate change on the two axes the pointer drives, rad/s. */
export interface PointerRate {
	pitch: number;
	yaw: number;
}

const clampAbs = (v: number, max: number) => Math.max(-max, Math.min(max, v));

/** What a raw delta asks for, rad/s: the nose follows the pointer. */
export const asked = (dxPx: number, dyPx: number): PointerRate => ({
	pitch: -dyPx * MOUSE_RAD_PER_PX,
	yaw: -dxPx * MOUSE_RAD_PER_PX,
});

/** The impulse this frame's delta asks of `stepAngular`, spike-guarded. */
export function pointerImpulse(dxPx: number, dyPx: number): Angular {
	const now = asked(dxPx, dyPx);
	return {
		pitch: clampAbs(now.pitch, MOUSE_MAX_STEP),
		yaw: clampAbs(now.yaw, MOUSE_MAX_STEP),
		roll: 0,
	};
}

/** One flick, as the readout reports it. */
export interface Flick {
	/** The fastest frame, pixels a second. */
	peakPxS: number;
	/** The rate change the pointer asked for over the flick, rad/s summed
	 *  over pitch and yaw. */
	askedRadS: number;
	/** The rate change the vents paid toward it. */
	deliveredRadS: number;
	durationS: number;
}

/** A flick ends this long after the pointer stops. */
const FLICK_QUIET_S = 0.15;

/**
 * Reads flicks for a flight test: the console readout the principal pastes
 * (`__seelite.pointerReadout`), so a limit is compared with their own hand
 * rather than with an assumed one. #641 read a hard flick at 22,000–24,000
 * px/s against the courier's 1364.
 */
export class FlickMeter {
	private current: Flick | null = null;
	private quietS = 0;
	last: Flick | null = null;
	/** The fastest flick since the page loaded: a small correction after a
	 *  hard spin replaces `last` but not this. */
	hardest: Flick | null = null;

	frame(
		dxPx: number,
		dyPx: number,
		dt: number,
		askedNow: PointerRate,
		delivered: PointerRate,
	) {
		if (!(dt > 0)) return;
		const moving = dxPx !== 0 || dyPx !== 0;
		if (!moving && !this.current) return;
		if (!this.current)
			this.current = {
				peakPxS: 0,
				askedRadS: 0,
				deliveredRadS: 0,
				durationS: 0,
			};
		const f = this.current;
		f.peakPxS = Math.max(f.peakPxS, Math.hypot(dxPx, dyPx) / dt);
		f.askedRadS += Math.abs(askedNow.pitch) + Math.abs(askedNow.yaw);
		f.deliveredRadS += Math.abs(delivered.pitch) + Math.abs(delivered.yaw);
		f.durationS += dt;
		this.quietS = moving ? 0 : this.quietS + dt;
		if (this.quietS >= FLICK_QUIET_S) {
			this.last = f;
			if (!this.hardest || f.peakPxS > this.hardest.peakPxS) this.hardest = f;
			this.current = null;
			this.quietS = 0;
		}
	}

	reset() {
		this.current = null;
		this.quietS = 0;
	}
}

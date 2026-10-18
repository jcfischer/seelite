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

/** Whether a lock was asked for; engines without the method ask for nothing. */
export function requestLock(el: {
	requestPointerLock?: () => unknown;
}): boolean {
	if (typeof el.requestPointerLock !== "function") return false;
	// **A refusal is read, not thrown** — it is the ordinary case, not the
	// exceptional one: Chrome holds out after the player's own Escape and
	// past a rate limit whatever the reason, a window that is not the key
	// window cannot be locked at all, and Safari refuses outright without a
	// gesture it may or may not have just seen. Dropping the promise made
	// every refused click an unhandled rejection, which surfaces as a page
	// error — which is why `probe-gun-feedback.mjs` had to stub this call
	// out to keep its own click real. **And the promise is not assumed:**
	// the returning form of this call is not universal, and on an engine
	// that hands back `undefined` a `.catch` taken straight off it is the
	// very uncaught error this line exists to remove. TypeScript cannot see
	// that, because its own `lib.dom` declares the Promise. The retry is the
	// next click, which is where we are standing.
	void Promise.resolve(el.requestPointerLock()).catch(() => {});
	return true;
}

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

/** The pointer speed, px/s, above which a couple of `authority` rad/s²
 *  stops paying a delta in full. Frame-rate invariant. */
export const couplePxS = (authority: number) => authority / MOUSE_RAD_PER_PX;

/** What a raw delta asks for, rad/s: the nose follows the pointer. */
const asked = (dxPx: number, dyPx: number): PointerRate => ({
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
	/** The fastest movement over any `FLICK_PEAK_WINDOW_S`, pixels a second. */
	peakPxS: number;
	/** The rate change the pointer asked for over the flick, rad/s summed
	 *  over pitch and yaw. */
	askedRadS: number;
	/** The rate change that reached the rate toward it, after the spike
	 *  guard and the couple. */
	deliveredRadS: number;
	/** From the first move to the last, seconds; the quiet that closes the
	 *  flick is not in it. */
	durationS: number;
	/** Whether the assist was on for any frame of it. */
	assisted: boolean;
}

/** A flick ends this long after the pointer stops. */
const FLICK_QUIET_S = 0.15;

/** A flick's peak is read over this much time, not over one frame: a single
 *  event can carry hundreds of pixels (a re-focused window, a hitch), and a
 *  one-frame peak would be that event rather than the hand. */
export const FLICK_PEAK_WINDOW_S = 0.05;

/**
 * Reads flicks for a flight test: the console readout the principal pastes
 * (`__seelite.pointerReadout`), so a limit is compared with their own hand
 * rather than with an assumed one. `deliveredRadS` is what reached the rate:
 * the spike guard's clip and the couple's together.
 */
export class FlickMeter {
	private current: Flick | null = null;
	private quietS = 0;
	/** The frames inside the peak window, newest last. */
	private recent: { px: number; dt: number }[] = [];
	last: Flick | null = null;
	/** The fastest flick since the page loaded: a small correction after a
	 *  hard spin replaces `last` but not this. */
	hardest: Flick | null = null;

	frame(
		dxPx: number,
		dyPx: number,
		dt: number,
		delivered: PointerRate,
		assist: boolean,
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
				assisted: false,
			};
		const f = this.current;
		this.recent.push({ px: Math.hypot(dxPx, dyPx), dt });
		let windowS = this.recent.reduce((t, r) => t + r.dt, 0);
		while (windowS - this.recent[0].dt >= FLICK_PEAK_WINDOW_S)
			windowS -= this.recent.shift()?.dt ?? 0;
		const px = this.recent.reduce((t, r) => t + r.px, 0);
		f.peakPxS = Math.max(
			f.peakPxS,
			px / Math.max(windowS, FLICK_PEAK_WINDOW_S),
		);
		const askedNow = asked(dxPx, dyPx);
		f.askedRadS += Math.abs(askedNow.pitch) + Math.abs(askedNow.yaw);
		f.deliveredRadS += Math.abs(delivered.pitch) + Math.abs(delivered.yaw);
		f.durationS += dt;
		f.assisted ||= assist;
		this.quietS = moving ? 0 : this.quietS + dt;
		if (this.quietS >= FLICK_QUIET_S) {
			f.durationS -= this.quietS;
			this.last = f;
			if (!this.hardest || f.peakPxS > this.hardest.peakPxS) this.hardest = f;
			this.reset();
		}
	}

	reset() {
		this.current = null;
		this.quietS = 0;
		this.recent = [];
	}
}

/**
 * The pointer's turn (#641): what a mouse delta asks of the attitude vents,
 * and what happens to the part they cannot pay in one step.
 *
 * A delta is a demand for a change of rate (`flight-model.md` §3.8.2), and
 * `stepAngular` pays at most the couple's authority a step. So a fast movement
 * is clipped twice: by `MOUSE_MAX_STEP` here, a frame's spike guard, and by the
 * couple there, `angularAuthority × dt`. The couple's clip binds first on every
 * hull at 60 Hz and is frame-rate invariant: it is `A / MOUSE_RAD_PER_PX`
 * pixels a second. `tests/pointer.test.ts` prints it per hull.
 *
 * Two laws, chosen by `?pointer=` for the principal's flight test:
 *
 * - **`drop`** — today's law. What the step cannot pay is lost.
 * - **`carry`** — what the step cannot pay is banked and asked for again on
 *   the next step, the bank decaying at `tauS`. The assist-off regime only:
 *   with the assist on, `stepAngular` reports nothing unspent. The bank is
 *   capped at `capRadS` a axis, which is the spike guard on this arm, so a
 *   re-focused window's hundreds of pixels cannot bank a spin.
 *
 * `carry` is **not** Elite's virtual stick. That law makes the pointer a stick
 * deflection which returns to centre at a set rate, and the deflection asks
 * for a torque; this one keeps the pointer a change of rate and only stops
 * losing it. The tuning is hull-invariant on purpose: thrust is a hull's one
 * handling dial (map #1's Constraints), and this is the input layer.
 */

import type { Angular } from "./sim";

/** Radians a second of rate one pixel of pointer movement asks for. */
export const MOUSE_RAD_PER_PX = 0.0022;

/** How far a single frame's mouse movement may turn the ship, radians. A
 *  flicked pointer or a re-focused window can deliver a delta of hundreds of
 *  pixels in one event, and without this the ship spins. The `drop` law's
 *  spike guard; `carry` uses its bank cap instead. */
export const MOUSE_MAX_STEP = 0.12;

export type PointerLaw = "drop" | "carry";

export interface PointerTuning {
	law: PointerLaw;
	/** The bank's e-folding time, seconds. */
	tauS: number;
	/** The most a bank may hold a axis, rad/s. */
	capRadS: number;
}

export const POINTER_DEFAULTS: PointerTuning = Object.freeze({
	law: "drop",
	tauS: 0.25,
	capRadS: 1,
});

/** What the pointer still asks for, rad/s, per axis it drives. */
export interface PointerBank {
	pitch: number;
	yaw: number;
}

export const EMPTY_BANK: PointerBank = Object.freeze({ pitch: 0, yaw: 0 });

const clampAbs = (v: number, max: number) => Math.max(-max, Math.min(max, v));

/** What a raw delta asks for, rad/s: the nose follows the pointer. */
export const asked = (dxPx: number, dyPx: number): PointerBank => ({
	pitch: -dyPx * MOUSE_RAD_PER_PX,
	yaw: -dxPx * MOUSE_RAD_PER_PX,
});

/** The impulse this step asks of `stepAngular`: this frame's delta, plus the
 *  bank on `carry`. */
export function pointerImpulse(
	tuning: PointerTuning,
	bank: PointerBank,
	dxPx: number,
	dyPx: number,
): Angular {
	const now = asked(dxPx, dyPx);
	if (tuning.law === "drop")
		return {
			pitch: clampAbs(now.pitch, MOUSE_MAX_STEP),
			yaw: clampAbs(now.yaw, MOUSE_MAX_STEP),
			roll: 0,
		};
	return {
		pitch: clampAbs(bank.pitch + now.pitch, tuning.capRadS),
		yaw: clampAbs(bank.yaw + now.yaw, tuning.capRadS),
		roll: 0,
	};
}

/** The bank after a step: what `stepAngular` left unspent, decayed, on
 *  `carry`; nothing on `drop`. */
export function settleBank(
	tuning: PointerTuning,
	unspent: Angular,
	dt: number,
): PointerBank {
	if (tuning.law === "drop") return EMPTY_BANK;
	const decay = Math.exp(-dt / tuning.tauS);
	return { pitch: unspent.pitch * decay, yaw: unspent.yaw * decay };
}

/** One flick, as the flight test reads it. */
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

/** A flick ends this long after the pointer stops and the bank is empty. */
const FLICK_QUIET_S = 0.15;

/**
 * Reads flicks for the flight test: the console readout the principal pastes
 * (`__seelite.pointerReadout`), so the limit is compared with their own hand
 * rather than with an assumed one.
 */
export class FlickMeter {
	private current: Flick | null = null;
	private quietS = 0;
	last: Flick | null = null;

	frame(
		dxPx: number,
		dyPx: number,
		dt: number,
		askedNow: PointerBank,
		delivered: PointerBank,
		bankRadS = 0,
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
		this.quietS = moving || bankRadS > 1e-6 ? 0 : this.quietS + dt;
		if (this.quietS >= FLICK_QUIET_S) {
			this.last = f;
			this.current = null;
			this.quietS = 0;
		}
	}

	reset() {
		this.current = null;
		this.quietS = 0;
	}
}

/** The flight test's tuning from a query string: `?pointer=carry`, and
 *  optionally `pointerTau` (seconds) and `pointerCap` (rad/s). Anything
 *  unreadable keeps its default. */
export function pointerTuningFrom(search: string): PointerTuning {
	const q = new URLSearchParams(search);
	const positive = (key: string, fallback: number) => {
		const v = Number(q.get(key));
		return q.has(key) && Number.isFinite(v) && v > 0 ? v : fallback;
	};
	return {
		law: q.get("pointer") === "carry" ? "carry" : "drop",
		tauS: positive("pointerTau", POINTER_DEFAULTS.tauS),
		capRadS: positive("pointerCap", POINTER_DEFAULTS.capRadS),
	};
}

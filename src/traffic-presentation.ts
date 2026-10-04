/**
 * Where a Traffic carrier on its projection is drawn at a clock, and how far
 * that moves it across one step (node #664). Three-free, so the render path
 * and the collision step read one law and a headless test can read it too.
 *
 * The authority projects every carrier at 10 Hz. Between two authority ticks
 * the drawn pose blends the **correction**, not two stale absolute positions:
 * each sample is predicted forward to the clock first, along its own `vel`,
 * and the two predictions are blended by how far the clock is into the
 * current tick's span. A station can translate several kilometres during one
 * authority interval, so blending the absolute poses would draw the carrier a
 * whole tick behind its station (#266's recording).
 *
 * **A drawn step is not `vel · dt`.** The blend moves the carrier by the
 * correction as well as by `vel`, and on a smoothed local approach `vel` read
 * 0.082 km/s for a step that moved several kilometres
 * (`docs/findings/traffic-collision-corpus.md`). Anything that sweeps a
 * projection — the collision step — takes its motion from two presented
 * poses (`presentedTrafficStep`), never from `vel`.
 */

import { type Vec3, add, scale, sub } from "./vec3";

/** One authority sample of a carrier: where it was projected, and the
 *  velocity of the law it interpolates. */
export interface TrafficSample {
	pos: Vec3;
	vel: Vec3;
}

/** The two authority samples a drawn pose is blended from, and their clocks. */
export interface TrafficSamples {
	current: TrafficSample;
	currentAtS: number;
	/** The tick before, or `null` when there is none to blend from. */
	prior: TrafficSample | null;
	priorAtS: number;
	/**
	 * `current.pos` was already resampled at the clock (a carrier settled in
	 * a berth, `parkedTrafficProjection`), so it is not predicted again —
	 * that would apply the station's orbital velocity twice.
	 */
	settled?: boolean;
}

/** Where `samples` draw the carrier at `atS` seconds of game time. */
export function presentedTrafficPos(
	samples: TrafficSamples,
	atS: number,
): Vec3 {
	const { current, currentAtS, prior, priorAtS } = samples;
	const predict = (pose: TrafficSample, fromS: number): Vec3 =>
		add(
			pose.pos,
			scale(pose.vel, Number.isFinite(fromS) ? Math.max(0, atS - fromS) : 0),
		);
	const now = samples.settled
		? { ...current.pos }
		: predict(current, currentAtS);
	if (!prior) return now;
	const spanS = currentAtS - priorAtS;
	const blend =
		Number.isFinite(spanS) && spanS > 0
			? Math.max(0, Math.min(1, (atS - currentAtS) / spanS))
			: 1;
	const before = predict(prior, priorAtS);
	return add(before, scale(sub(now, before), blend));
}

/** Where the last sweep left a carrier: its drawn end, and the clock of it. */
export interface TrafficSweptEnd {
	atS: number;
	pos: Vec3;
}

/** Two clocks this close are one: a step's end and the next step's start are
 *  each `gameTime + dt`, summed the same way, so this only absorbs rounding. */
const SAME_CLOCK_S = 1e-9;

/**
 * A projected carrier across one step: drawn at `fromS + dt`, from where the
 * step began, and the velocity that displacement is (node #664). Each end is
 * evaluated at its own clock, blend and prediction alike.
 *
 * **`from` carries the previous sweep's end across an authority tick.** Within
 * one tick's samples a step's end is the next step's start by construction.
 * Across a tick it is not: the step before the tick ended on the old samples,
 * and the new ones draw the carrier somewhere else at the same clock — on a
 * local approach a correction of up to a kilometre, spread by the blend, so
 * up to about 0.1 km on the first 60 Hz frame. The render path draws both
 * poses, one frame apart. Given the last sweep's end at `fromS`, the step
 * starts there, so that jump is swept rather than skipped, and its velocity
 * spikes on a tick's frame by exactly the jump: that is the drawn motion. A
 * `from` at any other clock — a carrier not swept last step, a rewound clock
 * — is ignored, and the step starts where it is drawn now. With no step to
 * divide by, the velocity is the current sample's.
 */
export function presentedTrafficStep(
	samples: TrafficSamples,
	fromS: number,
	dt: number,
	from: TrafficSweptEnd | null = null,
): { start: Vec3; end: Vec3; vel: Vec3 } {
	const start =
		from && Math.abs(from.atS - fromS) <= SAME_CLOCK_S
			? { ...from.pos }
			: presentedTrafficPos(samples, fromS);
	if (!(dt > 0)) return { start, end: start, vel: { ...samples.current.vel } };
	const end = presentedTrafficPos(samples, fromS + dt);
	return { start, end, vel: scale(sub(end, start), 1 / dt) };
}

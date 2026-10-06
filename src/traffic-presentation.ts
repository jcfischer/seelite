/**
 * Where a Traffic carrier on its projection is drawn at a clock, how it is
 * turned there, and how far that moves it across one step (node #664). Three-free, so the render path
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

import { shipPose, spinBetween } from "./collision";
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

/** A carrier's attitude as a sample carries it: the nose, and the up when
 *  the route states one. */
export interface AttitudeSample {
	nose?: Vec3 | null;
	up?: Vec3 | null;
}

/** One authority sample of a carrier: where it was projected, the velocity
 *  of the law it interpolates, and its attitude. */
export interface TrafficSample extends AttitudeSample {
	pos: Vec3;
	vel: Vec3;
}

/** A drawn attitude: the nose and the up, at right angles. */
export interface TrafficAttitude {
	nose: Vec3;
	up: Vec3;
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
	const before = predict(prior, priorAtS);
	return add(before, scale(sub(now, before), blendAt(samples, atS)));
}

/** How far `atS` is into the current tick's span, `[0, 1]`: the one blend
 *  the pose and the attitude are both drawn with. */
function blendAt(
	samples: { currentAtS: number; priorAtS: number },
	atS: number,
): number {
	const spanS = samples.currentAtS - samples.priorAtS;
	return Number.isFinite(spanS) && spanS > 0
		? Math.max(0, Math.min(1, (atS - samples.currentAtS) / spanS))
		: 1;
}

/** The hull's forward axis in its own frame, as the mesh is built. */
const FORWARD = v3(0, 0, -1);

/**
 * A sample's attitude as a frame, the up square to the nose — as three's
 * `lookAt` squares it before drawing, so a route's up that has drifted off
 * square is swept where it is drawn. With no up, the up is where the
 * shortest turn from `FORWARD` onto the nose carries the hull's own up —
 * what three's `setFromUnitVectors` draws, a half turn about the up included.
 */
function frameOf(sample: AttitudeSample): TrafficAttitude | null {
	if (!sample.nose) return null;
	const nose = scale(sample.nose, 1 / length(sample.nose));
	if (sample.up) {
		const square = sub(sample.up, scale(nose, dot(sample.up, nose)));
		const n = length(square);
		if (n > 1e-12) return { nose, up: scale(square, 1 / n) };
	}
	const cos = dot(FORWARD, nose);
	const axis = cross(FORWARD, nose);
	const sin = length(axis);
	if (sin < 1e-12) return { nose, up: v3(0, 1, 0) };
	return {
		nose,
		up: rotateAbout(v3(0, 1, 0), scale(axis, 1 / sin), Math.atan2(sin, cos)),
	};
}

/**
 * How a carrier is **turned** where `samples` draw it at `atS` (node #664):
 * the prior tick's attitude turned toward the current one by the blend its
 * pose is drawn with, along the shortest turn — a slerp — and the current
 * one alone with no prior. The render path draws the hull at this attitude
 * and the collision step sweeps its box at it, so what is swept is what is
 * drawn in turn as well as in place. `null` when the current sample has no
 * nose, which draws nothing.
 */
export function presentedTrafficAttitude(
	samples: {
		current: AttitudeSample;
		currentAtS: number;
		prior: AttitudeSample | null;
		priorAtS: number;
	},
	atS: number,
): TrafficAttitude | null {
	const now = frameOf(samples.current);
	if (!now) return null;
	const before = samples.prior ? frameOf(samples.prior) : null;
	if (!before) return now;
	const from = shipPose(v3(), before.nose, before.up);
	const spin = spinBetween(from, shipPose(v3(), now.nose, now.up));
	const angle = spin.angle * blendAt(samples, atS);
	if (angle === 0) return before;
	return {
		nose: rotateAbout(before.nose, spin.axis, angle),
		up: rotateAbout(before.up, spin.axis, angle),
	};
}

/** Where the last sweep left a carrier: its drawn end, its attitude there,
 *  and the clock of it. */
export interface TrafficSweptEnd {
	atS: number;
	pos: Vec3;
	attitude: TrafficAttitude | null;
}

/** Two clocks this close are one: a step's end and the next step's start are
 *  each `gameTime + dt`, summed the same way, so this only absorbs rounding. */
const SAME_CLOCK_S = 1e-9;

/**
 * A projected carrier across one step: drawn at `fromS + dt`, from where the
 * step began, the velocity that displacement is, and its attitude at each end
 * (`presentedTrafficAttitude`) (node #664). Each end is evaluated at its own
 * clock, blend and prediction alike.
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
 * — is ignored, and the step starts where it is drawn now. The attitude is
 * carried the same way, since a tick re-turns a carrier as it re-places it.
 * With no step to divide by, the velocity is the current sample's.
 */
export function presentedTrafficStep(
	samples: TrafficSamples,
	fromS: number,
	dt: number,
	from: TrafficSweptEnd | null = null,
): {
	start: Vec3;
	end: Vec3;
	vel: Vec3;
	startAttitude: TrafficAttitude | null;
	endAttitude: TrafficAttitude | null;
} {
	const carried =
		from && Math.abs(from.atS - fromS) <= SAME_CLOCK_S ? from : null;
	const start = carried
		? { ...carried.pos }
		: presentedTrafficPos(samples, fromS);
	const startAttitude =
		carried?.attitude ?? presentedTrafficAttitude(samples, fromS);
	if (!(dt > 0))
		return {
			start,
			end: start,
			vel: { ...samples.current.vel },
			startAttitude,
			endAttitude: startAttitude,
		};
	const end = presentedTrafficPos(samples, fromS + dt);
	return {
		start,
		end,
		vel: scale(sub(end, start), 1 / dt),
		startAttitude,
		endAttitude: presentedTrafficAttitude(samples, fromS + dt),
	};
}

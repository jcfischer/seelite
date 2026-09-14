/**
 * What the player sees and hears when the pulse laser fires (#324).
 *
 * **The gun fired and nothing showed it.** Part (b) wired the trigger into
 * `stepCondition`, and a held trigger spent energy and built heat, but the
 * production cockpit drew no tracer and played no sound. In the principal's
 * first flight both Space and the mouse read as dead keys. A real key press in
 * a live duel moved heat from 0 to 1.3 in 0.8 s, so the input was never the
 * fault. `probe-interdiction.mjs` checks the gun through the sim and could
 * not see that the screen stayed dark.
 *
 * This module decides when a tracer is on the glass and when a shot sound
 * plays, from whether the gun fired this step. `Game` draws and plays. It
 * imports nothing, so it stays in the headless tier.
 */

/** How long the tracer stays on the glass after a fired step, s. Longer than
 *  a frame, so one fired step is seen at any frame rate. */
export const TRACER_HOLD_S = 0.08;

/** The shortest gap between two shot sounds, s. The gun fires on every step
 *  the trigger is held, and a sound per step would be one buzz. */
export const SHOT_SOUND_GAP_S = 0.12;

export interface GunFeedback {
	/** Seconds the tracer has left on the glass. */
	readonly tracerLeftS: number;
	/** Seconds since the last shot sound. */
	readonly sinceSoundS: number;
}

/** A gun that has not fired: no tracer, and the next shot sounds at once. */
export const QUIET_GUN: GunFeedback = {
	tracerLeftS: 0,
	sinceSoundS: Number.POSITIVE_INFINITY,
};

/** One step of the feedback, from whether the gun fired this step. */
export function stepGunFeedback(
	feedback: GunFeedback,
	fired: boolean,
	dt: number,
): { feedback: GunFeedback; playSound: boolean } {
	const since = feedback.sinceSoundS + dt;
	if (!fired)
		return {
			feedback: {
				tracerLeftS: Math.max(0, feedback.tracerLeftS - dt),
				sinceSoundS: since,
			},
			playSound: false,
		};
	const playSound = since >= SHOT_SOUND_GAP_S;
	return {
		feedback: {
			tracerLeftS: TRACER_HOLD_S,
			sinceSoundS: playSound ? 0 : since,
		},
		playSound,
	};
}

/** The two gun ports low on the canopy and the sightline they meet at, as
 *  fractions of the canvas. The sightline is the nose cross at the centre. */
export const TRACER_PORTS = [
	{ x: 0.24, y: 0.64 },
	{ x: 0.76, y: 0.64 },
] as const;
export const TRACER_AIM = { x: 0.5, y: 0.5 } as const;
export const TRACER_COLOUR = "rgba(116, 234, 255, 0.98)";

/** Draw the tracer, clipped to the glass so it never crosses the panel. */
export function drawGunTracer(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	glassBottom: number,
): void {
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, w, h * glassBottom);
	ctx.clip();
	ctx.strokeStyle = TRACER_COLOUR;
	ctx.lineWidth = 3;
	ctx.beginPath();
	for (const port of TRACER_PORTS) {
		ctx.moveTo(w * port.x, h * port.y);
		ctx.lineTo(w * TRACER_AIM.x, h * TRACER_AIM.y);
	}
	ctx.stroke();
	ctx.restore();
}

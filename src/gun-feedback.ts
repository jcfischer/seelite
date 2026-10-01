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
 * This module decides when a tracer is on the glass and when a discrete shot
 * sound is owed, from whether the gun fired this step. `Game` draws, and
 * `weapon-sound.ts` picks the voice (#545), or none when the laser is a
 * sustained beam. It imports nothing, so it stays in the headless tier.
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
): { feedback: GunFeedback; sound: boolean } {
	const since = feedback.sinceSoundS + dt;
	if (!fired)
		return {
			feedback: {
				tracerLeftS: Math.max(0, feedback.tracerLeftS - dt),
				sinceSoundS: since,
			},
			sound: false,
		};
	const playSound = since >= SHOT_SOUND_GAP_S;
	return {
		feedback: {
			tracerLeftS: TRACER_HOLD_S,
			sinceSoundS: playSound ? 0 : since,
		},
		sound: playSound,
	};
}

/** The two gun ports low on the canopy and the sightline they meet at, as
 *  fractions of the canvas. The sightline is the nose cross at the centre. */
export const TRACER_PORTS = [
	{ x: 0.24, y: 0.64 },
	{ x: 0.76, y: 0.64 },
] as const;

/**
 * One port per gun (#607): a hull with one hardpoint fires one beam, from low
 * on the glass's centre line, and two keep `TRACER_PORTS`'s pair. More are
 * spread evenly between the pair's ports. The cockpit's counterpart of the
 * chase beam from each muzzle.
 */
export function tracerPorts(
	guns: number,
): readonly { readonly x: number; readonly y: number }[] {
	const [left, right] = TRACER_PORTS;
	// No gun, no beam: chase draws none for a hull with no muzzles, and the
	// cockpit agrees (sage round 2 on #608).
	if (guns <= 0) return [];
	if (guns === 1) return [{ x: 0.5, y: left.y }];
	return Array.from({ length: guns }, (_, i) => ({
		x: left.x + ((right.x - left.x) * i) / (guns - 1),
		y: left.y,
	}));
}
export const TRACER_AIM = { x: 0.5, y: 0.5 } as const;
export const TRACER_COLOUR = "rgba(116, 234, 255, 0.98)";

/** Draw the tracer, clipped above `glassBottom` (a fraction of the height).
 *  The cockpit passes the glass's bottom, so the tracer never crosses the
 *  panel. Chase has no glass and passes 1, the whole frame. `aim` is where the
 *  beam meets the glass, as fractions of the canvas: the sightline, or the
 *  gimbal's turned beam (#324). */
export function drawGunTracer(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	glassBottom: number,
	aim: { readonly x: number; readonly y: number } = TRACER_AIM,
	ports: readonly { readonly x: number; readonly y: number }[] = TRACER_PORTS,
): void {
	drawTracerSegments(
		ctx,
		w,
		h,
		glassBottom,
		ports.map((port) => ({
			from: { x: w * port.x, y: h * port.y },
			to: { x: w * aim.x, y: h * aim.y },
		})),
	);
}

/** One beam on the canvas, in pixels. */
export interface TracerSegment {
	readonly from: { readonly x: number; readonly y: number };
	readonly to: { readonly x: number; readonly y: number };
}

/** Draw tracer segments in canvas pixels, clipped above `glassBottom`: the
 *  chase view's beams, one from each muzzle (#607 D3). In the tracer's own
 *  colour and weight, so a chase shot reads as the same gun. */
export function drawTracerSegments(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	glassBottom: number,
	segments: readonly TracerSegment[],
): void {
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, w, h * glassBottom);
	ctx.clip();
	ctx.strokeStyle = TRACER_COLOUR;
	ctx.lineWidth = 3;
	ctx.beginPath();
	for (const { from, to } of segments) {
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(to.x, to.y);
	}
	ctx.stroke();
	ctx.restore();
}

/** How long the canopy rim glows after a hit lands on the player, s. */
export const STRUCK_FLASH_S = 0.22;

/** How far the first notice row sits above the glass line, and how far apart
 *  two rows are, in px. One figure each, because a second notice drawn at the
 *  first one's baseline is one illegible line and not two (#457). */
const NOTICE_ROW_PX = 28;
const NOTICE_ROW_PITCH_PX = 22;

/** **The ladder has one owner, and it is this.** Two subjects share the rows
 *  now and a third would have nowhere to learn which are taken, so the rungs
 *  are named here rather than passed as bare literals from `render` (sage
 *  round 2 on #457). Row 0 is the bottom line. */
export const GLASS_NOTICE_ROW = { scoop: 0, charge: 1 } as const;

/**
 * A one-line notice on the glass: centred under the reticle, just above the
 * glass line, in whatever colour the event earned — `hud-and-scanner.md` §4
 * owns green for a confirmed state, amber for an actionable one and red for a
 * refusal, so the caller passes the fill rather than this deciding.
 *
 * Here beside the other overlay effects rather than inline in `render`, which
 * is already very large (sage #355).
 *
 * **It was the scoop's, and it is a drawer now (#324, widened by #457).** The
 * charge for sustained fire is a second subject with its own words, window and
 * re-arm rule (`charge-notice.ts`), and `row` is what keeps the two off each
 * other's baseline: row 0 is the bottom line, row 1 sits above it. What is
 * shared is one font, one alignment and one ladder — the state machines stay
 * apart, because a charge that could push an unread scoop off the glass is the
 * defect `nextScoopNotice` exists to refuse. The rungs are named by
 * `GLASS_NOTICE_ROW` rather than counted at the call sites.
 */
export function drawGlassNotice(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	glassBottom: number,
	notice: { text: string; alpha: number; fill: string; row?: number },
) {
	ctx.save();
	ctx.globalAlpha = notice.alpha;
	ctx.fillStyle = notice.fill;
	ctx.font = "16px ui-monospace, Menlo, monospace";
	ctx.textAlign = "center";
	ctx.fillText(
		notice.text,
		w / 2,
		h * glassBottom - NOTICE_ROW_PX - (notice.row ?? 0) * NOTICE_ROW_PITCH_PX,
	);
	ctx.restore();
}
/** The raider's beam, warm against the player's cyan. */
export const ENEMY_BEAM_COLOUR = "rgba(255, 140, 90, 0.95)";

/**
 * The raider's shot, while it fires (#324, found missing in the second
 * playtest: "his lasers aren't showing up"). A line from the raider's point on
 * the glass to `to`, where the player sits: the bottom of the glass in the
 * cockpit, the hull in chase. Clipped above `glassBottom` like the player's
 * tracer.
 */
export function drawEnemyBeam(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	glassBottom: number,
	from: { readonly x: number; readonly y: number },
	to: { readonly x: number; readonly y: number },
): void {
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, w, h * glassBottom);
	ctx.clip();
	ctx.strokeStyle = ENEMY_BEAM_COLOUR;
	ctx.lineWidth = 2.5;
	ctx.beginPath();
	ctx.moveTo(from.x, from.y);
	ctx.lineTo(to.x, to.y);
	ctx.stroke();
	ctx.restore();
}

/**
 * The canopy rim when a hit lands on the player: a rim and not a wash, so the
 * view is not taken away (the `?combat=1` rig's lesson, ported). `strength` is
 * 0..1, the share of the flash left.
 */
export function drawStruckRim(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	glassBottom: number,
	strength: number,
): void {
	if (strength <= 0) return;
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, w, h * glassBottom);
	ctx.clip();
	const reach = Math.hypot(w, h * glassBottom) * 0.6;
	const glow = ctx.createRadialGradient(
		w / 2,
		h * glassBottom * 0.5,
		reach * 0.55,
		w / 2,
		h * glassBottom * 0.5,
		reach,
	);
	glow.addColorStop(0, "rgba(255, 90, 70, 0)");
	glow.addColorStop(1, `rgba(255, 90, 70, ${(0.34 * strength).toFixed(3)})`);
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, w, h * glassBottom);
	ctx.restore();
}

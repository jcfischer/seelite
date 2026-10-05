/**
 * The witchspace transition's pure half (#532): the phase, the look it drives,
 * the cue schedule, and every way the effect can end.
 *
 * #195's D1 ratified the shape and this module does not restate its reasons: a
 * jump is a **transition that straddles the cut**, not a place. The entry plays
 * through the whole of §8's wind-up, in the old system; a cover hides the frame
 * `jumpWorldTo` replaces the world on; the exit plays in the new system. D1
 * named the cover a whiteout. The principal flew five versions on 2026-09-26:
 * the cover is now the dark that closes to a point as the ship escapes its
 * light, the tunnel is ridden after the cut and bends rather than swirls, and
 * the white is a flash on the cut. `WITCHSPACE` below carries the timeline.
 * The game clock is untouched — nothing here reads or advances it.
 *
 * ## Why a state machine and not a reading of the charge
 *
 * `stepCharge` returns the **idle** charge on the step it fires, and
 * `cancelCharge` returns the same idle charge. So `JumpCharge.leftS` reads zero
 * at the cut, after a cancel, and when nothing ever charged — and a phase
 * derived from it would pop to nothing on a cancel instead of retracting, and
 * would lose the cut altogether. The effect is fed by **events** instead: begin,
 * abort (a cancel, or a jump refused at the cut), jumped, and arrive (the exit
 * with no entry, which #530's opening needs).
 *
 * ## The phase
 *
 * `t` is seconds from the cut: `-JUMP_CHARGE_S` when the wind-up begins, `0` on
 * the cut, positive through the exit. An entry that reaches zero **holds** there
 * rather than idling — the charge arms the jump and `takePendingJump` takes it at
 * the end of the frame, and the cover has to still be up when it does.
 *
 * Nothing in this file imports Three.js. `witchspace-pass.ts` and
 * `arrival-rift.ts` draw what `witchspaceLook` says.
 */
import { HYPERSPACE_SWEEP_S } from "./audio";
import type { Cue } from "./audio-cue";
import { JUMP_CHARGE_S } from "./hyperspace";
import {
	DEFAULT_WITCHSPACE_ARMS,
	type WitchspaceSoundArms,
} from "./witchspace-sound";

/**
 * The timeline. **Proposals, judged on the strip and in flight** — #532 names
 * them as the questions the build settles, and the principal's yes settles them.
 *
 * The shape is the principal's, from the third flight (2026-09-26): *we are
 * faster than light, so we are escaping the light while accelerating*, and the
 * whole sequence runs two to three times the first build's. So the entry is
 * the whole of §8's wind-up rather than its last part, and the arrival is long:
 *
 * 1. **The wind-up.** The sky crowds forward into a starbow as the ship nears
 *    light speed (`beta`): aberration, Doppler colour, the light beamed ahead.
 * 2. **Escaping the light.** Black closes in from the rim (`dark`) until the
 *    sky is one blazing point ahead.
 * 3. **The cut.** A flash; the world is replaced in the dark.
 * 4. **Witchspace.** The tunnel opens out of the point, is ridden, and closes
 *    back into it.
 * 5. **The new light catches up.** The dark recedes from the centre and the
 *    starbow unwinds to the true sky; the rift opens behind the ship. The
 *    pilot's controls come back when the whole sky has (`controlBackS`).
 *
 * `sweepS` is not a proposal: it is `hyperspace()`'s length in `audio.ts`, and
 * D3 places that cue so its end lands on the cut. `humS` is the rest of the
 * wind-up, which is D3's "first 1.6 s". The charge itself is §8's and is not
 * lengthened here: it is shared with cruise's spool by design.
 */
export const WITCHSPACE = Object.freeze({
	/** The entry's length: the whole wind-up. */
	entryS: JUMP_CHARGE_S,
	/** How long before the cut the starbow is complete. */
	betaFullS: 0.8,
	/** How long before the cut the dark starts to close in from the rim. */
	darkInS: 1.2,
	/** How long before the cut the dark has closed to the point. */
	pointS: 0.25,
	/** The flash on the cut: its peak, and how long it takes to rise and fall. */
	flashPeak: 0.45,
	flashS: 0.15,
	/** After the cut: the tunnel is full by here. */
	tunnelOpenS: 0.5,
	/** It starts to close back into the point here, and is gone by here. */
	tunnelCloseS: 2.4,
	tunnelGoneS: 3.1,
	/** The new light arrives: the dark starts to recede and the sky to unfold. */
	unfoldAtS: 3.0,
	/** The dark is gone by here. */
	darkGoneS: 3.8,
	/** The exit's screen-space length: every screen term is gone by here. */
	exitS: 4.6,
	/**
	 * The pilot's controls come back here: **the whole sky is back**, not only
	 * the dark gone. At `darkGoneS` the sky is still half squeezed and the HUD's
	 * markers still disagree with it (sage round 2 on #533).
	 */
	get controlBackS() {
		return this.exitS;
	},
	/**
	 * How often a ring of light passes on the tunnel wall, Hz: the ride's
	 * `rings` voice pulses with it (#534). The shader draws the rings as
	 * `sin(wallDepth * 3.5 - t * 22.0)` with `t` the phase in seconds, so one
	 * passes every 2π/22 s; `tests/witchspace.test.ts` reads that 22 out of
	 * `WITCHSPACE_TUNNEL_FRAGMENT` rather than trusting this copy.
	 */
	ringHz: 22 / (2 * Math.PI),
	/**
	 * The longest a ride may sound, seconds from its start. Its end is its own
	 * cue, fired off the exit clock at `tunnelCloseS`; this only bounds a ride
	 * whose close never came. **No stall has been measured against it.** What
	 * the code does say is how large one must be: the exit clock takes at most
	 * `maxExitDtS` from each frame, so the ride ends before its close only if
	 * the frames before the close add more than `rideLimitS - tunnelCloseS`
	 * (3.8 s) of wall time beyond that.
	 */
	get rideLimitS() {
		return 2 * this.tunnelGoneS;
	},
	/** The arrival rift opens with the new light, and is gone by here. */
	riftEndS: 7.5,
	/**
	 * The fraction of light speed the look reaches at `beta` one. Under one,
	 * because a camera cannot see all the way round.
	 */
	peakBeta: 0.97,
	/** How long a cancelled entry takes to fade out. */
	retractS: 0.35,
	/**
	 * The most one frame may advance the exit clock. `rebuildSystem()` is the
	 * frame before the exit's first, and the frames after it can be long; a fade
	 * on raw dt would clear during that stall and show the pop-in the cover is
	 * there to hide.
	 */
	maxExitDtS: 0.05,
	/** `hyperspace()`'s sweep, seconds. */
	sweepS: HYPERSPACE_SWEEP_S,
	/** The charge hum: the wind-up before the sweep. */
	humS: JUMP_CHARGE_S - HYPERSPACE_SWEEP_S,
	/** When the exit state ends: the longer of the screen terms and the rift. */
	get exitEndS() {
		return Math.max(this.exitS, this.riftEndS);
	},
});

/** What is drawn, each term in `[0, 1]`. */
export interface WitchspaceLook {
	/** The streak: straight spokes out from the nose. */
	streak: number;
	/** How close to light speed the sky looks: aberration and Doppler. */
	beta: number;
	/** Black closing in from the rim: 1 leaves only the point ahead. */
	dark: number;
	/** The bending tunnel, opening from the centre: 1 fills the frame. */
	tunnel: number;
	/** A flash of white over the whole frame, on the cut. */
	whiteout: number;
	/** The world-anchored arrival object's strength. */
	rift: number;
}

export type WitchspaceState =
	| { kind: "idle" }
	/** The wind-up. `leftS` is seconds to the cut, and holds at zero. */
	| { kind: "entry"; leftS: number }
	/**
	 * The new system. `sinceS` is seconds from the cut. `from` is what began
	 * it — a jump, or an arrival nobody watched depart — which the look does not
	 * read and the cues do (#534's `arrival` arm).
	 */
	| { kind: "exit"; sinceS: number; from: "jump" | "arrival" }
	/** A cancelled or refused entry fading from what was on screen. */
	| { kind: "retract"; from: WitchspaceLook; sinceS: number };

/** The cues `witchspaceCues` can emit. The stop silences every other one.
 *  Each carries its own timing, so the engine never reads this schedule. */
export type WitchspaceCue = Extract<
	Cue,
	{
		kind:
			| "witchspaceHum"
			| "witchspaceSweep"
			| "witchspaceFlash"
			| "witchspaceRide"
			| "witchspaceRideClose"
			| "witchspaceUnfold"
			| "witchspaceRift"
			| "witchspaceStop";
	}
>;

export const idleWitchspace = (): WitchspaceState => ({ kind: "idle" });

/**
 * The entry at `leftS` seconds from the cut — how `main.ts` keeps the effect on
 * the charge's own countdown rather than on a second clock beside it. From
 * idle it is a begin, and `witchspaceCues` hears it as one.
 */
export const entryWitchspace = (leftS: number): WitchspaceState => ({
	kind: "entry",
	leftS: Math.min(JUMP_CHARGE_S, Math.max(0, leftS)),
});

/** §8's wind-up has begun. Pairs with `beginCharge`. */
export const beginWitchspace = (): WitchspaceState =>
	entryWitchspace(JUMP_CHARGE_S);

/**
 * The jump was taken: the world is the new system. From any state — a jump with
 * no entry drawn is still an arrival, and the exit is what the player sees.
 */
export const jumpedWitchspace = (): WitchspaceState => ({
	kind: "exit",
	sinceS: 0,
	from: "jump",
});

/**
 * The exit with no entry: an arrival nobody watched depart. #530's opening
 * films one, and #262's NPC arrivals can reuse the rift it draws.
 */
export const arriveWitchspace = (): WitchspaceState => ({
	kind: "exit",
	sinceS: 0,
	from: "arrival",
});

/**
 * The entry ends without a jump: damage cancelled the charge, the ship docked,
 * or `performJump` refused at the cut. Retracts from whatever was on screen. An
 * exit is past the point of cancelling and is returned unchanged, as is idle.
 */
export function abortWitchspace(state: WitchspaceState): WitchspaceState {
	if (state.kind !== "entry") return state;
	return { kind: "retract", from: witchspaceLook(state), sinceS: 0 };
}

/** One frame. `dt` is wall time; the game clock is not read. */
export function stepWitchspace(
	state: WitchspaceState,
	dt: number,
): WitchspaceState {
	switch (state.kind) {
		case "idle":
			return state;
		case "entry":
			return { kind: "entry", leftS: Math.max(0, state.leftS - dt) };
		case "exit": {
			const sinceS = state.sinceS + Math.min(dt, WITCHSPACE.maxExitDtS);
			return sinceS >= WITCHSPACE.exitEndS
				? idleWitchspace()
				: { ...state, sinceS };
		}
		case "retract": {
			const sinceS = state.sinceS + dt;
			return sinceS >= WITCHSPACE.retractS
				? idleWitchspace()
				: { ...state, sinceS };
		}
	}
}

/** Seconds from the cut, or `null` when no jump is in progress. */
export function witchspacePhase(state: WitchspaceState): number | null {
	// `0 - x` and not `-x`: an entry held at the cut is phase 0, not -0.
	if (state.kind === "entry") return 0 - state.leftS;
	if (state.kind === "exit") return state.sinceS;
	return null;
}

/**
 * The state a real run is in at phase `t` — what the phase handle holds and the
 * view set's strip captures. Before the cut an entry, from the cut an exit.
 */
export function witchspaceAtPhase(t: number): WitchspaceState {
	return t < 0
		? { kind: "entry", leftS: Math.min(JUMP_CHARGE_S, -t) }
		: { kind: "exit", sinceS: t, from: "jump" };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
	const u = clamp01((x - a) / (b - a));
	return u * u * (3 - 2 * u);
};

const NOTHING: WitchspaceLook = Object.freeze({
	streak: 0,
	beta: 0,
	dark: 0,
	tunnel: 0,
	whiteout: 0,
	rift: 0,
});

/** What the state draws. Pure in the state; nothing is remembered. */
export function witchspaceLook(state: WitchspaceState): WitchspaceLook {
	const W = WITCHSPACE;
	switch (state.kind) {
		case "idle":
			return { ...NOTHING };
		case "entry": {
			const t = -state.leftS;
			const u = clamp01((t + W.entryS) / W.entryS);
			return {
				// Quadratic: barely there early and hard into the cut, which is
				// what a drive spooling reads as.
				streak: u * u,
				beta: smoothstep(-W.entryS, -W.betaFullS, t),
				dark: smoothstep(-W.darkInS, -W.pointS, t),
				tunnel: 0,
				whiteout: W.flashPeak * smoothstep(-W.flashS, 0, t),
				rift: 0,
			};
		}
		case "exit": {
			const t = state.sinceS;
			// Both of these are held at one through the ride, and let go when the
			// new system's light arrives.
			const unfold = smoothstep(W.unfoldAtS, W.exitS, t);
			return {
				// The lines come back with the light, and fade as the sky settles.
				streak:
					smoothstep(W.unfoldAtS, W.unfoldAtS + 0.3, t) *
					(1 - smoothstep(W.unfoldAtS + 0.3, W.exitS, t)),
				beta: 1 - unfold,
				dark: 1 - smoothstep(W.unfoldAtS, W.darkGoneS, t),
				tunnel:
					smoothstep(0, W.tunnelOpenS, t) *
					(1 - smoothstep(W.tunnelCloseS, W.tunnelGoneS, t)),
				whiteout: W.flashPeak * (1 - smoothstep(0, W.flashS, t)),
				// Opens with the new light, lingers, and closes behind the ship.
				rift:
					smoothstep(W.unfoldAtS, W.unfoldAtS + 0.5, t) *
					(1 - smoothstep(W.exitS + 1, W.riftEndS, t)),
			};
		}
		case "retract": {
			const k = 1 - smoothstep(0, W.retractS, state.sinceS);
			const from = state.from;
			return {
				streak: from.streak * k,
				beta: from.beta * k,
				dark: from.dark * k,
				tunnel: from.tunnel * k,
				whiteout: from.whiteout * k,
				rift: from.rift * k,
			};
		}
	}
}

/**
 * Whether the pilot's flight controls are held: from the cut until the sky is
 * back (`controlBackS`), on the principal's ruling. The wind-up is never held —
 * it is §8's vulnerable window, flown by the pilot. The clock runs throughout;
 * nothing is near the arrival point.
 */
export function witchspaceControlHeld(state: WitchspaceState): boolean {
	return state.kind === "exit" && state.sinceS < WITCHSPACE.controlBackS;
}

/**
 * The cues a transition from `prev` to `next` owes: D3's two before the cut,
 * and #534's four after it.
 *
 * - the hum when a wind-up begins: the low charge hum for its first `humS`.
 * - the sweep on the step the entry crosses `sweepS` from the cut, so its end
 *   lands on the cut. On the `rise` and `swallow` arms it carries the time
 *   left to the cut, so it holds to it however late it fired; on `swallow`
 *   also where the dark closes, in seconds from its own start, so it is drawn
 *   down into the point.
 * - the flash and the ride on the step the exit begins: the flash on the cut,
 *   and the ride opening with the tunnel.
 * - the ride's close on the step the exit crosses `tunnelCloseS`, as the
 *   tunnel closes back into the point.
 * - the unfolding and the rift on the step the exit crosses `unfoldAtS`: the
 *   new light arriving, and the rift that opens with it and closes behind.
 * - the stop when an entry ends without a jump — a sweep that played on after
 *   a cancel would announce a jump that did not happen — and when an exit ends
 *   at all: at its natural end every voice has already rung out and the stop
 *   takes nothing, and a reset, a new charge or a second arrival cut it short.
 *
 * Each exit cue fires on its own threshold rather than all at the cut, because
 * the exit clock clamps a long frame (`maxExitDtS`) and the audio clock does
 * not: a rebuild's stall would leave one long cue ahead of what is drawn. So
 * nothing that follows the drawing is scheduled ahead on the audio clock —
 * which is why the ride's close is a cue of its own (sage round 1 on #575).
 * What a cue does schedule is its own shape once begun: the ride's swell in,
 * the unfolding's fall and the rift's close run on the audio clock from the
 * step that fired them.
 *
 * The arrival-only path plays the exit's cues on the `arrivalsound` arm and
 * nothing on `arrivalquiet`: there was no wind-up to hear.
 */
export function witchspaceCues(
	prev: WitchspaceState,
	next: WitchspaceState,
	arms: WitchspaceSoundArms = DEFAULT_WITCHSPACE_ARMS,
): WitchspaceCue[] {
	if (next.kind === "exit") return exitCues(prev, next, arms);
	const W = WITCHSPACE;
	const hum: WitchspaceCue = { kind: "witchspaceHum", seconds: W.humS };
	const sweep = (leftS: number): WitchspaceCue =>
		arms.before === "swallow"
			? {
					kind: "witchspaceSweep",
					riseS: leftS,
					swallow: {
						fromS: Math.max(0, leftS - W.darkInS),
						toS: Math.max(0, leftS - W.pointS),
					},
				}
			: arms.before === "rise"
				? { kind: "witchspaceSweep", riseS: leftS }
				: { kind: "witchspaceSweep" };
	const stop: WitchspaceCue = { kind: "witchspaceStop" };
	// An exit ending: `next` is not one, or `exitCues` would have answered.
	const endsExit = prev.kind === "exit";
	if (next.kind === "entry" && prev.kind !== "entry") {
		const begun = next.leftS <= W.sweepS ? [hum, sweep(next.leftS)] : [hum];
		return endsExit ? [stop, ...begun] : begun;
	}
	if (prev.kind === "entry" && next.kind === "entry") {
		return prev.leftS > W.sweepS && next.leftS <= W.sweepS
			? [sweep(next.leftS)]
			: [];
	}
	if (prev.kind === "entry" && next.kind === "retract") return [stop];
	return endsExit ? [stop] : [];
}

type ExitState = Extract<WitchspaceState, { kind: "exit" }>;

/** `witchspaceCues` for a move into an exit: a new one, or one stepping on. */
function exitCues(
	prev: WitchspaceState,
	next: ExitState,
	arms: WitchspaceSoundArms,
): WitchspaceCue[] {
	const W = WITCHSPACE;
	// A new exit: from the cut, or an arrival — which, over an exit still
	// running, takes what that one was playing first.
	const running = prev.kind === "exit" && next.sinceS >= prev.sinceS;
	const cues: WitchspaceCue[] = [];
	if (prev.kind === "exit" && !running) cues.push({ kind: "witchspaceStop" });
	if (next.from === "arrival" && arms.arrival === "arrivalquiet") return cues;
	const since = running ? prev.sinceS : -1;
	const crosses = (at: number) => since < at && next.sinceS >= at;
	if (!running)
		cues.push(
			{ kind: "witchspaceFlash", voice: arms.flash },
			{
				kind: "witchspaceRide",
				voice: arms.ride,
				seconds: W.rideLimitS,
				openS: W.tunnelOpenS,
				ringHz: W.ringHz,
			},
		);
	if (crosses(W.tunnelCloseS))
		cues.push({
			kind: "witchspaceRideClose",
			seconds: W.tunnelGoneS - W.tunnelCloseS,
		});
	if (crosses(W.unfoldAtS))
		cues.push(
			{ kind: "witchspaceUnfold", seconds: W.exitS - W.unfoldAtS },
			{ kind: "witchspaceRift", seconds: W.riftEndS - W.unfoldAtS },
		);
	return cues;
}

/**
 * Whether the flight bed is hushed for the transition (#534's `engine` arm):
 * on `duck`, from the cut until the pilot's hands come back. One rule for
 * `main.ts` and the listening harness, so the render the principal hears is
 * the rule the game flies (sage round 1 on #575).
 *
 * Not under a quiet arrival: that arm is the arrival as it was before #534,
 * and nothing hushed the bed then (sage round 2).
 */
export function witchspaceHushesBed(
	state: WitchspaceState,
	arms: WitchspaceSoundArms,
): boolean {
	if (
		state.kind === "exit" &&
		state.from === "arrival" &&
		arms.arrival === "arrivalquiet"
	)
		return false;
	return arms.engine === "duck" && witchspaceControlHeld(state);
}

/**
 * One step of a scripted jump: the entry counts down, the cut is taken on the
 * step it reaches zero — as `takePendingJump` takes the armed jump at the end
 * of that frame — and the exit counts up. The game does not call this: its cut
 * is `performJump`. The tests and the listening harness do, so they fly one
 * jump rather than four copies of it.
 */
export function stepJump(state: WitchspaceState, dt: number): WitchspaceState {
	return state.kind === "entry" && state.leftS <= 0
		? jumpedWitchspace()
		: stepWitchspace(state, dt);
}

/**
 * The sky cameras' zoom at a look's `beta`: relativistic aberration.
 *
 * A ship moving at β sees a source at angle θ from its heading at θ', where
 * `tan(θ'/2) = sqrt((1 - β) / (1 + β)) · tan(θ/2)` — the whole sky crowds
 * forward. A perspective camera's zoom scales the tangent of its field the same
 * way, so the sky, far and approach cameras take this factor and the stars from
 * the sides slide into view round the nose. The near camera does not: the cabin
 * and the hull are travelling with the pilot.
 *
 * It is the half-angle tangent standing in for the full-angle one; the two agree
 * near the axis, which is where the eye is.
 */
export function witchspaceSkyZoom(beta: number): number {
	if (beta <= 0) return 1;
	const b = WITCHSPACE.peakBeta * Math.min(1, beta);
	return Math.sqrt((1 - b) / (1 + b));
}

/** NPC rings open at the jump; the existing exit clock still owns closing. */
export function npcRiftStrength(ageS: number): number {
	if (ageS < 0 || ageS >= WITCHSPACE.riftEndS) return 0;
	const look = (sinceS: number) =>
		witchspaceLook({ kind: "exit", sinceS, from: "arrival" }).rift;
	return (
		look(Math.min(ageS + WITCHSPACE.unfoldAtS, WITCHSPACE.unfoldAtS + 0.5)) *
		look(Math.max(ageS, WITCHSPACE.unfoldAtS + 0.5))
	);
}

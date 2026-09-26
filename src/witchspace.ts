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
import { JUMP_CHARGE_S } from "./hyperspace";

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
 *    pilot's controls come back when the sky has (`controlBackS`).
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
	/** The dark is gone by here, and the controls come back. */
	controlBackS: 3.8,
	/** The exit's screen-space length: every screen term is gone by here. */
	exitS: 4.6,
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
	sweepS: 1.4,
	/** The charge hum: the wind-up before the sweep. */
	humS: JUMP_CHARGE_S - 1.4,
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
	/** The new system. `sinceS` is seconds from the cut. */
	| { kind: "exit"; sinceS: number }
	/** A cancelled or refused entry fading from what was on screen. */
	| { kind: "retract"; from: WitchspaceLook; sinceS: number };

/** The cues `witchspaceCues` can emit. `stop` silences both of the others. */
export type WitchspaceCue = "hum" | "sweep" | "stop";

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
});

/**
 * The exit with no entry: an arrival nobody watched depart. #530's opening
 * films one, and #262's NPC arrivals can reuse the rift it draws.
 */
export const arriveWitchspace = (): WitchspaceState => ({
	kind: "exit",
	sinceS: 0,
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
				: { kind: "exit", sinceS };
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
		: { kind: "exit", sinceS: t };
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
				dark: 1 - smoothstep(W.unfoldAtS, W.controlBackS, t),
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
 * The cues a transition from `prev` to `next` owes (D3).
 *
 * - `hum` when a wind-up begins: the low charge hum for its first `humS`.
 * - `sweep` on the step the entry crosses `sweepS` from the cut, so
 *   `hyperspace()`'s end lands on the cut.
 * - `stop` when an entry ends without a jump. A sweep that played on after a
 *   cancel would announce a jump that did not happen.
 *
 * The arrival-only path cues nothing: there was no wind-up to hear.
 */
export function witchspaceCues(
	prev: WitchspaceState,
	next: WitchspaceState,
): WitchspaceCue[] {
	if (next.kind === "entry" && prev.kind !== "entry") {
		return next.leftS <= WITCHSPACE.sweepS ? ["hum", "sweep"] : ["hum"];
	}
	if (prev.kind === "entry" && next.kind === "entry") {
		return prev.leftS > WITCHSPACE.sweepS && next.leftS <= WITCHSPACE.sweepS
			? ["sweep"]
			: [];
	}
	if (prev.kind === "entry" && next.kind === "retract") return ["stop"];
	return [];
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

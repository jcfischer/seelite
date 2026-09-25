/**
 * The witchspace transition's pure half (#532): the phase, the look it drives,
 * the cue schedule, and every way the effect can end.
 *
 * #195's D1 ratified the shape and this module does not restate its reasons: a
 * jump is a **transition that straddles the cut**, not a place. The entry plays
 * in the last part of §8's wind-up, in the old system; a cover hides the frame
 * `jumpWorldTo` replaces the world on; the exit plays in the new system. D1
 * named the cover a whiteout. The principal flew that on 2026-09-26 and asked
 * for a colourful, swirling tunnel with volumetric mist instead, so the cover is
 * the tunnel now and the white is a flash on the cut.
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
 * The durations. **Proposals, judged on the strip** — #532 names them as the
 * questions the build settles, and the principal's yes is what settles them.
 *
 * `sweepS` is not a proposal: it is `hyperspace()`'s length in `audio.ts`, and
 * D3 places that cue so its end lands on the cut. `humS` is the rest of the
 * wind-up, which is D3's "first 1.6 s".
 */
export const WITCHSPACE = Object.freeze({
	/** The entry's length, the last part of the wind-up. */
	entryS: 1.4,
	/**
	 * How long before the cut the tunnel starts to open. It opens from the
	 * centre after the streak has taken hold, and fills the frame on the cut.
	 */
	tunnelInS: 0.9,
	/**
	 * How long after the cut the tunnel stays full before it collapses. **The
	 * tunnel is the cover**: it hides the frame the world is replaced on and
	 * the rebuild's first frames (#208's bakes are queued, not synchronous).
	 */
	tunnelHoldS: 0.15,
	/** The flash on the cut: its peak, and how long it takes to rise and fall. */
	flashPeak: 0.45,
	flashS: 0.15,
	/** The exit's screen-space length: tunnel, flash and streak are gone by here. */
	exitS: 1.6,
	/** The arrival rift's whole life, from the cut. */
	riftS: 4,
	/** How long a cancelled entry takes to fade out. */
	retractS: 0.35,
	/**
	 * The most one frame may advance the exit clock. `rebuildSystem()` is the
	 * frame before the exit's first, and the frames after it can be long; a fade
	 * on raw dt would clear during that stall and show the pop-in the tunnel is
	 * there to cover.
	 */
	maxExitDtS: 0.05,
	/** `hyperspace()`'s sweep, seconds. */
	sweepS: 1.4,
	/** The charge hum: the wind-up before the sweep. */
	humS: JUMP_CHARGE_S - 1.4,
	/** When the exit state ends: the longer of the screen fade and the rift. */
	get exitEndS() {
		return Math.max(this.exitS, this.riftS);
	},
});

/** What is drawn, each term in `[0, 1]`. */
export interface WitchspaceLook {
	/** The radial streak across the frame. */
	streak: number;
	/** The swirling tunnel, opening from the centre: 1 fills the frame. */
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
export const jumpedWitchspace = (_from: WitchspaceState): WitchspaceState => ({
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
	tunnel: 0,
	whiteout: 0,
	rift: 0,
});

/** What the state draws. Pure in the state; nothing is remembered. */
export function witchspaceLook(state: WitchspaceState): WitchspaceLook {
	switch (state.kind) {
		case "idle":
			return { ...NOTHING };
		case "entry": {
			const t = -state.leftS;
			const { entryS, tunnelInS, flashPeak, flashS } = WITCHSPACE;
			const u = clamp01((t + entryS) / entryS);
			return {
				// Quadratic: the streak is barely there for the first half and
				// builds hard into the cut, which is what a drive spooling reads as.
				streak: u * u,
				tunnel: smoothstep(-tunnelInS, 0, t),
				whiteout: flashPeak * smoothstep(-flashS, 0, t),
				rift: 0,
			};
		}
		case "exit": {
			const t = state.sinceS;
			const { tunnelHoldS, exitS, riftS, flashPeak, flashS } = WITCHSPACE;
			return {
				streak: 1 - smoothstep(0, exitS * 0.6, t),
				tunnel: 1 - smoothstep(tunnelHoldS, exitS, t),
				whiteout: flashPeak * (1 - smoothstep(0, flashS, t)),
				// Opens as the tunnel collapses, lingers, and closes behind the ship.
				rift: smoothstep(0, 0.25, t) * (1 - smoothstep(riftS * 0.4, riftS, t)),
			};
		}
		case "retract": {
			const k = 1 - smoothstep(0, WITCHSPACE.retractS, state.sinceS);
			return {
				streak: state.from.streak * k,
				tunnel: state.from.tunnel * k,
				whiteout: state.from.whiteout * k,
				rift: state.from.rift * k,
			};
		}
	}
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

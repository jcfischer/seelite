/**
 * What a pad button *means* in this game (#283).
 *
 * ## Why the table is here and not in either of the two obvious places
 *
 * Not in `src/gamepad.ts`, because that module is a **copy** — seekolous wrote
 * it to be pasted into this repo and a third game after it, and a binding table
 * there would have to name a station, a target or a flight regime. Its header
 * states the rule; this file is the other side of it.
 *
 * Not in `main.ts` either, and that is the one deviation from #283's build
 * contract. `main.ts` is not on the headless list and nothing in the unit tier
 * can load it, so a table written there is a table no test can read. The rule
 * the contract was protecting is that the *module* stays game-agnostic, and it
 * does. `tests/pad-bindings.test.ts` is what the move buys.
 *
 * ## A binding is a key, not an action
 *
 * Every entry below names a key the keyboard already sends to `Game.command`.
 * The pad does not get its own copy of what `j` does; it presses `j`. One
 * implementation stays one implementation, and the pad cannot drift away from
 * the keyboard while nobody is looking.
 *
 * ## Three contexts, and the second one is the interesting one
 *
 * `flight` is the forward view. `console` is a head turned to the left or right
 * console — and the console's own footer says *"Simulation continues while this
 * console is open"*, which is true and load-bearing: suspending the sticks
 * every time the pilot glanced at the target list would stop the ship. So a
 * console claims **six controls** — the d-pad's two vertical positions, the two
 * face buttons and the two shoulders — and everything else keeps flying.
 *
 * `modal` is the settings or perf panel, which is the one place the whole pad
 * is taken. `settings-panel.ts` already does exactly this for the keyboard, by
 * calling `releaseHeldKeys` on open: a held throttle key kept flying the ship
 * behind a screen the player was reading. A key is an *event* and can be
 * forgotten; a stick is a **position, re-reported every frame**, so there is
 * nothing to release and the axes have to be refused instead.
 */

import type { PadButtonName, PadFrame } from "./gamepad";

/**
 * Where the pad's discrete controls are pointed this frame.
 *
 * Derived from the game's own state — the head-look position and whether a
 * modal panel is mounted — rather than from a flag the pad sets. That is what
 * keeps seekolous's rule intact: no field records which device is in charge,
 * and the mouse can act on the same panel in the same frame.
 */
export type PadContext = "flight" | "console" | "modal";

/**
 * The flight table. DualSense labels in brackets; an Xbox pad reads `a`/`b`/
 * `x`/`y` literally.
 *
 * | button | key | does |
 * | --- | --- | --- |
 * | `a` (Cross) | `enter` | launch, or skip the dock traversal |
 * | `b` (Circle) | `c` | request docking clearance |
 * | `x` (Square) | `x` | flight assist |
 * | `y` (Triangle) | `j` | engage or drop cruise |
 * | `l1` / `r1` | `g` / `t` | previous and next target |
 * | `l3` | `f` | face the target |
 * | `r3` | `v` | cockpit or chase |
 * | `start` (Options) | `u` | docking computer |
 * | `select` (Create) | `` ` `` | charge the hyperspace jump |
 * | d-pad ←/↑/→ | `1` / `2` / `3` | head-look port, forward, starboard |
 *
 * **Unbound: `home` and d-pad ↓.** The module reports both; nothing here claims
 * them. The tuning dials, the perf panel's six toggles and the settings key
 * stay on the keyboard — seventeen buttons cannot carry twenty-six letters, and
 * saying which are dropped is better than discovering it in flight.
 */
export const PAD_FLIGHT_KEYS: Partial<Record<PadButtonName, string>> = {
	a: "enter",
	b: "c",
	x: "x",
	y: "j",
	l1: "g",
	r1: "t",
	l3: "f",
	r3: "v",
	start: "u",
	select: "`",
	left: "1",
	up: "2",
	right: "3",
};

/** The six a console takes, and what each becomes there. */
const CONSOLE_CLAIMS: Partial<Record<PadButtonName, keyof PadIntents>> = {
	up: "focusDelta",
	down: "focusDelta",
	a: "activate",
	b: "back",
	l1: "tabDelta",
	r1: "tabDelta",
};

/**
 * What the pad asked for this frame, in the game's own words.
 *
 * The deltas are `-1`, `0` or `1` — one row or one tab per press, never per
 * frame, because these come off `pressed` and not off `held`. Key repeat on a
 * held d-pad is a thing a player will eventually want and is not in this node;
 * adding it means a timer, and a timer is state this function does not have.
 */
export interface PadIntents {
	/** Keys to hand to `Game.command`, in press order. */
	readonly keys: readonly string[];
	/** Walk the panel's cursor: -1 up, +1 down. */
	readonly focusDelta: number;
	/** Change the panel's tab: -1 left, +1 right. */
	readonly tabDelta: number;
	/** Change the focused row's value: -1 left, +1 right. Modal panels only. */
	readonly valueDelta: number;
	/** Activate the focused row. */
	readonly activate: boolean;
	/** Close the panel, or turn the head back to forward. */
	readonly back: boolean;
}

const NO_INTENTS: PadIntents = {
	keys: [],
	focusDelta: 0,
	tabDelta: 0,
	valueDelta: 0,
	activate: false,
	back: false,
};

export function padIntents(
	frame: PadFrame | null,
	context: PadContext,
): PadIntents {
	if (!frame?.connected || frame.pressed.size === 0) return NO_INTENTS;

	const keys: string[] = [];
	let focusDelta = 0;
	let tabDelta = 0;
	let valueDelta = 0;
	let activate = false;
	let back = false;

	for (const name of frame.pressed) {
		if (context === "modal") {
			// The whole pad, and no key reaches the ship. Left and right are a
			// *value* here rather than a head turn, because the settings panel's
			// own hint line says ←→ changes one — the pad is adopting that model,
			// not inventing a second grammar beside it.
			if (name === "up") focusDelta -= 1;
			else if (name === "down") focusDelta += 1;
			else if (name === "left") valueDelta -= 1;
			else if (name === "right") valueDelta += 1;
			else if (name === "a") activate = true;
			else if (name === "b") back = true;
			continue;
		}
		if (context === "console" && CONSOLE_CLAIMS[name]) {
			if (name === "up") focusDelta -= 1;
			else if (name === "down") focusDelta += 1;
			else if (name === "l1") tabDelta -= 1;
			else if (name === "r1") tabDelta += 1;
			else if (name === "a") activate = true;
			else if (name === "b") back = true;
			continue;
		}
		const key = PAD_FLIGHT_KEYS[name];
		if (key !== undefined) keys.push(key);
	}

	return { keys, focusDelta, tabDelta, valueDelta, activate, back };
}

/**
 * The continuous half: three rotation commands and a throttle trim.
 *
 * **These are `command` values, not the mouse's `impulse`.** `stepAngular`
 * clamps a command to [-1, 1] and scales it by the axis maximum, so a stick a
 * third of the way over is a third of the turn rate and the simulation needs no
 * change at all — the keyboard, which can only send ±1, was the lossy part. The
 * mouse's path is a different one: a pointer delta is a *nudge* that is damped
 * away over the next few frames, and a stick routed through it would give a
 * ship that turns and then quits.
 *
 * **Every term is a negation**, and that is not an accident. The pad's axes are
 * positive right and positive *down*; this game's commands are positive nose-
 * left and positive nose-up, which is also how `main.ts` builds the mouse's two
 * terms. So the pad agrees with the mouse: push right, nose goes right.
 */
export interface PadFlightAxes {
	readonly yaw: number;
	readonly pitch: number;
	readonly roll: number;
	/**
	 * How fast to move the throttle, -1 to 1 — **not where to put it**.
	 *
	 * This is #283's F2 and it is the decision the node owed. The rejected arm
	 * is the obvious one: a trigger reporting an absolute 0..1 throttle
	 * position. Three things are wrong with it, and the first is the one that
	 * settles it without any measurement.
	 *
	 * 1. **A throttle you must hold is not a throttle.** Let go of the trigger
	 *    and the ship coasts to a stop. Elite's throttle is a lever you set and
	 *    leave, and every leg in this game is minutes long.
	 * 2. It has no rate for `STATION_THROTTLE_RATE_SCALE` to scale, so the
	 *    fine control near a station — which exists so docking is flyable —
	 *    would simply not apply to the pad.
	 * 3. It fights three existing writers. The docking computer, cruise entry
	 *    and the detour cancel all *assign* `throttle`; a trigger held at 0.6
	 *    would re-assert itself against each of them on the very next frame.
	 *
	 * A trim keeps all three and is still analog, which was the point: a light
	 * pull trims slowly and a full pull slams, where a key has exactly one
	 * speed.
	 */
	readonly throttleTrim: number;
}

const NO_AXES: PadFlightAxes = { yaw: 0, pitch: 0, roll: 0, throttleTrim: 0 };

/**
 * Negate, and give back positive zero.
 *
 * `-0` is what a plain negation makes of a rested stick, and it is not the same
 * value: `Object.is(-0, 0)` is false, and so is a structural comparison. An
 * input layer whose "nothing is happening" differs from every other module's
 * nothing is one whose rest state has to be special-cased by each of them, so it
 * is normalised once, here.
 */
const negate = (value: number) => (value === 0 ? 0 : -value);

export function padFlightAxes(
	frame: PadFrame | null,
	context: PadContext,
): PadFlightAxes {
	if (!frame?.connected || context === "modal") return NO_AXES;
	return {
		yaw: negate(frame.axes.rightX),
		pitch: negate(frame.axes.rightY),
		roll: negate(frame.axes.leftX),
		// `values`, not `held`: rule 3 of the module's header exists for this
		// line. A trigger read as a switch is a key with extra steps.
		throttleTrim: frame.values.r2 - frame.values.l2,
	};
}

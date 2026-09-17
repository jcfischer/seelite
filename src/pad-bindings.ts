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
 * ## Four contexts, and the second one is the interesting one
 *
 * `flight` is the forward view. It and `instrument` are the two contexts that
 * move the ship — `contextFliesShip` is the predicate, and an earlier version of
 * this line called flight the only one, which the instrument paragraph below
 * then contradicted.
 *
 * `console` is a head turned to a side console, or the station console on the
 * forward wall while docked. It claims **six discrete controls** — the d-pad's
 * two vertical positions, the two face buttons and the two shoulders — and it
 * **suspends the sticks, the triggers and the mouse**. The mouse belongs in
 * that sentence: this header is the declared owner of the reversal, and it was
 * the incomplete copy while `docs/gamepad.md` had it right.
 *
 * That suspension is a reversal, and the reasoning it replaced is worth keeping
 * because it was wrong in an instructive way. The console's footer says
 * *"Simulation continues while this console is open"*, and #283 read it as *the
 * ship must stay flyable*, so the sticks kept flying. It is a claim about the
 * **world** — orbits, markets, NPCs, all of which do go on running — and not
 * about the controls. Flown, the version that kept them was a ship flying off
 * while its pilot read a list.
 *
 * The throttle is *held* rather than zeroed, so the ship coasts on the velocity
 * it had. Driving it to zero was offered and declined: it changes your speed
 * without being asked.
 *
 * `instrument` is the frame overlay behind `?perf`, and it is the one exception
 * to that suspension rather than an inconsistency in it. It takes a console's
 * six buttons and **leaves the sticks alone**, because it exists to measure a
 * frame *while it is flown* — a mode that stopped the ship would be measuring a
 * different frame from the one it is there for. The reversal above is about the
 * panels a player reads; this is an instrument a developer watches.
 *
 * `modal` is the **settings screen and the Commander overlay** (#306) — the two
 * places the whole pad is taken. `settings-panel.ts` already does exactly this for the keyboard,
 * by calling `releaseHeldKeys` on open: a held throttle key kept flying the
 * ship behind a screen the player was reading. A key is an *event* and can be
 * forgotten; a stick is a **position, re-reported every frame**, so there is
 * nothing to release and the axes have to be refused instead.
 *
 * The frame instrument is deliberately not modal, and an earlier version of
 * this paragraph said it was. It is an overlay on a running game, so it takes
 * a console's six controls and flight continues underneath — a panel that
 * stopped the ship would be measuring a different frame from the one it exists
 * to measure.
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
export type PadContext = "flight" | "console" | "modal" | "instrument";

/**
 * The flight table. DualSense labels in brackets; an Xbox pad reads `a`/`b`/
 * `x`/`y` literally.
 *
 * | button | key | does |
 * | --- | --- | --- |
 * | `a` (Cross) | `enter` | launch, or skip the dock traversal |
 * | `b` (Circle) | `c` | request docking clearance |
 * | `y` (Triangle) | `j` | engage or drop cruise |
 * | `l1` / `r1` | `g` / `t` | previous and next target |
 * | `l3` | `f` | face the target |
 * | `r3` | `v` | cockpit or chase |
 * | `start` (Options) | `u` | docking computer |
 * | `select` (Create) | `` ` `` | charge the Jump |
 * | d-pad ←/↑/→ | `1` / `2` / `3` | head-look port, forward, starboard |
 *
 * D-pad ↓ is not in the table because what it does is not a key: it hands the
 * pad to the frame instrument and takes it back (`PadIntents.instrument`).
 *
 * `x` (Square) is not in the table either: it is the pulse laser's trigger,
 * held (`padFireHeld`), by the principal's ruling (#324). Flight assist stays on
 * the keyboard's `x`.
 *
 * **Unbound: `home` alone.** The module reports it; nothing here claims it. The
 * tuning dials and the settings key stay on the keyboard — seventeen buttons
 * cannot carry twenty-six letters, and saying which are dropped is better than
 * discovering it in flight.
 */
export const PAD_FLIGHT_KEYS: Partial<Record<PadButtonName, string>> = {
	a: "enter",
	b: "c",
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

/**
 * The line a console shows a pad player, built from what that surface has.
 *
 * Owned here beside the bindings it names: it was written into
 * `live-cockpit.ts` and was a third copy of a table this module and
 * `docs/gamepad.md` already own, so a rebind moved two of the three.
 *
 * **Assembled rather than picked from near-copies.** It began as one constant,
 * gained a station variant that was the first minus one segment, and would have
 * gained a third and fourth for the empty walk — three of them left dead the
 * moment this function replaced them, which sage then found. A surface with
 * nothing focusable must not promise a walk, and the station console must not
 * promise a back: it is reached with the head already forward, so `back` would
 * turn a forward head forward.
 *
 * **"CONTROLLER", not "PAD".** On a *station* console the shorter word meets
 * `CONTEXT.md`'s berth sense, which is the one surface in this game where that
 * reading is live. The buttons are named by standard-mapping position rather
 * than drawn as DualSense glyphs, because an Xbox pad reads `a`/`b` literally.
 */
/**
 * The hint a surface should show, built from its two facts.
 *
 * Assembled rather than picked from a list of near-copies: the station line was
 * the console line minus one segment, and the empty-walk case would have been a
 * third and fourth. A surface with nothing focusable must not promise a walk —
 * and it still gets a marker, because the ship is suspended there either way and
 * the *marker* answers a different question from the *hint*.
 */
export function padHintFor(surface: {
	station: boolean;
	walkable: boolean;
}): string {
	const segments = ["CONTROLLER"];
	if (surface.walkable) segments.push("UP/DOWN WALK", "A SELECT");
	if (!surface.station) segments.push("B BACK");
	segments.push("L1/R1 TAB");
	return segments.join(" · ");
}

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
	/**
	 * Hand the pad to the frame instrument, or take it back.
	 *
	 * The perf panel is a developer overlay behind `?perf` with no head-look
	 * position of its own, so it needs a way in that costs a player nothing.
	 * D-pad **down** is it: the other three directions are the three head-look
	 * positions, and down was the last free one.
	 */
	readonly instrument: boolean;
}

const NO_INTENTS: PadIntents = {
	keys: [],
	focusDelta: 0,
	tabDelta: 0,
	valueDelta: 0,
	activate: false,
	back: false,
	instrument: false,
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
	let instrument = false;

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
		// **One list, not a table beside a switch.** This was a
		// `CONSOLE_CLAIMS` map naming each button's field, checked for
		// membership and then re-implemented below — so the map's *values* were
		// never read and editing one changed nothing. Sage found the dead half,
		// round 5. A console's six claims are the six cases here; anything not
		// claimed falls through to the flight table, which is the rule stated
		// once.
		if (context === "console" || context === "instrument") {
			if (name === "up") {
				focusDelta -= 1;
				continue;
			}
			if (name === "down") {
				focusDelta += 1;
				continue;
			}
			if (name === "l1") {
				tabDelta -= 1;
				continue;
			}
			if (name === "r1") {
				tabDelta += 1;
				continue;
			}
			if (name === "a") {
				activate = true;
				continue;
			}
			if (name === "b") {
				back = true;
				continue;
			}
		}
		if (name === "down") {
			instrument = true;
			continue;
		}
		const key = PAD_FLIGHT_KEYS[name];
		if (key !== undefined) keys.push(key);
	}

	return {
		keys,
		focusDelta,
		tabDelta,
		valueDelta,
		activate,
		back,
		instrument,
	};
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

/**
 * Whether input in this context reaches the ship at all.
 *
 * **One owner, because three of them disagreed.** The rule was written inline
 * here, again as `padContext() === "flight"` for the mouse, and a third time in
 * `hasControlInput` — and the copies had already drifted on `instrument`, where
 * the sticks flew and the mouse did not, so the one mode whose whole purpose is
 * measuring a frame *while it is flown* could not be flown by mouse. Sage found
 * that, and the blocker beside it was the same drift reaching the galaxy chart.
 *
 * See the header for which contexts fly, why a console does not, and why the
 * instrument is an exception rather than an oversight.
 */
export function contextFliesShip(context: PadContext): boolean {
	return context === "flight" || context === "instrument";
}

/**
 * What to do with the pointer lock, given the context and whether the canvas
 * already holds it. **This is the argument; the call sites point here.**
 *
 * **The same rule as `contextFliesShip`, asked by the other half of the mouse
 * (#371).** A captured pointer does not only carry relative deltas: while the lock
 * is held the browser delivers *every* mouse event — the click included — to the
 * locked element, wherever over the page the cursor was. So a console that
 * suspends the mouse and keeps the capture suspends nothing the player can feel
 * and takes something they need: the panel paints, highlights, and answers
 * nothing, because the click aimed at its tab was delivered to the glass
 * underneath. That is #283's ruling one level down — the surface that says the
 * mouse does not fly the ship also says the pointer is not its own to hold.
 *
 * Same predicate, not a second table, for the reason `contextFliesShip` itself
 * exists: this rule was written nowhere at all, so there was nothing to drift,
 * and the one place that did release the pointer — `commander-overlay.ts`, for its
 * own screen — was a habit rather than a rule. `instrument` keeps the lock for the
 * reason it keeps the sticks: its panel is `pointer-events: none`, so there is
 * nothing on it for a click to reach, and the frame it exists to measure is a
 * frame still being flown.
 *
 * **`capture` is permission for a click, not an instruction to make one.** The
 * browser grants a lock only from an activation-triggering event or after a
 * page-initiated exit, and Blink refuses a tenth request inside two seconds
 * (`kMaxLocksInWindow`), so nothing downstream should read this name as licence to
 * ask every frame. `release` is the only effect the game takes on its own, and it
 * is edge-triggered by `held`: once the pointer is back the row reads `at-rest`,
 * which is what keeps a frame loop from pounding the browser with an exit it has
 * already carried out — and covers the player's own Escape for free, whose release
 * leaves nothing here to release.
 */
export function pointerLockMove(
	context: PadContext,
	held: boolean,
): PointerLockMove {
	if (!contextFliesShip(context)) return held ? "release" : "at-rest";
	return held ? "keep" : "capture";
}

export type PointerLockMove = "capture" | "release" | "keep" | "at-rest";

export function padFlightAxes(
	frame: PadFrame | null,
	context: PadContext,
): PadFlightAxes {
	if (!frame?.connected || !contextFliesShip(context)) return NO_AXES;
	return {
		yaw: negate(frame.axes.rightX),
		pitch: negate(frame.axes.rightY),
		roll: negate(frame.axes.leftX),
		// `values`, not `held`: rule 3 of the module's header exists for this
		// line. A trigger read as a switch is a key with extra steps. The
		// instrument's tab steps are the shoulders, so the triggers do not
		// collide with them there.
		throttleTrim: frame.values.r2 - frame.values.l2,
	};
}

/**
 * Whether the pad holds the pulse laser's trigger: Square (`x`), held, in a
 * context that flies the ship (#324, the principal's ruling). A digital button,
 * so the pad's own pressed bit decides it. A console suspends it with the
 * sticks, so Square held while reading the market does not fire.
 */
export function padFireHeld(
	frame: PadFrame | null,
	context: PadContext,
): boolean {
	return (
		frame?.connected === true &&
		contextFliesShip(context) &&
		frame.held.has("x")
	);
}

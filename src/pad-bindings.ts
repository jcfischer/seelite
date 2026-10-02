/**
 * What a pad button *means* in this game (#283).
 *
 * **And what one surface owns.** `PadContext` — the names come from the gamepad,
 * the thing is the drawn surface — is this module's answer to which surface the
 * sticks, the triggers **and the pointer** belong to. `pointerLockMove` below is
 * the mouse's half of that answer (#371), and it lives here because it is the same
 * predicate as `contextFliesShip` asked by the other half of the mouse, not because
 * a gamepad button is anywhere in it.
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
 * because it was wrong in an instructive way. The console's footer once read
 * *"Simulation continues while this console is open"* — since deleted as copy —
 * and #283 read it as *the ship must stay flyable*, so the sticks kept flying.
 * It was a claim about the **world** — orbits, markets, NPCs, all of which do go
 * on running — and not about the controls. Flown, the version that kept them was
 * a ship flying off while its pilot read a list.
 *
 * The throttle is *held* rather than zeroed, so the ship coasts on the velocity
 * it had. Driving it to zero was offered and declined: it changes your speed
 * without being asked.
 *
 * `instrument` is the frame overlay behind `?perf`, and it is the one exception
 * to that suspension rather than an inconsistency in it. It takes a console's
 * six buttons, of which the shoulders do nothing there because it has no tabs
 * (#379), and **leaves the sticks alone**, because it exists to measure a
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
export type PadContext =
	| "flight"
	| "console"
	| "modal"
	| "instrument"
	/**
	 * The rebind modal is open and listening (#369 D9).
	 *
	 * Its whole job: **admit the sticks and triggers for one capture, refuse
	 * everything else, and swallow every input except its own cancel.** F8's
	 * problem — a modal must refuse the axes, because a stick is a position and
	 * there is nothing to release — is answered in the open by a context that
	 * exists to admit them, rather than by punching a hole in `modal`'s
	 * suspension. Nothing here flies the ship, which `contextFliesShip` says
	 * once for the axes, the trigger and the pointer alike.
	 *
	 * **The reading is `capturedTrigger`'s, in `commands.ts`**, because what it
	 * produces is a `Trigger` and that is the registry's word. This module
	 * answers the half that is its own: which presses a surface claims, and
	 * here that is one — the way out.
	 */
	| "capture";

/**
 * Which standard buttons fall through to the flight layout, and in which
 * contexts.
 *
 * **The table of what each one *does* is not here any more (#381 S4).** It was
 * `PAD_FLIGHT_KEYS`, a button-to-key map resolved against the shipped
 * keyboard, and that pinned every pad button to the default layout by
 * construction: a pad rebind could not be expressed at all, because the
 * button's meaning lived somewhere a player's layout is not. The authored
 * defaults are `PAD_FLIGHT_COMMANDS` in `src/commands.ts` now, as
 * `CommandId`s, and `resolvePad` reads the layout in force.
 *
 * What stays here is the half that is genuinely this module's: **which presses
 * a surface has already claimed.** A console takes six of them and the rest
 * fall through, which is the rule `padIntents` states once below — so this
 * module still decides *whether* a button reaches the ship, and no longer
 * decides *what* it reaches.
 *
 * **Unbound: `home` alone.** The registry reports it; nothing claims it. The
 * tuning dials and the settings key stay on the keyboard — seventeen buttons
 * cannot carry twenty-six letters, and saying which are dropped is better than
 * discovering it in flight.
 */
/**
 * What the pad asked for this frame, in the game's own words.
 *
 * The deltas are `-1`, `0` or `1` — one row or one tab per press, never per
 * frame, because these come off `pressed` and not off `held`. Key repeat on a
 * held d-pad is a thing a player will eventually want and is not in this node;
 * adding it means a timer, and a timer is state this function does not have.
 */
export interface PadIntents {
	/**
	 * The presses this surface did not claim, in press order.
	 *
	 * Buttons rather than keys since #381 S4: what each one reaches is the
	 * layout's answer and not this module's, so these are handed to
	 * `resolvePad` with the context they were read in.
	 */
	readonly buttons: readonly PadButtonName[];
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

/**
 * The two buttons that are pulls rather than presses; see `padIntents`.
 *
 * Exported because `capturedTrigger` in `commands.ts` needs the same law — a
 * capture must not record a full pull as a button press — and it had the pair
 * written out again (sage round 3 on #497).
 */
export const ANALOG_TRIGGERS = [
	"l2",
	"r2",
] as const satisfies readonly PadButtonName[];

/** Whether this button is one of them. A predicate, because `includes` on a
 *  `as const` tuple narrows its own argument and refuses every other name. */
export const isAnalogTrigger = (name: PadButtonName): boolean =>
	(ANALOG_TRIGGERS as readonly PadButtonName[]).includes(name);

const NO_INTENTS: PadIntents = {
	buttons: [],
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

	const buttons: PadButtonName[] = [];
	let focusDelta = 0;
	let tabDelta = 0;
	let valueDelta = 0;
	let activate = false;
	let back = false;
	let instrument = false;

	for (const name of frame.pressed) {
		if (context === "capture") {
			// **Nothing at all, and that includes the way out** (#369 D9's
			// "swallow every input except its own cancel", answered by the
			// principal's ruling on which input the cancel is).
			//
			// The first version reserved Circle, because Circle is `back`
			// everywhere else in this game — and the cost was that Circle
			// became the one button a pad could never bind. It does not have
			// to be paid: **the cancel is a click**, and a click is the one
			// input this game guarantees. #370's standing premise is that a
			// screen is always clickable, which is why the pointer rows carry
			// `fixed: "pointer"` — no movable trigger at all. So the modal's
			// way out is a control that no binding table can hold, by the same
			// argument that gives the `Controls` tab its settings door, and
			// every one of the seventeen buttons stays capturable.
			//
			// The stick and the trigger are read by `capturedTrigger` off the
			// frame directly rather than through this function, because they
			// are a position rather than a press and an intent struct has
			// nowhere to put one.
			continue;
		}
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
			// The shoulders step tabs on a console. The instrument is a list of
			// switches with no tabs, so there they are claimed and do nothing
			// (#379): a tab step nothing reads is a claim with no consumer, and
			// letting them fall through would cycle the target under the panel.
			if (name === "l1" || name === "r1") {
				if (context === "console") tabDelta += name === "r1" ? 1 : -1;
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
		// **An analog trigger is a value, never a press.** Rule 3 of this
		// module's header: a trigger read as a switch is a key with extra
		// steps, and the standard mapping reports `pressed` on a full pull —
		// so `padFlightAxes` reads `values.r2 - values.l2` and nothing here
		// reports the pull. This was implicit while the flight table was a
		// key map, because that table simply had no entry for either; the
		// table names commands elsewhere now and reports every unclaimed
		// press, so the law has to be stated or it changes in silence
		// (#381 S4).
		if (isAnalogTrigger(name)) continue;
		// Unclaimed, so it falls through to the ship. Whether the layout binds
		// it is the registry's question, asked with this context.
		buttons.push(name);
	}

	return {
		buttons,
		focusDelta,
		tabDelta,
		valueDelta,
		activate,
		back,
		instrument,
	};
}

/**
 * The continuous half: three rotation commands, a throttle trim and the
 * vertical strafe (#620).
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
	/**
	 * The vertical strafe, −1…1, positive up (#620, `flight-model.md` §3.5).
	 *
	 * **The left stick's vertical axis, because it was the one free axis.**
	 * The right stick is pitch and yaw, the left stick's horizontal is roll and
	 * the triggers are the throttle, all flown and accepted on #283, so the
	 * strafe takes what was left rather than moving any of them. That leaves
	 * the lateral strafe with no axis on the pad at all, and where it goes is
	 * the principal's to rule (#620); until then it is the arrows' alone.
	 */
	readonly heave: number;
}

const NO_AXES: PadFlightAxes = {
	yaw: 0,
	pitch: 0,
	roll: 0,
	throttleTrim: 0,
	heave: 0,
};

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
 * What to do with the pointer lock, given the context, whether a console is drawn,
 * and whether the canvas already holds the pointer. **This is the argument; the
 * call sites point here.**
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
 * own screen — was a habit rather than a rule.
 *
 * **And a drawn console wins, whatever the context says** (`consoleDrawn`, the
 * principal's ruling on this node, asked because `readPadContext` answers
 * `instrument` before it ever tests for a console). `instrument` keeps the mouse for
 * one reason: its panel is `pointer-events: none`, so there is nothing on it for a
 * click to reach. That reason runs out the moment a console is drawn under the
 * overlay — the pad's `down` focuses the instrument and the d-pad's `1`/`2`/`3` still
 * turn the head, so the combination is one a player reaches, and `main.ts`'s own
 * chart comment records it. Then the overlay is transparent and the console behind it
 * is not, and the click belongs to the console. Sticks aside: this is the pointer's
 * rule only, so #283's instrument exception is untouched.
 *
 * **`take` is permission for a click, not an instruction to make one.** The
 * word was `capture` until #381 S4, and it gave it up: D9 names the rebind
 * modal's input context `capture`, and two meanings of one word in one module
 * — a pointer verdict and an input context — is a thing neither a reader nor a
 * grep can tell apart. The ruling owns the context; this verdict is the
 * repo's own word, so this is the one that moves. The
 * browser grants a lock only from an activation-triggering event or after a
 * page-initiated exit, and it rate-limits being asked at all:
 * `scripts/probe-pointer-lock.mjs` measures that window against its own click
 * sequence and paces itself by it, and it — not this comment — owns the figures.
 * So nothing downstream should read this name as licence to ask every frame. `release` is the only effect the game takes on its own, and it
 * is edge-triggered by `held`: once the pointer is back the row reads `at-rest`,
 * which is what keeps a frame loop from pounding the browser with an exit it has
 * already carried out — and covers the player's own Escape for free, whose release
 * leaves nothing here to release.
 */
export function pointerLockMove(
	context: PadContext,
	consoleDrawn: boolean,
	held: boolean,
): PointerLockMove {
	if (!contextFliesShip(context) || consoleDrawn)
		return held ? "release" : "at-rest";
	return held ? "keep" : "take";
}

export type PointerLockMove = "take" | "release" | "keep" | "at-rest";

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
		// line. A trigger read as a switch is a key with extra steps.
		throttleTrim: frame.values.r2 - frame.values.l2,
		heave: negate(frame.axes.leftY),
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

/**
 * Whether the left mouse button holds the pulse laser's trigger (#378).
 *
 * **The principal's ruling on #378: the mouse's trigger is on the suspended
 * side.** #283 put the sticks, the triggers and the mouse there, and #371 moved
 * the mouse's delta and its pointer over. The button was the last part of the
 * mouse still flying, so a click on the glass beside an open console fired the
 * gun while the pad's Square, held in the same place, did not.
 *
 * **The pointer's rule, not the pad's.** A button is part of the pointer, so it
 * fires only where `pointerLockMove` would let a click take the lock: a context
 * that flies the ship, with no console drawn. That differs from `padFireHeld`,
 * which reads only the context, wherever a console is drawn in a context that
 * flies. `readPadContext` answers `console` for a drawn console unless a modal
 * is open (which does not fly) or the instrument is focused, so the one such cell
 * the game reaches is the instrument focused over a drawn console. There this
 * follows #371's ruling for the pointer, that the click belongs to the console.
 * That cell is this change's reading of the principal's ruling on #378, which
 * did not name it, and the pad's Square still fires there.
 *
 * **Asked at the press as well as each frame.** `main.ts` asks it when the button
 * goes down, so a press made where the mouse is suspended never becomes a trigger
 * and does not fire when the head comes back with it still held (sage round 1
 * on #378).
 *
 * `Space` is not in this and stays live: the keyboard is deliberately not
 * suspended over a console, which is the principal's earlier ruling recorded at
 * the mouse-look gate in `main.ts`, and not this node's to reopen.
 */
export function mouseFireHeld(
	held: boolean,
	context: PadContext,
	consoleDrawn: boolean,
): boolean {
	return held && pointerLockMove(context, consoleDrawn, false) === "take";
}

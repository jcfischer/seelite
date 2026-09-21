/**
 * What the pad *means* — #283's binding table, checked headlessly.
 *
 * The table is deliberately not inside `src/gamepad.ts`: that module is a copy
 * and a binding table there would have to name a station, a target or a regime.
 * It is deliberately not inside `main.ts` either, which nothing in this tier can
 * load — and a table nothing can load is a table nothing checks.
 */
import { describe, expect, test } from "bun:test";
import {
	type PadButtonName,
	type RawPad,
	readPad,
	STANDARD_BUTTONS,
} from "../src/gamepad";
import {
	contextFliesShip,
	mouseFireHeld,
	PAD_FLIGHT_KEYS,
	type PadContext,
	type PadIntents,
	type PointerLockMove,
	padFireHeld,
	padFlightAxes,
	padIntents,
	pointerLockMove,
} from "../src/pad-bindings";
import { codeOf, srcFiles } from "./lib/source-scan";

const NOTHING: ReadonlySet<PadButtonName> = new Set();

function pad(overrides: Partial<RawPad> = {}): RawPad {
	return {
		id: "DualSense Wireless Controller (STANDARD GAMEPAD)",
		mapping: "standard",
		axes: [0, 0, 0, 0],
		buttons: STANDARD_BUTTONS.map(() => ({ pressed: false, value: 0 })),
		...overrides,
	};
}

/** A frame in which exactly `name` has just gone down. */
const press = (name: PadButtonName, value = 1) => {
	const index = STANDARD_BUTTONS.indexOf(name);
	const buttons = STANDARD_BUTTONS.map((_, i) =>
		i === index
			? { pressed: value >= 0.5, value }
			: { pressed: false, value: 0 },
	);
	return readPad(pad({ buttons }), NOTHING);
};

/** A frame with the sticks at [leftX, leftY, rightX, rightY]. */
const sticks = (axes: [number, number, number, number]) =>
	readPad(pad({ axes }), NOTHING);

/**
 * A frame with one analog trigger pulled to `value`.
 *
 * The same construction as `press`, which is the point: a trigger is a button
 * that reports a continuous pull, and building it a second way would let the
 * two drift. Sage asked for the reuse, round 2.
 */
const trigger = (name: "l2" | "r2", value: number) => press(name, value);

const rest = readPad(pad(), NOTHING);
const absent = readPad(null, NOTHING);

describe("the flight table names keys the keyboard already understands", () => {
	test("every binding is a key `Game.command` actually handles", () => {
		// The pad does not get its own copy of what a button does. It presses the
		// key, and one implementation stays one implementation — a second copy is
		// how the pad and the keyboard come to disagree about what `j` means.
		//
		// **Read off `command`'s own cases, not matched against a shape.** This
		// was a regular expression accepting any single letter, which `p` and `z`
		// satisfy while `command` handles neither — so deleting a handler left
		// the check green and the binding dead. Sage found that, round 6. A
		// source read rather than an import because `main.ts` cannot be loaded in
		// this tier; it is the same trade `tests/output-stage.test.ts` makes.
		const source = codeOf("src/main.ts");
		const body = source.slice(source.indexOf("private command(key: string)"));
		const handled = new Set(
			[
				...body.slice(0, body.indexOf("\n\t}")).matchAll(/case "([^"]+)":/g),
			].map((m) => m[1]),
		);
		expect(handled.size).toBeGreaterThan(10);
		for (const key of Object.values(PAD_FLIGHT_KEYS))
			expect(
				handled.has(key),
				`${key} is bound but command does not handle it`,
			).toBe(true);
	});

	test("no two buttons are bound to the same key", () => {
		const keys = Object.values(PAD_FLIGHT_KEYS);
		expect(new Set(keys).size).toBe(keys.length);
	});

	test("the flight-critical set from the node is all there", () => {
		const bound = new Set(Object.values(PAD_FLIGHT_KEYS));
		// cruise, next/previous target, face, clearance, docking computer,
		// launch/skip, view, jump, and the three head-look positions.
		//
		// **Assist left the pad in #324, by the principal's ruling**: Square is
		// the laser's trigger, and flight assist stays on the keyboard's `x`.
		expect(bound.has("x")).toBe(false);
		for (const key of [
			"j",
			"t",
			"g",
			"f",
			"c",
			"u",
			"enter",
			"v",
			"`",
			"1",
			"2",
			"3",
		])
			expect(bound.has(key), key).toBe(true);
	});
});

describe("a press becomes a command, once", () => {
	test("Cross launches", () => {
		expect(padIntents(press("a"), "flight").keys).toEqual(["enter"]);
	});

	test("Square presses no key: it is the laser's trigger (#324)", () => {
		expect(padIntents(press("x"), "flight").keys).toEqual([]);
	});

	test("a button merely held is not a press", () => {
		// `command` fires on the edge, exactly as `onKey`'s `!e.repeat` does.
		// Reading the held set instead would toggle cruise sixty times a second.
		const held: ReadonlySet<PadButtonName> = new Set<PadButtonName>(["y"]);
		const frame = readPad(
			pad({
				buttons: STANDARD_BUTTONS.map((n) =>
					n === "y"
						? { pressed: true, value: 1 }
						: { pressed: false, value: 0 },
				),
			}),
			held,
		);
		expect(padIntents(frame, "flight").keys).toEqual([]);
	});

	test("an unbound button says nothing", () => {
		expect(padIntents(press("home"), "flight").keys).toEqual([]);
	});

	test("d-pad down asks for the instrument, and is the last free direction", () => {
		// The perf panel is a developer overlay with no head-look position of
		// its own, so it needs a way in that costs nothing a player uses. Down
		// was the one d-pad direction the flight table had not claimed — left,
		// forward and right are the three head-look positions.
		const asked = padIntents(press("down"), "flight");
		expect(asked.instrument).toBe(true);
		expect(asked.keys).toEqual([]);
		expect(asked.focusDelta).toBe(0);
	});

	test("nothing else asks for it", () => {
		for (const name of STANDARD_BUTTONS)
			if (name !== "down")
				expect(padIntents(press(name), "flight").instrument, name).toBe(false);
	});

	test("a disconnected pad says nothing at all", () => {
		expect(padIntents(absent, "flight")).toEqual(padIntents(rest, "flight"));
		expect(padIntents(absent, "flight").keys).toEqual([]);
	});
});

describe("a console takes six controls and leaves the rest flying", () => {
	// The console footer says "Simulation continues while this console is open",
	// and it is right: suspending the sticks every time the pilot glanced at the
	// target list would stop the ship. So a console claims the d-pad's two
	// vertical positions, the two face buttons and the two shoulders — and
	// nothing else changes meaning.

	test("up and down walk the cursor instead of turning the head", () => {
		expect(padIntents(press("up"), "console").focusDelta).toBe(-1);
		expect(padIntents(press("down"), "console").focusDelta).toBe(1);
		expect(padIntents(press("up"), "console").keys).toEqual([]);
	});

	test("down walks the list rather than reaching for the instrument", () => {
		expect(padIntents(press("down"), "console").instrument).toBe(false);
	});

	test("up and down are head-look again once the head is forward", () => {
		expect(padIntents(press("up"), "flight").keys).toEqual(["2"]);
		expect(padIntents(press("up"), "flight").focusDelta).toBe(0);
	});

	test("left and right keep turning the head, so the other console is reachable", () => {
		expect(padIntents(press("left"), "console").keys).toEqual(["1"]);
		expect(padIntents(press("right"), "console").keys).toEqual(["3"]);
	});

	test("Cross activates the focused row rather than launching", () => {
		// Which is not a loss: LAUNCH is a button *on* the right console, so
		// Cross still launches — through the row instead of past it.
		expect(padIntents(press("a"), "console").activate).toBe(true);
		expect(padIntents(press("a"), "console").keys).toEqual([]);
	});

	test("Circle backs out to the forward view", () => {
		expect(padIntents(press("b"), "console").back).toBe(true);
		expect(padIntents(press("b"), "console").keys).toEqual([]);
	});

	test("the shoulders change tab rather than target", () => {
		expect(padIntents(press("l1"), "console").tabDelta).toBe(-1);
		expect(padIntents(press("r1"), "console").tabDelta).toBe(1);
		expect(padIntents(press("l1"), "console").keys).toEqual([]);
	});

	test("everything else still flies the ship", () => {
		expect(padIntents(press("y"), "console").keys).toEqual(["j"]);
		expect(padIntents(press("l3"), "console").keys).toEqual(["f"]);
		expect(padIntents(press("select"), "console").keys).toEqual(["`"]);
	});
});

describe("a modal panel takes the whole pad", () => {
	test("no flight command survives it", () => {
		// The settings panel already does this for the keyboard —
		// `releaseHeldKeys` — because a held throttle key kept flying the ship
		// behind a screen the player was reading.
		for (const name of STANDARD_BUTTONS)
			expect(padIntents(press(name), "modal").keys, name).toEqual([]);
	});

	test("left and right change a value rather than turning the head", () => {
		// ←→ is what the settings panel's own hint line says, and the pad should
		// not invent a second grammar for the panel it is adopting.
		expect(padIntents(press("left"), "modal").valueDelta).toBe(-1);
		expect(padIntents(press("right"), "modal").valueDelta).toBe(1);
	});

	test("up and down walk, Cross activates, Circle closes", () => {
		expect(padIntents(press("up"), "modal").focusDelta).toBe(-1);
		expect(padIntents(press("down"), "modal").focusDelta).toBe(1);
		expect(padIntents(press("a"), "modal").activate).toBe(true);
		expect(padIntents(press("b"), "modal").back).toBe(true);
	});
});

describe("the sticks are a command, and they carry their own magnitude", () => {
	test("a pad at rest commands exactly nothing", () => {
		// Exactly zero, not nearly. `hasControlInput` reads these to cancel the
		// docking computer, so a stick that drifts by 0.001 disengages an
		// autopilot the player never touched.
		expect(padFlightAxes(rest, "flight")).toEqual({
			yaw: 0,
			pitch: 0,
			roll: 0,
			throttleTrim: 0,
		});
	});

	test("a stick inside the deadzone is still exactly nothing", () => {
		expect(padFlightAxes(sticks([0.1, 0.1, 0.1, 0.1]), "flight")).toEqual({
			yaw: 0,
			pitch: 0,
			roll: 0,
			throttleTrim: 0,
		});
	});

	test("no pad at all is the same as a pad at rest", () => {
		expect(padFlightAxes(null, "flight")).toEqual(
			padFlightAxes(absent, "flight"),
		);
	});

	test("the right stick is pitch and yaw, and it agrees with the mouse", () => {
		// The mouse is the device the pad replaces: moving it right turns the
		// nose right, moving it away pitches the nose up. `main.ts` builds both
		// as negated deltas, and the pad's axes are positive right and positive
		// *down*, so both terms are negations too.
		const right = padFlightAxes(sticks([0, 0, 1, 0]), "flight");
		expect(right.yaw).toBe(-1);
		const up = padFlightAxes(sticks([0, 0, 0, -1]), "flight");
		expect(up.pitch).toBe(1);
	});

	test("the left stick rolls, and left is left", () => {
		expect(padFlightAxes(sticks([-1, 0, 0, 0]), "flight").roll).toBe(1);
	});

	test("half a stick is half a turn, which is the whole argument", () => {
		// A key has one speed. `stepAngular` clamps its command to [-1, 1] and
		// scales by the axis maximum, so a partly-deflected stick is a partial
		// rate with no change to the sim at all.
		const half = padFlightAxes(sticks([0, 0, 0.6, 0]), "flight");
		expect(half.yaw).toBeLessThan(0);
		expect(half.yaw).toBeGreaterThan(-1);
		// Rescaled past the deadzone rather than passed through raw, so the
		// first millimetre of real travel is a small number and not a jump.
		expect(Math.abs(half.yaw)).toBeCloseTo((0.6 - 0.18) / (1 - 0.18), 6);
	});

	test("an open console suspends them too, which is the principal's ruling", () => {
		// **This reverses what #283 shipped.** The node argued that a console
		// takes six discrete controls and the sticks keep flying, from the
		// console's own footer — "Simulation continues while this console is
		// open". Flown, that reads as the ship flying off while you are reading
		// it. The world still runs; the *controls* are what a panel takes.
		expect(padFlightAxes(sticks([1, 1, 1, 1]), "console")).toEqual({
			yaw: 0,
			pitch: 0,
			roll: 0,
			throttleTrim: 0,
		});
	});

	test("and the throttle is held rather than zeroed", () => {
		// The trim is refused, so the throttle keeps whatever value it had and
		// the ship coasts. Driving it to zero was offered and declined: it
		// changes your speed without being asked.
		expect(padFlightAxes(trigger("r2", 1), "console").throttleTrim).toBe(0);
		expect(padFlightAxes(trigger("l2", 1), "console").throttleTrim).toBe(0);
	});

	test("a modal panel suspends the sticks, which a key release cannot do", () => {
		// A key is an event and can be forgotten; a stick is a position and is
		// re-reported every frame, so there is nothing to release. This is the
		// only place the axes are refused.
		expect(padFlightAxes(sticks([1, 1, 1, 1]), "modal")).toEqual({
			yaw: 0,
			pitch: 0,
			roll: 0,
			throttleTrim: 0,
		});
	});

	test("a panel stops the ship; the instrument does not", () => {
		expect(padFlightAxes(sticks([0, 0, 1, 0]), "flight").yaw).toBe(-1);
		expect(padFlightAxes(sticks([0, 0, 1, 0]), "console").yaw).toBe(0);
		expect(padFlightAxes(sticks([0, 0, 1, 0]), "modal").yaw).toBe(0);
		// **The one exception, and it is not an inconsistency.** The frame
		// instrument is a developer overlay behind `?perf` whose whole purpose is
		// measuring a frame *while it is flown*; a mode that stopped the ship
		// would measure a different frame from the one it exists for. It takes a
		// console's six buttons and leaves the sticks alone.
		expect(padFlightAxes(sticks([0, 0, 1, 0]), "instrument").yaw).toBe(-1);
		// The triggers trim there too.
		expect(padFlightAxes(trigger("r2", 1), "instrument").throttleTrim).toBe(1);
	});

	test("the shoulders step no tab in the instrument, and fly nothing either (#379)", () => {
		// The instrument is the perf panel, a list of switches with no tabs, so
		// nothing there reads a tab step (the principal's ruling on #379). The
		// shoulders stay claimed: falling through to the flight table would turn
		// them into `t`/`g` and cycle the target while the panel has the pad.
		for (const name of ["l1", "r1"] as const) {
			expect(padIntents(press(name), "instrument").tabDelta, name).toBe(0);
			expect(padIntents(press(name), "instrument").keys, name).toEqual([]);
		}
		// A console still steps its tabs with them.
		expect(padIntents(press("r1"), "console").tabDelta).toBe(1);
	});

	test("every intent the instrument emits, the instrument branch reads (#379)", () => {
		// The class, not the instance: `tabDelta` was emitted here while nothing
		// read it, and a row asserting the emitted value was green on that
		// defect. So every field a press yields in `instrument` must be read in
		// `main.ts`'s instrument branch.
		//
		// **Keyed by `PadIntents`, so a new field is a type error here** rather
		// than a field this row silently skips (sage round 1 on #379).
		const FIELDS: Record<keyof PadIntents, true> = {
			keys: true,
			focusDelta: true,
			tabDelta: true,
			valueDelta: true,
			activate: true,
			back: true,
			instrument: true,
		};
		const emitted = new Set<keyof PadIntents>();
		for (const name of STANDARD_BUTTONS) {
			const intents = padIntents(press(name), "instrument");
			for (const field of Object.keys(FIELDS) as (keyof PadIntents)[]) {
				const value = intents[field];
				if (Array.isArray(value) ? value.length > 0 : value) emitted.add(field);
			}
		}
		expect(emitted.size).toBeGreaterThan(0);
		// **Fail closed on the slice.** Both markers must be found, or a missing
		// end would run the slice to the end of the file and pick up the console
		// branch's own `intents.tabDelta` — green on the defect again.
		const main = codeOf("src/main.ts");
		const at = main.indexOf("if (perf?.isFocused()) {");
		expect(at).toBeGreaterThan(-1);
		const end = main.indexOf("\n\t\t\treturn;\n\t\t}", at);
		expect(end).toBeGreaterThan(at);
		const branch = main.slice(at, end);
		expect(branch).not.toContain("liveCockpit");
		// A read here is an `if` on the field or a loop over it, which is what a
		// source scan can see. It cannot see what that branch then does: whether
		// the read acts is the browser tier's (`probe-pad-instrument.mjs`).
		for (const field of emitted)
			expect(branch, `instrument emits ${field}`).toMatch(
				new RegExp(`(if \\(intents\\.${field}\\b|of intents\\.${field}\\))`),
			);
	});

	test("the instrument still claims the six a console claims", () => {
		expect(padIntents(press("up"), "instrument").focusDelta).toBe(-1);
		expect(padIntents(press("a"), "instrument").activate).toBe(true);
		expect(padIntents(press("b"), "instrument").back).toBe(true);
		expect(padIntents(press("up"), "instrument").keys).toEqual([]);
		// And everything else still flies it.
		expect(padIntents(press("y"), "instrument").keys).toEqual(["j"]);
	});
});

describe("the throttle is a trim, and the rejected arm is why", () => {
	test("the right trigger opens it and the left closes it", () => {
		expect(padFlightAxes(trigger("r2", 1), "flight").throttleTrim).toBe(1);
		expect(padFlightAxes(trigger("l2", 1), "flight").throttleTrim).toBe(-1);
	});

	test("the shoulders do not move it", () => {
		expect(padFlightAxes(press("r1"), "flight").throttleTrim).toBe(0);
		expect(padFlightAxes(press("l1"), "flight").throttleTrim).toBe(0);
	});

	test("a light pull trims slowly, which the keyboard cannot do", () => {
		expect(padFlightAxes(trigger("r2", 0.25), "flight").throttleTrim).toBe(
			0.25,
		);
	});

	test("a resting trigger holds the throttle where it is", () => {
		// This is the arm that was chosen. A *position* trigger would send the
		// throttle to zero the moment the player let go, which is not what a
		// throttle is — and it would fight three existing writers: the near-
		// station rate scale, the autopilot and cruise's full-throttle entry.
		expect(padFlightAxes(rest, "flight").throttleTrim).toBe(0);
	});

	test("both triggers together cancel out", () => {
		const both = readPad(
			pad({
				buttons: STANDARD_BUTTONS.map((n) =>
					n === "l2" || n === "r2"
						? { pressed: true, value: 1 }
						: { pressed: false, value: 0 },
				),
			}),
			NOTHING,
		);
		expect(padFlightAxes(both, "flight").throttleTrim).toBe(0);
	});
});

describe("Square is the trigger, and the shoulders the targets (#324)", () => {
	test("Square held fires in flight, and nothing else does", () => {
		expect(padFireHeld(press("x"), "flight")).toBe(true);
		// Every other button, so a trigger that also read another one would
		// show here (sage #329).
		for (const name of STANDARD_BUTTONS)
			if (name !== "x")
				expect(padFireHeld(press(name), "flight"), name).toBe(false);
		expect(padFireHeld(rest, "flight")).toBe(false);
		expect(padFireHeld(absent, "flight")).toBe(false);
	});

	test("a console suspends the trigger with the sticks", () => {
		expect(padFireHeld(press("x"), "console")).toBe(false);
		expect(padFireHeld(press("x"), "modal")).toBe(false);
	});

	test("R1 and L1 step the target, and L2 presses no key", () => {
		expect(padIntents(press("r1"), "flight").keys).toEqual(["t"]);
		expect(padIntents(press("l1"), "flight").keys).toEqual(["g"]);
		expect(padIntents(trigger("l2", 1), "flight").keys).toEqual([]);
	});
});

describe("the standard mapping's numbering, as literals", () => {
	// **The one place a renumbering can be caught.** Every other fixture in this
	// repo derives its indices from `STANDARD_BUTTONS` — the unit helpers above
	// and `scripts/lib/fake-pad.mjs` alike — so each of them agrees with the
	// module *by construction* and none could report that the module had drifted
	// from the W3C specification.
	//
	// `probe-gamepad.mjs` used to carry this check and lost it when the three
	// probes were given one shared fixture (#283, round 1), while the fixture's
	// docstring went on claiming the probe still asserted it. Sage read the
	// claim against the code, round 5. It belongs here rather than in a browser:
	// it is a comparison of two lists.
	const W3C = [
		"a",
		"b",
		"x",
		"y",
		"l1",
		"r1",
		"l2",
		"r2",
		"select",
		"start",
		"l3",
		"r3",
		"up",
		"down",
		"left",
		"right",
		"home",
	];

	test("every button sits where the standard mapping puts it", () => {
		// Compared as plain strings: `STANDARD_BUTTONS` is a literal-union tuple,
		// and typing `W3C` to match it would make the check agree with the module
		// by construction — which is the whole thing this is here to avoid.
		expect([...STANDARD_BUTTONS] as string[]).toEqual(W3C);
	});

	test("and there are exactly seventeen of them", () => {
		// A count as well as an order: a mapping that grew an eighteenth position
		// would pass a prefix comparison, and the fixtures build their button
		// arrays to a length of seventeen.
		expect(STANDARD_BUTTONS).toHaveLength(17);
	});
});

describe("the audio unlock keeps its listeners until it has worked", () => {
	// **A source assertion, and the reason is that the state cannot be reached
	// from a probe here.** Sage's round 5 finding is that removing both unlock
	// paths unconditionally spends them on a keystroke that granted no user
	// activation — they saw Escape do exactly that. In this repo's Chromium
	// Escape *does* grant activation, so `probe-gamepad.mjs` cannot build the
	// case: it presses Escape, the context opens, and the check passes with the
	// guard removed. Asserting the guard's presence is what is left, and
	// `tests/output-stage.test.ts` sets the precedent — it reads the spliced
	// shader source for the same reason.
	//
	// It is a weaker check than a behavioural one and says so. What it cannot
	// see is whether the guard is correct, only that the removal is not
	// unconditional.

	test("the removal sits behind a silence check", () => {
		const source = codeOf("src/main.ts");
		const unlock = source.slice(source.indexOf("const unlockAudio = () => {"));
		const body = unlock.slice(0, unlock.indexOf("};"));
		expect(body).toContain("this.audio.ensure()");
		expect(body).toContain("if (this.audio.silent) return;");
		// And the guard precedes both removals, which is the whole of it.
		expect(body.indexOf("if (this.audio.silent) return;")).toBeLessThan(
			body.indexOf('removeEventListener("pointerdown"'),
		);
		expect(body.indexOf("if (this.audio.silent) return;")).toBeLessThan(
			body.indexOf('removeEventListener("keydown"'),
		);
	});
});

describe("the pointer goes with the mouse, not with the camera (#371)", () => {
	// **The whole of #371, headless.** `pointerLockMove` owns the rule and the
	// argument; `probe-pointer-lock.mjs` measures the consequence in a browser.
	// This holds the decision itself, because the consequence is only measurable
	// where the browser will grant a lock at all — which is not every Chromium, and
	// not this repo's default launcher. A table that survives the harness is the
	// reason the rule is a function in this module rather than two conditions in
	// `main.ts`, which nothing here can load.
	//
	// **Keyed by `PadContext`, not listing it.** A plain array of rows would go on
	// passing, green, the day a fifth context joins that union, and the row below
	// only has to walk the object it is given.
	const CELLS: Record<
		PadContext,
		{
			clear: { notHeld: PointerLockMove; held: PointerLockMove };
			drawn: { notHeld: PointerLockMove; held: PointerLockMove };
		}
	> = {
		// A click may take the lock here, and while it is held nothing gives it
		// back: the forward view and the instrument, which keeps the lock for the
		// reason it keeps the sticks — its panel is `pointer-events: none`, so a
		// frame that exists to be measured while flown is still being flown.
		flight: {
			clear: { notHeld: "capture", held: "keep" },
			drawn: { notHeld: "at-rest", held: "release" },
		},
		// **`instrument` + a drawn console is the cell round 5 found.**
		// `readPadContext` answers `instrument` before it ever tests for a console, so
		// the instrument can be focused over a console — the pad's `down` focuses it
		// and its d-pad still turns the head, and `main.ts`'s chart comment records
		// that combination as reachable. The overlay's own reason for keeping the
		// mouse is that nothing on it can be clicked; behind it the console can, so
		// the console wins. That is the principal's ruling on this node, and before it
		// this cell read `keep` and left the console unclickable.
		instrument: {
			clear: { notHeld: "capture", held: "keep" },
			drawn: { notHeld: "at-rest", held: "release" },
		},
		// And here the pointer comes back, which is the whole of #371. Why the
		// release is edge-triggered on `held` is `pointerLockMove`'s to say. Both
		// branches answer the same because the context already fails the flight test:
		// `readPadContext` derives `console` from the drawn console, so `clear` is
		// unreachable from the game's own reads — kept because the *rule* still has to
		// answer it, and a table that only holds reachable cells cannot say that.
		console: {
			clear: { notHeld: "at-rest", held: "release" },
			drawn: { notHeld: "at-rest", held: "release" },
		},
		modal: {
			clear: { notHeld: "at-rest", held: "release" },
			drawn: { notHeld: "at-rest", held: "release" },
		},
	};

	test("every context, drawn or clear, held or not — and the flight rule's own answer", () => {
		for (const [context, byDrawn] of Object.entries(CELLS) as [
			PadContext,
			(typeof CELLS)[PadContext],
		][]) {
			for (const drawn of [false, true]) {
				const cells = drawn ? byDrawn.drawn : byDrawn.clear;
				expect(pointerLockMove(context, drawn, false)).toBe(cells.notHeld);
				expect(pointerLockMove(context, drawn, true)).toBe(cells.held);
				// The delegation is the claim, not an implementation detail: a new
				// context that flies the ship and withholds the pointer, or the other
				// way about, is the drift `contextFliesShip` was extracted to stop. A
				// drawn console is the one thing that overrules it, and that is the
				// whole of the `&& !drawn` below.
				expect(pointerLockMove(context, drawn, false) === "capture").toBe(
					contextFliesShip(context) && !drawn,
				);
			}
		}
	});

	test("the mouse's trigger goes with its pointer (#378)", () => {
		// The principal's ruling on #378: the mouse is the device #283 put on the
		// suspended side, so its button fires only where the pointer may be held.
		// A click on the glass beside a drawn console does not fire. Space still
		// does: the keyboard's ruling is not this node's.
		for (const context of Object.keys(CELLS) as PadContext[])
			for (const drawn of [false, true]) {
				const admits = pointerLockMove(context, drawn, false) === "capture";
				expect(mouseFireHeld(true, context, drawn), `${context}/${drawn}`).toBe(
					admits,
				);
				expect(mouseFireHeld(false, context, drawn)).toBe(false);
			}
		// The two cells a player reaches with the button down, spelled out so the
		// loop above cannot pass by agreeing with a wrong `pointerLockMove`.
		expect(mouseFireHeld(true, "flight", false)).toBe(true);
		expect(mouseFireHeld(true, "console", true)).toBe(false);
		// And the one cell where it parts from `padFireHeld`: the instrument focused
		// over a drawn console, where the click belongs to the console (#371).
		expect(mouseFireHeld(true, "instrument", true)).toBe(false);
		expect(mouseFireHeld(true, "instrument", false)).toBe(true);
	});

	test("and triggerHeld asks it, rather than reading the button bare", () => {
		const main = codeOf("src/main.ts");
		const at = main.indexOf("private triggerHeld(): boolean {");
		expect(at).toBeGreaterThan(-1);
		const body = main.slice(at, main.indexOf("\n\t}", at));
		// The button is read once, and only as the rule's argument (sage round 1 on #378:
		// a bare read at either end of the `||` chain passed the first version).
		expect(body.match(/this\.mouseFiring/g) ?? []).toHaveLength(1);
		expect(body).toMatch(/mouseFireHeld\(\s*this\.mouseFiring,/);
	});

	test("and a press made where the mouse is suspended never becomes a trigger", () => {
		// Sage round 1 on #378: gating only the read let a press made beside a console
		// latch, and fire once the head came back with the button still held.
		const main = codeOf("src/main.ts");
		const at = main.indexOf('domElement.addEventListener("pointerdown"');
		expect(at).toBeGreaterThan(-1);
		const handler = main.slice(at, main.indexOf("});", at));
		expect(handler).toContain("mouseFireHeld(");
		expect(handler).not.toContain("this.mouseFiring = true");
	});

	test("the gamepad's head turn arrives at the same door the keyboard's does", () => {
		// `probe-pointer-lock.mjs` turns the head with a held d-pad and reads the
		// pointer come back, and the reason that row is about a *door* rather than a
		// second copy of the keyboard row is this mapping: the d-pad's three
		// horizontal positions are the `1`/`2`/`3` commands, which is why the probe
		// can say "the gamepad door" and mean `command`, not a binding of its own.
		expect(PAD_FLIGHT_KEYS.left).toBe("1");
		expect(PAD_FLIGHT_KEYS.up).toBe("2");
		expect(PAD_FLIGHT_KEYS.right).toBe("3");
	});

	test("the lock is asked for at one door, and given up at two that are named", () => {
		// **A count, and it is standing in for a predicate — so read what it
		// guards.** The defect class is not "the wrong condition" but "a second place
		// that takes the lock without asking", which is how a release came to be
		// written beside one screen before this rule had an owner. Why that release
		// stays and a third would not is `reconcilePointerLock`'s comment; what the
		// lists below do is make a new one a decision rather than an accident.
		const doors = (call: RegExp): string[] => {
			const found: string[] = [];
			for (const file of srcFiles())
				for (const _ of codeOf(file).matchAll(call)) found.push(file);
			return found;
		};
		expect(doors(/requestPointerLock\s*\(/g)).toEqual(["src/main.ts"]);
		expect(doors(/exitPointerLock\s*\(/g).sort()).toEqual([
			"src/commander-overlay.ts",
			"src/main.ts",
		]);
		// And the one door asks the rule **and obeys it**: the answer has to be
		// tested and returned from, not merely computed and dropped on the way to
		// the browser. `toContain("pointerLockMove(")` alone would pass a handler
		// that asks and ignores — which is what sage, round 2, read out of it.
		const asked = codeOf("src/main.ts");
		const door = asked.slice(
			asked.indexOf('addEventListener("click"'),
			asked.indexOf("requestPointerLock"),
		);
		expect(door).toContain("pointerLockMove(");
		// **The gate's meaning, not the formatter's layout.** Sage, round 3, on the
		// first version of this line: it required a newline before the `return`, so
		// Biome reflowing the statement — or someone adding braces — would have gone
		// red with the rule untouched. Braces and reflows are allowed here; an answer
		// that is computed and dropped is not.
		expect(door).toMatch(/!==\s*"capture"[\s\S]{0,24}?return\b/);
	});
});

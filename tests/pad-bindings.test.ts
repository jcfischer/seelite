/**
 * What the pad *means* — #283's binding table, checked headlessly.
 *
 * The table is deliberately not inside `src/gamepad.ts`: that module is a copy
 * and a binding table there would have to name a station, a target or a regime.
 * It is deliberately not inside `main.ts` either, which nothing in this tier can
 * load — and a table nothing can load is a table nothing checks.
 */
import { describe, expect, test } from "bun:test";
import { codeOf } from "./lib/source-scan";
import {
	type PadButtonName,
	type RawPad,
	STANDARD_BUTTONS,
	readPad,
} from "../src/gamepad";
import {
	PAD_FLIGHT_KEYS,
	padFlightAxes,
	padIntents,
} from "../src/pad-bindings";

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
		// assist, cruise, next/previous target, face, clearance, docking
		// computer, launch/skip, view, jump, and the three head-look positions.
		for (const key of [
			"x",
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

	test("Square toggles the assist", () => {
		expect(padIntents(press("x"), "flight").keys).toEqual(["x"]);
	});

	test("a button merely held is not a press", () => {
		// `command` fires on the edge, exactly as `onKey`'s `!e.repeat` does.
		// Reading the held set instead would toggle the assist sixty times a
		// second.
		const held: ReadonlySet<PadButtonName> = new Set<PadButtonName>(["x"]);
		const frame = readPad(
			pad({
				buttons: STANDARD_BUTTONS.map((n) =>
					n === "x"
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
		expect(padIntents(press("x"), "console").keys).toEqual(["x"]);
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
		expect(padFlightAxes(trigger("r2", 1), "instrument").throttleTrim).toBe(1);
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

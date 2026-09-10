/**
 * The pad's normalisation, which is all of it that can be tested without a
 * browser — and all of it that decides anything.
 *
 * `GamepadSource.poll()` takes an injected list precisely so this file never
 * needs `navigator`; what it cannot cover is that `navigator.getGamepads()` is
 * wired to it at all, and `scripts/probe-gamepad.mjs` is where that is checked
 * against a real browser.
 *
 * The deadzone tests are the ones with teeth. A per-axis deadzone passes a
 * straight-up push and fails a diagonal one, so the diagonal cases below are
 * the ones that would red if somebody "simplified" the radial cut.
 */
import { describe, expect, test } from "bun:test";
import {
	applyRadialDeadzone,
	GamepadSource,
	type PadButtonName,
	type RawPad,
	readPad,
	STANDARD_BUTTONS,
} from "../src/gamepad";

/** A standard-mapping pad with everything at rest, for a test to bend one field of. */
function pad(overrides: Partial<RawPad> = {}): RawPad {
	return {
		id: "DualSense Wireless Controller (STANDARD GAMEPAD)",
		mapping: "standard",
		axes: [0, 0, 0, 0],
		buttons: STANDARD_BUTTONS.map(() => ({ pressed: false, value: 0 })),
		...overrides,
	};
}

/** The same, with one named button held. */
function withButton(name: PadButtonName, value = 1): RawPad {
	const index = STANDARD_BUTTONS.indexOf(name);
	const buttons = STANDARD_BUTTONS.map((_, i) =>
		i === index
			? { pressed: value >= 0.5, value }
			: { pressed: false, value: 0 },
	);
	return pad({ buttons });
}

const NOTHING: ReadonlySet<PadButtonName> = new Set();

describe("radial deadzone", () => {
	test("a stick at rest reads exactly zero", () => {
		expect(applyRadialDeadzone(0, 0, 0.18)).toEqual([0, 0]);
	});

	test("drift below the deadzone is discarded", () => {
		// A rested DualSense idles here. If this passes anything through, the
		// camera pans on its own with nobody touching the pad.
		expect(applyRadialDeadzone(0.09, -0.06, 0.18)).toEqual([0, 0]);
	});

	test("output starts from rest, not from the deadzone", () => {
		// Just past the edge. Without rescaling the first live reading would be
		// ~0.18, so the camera would start at a speed instead of from a standstill.
		const [x] = applyRadialDeadzone(0.19, 0, 0.18);
		expect(x).toBeGreaterThan(0);
		expect(x).toBeLessThan(0.02);
	});

	test("a full push reaches 1", () => {
		const [x, y] = applyRadialDeadzone(1, 0, 0.18);
		expect(x).toBeCloseTo(1, 6);
		expect(y).toBe(0);
	});

	test("the diagonal is not slower than the cardinal — the square-deadzone bug", () => {
		// This is the case a per-axis deadzone gets wrong. Each axis here is
		// 0.212, which a 0.18 per-axis cut would nearly erase; radially the
		// magnitude is 0.3 and well past the edge.
		const [x, y] = applyRadialDeadzone(0.212, 0.212, 0.18);
		expect(Math.hypot(x, y)).toBeGreaterThan(0.1);
		expect(x).toBeCloseTo(y, 6);
	});

	test("a deadzone of 1 discards every direction equally", () => {
		// The documented top of the range, and the arithmetic divides by zero
		// there: a cardinal push was discarded while a diagonal reading past 1
		// came through. A boundary that behaves differently by direction is not
		// a boundary.
		expect(applyRadialDeadzone(1, 0, 1)).toEqual([0, 0]);
		expect(applyRadialDeadzone(1, 1, 1)).toEqual([0, 0]);
		expect(applyRadialDeadzone(0.5, 0.5, 1)).toEqual([0, 0]);
	});

	test("a diagonal at full deflection is not faster than a cardinal one", () => {
		// Raw axes can each read 1.0 on a squared-off gate, magnitude 1.41. Left
		// alone that is a camera that pans half again as fast diagonally.
		const [x, y] = applyRadialDeadzone(1, 1, 0.18);
		expect(Math.hypot(x, y)).toBeCloseTo(1, 6);
	});
});

describe("reading a frame", () => {
	test("no pad is a connected:false frame, not a throw", () => {
		const frame = readPad(null, NOTHING);
		expect(frame.connected).toBe(false);
		expect(frame.axes.leftX).toBe(0);
		expect(frame.held.size).toBe(0);
	});

	test("a pad unplugged mid-press still reports the release", () => {
		// Otherwise a game holding a sculpt open on `a` sculpts forever.
		const frame = readPad(null, new Set<PadButtonName>(["a"]));
		expect([...frame.released]).toEqual(["a"]);
		expect(frame.held.size).toBe(0);
		// …and it is as write-proof as any other frame. This branch was the one
		// exception while the code claimed there were none, so a consumer could
		// have edited the evidence of a disconnect.
		expect(Object.isFrozen(frame)).toBe(true);
		expect(() => (frame.released as Set<PadButtonName>).clear()).toThrow();
	});

	test("axes map to the standard mapping's four stick channels", () => {
		const frame = readPad(pad({ axes: [1, -1, -1, 1] }), NOTHING);
		expect(frame.axes.leftX).toBeCloseTo(0.707, 2);
		expect(frame.axes.leftY).toBeCloseTo(-0.707, 2);
		expect(frame.axes.rightX).toBeCloseTo(-0.707, 2);
		expect(frame.axes.rightY).toBeCloseTo(0.707, 2);
	});

	test("a pad with fewer axes than the standard mapping reads zero, not NaN", () => {
		const frame = readPad(pad({ axes: [0.5] }), NOTHING);
		expect(frame.axes.rightX).toBe(0);
		expect(Number.isNaN(frame.axes.rightY)).toBe(false);
	});

	test("every standard button is named and none is missed", () => {
		// Membership, not a count — the argument `headless.test.ts` makes about
		// its own list applies here for the same reason.
		expect(new Set(STANDARD_BUTTONS).size).toBe(STANDARD_BUTTONS.length);
		expect(STANDARD_BUTTONS).toContain("a");
		expect(STANDARD_BUTTONS).toContain("home");
		const frame = readPad(pad(), NOTHING);
		expect(Object.keys(frame.values).sort()).toEqual(
			[...STANDARD_BUTTONS].sort(),
		);
	});

	test("Cross is index 0 and Circle index 1, as the standard mapping says", () => {
		expect(readPad(withButton("a"), NOTHING).held.has("a")).toBe(true);
		expect(readPad(withButton("b"), NOTHING).held.has("b")).toBe(true);
		expect(STANDARD_BUTTONS.indexOf("a")).toBe(0);
		expect(STANDARD_BUTTONS.indexOf("b")).toBe(1);
	});

	test("a short buttons array degrades to nothing pressed", () => {
		const frame = readPad(pad({ buttons: [] }), NOTHING);
		expect(frame.connected).toBe(true);
		expect(frame.held.size).toBe(0);
	});

	test("a pad the browser could not fit to the standard mapping is refused", () => {
		// Every name this module hands out is a *position*. Off the standard
		// mapping the indices mean whatever the firmware wanted, so reporting
		// `buttons[0]` as `a` would invent a Cross press — and Cross starts a
		// match. An exotic pad reads as no pad, and the keyboard still works.
		const exotic = pad({ mapping: "", buttons: withButton("a").buttons });
		const frame = readPad(exotic, NOTHING);
		expect(frame.connected).toBe(false);
		expect(frame.held.size).toBe(0);
		expect(frame.pressed.size).toBe(0);
	});

	test("a missing mapping is refused too, not treated as standard", () => {
		const frame = readPad({ axes: [0, 0, 0, 0], buttons: [] }, NOTHING);
		expect(frame.connected).toBe(false);
	});

	test("refusing an exotic pad still reports what the last real one was holding", () => {
		const frame = readPad(pad({ mapping: "" }), new Set<PadButtonName>(["a"]));
		expect([...frame.released]).toEqual(["a"]);
	});
});

describe("edges", () => {
	test("a button down for the first time is pressed, then only held", () => {
		const first = readPad(withButton("a"), NOTHING);
		expect([...first.pressed]).toEqual(["a"]);

		const second = readPad(withButton("a"), first.held);
		expect(second.held.has("a")).toBe(true);
		expect(second.pressed.size).toBe(0);
	});

	test("letting go is a release, once", () => {
		const down = readPad(withButton("a"), NOTHING);
		const up = readPad(pad(), down.held);
		expect([...up.released]).toEqual(["a"]);

		const stillUp = readPad(pad(), up.held);
		expect(stillUp.released.size).toBe(0);
	});

	test("a pad that appears with a button already down fires no press at all", () => {
		// A browser hides a pad until a button on it is pressed, so the first
		// frame a pad exists is usually a frame with that button down — the press
		// that *woke the controller*. Acting on it means the wake-up keystroke
		// also casts a spell, and it is the same reading that let a restart count
		// itself twice. The pad is held, and nothing was pressed.
		const source = new GamepadSource();
		const first = source.poll([withButton("a")]);
		expect(first.held.has("a")).toBe(true);
		expect(first.pressed.size).toBe(0);

		const second = source.poll([withButton("a")]);
		expect(second.pressed.size).toBe(0);
	});

	test("…and the next press, after letting go, is a real one", () => {
		// The other half: suppressing the first sighting must not suppress the
		// player's actual input a moment later.
		const source = new GamepadSource();
		source.poll([withButton("a")]);
		source.poll([pad()]);
		expect([...source.poll([withButton("a")]).pressed]).toEqual(["a"]);
	});

	test("a held button does not re-fire every frame", () => {
		const source = new GamepadSource();
		source.poll([pad()]);
		expect([...source.poll([withButton("a")]).pressed]).toEqual(["a"]);
		expect(source.poll([withButton("a")]).pressed.size).toBe(0);
		expect(source.poll([withButton("a")]).pressed.size).toBe(0);
	});

	test("swapping controllers does not invent a press", () => {
		// `previousHeld` is a set of names with no device attached, so a second
		// pad already holding Cross once produced an edge nobody caused. Two pads
		// with different ids, the second holding what the first was not.
		const source = new GamepadSource();
		const first = pad({ id: "pad-one" });
		source.poll([first]);
		source.poll([first]);
		const swapped = source.poll([{ ...withButton("a"), id: "pad-two" }]);
		expect(swapped.held.has("a")).toBe(true);
		expect(swapped.pressed.size).toBe(0);
	});

	test("swapping controllers while a button is held still reports the release", () => {
		// The worst case of the swap, and the one the first fix dropped: the
		// departing pad's releases were thrown away with the arriving pad's
		// presses, so Cross held through a swap never came up and the sculpt
		// stroke ran on with nothing holding it.
		const source = new GamepadSource();
		const held = { ...withButton("a"), id: "pad-one" };
		source.poll([held]);
		source.poll([held]);
		expect(source.poll([held]).held.has("a")).toBe(true);

		const swapped = source.poll([pad({ id: "pad-two" })]);
		expect([...swapped.released]).toEqual(["a"]);
		expect(swapped.pressed.size).toBe(0);
		expect(swapped.held.size).toBe(0);
	});

	test("a swap where both pads hold the button reports no release", () => {
		// The limit of the rule above, pinned so the docs cannot promise more
		// than this. The module cannot tell "let go and pressed again" from
		// "still down" across a swap, so it reports still down — and a sculpt
		// stroke survives a swap made with Cross held on both pads.
		const source = new GamepadSource();
		const one = { ...withButton("a"), id: "pad-one" };
		source.poll([one]);
		source.poll([one]);
		const swapped = source.poll([{ ...withButton("a"), id: "pad-two" }]);
		expect(swapped.held.has("a")).toBe(true);
		expect(swapped.released.size).toBe(0);
		expect(swapped.pressed.size).toBe(0);
	});

	test("…and the same pad in the same slot keeps its history", () => {
		// The rule must cost nothing on the ordinary frame: a pad that has not
		// changed still reports its edges.
		const source = new GamepadSource();
		source.poll([pad({ id: "pad-one" })]);
		source.poll([pad({ id: "pad-one" })]);
		const pressed = source.poll([{ ...withButton("a"), id: "pad-one" }]);
		expect([...pressed.pressed]).toEqual(["a"]);
	});
});

describe("triggers report pressure", () => {
	test("a half-pulled trigger has a value and is not held", () => {
		const frame = readPad(withButton("r2", 0.3), NOTHING);
		expect(frame.values.r2).toBeCloseTo(0.3, 6);
		expect(frame.held.has("r2")).toBe(false);
	});

	test("past the threshold it is held and still carries its value", () => {
		const frame = readPad(withButton("r2", 0.8), NOTHING);
		expect(frame.held.has("r2")).toBe(true);
		expect(frame.values.r2).toBeCloseTo(0.8, 6);
	});

	test("the threshold is configurable, because a throttle is not a button", () => {
		const frame = readPad(withButton("r2", 0.3), NOTHING, {
			pressThreshold: 0.2,
		});
		expect(frame.held.has("r2")).toBe(true);
	});

	test("a resting trigger is not held, even at a threshold of zero", () => {
		// `0 >= 0` is true, so a threshold of zero once meant both triggers read
		// as held for ever and never produced an edge at all.
		const frame = readPad(pad(), NOTHING, { pressThreshold: 0 });
		expect(frame.held.has("l2")).toBe(false);
		expect(frame.held.has("r2")).toBe(false);
		// …while the lightest real pull is held, which is what asking for zero
		// was for.
		const touched = readPad(withButton("r2", 0.01), NOTHING, {
			pressThreshold: 0,
		});
		expect(touched.held.has("r2")).toBe(true);
	});

	test("a raised threshold really raises the bite point", () => {
		// The direction the option exists for, and the one it did not have: the
		// browser calls a trigger at 0.6 `pressed` on its own fixed ~0.5, and
		// or-ing that bit in meant asking for 0.9 still got a press at 0.6. An
		// option that can only ever loosen is not an option.
		const frame = readPad(withButton("r2", 0.6), NOTHING, {
			pressThreshold: 0.9,
		});
		expect(frame.values.r2).toBeCloseTo(0.6, 6);
		expect(frame.held.has("r2")).toBe(false);
	});

	test("…and a digital button is still the pad's own answer, not the number", () => {
		// Same raised threshold, a face button rather than a trigger. Cross is a
		// switch: the pad says it is down, and no threshold should argue.
		const frame = readPad(withButton("a"), NOTHING, { pressThreshold: 0.9 });
		expect(frame.held.has("a")).toBe(true);
	});

	test("a digital button reporting pressed with value 0 is still held", () => {
		// Some drivers do this. Trusting the threshold alone would drop the press.
		const buttons = STANDARD_BUTTONS.map((_, i) =>
			i === 0 ? { pressed: true, value: 0 } : { pressed: false, value: 0 },
		);
		expect(readPad(pad({ buttons }), NOTHING).held.has("a")).toBe(true);
	});

	test("a lowered threshold does not turn a face button's stray value into a press", () => {
		// The other direction of the same confusion. `pressThreshold` is the
		// trigger's bite point; a switch has none, and or-ing it in let a face
		// button reporting `{pressed: false, value: 0.3}` read as a Cross press
		// whenever a caller lowered the number for a throttle.
		const buttons = STANDARD_BUTTONS.map((_, i) =>
			i === 0 ? { pressed: false, value: 0.3 } : { pressed: false, value: 0 },
		);
		const frame = readPad(pad({ buttons }), NOTHING, { pressThreshold: 0.2 });
		expect(frame.values.a).toBeCloseTo(0.3, 6);
		expect(frame.held.has("a")).toBe(false);
	});
});

describe("the source", () => {
	test("picks the first present pad when no index is given", () => {
		const source = new GamepadSource();
		const frame = source.poll([null, null, withButton("b")]);
		expect(frame.connected).toBe(true);
		expect(frame.held.has("b")).toBe(true);
	});

	test("an explicit index reads that slot and no other", () => {
		const source = new GamepadSource({ index: 1 });
		expect(source.poll([withButton("a"), null]).connected).toBe(false);
	});

	test("an unusable pad in an earlier slot does not hide a real one behind it", () => {
		// "The first pad that is there" has to mean the first *usable* one. Taking
		// the first occupied slot and then refusing it for its mapping left a real
		// controller in slot 1 invisible, and the game reported no pad at all.
		const source = new GamepadSource();
		const frame = source.poll([pad({ mapping: "" }), withButton("b")]);
		expect(frame.connected).toBe(true);
		expect(frame.held.has("b")).toBe(true);
	});

	test("a named slot still means that slot, refusal included", () => {
		// The other half of the rule: a caller who names an index has said which
		// device they mean, so scanning past it would be overriding them.
		const source = new GamepadSource({ index: 0 });
		expect(source.poll([pad({ mapping: "" }), withButton("b")]).connected).toBe(
			false,
		);
	});

	test("an empty list is a disconnected frame", () => {
		expect(new GamepadSource().poll([]).connected).toBe(false);
	});

	test("the shared empty sets cannot be written to", () => {
		// They are shared by every frame with no edges to report, so one `add`
		// would make every later frame report a press nobody made. `Object.freeze`
		// does not stop that — a frozen `Set` still accepts `add` — which is why
		// this is a throwing subclass and not a freeze.
		const frame = new GamepadSource().poll([pad()]);
		expect(() => (frame.pressed as Set<PadButtonName>).add("a")).toThrow();
		expect(() => (frame.released as Set<PadButtonName>).clear()).toThrow();
		expect(frame.pressed.size).toBe(0);
	});

	test("a connected frame is write-proof too, not only the empty one", () => {
		// `held` is the one that matters: `GamepadSource` keeps it as next
		// frame's history, so a consumer adding a name to it would be editing
		// the past. The earlier version froze only the no-pad frame while the
		// header claimed every frame.
		const frame = new GamepadSource().poll([withButton("a")]);
		expect(() => (frame.held as Set<PadButtonName>).add("b")).toThrow();
		expect(Object.isFrozen(frame)).toBe(true);
		expect(Object.isFrozen(frame.axes)).toBe(true);
		expect(frame.held.size).toBe(1);
	});

	test("the no-pad frame is one shared object, not one per frame", () => {
		// `poll()` runs every frame of every game whether or not anybody owns a
		// controller, so the common answer is the one that must not allocate.
		// Identity is the only way to assert that from outside.
		const source = new GamepadSource();
		expect(source.poll([])).toBe(source.poll([]));
	});

	test("…but a frame that has releases to report is its own", () => {
		const source = new GamepadSource();
		source.poll([withButton("a")]);
		const unplugged = source.poll([]);
		expect([...unplugged.released]).toEqual(["a"]);
		expect(unplugged).not.toBe(source.poll([]));
	});

	test("polling with an injected list never touches navigator", () => {
		// The control for this whole file: under bun there is no `navigator`
		// with `getGamepads`, so a source that reached for it would throw here
		// rather than return a frame.
		const source = new GamepadSource();
		expect(source.poll([pad()]).connected).toBe(true);
	});

	test("polling with no list under bun is empty rather than a throw", () => {
		// Half of rule 2: the *guard*. Under bun there is no `getGamepads`, so
		// this returns before the call — which is why it is not the whole check,
		// and why the next test exists. Review found this one claiming both.
		expect(new GamepadSource().poll().connected).toBe(false);
	});

	test("a getGamepads that throws is a disconnected frame, not a crash", () => {
		// The other half: the `try`. A `getGamepads` that is present and *refuses*
		// is a different shape from one that is absent, and an input layer that
		// dies on the second takes the game with it — that is the whole reason
		// for the catch, and it does not need a cause to be worth having. (An
		// earlier version of this comment named the insecure-context case as
		// that cause; review could not find it in the WebIDL, so the claim is
		// gone and the check stays.)
		const before = Object.getOwnPropertyDescriptor(globalThis, "navigator");
		let called = 0;
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: {
				getGamepads() {
					called++;
					throw new DOMException("getGamepads refused");
				},
			},
		});
		const warn = console.warn;
		let warned = 0;
		console.warn = () => {
			warned++;
		};
		try {
			const source = new GamepadSource();
			expect(source.poll().connected).toBe(false);
			// The control: a test that never reached the throwing call would
			// pass for the same reason the one above does.
			expect(called).toBe(1);
			// …and it says so, because an empty frame is what "no pad" looks
			// like and a fault must not be silent. Once, though — this runs
			// every frame, and a warning per frame is its own outage.
			expect(warned).toBe(1);
			source.poll();
			source.poll();
			expect(called).toBe(3);
			expect(warned).toBe(1);
		} finally {
			console.warn = warn;
			if (before) Object.defineProperty(globalThis, "navigator", before);
			else delete (globalThis as { navigator?: unknown }).navigator;
		}
	});
});

/**
 * The capture context, and what a rebind may move onto (#381 S4, #369 D9/D12).
 *
 * D9 rules that the modal lives in a new `capture` context whose whole job is
 * to **admit the sticks and triggers for one capture, refuse everything else,
 * and swallow every input except its own cancel**. F8's problem — a modal must
 * refuse the axes because a stick is a position and there is nothing to
 * release — is answered in the open, by a context that exists to admit them,
 * rather than by punching a hole in the console's suspension.
 *
 * **And what `rebind` accepts is narrower than what the modal admits, on
 * purpose.** After this slice's first step the layout has exactly two readers:
 * `resolveKey` and `resolvePad`, and `resolvePad` answers a *press*.
 * `padFlightAxes` and `padFireHeld` still read fixed positions, so a stored
 * stick move would be a value satisfying no reader — which is what
 * `movedTrigger`'s first version shipped and what its doc exists to refuse.
 * D12 says every command accepts every kind; this is the half of D12 that has
 * a reader, with each refusal naming the one that would have to exist.
 */
import { describe, expect, test } from "bun:test";
import { shippedTrigger } from "./lib/shipped-trigger";
import {
	capturedTrigger,
	CAPTURE_DEFLECTION,
	DEFAULT_BINDINGS,
	PAD_CONTEXTS,
	rebind,
	resolveKey,
	resolvePad,
	type Trigger,
	triggerKey,
} from "../src/commands";
import { parseLayout, serializeLayout } from "../src/binding-store";
import { type PadButtonName, STANDARD_BUTTONS } from "../src/gamepad";
import { press, rest as restFrame, sticks } from "./lib/pad-frames";
import {
	contextFliesShip,
	padFireHeld,
	padFlightAxes,
	padIntents,
} from "../src/pad-bindings";

const rest = restFrame();

describe("the capture context admits the pad and flies nothing", () => {
	test("it is one of the contexts, and it does not fly the ship", () => {
		expect(PAD_CONTEXTS).toContain("capture");
		expect(contextFliesShip("capture")).toBe(false);
	});

	test("a deflected stick commands nothing there", () => {
		// The half of D9 that makes the context necessary: the modal has to see
		// the stick, and the ship must not. `contextFliesShip` is the one owner
		// of that rule, so this follows from the line above rather than from a
		// second gate — and the row is here because a fifth context is exactly
		// the edit that would forget one.
		expect(padFlightAxes(sticks([1, 1, 1, 1]), "capture")).toEqual({
			yaw: 0,
			pitch: 0,
			roll: 0,
			throttleTrim: 0,
			heave: 0,
		});
	});

	test("and the pulse laser's trigger is not held there either", () => {
		const held: ReadonlySet<PadButtonName> = new Set<PadButtonName>(["x"]);
		expect(padFireHeld(press("x", 1, held), "capture")).toBe(false);
	});

	test("no press reaches anything at all — every button is swallowed whole", () => {
		// **Including Circle, and that is the principal's ruling.** The first
		// version reserved Circle as the way out, because Circle is `back`
		// everywhere else — and the cost was that Circle became the one button
		// a pad could never bind. The cancel is a *click* instead: #370's
		// standing premise is that a screen is always clickable, which is why
		// the pointer rows carry `fixed: "pointer"` and have no movable
		// trigger at all. A modal whose way out is a control no binding table
		// holds is the same argument that gives this tab its settings door.
		for (const name of STANDARD_BUTTONS) {
			const out = padIntents(press(name), "capture");
			expect(out.buttons, name).toEqual([]);
			expect(out.focusDelta, name).toBe(0);
			expect(out.tabDelta, name).toBe(0);
			expect(out.valueDelta, name).toBe(0);
			expect(out.activate, name).toBe(false);
			expect(out.instrument, name).toBe(false);
			expect(out.back, name).toBe(false);
		}
	});
});

describe("what one capture records", () => {
	test("a button press is recorded with the contexts that button has", () => {
		// The contexts are the *button's* and never the player's — a console
		// claims Circle and the Cross, so a binding captured on Triangle is live
		// in the three contexts Triangle falls through in, and one captured on
		// Cross in the one that Cross does. #369 D4's "the player edits the
		// trigger; the context set is the command's", applied to the half of a
		// pad trigger that is not the button.
		const captured = capturedTrigger(press("y"), rest);
		expect(captured).toEqual({
			kind: "pad-button",
			button: "y",
			contexts: ["flight", "instrument", "console"],
		});
		expect(capturedTrigger(press("a"), rest)).toEqual({
			kind: "pad-button",
			button: "a",
			contexts: ["flight"],
		});
	});

	test("Circle is recorded like any other button", () => {
		// The row that changed when the cancel became a click. Circle is
		// `dock.clearance` on the shipped layout and falls through in flight
		// alone, so it comes back with that one context — which is also the
		// proof that this is the ordinary path and not a special case.
		expect(capturedTrigger(press("b"), rest)).toEqual({
			kind: "pad-button",
			button: "b",
			contexts: ["flight"],
		});
	});

	test("a button no context lets through is recorded, and then refused", () => {
		// D-pad down hands the pad to the frame instrument and is claimed by
		// every panel, so it falls through nowhere. A binding on it would be
		// live in no context at all — but the *capture* records it, and the
		// registry is what says why.
		//
		// **It returned `null` for a round** (sage round 2 on #497): the doc
		// said such a button was refused, the code silently ignored it, the
		// player pressing d-pad ↓ got a modal that did not react, and
		// `movedTrigger`'s `live-nowhere` refusal was unreachable from a pad.
		const caught = capturedTrigger(press("down"), rest);
		expect(caught).toEqual({
			kind: "pad-button",
			button: "down",
			contexts: [],
		});
		if (caught === null) return;
		expect(() =>
			rebind(
				DEFAULT_BINDINGS,
				"fly.cruise",
				shippedTrigger("fly.cruise", "pad-button"),
				caught,
			),
		).toThrow(/live nowhere/);
	});

	test("a stick is recorded on the half the player pushed", () => {
		const pushed = capturedTrigger(sticks([0, 0, 1, 0]), rest);
		expect(pushed).toEqual({
			kind: "pad-stick",
			stick: "right",
			axis: "x",
			half: "+",
			contexts: ["capture"],
		});
		expect(capturedTrigger(sticks([0, 0, -1, 0]), rest)).toMatchObject({
			half: "-",
		});
	});

	test("and a trigger on the one that was pulled", () => {
		expect(capturedTrigger(press("r2"), rest)).toEqual({
			kind: "pad-trigger",
			trigger: "r2",
			contexts: ["capture"],
		});
	});

	test("a stick already deflected when the modal opened is not a capture", () => {
		// **The trap C10 is named after.** The player was flying, turned the
		// head and pressed the shoulder to open this — the stick never came
		// back to centre. A capture that read a *level* would record it on the
		// first frame and pass a row called "reads a stick on the frame after
		// the modal suspended it" while recording the stick the player had not
		// let go of. The reading is an edge: inside the band, then outside.
		const deflected = sticks([0, 0, 1, 0]);
		expect(capturedTrigger(deflected, deflected)).toBeNull();
		// It has to come back first, and then it counts.
		expect(capturedTrigger(deflected, rest)).not.toBeNull();
	});

	test("with no previous frame nothing analog is captured at all", () => {
		// The opening frame has nothing to be an edge against, and a stick that
		// is already over is exactly the case above. A press is still a press:
		// `readPad` computes that edge itself, against the previous poll.
		expect(capturedTrigger(sticks([0, 0, 1, 0]), null)).toBeNull();
		expect(capturedTrigger(press("y"), null)).not.toBeNull();
	});

	test("a lean short of the band is not a push", () => {
		// Well above `applyRadialDeadzone`'s 0.18, because this is a deliberate
		// shove and not a drift — a worn stick resting at 0.3 would otherwise
		// bind itself the moment the modal opened.
		//
		// **The band is read against what the frame reports, not against the
		// raw push**, and the two are not the same number: `readPad` has
		// already taken the deadzone out, so a raw 0.58 arrives as 0.49. A row
		// written in raw pushes would be asserting the deadzone's arithmetic by
		// accident, and would move the day that default moves.
		const under = sticks([0, 0, 0.58, 0]);
		expect(under.axes.rightX).toBeLessThan(CAPTURE_DEFLECTION);
		expect(capturedTrigger(under, rest)).toBeNull();
		const over = sticks([0, 0, 0.6, 0]);
		expect(over.axes.rightX).toBeGreaterThanOrEqual(CAPTURE_DEFLECTION);
		expect(capturedTrigger(over, rest)).not.toBeNull();
	});

	test("a pad that is not there records nothing", () => {
		expect(capturedTrigger(null, rest)).toBeNull();
	});
});

describe("what a rebind may move onto", () => {
	test("a pad button moves onto another pad button, and flies there", () => {
		// The row C6 exists for. `home` is the one standard button the shipped
		// layout leaves free, and `resolvePad` is what answers afterwards — the
		// table is not the evidence, the resolver is.
		const from = shippedTrigger("fly.cruise", "pad-button");
		const to = capturedTrigger(press("home"), rest);
		if (to === null) throw new Error("home was not captured");
		const layout = rebind(DEFAULT_BINDINGS, "fly.cruise", from, to);
		expect(
			resolvePad(layout, {
				button: "home",
				context: "flight",
				view: "cockpit",
			}),
		).toEqual(["fly.cruise"]);
		expect(
			resolvePad(layout, { button: "y", context: "flight", view: "cockpit" }),
		).toEqual([]);
	});

	test("a key moves onto a pad button, which is D12's whole point", () => {
		// The cross-kind move: #283's arithmetic was that seventeen buttons
		// cannot carry twenty-six letters, and D12 retires the rule without
		// retiring the arithmetic — the trade becomes the player's. A command
		// the pad never reached can be put on the pad.
		const from = shippedTrigger("fly.assist", "key");
		const to = capturedTrigger(press("home"), rest);
		if (to === null) throw new Error("home was not captured");
		const layout = rebind(DEFAULT_BINDINGS, "fly.assist", from, to);
		expect(
			resolvePad(layout, {
				button: "home",
				context: "flight",
				view: "cockpit",
			}),
		).toEqual(["fly.assist"]);
		// And the key it came off no longer reaches it.
		expect(resolveKey(layout, { key: "x", view: "cockpit" })).not.toContain(
			"fly.assist",
		);
	});

	test("a pad button moves onto a key, the other way across", () => {
		const from = shippedTrigger("fly.cruise", "pad-button");
		const layout = rebind(DEFAULT_BINDINGS, "fly.cruise", from, {
			kind: "key",
			key: "8",
		});
		expect(resolveKey(layout, { key: "8", view: "cockpit" })).toEqual([
			"fly.cruise",
		]);
		expect(
			resolvePad(layout, { button: "y", context: "flight", view: "cockpit" }),
		).toEqual([]);
	});

	test("a stick is refused, and the refusal names the reader that is missing", () => {
		// **Not a disagreement with D12 — the half of it that has no reader.**
		// A stick reaches the ship through `padFlightAxes`, which reads fixed
		// positions and not the layout; storing the move would leave a row that
		// prints, satisfies nothing and flies nothing.
		const from = shippedTrigger("fly.cruise", "pad-button");
		const to = capturedTrigger(sticks([0, 0, 1, 0]), rest);
		if (to === null) throw new Error("the stick was not captured");
		expect(() => rebind(DEFAULT_BINDINGS, "fly.cruise", from, to)).toThrow(
			/padFlightAxes/,
		);
	});

	test("so is a trigger, for the same reason and naming the same reader", () => {
		const from = shippedTrigger("fly.cruise", "pad-button");
		const to = capturedTrigger(press("r2"), rest);
		if (to === null) throw new Error("the trigger was not captured");
		expect(() => rebind(DEFAULT_BINDINGS, "fly.cruise", from, to)).toThrow(
			/padFlightAxes/,
		);
	});

	test("and a button *hold*, which is a third reader again", () => {
		// `fight.firePulse` is Square held, and `padFireHeld` is what reads it —
		// a fixed position, like the axes. `resolvePad` answers a press only,
		// and says so.
		const from = shippedTrigger("fly.cruise", "pad-button");
		const to: Trigger = {
			kind: "pad-button",
			button: "home",
			hold: true,
			contexts: ["flight"],
		};
		expect(() => rebind(DEFAULT_BINDINGS, "fly.cruise", from, to)).toThrow(
			/padFireHeld/,
		);
	});

	test("a qualifier is still the command's: a held key may not become a press", () => {
		// Unchanged by any of the above, and the rule the whole table is an
		// extension of — `fly.pitchUp` is flown by *holding* a key, so a `to`
		// that dropped `hold` would store and fly nothing.
		const from = shippedTrigger("fly.pitchUp", "key");
		expect(() =>
			rebind(DEFAULT_BINDINGS, "fly.pitchUp", from, { kind: "key", key: "8" }),
		).toThrow(/qualifiers/);
	});

	test("the captured contexts are the button's and not the caller's", () => {
		// A caller that hands over a `contexts` of its own gets the button's
		// anyway: `Cross` falls through in flight alone, whatever a modal
		// claims about it. The same rule as a key's `hold`.
		const from = shippedTrigger("fly.cruise", "pad-button");
		const layout = rebind(DEFAULT_BINDINGS, "fly.cruise", from, {
			kind: "pad-button",
			button: "a",
			contexts: PAD_CONTEXTS,
		});
		const row = layout.find(
			(b) => b.command === "fly.cruise" && b.trigger.kind === "pad-button",
		);
		expect(row?.trigger).toEqual({
			kind: "pad-button",
			button: "a",
			contexts: ["flight"],
		});
		expect(triggerKey(row?.trigger as Trigger)).toBe("pad:a:press");
	});
});

describe("a pad move survives the trip to disk and back", () => {
	/**
	 * **The half `rebind` cannot hold up on its own.** `binding-store.ts`'s
	 * header said only a key may be stored — refused by `acceptTrigger` and
	 * refused again by `movedTrigger` — and that "S4 lifts both together, in
	 * one change". This is that change, and these rows are why it had to be
	 * one: a lifted `rebind` with an unlifted store is a pad move that is
	 * accepted, flies, and then refuses on reload, with the player told their
	 * saved change "asked for more than moving a key".
	 */
	test("the blob names the button, and the reload flies it", () => {
		const from = DEFAULT_BINDINGS.find(
			(b) => b.command === "fly.cruise" && b.trigger.kind === "pad-button",
		)?.trigger;
		if (!from) throw new Error("fly.cruise has no pad button");
		const to = capturedTrigger(press("home"), rest);
		if (to === null) throw new Error("home was not captured");
		const layout = rebind(DEFAULT_BINDINGS, "fly.cruise", from, to);

		const blob = serializeLayout(layout);
		expect(blob).toContain('"kind":"pad-button"');
		expect(blob).toContain('"button":"home"');

		const read = parseLayout(blob);
		expect(read.notices).toEqual([]);
		expect(
			resolvePad(read.layout, {
				button: "home",
				context: "flight",
				view: "cockpit",
			}),
		).toEqual(["fly.cruise"]);
		expect(
			resolvePad(read.layout, {
				button: "y",
				context: "flight",
				view: "cockpit",
			}),
		).toEqual([]);
	});

	test("a blob that claims its own contexts gets the button's back", () => {
		// The stored set is dropped and re-derived, exactly as a key's code is.
		// Cross falls through in flight alone whatever a hand-written blob says
		// about it, so a widened set cannot make a binding live in a console.
		//
		// **Cross is the button this row has to use, and it is already
		// `dock.launch`'s** — it is the only bound button that falls through in
		// one context, so it is the only one on which a widened set would show.
		// The collision that follows is D5 doing its job on a *loaded* pad
		// move, which is worth a line of its own: it says the predicate reaches
		// a row that came off disk and not only one a rebind just made.
		const read = parseLayout(
			JSON.stringify({
				version: 1,
				moves: [
					{
						command: "fly.cruise",
						from: { kind: "pad-button", button: "y" },
						to: {
							kind: "pad-button",
							button: "a",
							contexts: ["flight", "console", "instrument", "modal"],
						},
					},
				],
			}),
		);
		expect(read.notices.length).toBe(1);
		const warned = read.notices[0];
		expect(warned?.kind).toBe("collision");
		if (warned?.kind === "collision")
			expect(warned.collision.commands.slice().sort()).toEqual([
				"dock.launch",
				"fly.cruise",
			]);
		const row = read.layout.find(
			(b) => b.command === "fly.cruise" && b.trigger.kind === "pad-button",
		);
		expect(row?.trigger).toEqual({
			kind: "pad-button",
			button: "a",
			contexts: ["flight"],
		});
		expect(
			resolvePad(read.layout, {
				button: "a",
				context: "console",
				view: "cockpit",
			}),
		).toEqual([]);
		// And in flight both run, which is what the band says the game does.
		expect(
			resolvePad(read.layout, {
				button: "a",
				context: "flight",
				view: "cockpit",
			}).sort(),
		).toEqual(["dock.launch", "fly.cruise"]);
	});

	test("a stored stick is refused on shape, and names the row", () => {
		// The store's refusal, not the registry's: this module cannot hold a
		// stick's shape at all, and the sentence a player reads is the one
		// `controls-reference.ts` prints for `unreadable-trigger`.
		const read = parseLayout(
			JSON.stringify({
				version: 1,
				moves: [
					{
						command: "fly.cruise",
						from: { kind: "pad-button", button: "y" },
						to: { kind: "pad-stick", stick: "right", axis: "x", half: "+" },
					},
				],
			}),
		);
		expect(read.notices.length).toBe(1);
		const only = read.notices[0];
		expect(only?.kind).toBe("rejected");
		if (only?.kind === "rejected") {
			expect(only.reason).toBe("unreadable-trigger");
			expect(only.command).toBe("fly.cruise");
		}
		// And the layout is otherwise the shipped one.
		expect(
			resolvePad(read.layout, {
				button: "y",
				context: "flight",
				view: "cockpit",
			}),
		).toEqual(["fly.cruise"]);
	});
});

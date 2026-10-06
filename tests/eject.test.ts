/**
 * The eject control (node #703, on #660 D4 and D5): the binding the registry
 * carries, the hold that confirms it, and the states that refuse it.
 *
 * `main.ts` cannot load headless, so `probe-eject.mjs` holds the wiring — the
 * key pressed in flight fires the event, pressed docked is refused on the
 * console. These rows hold the law it wires.
 */
import { describe, expect, test } from "bun:test";
import {
	commandById,
	DEFAULT_BINDINGS,
	type Layout,
	isHeld,
	rebind,
} from "../src/commands";
import type { DockPhase } from "../src/dock-session";
import {
	EJECT_DOCKED_SENTENCE,
	EJECT_HOLD_S,
	EJECT_IDLE,
	EJECT_PHASE_REFUSAL,
	EJECT_REFUSED_TEXT,
	type EjectHold,
	type EjectRefusal,
	ejectArming,
	ejectArmingText,
	ejectRefusal,
	stepEjectHold,
} from "../src/eject";
import type { PadFrame } from "../src/gamepad";
import { ejectPrompt, spoken } from "../src/key-names";
import { ESCAPE_POD, EQUIPMENT } from "../src/market";
import { padEjectHeld } from "../src/pad-bindings"; // glossary-ignore: pad

/** Hold the control for `seconds` in frames of `dt`, under one refusal. */
function hold(
	seconds: number,
	refusal: EjectRefusal | null = null,
	dt = 1 / 60,
	from: EjectHold = EJECT_IDLE,
) {
	let state = from;
	const events: string[] = [];
	for (let t = 0; t < seconds - 1e-9; t += dt) {
		const step = stepEjectHold(state, true, dt, refusal);
		state = step.hold;
		if (step.event)
			events.push(
				step.event.kind === "eject" ? "eject" : `refused:${step.event.refusal}`,
			);
	}
	return { state, events };
}

describe("the binding table carries the action", () => {
	test("fly.eject is a held Backspace and a held Home, in the fly group", () => {
		const eject = commandById("fly.eject");
		expect(eject.group).toBe("fly");
		expect(eject.rebindable).toBe(true);
		const rows = DEFAULT_BINDINGS.filter((b) => b.command === "fly.eject").map(
			// glossary-ignore: Command
			(b) => b.trigger,
		);
		expect(rows).toContainEqual({ kind: "key", key: "backspace", hold: true });
		const pad = rows.find((t) => t.kind === "pad-button"); // glossary-ignore: pad
		expect(pad).toMatchObject({
			// glossary-ignore: pad
			kind: "pad-button", // glossary-ignore: pad
			button: "home",
			hold: true,
		});
		// Every trigger the command has is a hold: a press anywhere would be a // glossary-ignore: Command
		// stray press that costs the hold, which is what the confirm refuses.
		expect(
			rows.every((t) => "hold" in t && (t as { hold?: true }).hold === true),
		).toBe(true);
	});

	test("the key is held through the layout in force, so a rebind moves it", () => {
		const held = (layout: Layout, key: string) =>
			isHeld(layout, "fly.eject", new Set([key]), "cockpit");
		expect(held(DEFAULT_BINDINGS, "backspace")).toBe(true);
		const moved = rebind(
			DEFAULT_BINDINGS,
			"fly.eject",
			{ kind: "key", key: "backspace", hold: true },
			{ kind: "key", key: "8", hold: true },
		);
		expect(held(moved, "backspace")).toBe(false);
		expect(held(moved, "8")).toBe(true);
	});

	test("the controls help names it, from the layout in force (D9, D12)", () => {
		expect(ejectPrompt(DEFAULT_BINDINGS)).toBe("hold Backspace to eject");
		const moved = rebind(
			DEFAULT_BINDINGS,
			"fly.eject",
			{ kind: "key", key: "backspace", hold: true },
			{ kind: "key", key: "8", hold: true },
		);
		expect(ejectPrompt(moved)).toBe("hold 8 to eject");
		expect(ejectPrompt(moved)).toContain(spoken(moved, "fly.eject"));
	});

	test("the pad's Home is live where a press can be refused, and not under a modal", () => {
		// glossary-ignore: pad
		const frame = (held: string[]): PadFrame => ({
			connected: true,
			id: "test",
			axes: { leftX: 0, leftY: 0, rightX: 0, rightY: 0 },
			values: {} as PadFrame["values"],
			held: new Set(held) as PadFrame["held"],
			pressed: new Set(),
			released: new Set(),
		});
		expect(padEjectHeld(frame(["home"]), "flight")).toBe(true);
		expect(padEjectHeld(frame(["home"]), "instrument")).toBe(true);
		// Docked, the pad's context is `console`: without this the docked // glossary-ignore: pad
		// refusal could not be reached from a pad at all. // glossary-ignore: pad
		expect(padEjectHeld(frame(["home"]), "console")).toBe(true);
		expect(padEjectHeld(frame(["home"]), "modal")).toBe(false);
		expect(padEjectHeld(frame(["home"]), "capture")).toBe(false);
		expect(padEjectHeld(frame(["x"]), "flight")).toBe(false);
		expect(padEjectHeld(null, "flight")).toBe(false);
	});

	test("the pod the refusal reads is the row the shop sells", () => {
		expect(EQUIPMENT.map((e) => e.name)).toContain(ESCAPE_POD);
	});
});

describe("the binding table carries the refusal states (#660 D5)", () => {
	test("every dock phase but flight refuses", () => {
		const phases: DockPhase[] = ["flying", "arriving", "docked", "launching"];
		expect(phases.map((p) => EJECT_PHASE_REFUSAL[p])).toEqual([
			null,
			"arriving",
			"docked",
			"launching",
		]);
	});

	test("in flight it is refused only without a pod", () => {
		expect(ejectRefusal({ phase: "flying", podFitted: true })).toBeNull();
		expect(ejectRefusal({ phase: "flying", podFitted: false })).toBe("no-pod");
	});

	test("the phase is said before the pod: docked is docked whatever is fitted", () => {
		for (const podFitted of [true, false]) {
			expect(ejectRefusal({ phase: "docked", podFitted })).toBe("docked");
			expect(ejectRefusal({ phase: "arriving", podFitted })).toBe("arriving");
			expect(ejectRefusal({ phase: "launching", podFitted })).toBe("launching");
		}
	});

	test("every refusal has its own words, and the docked one a console sentence", () => {
		const texts = Object.values(EJECT_REFUSED_TEXT);
		expect(new Set(texts).size).toBe(texts.length);
		for (const text of texts) expect(text).toMatch(/^CANNOT EJECT {2}\S/);
		expect(EJECT_DOCKED_SENTENCE.toLowerCase()).toContain("docked");
	});
});

describe("the hold is the confirm", () => {
	test("a tap shorter than the hold does nothing", () => {
		const tap = hold(0.2);
		expect(tap.events).toEqual([]);
		// And letting go forgets it: two taps are not one hold.
		const released = stepEjectHold(tap.state, false, 1 / 60, null).hold;
		expect(released).toEqual(EJECT_IDLE);
		expect(hold(0.2, null, 1 / 60, released).events).toEqual([]);
	});

	test("held past the threshold it fires exactly once", () => {
		const long = hold(EJECT_HOLD_S * 3);
		expect(long.events).toEqual(["eject"]);
		expect(long.state.spent).toBe(true);
		// Fires on the frame the hold completes, not a frame early.
		expect(hold(EJECT_HOLD_S - 0.05).events).toEqual([]);
		expect(hold(EJECT_HOLD_S + 0.05).events).toEqual(["eject"]);
	});

	test("a refusal is said at once, needs no hold, and is said once", () => {
		const docked = hold(1 / 60, "docked");
		expect(docked.events).toEqual(["refused:docked"]);
		expect(hold(EJECT_HOLD_S * 2, "docked").events).toEqual(["refused:docked"]);
	});

	test("a hold that began refused never arms, even when the refusal clears", () => {
		// On the launch rails, then flying with the key still down: the launch
		// completing under a held key must not eject a pilot just told no.
		const refused = hold(0.1, "launching");
		expect(refused.events).toEqual(["refused:launching"]);
		const cleared = hold(EJECT_HOLD_S * 2, null, 1 / 60, refused.state);
		expect(cleared.events).toEqual([]);
		expect(ejectArming(cleared.state)).toBeNull();
		// Let go and press again, and it arms.
		const again = stepEjectHold(cleared.state, false, 1 / 60, null).hold;
		expect(hold(EJECT_HOLD_S * 2, null, 1 / 60, again).events).toEqual([
			"eject",
		]);
	});

	test("arming is shown for every frame the hold is filling", () => {
		expect(ejectArming(EJECT_IDLE)).toBeNull();
		const half = hold(EJECT_HOLD_S / 2).state;
		const share = ejectArming(half);
		expect(share).not.toBeNull();
		expect(share as number).toBeGreaterThan(0.4);
		expect(share as number).toBeLessThan(0.6);
		expect(ejectArmingText(0)).toBe("HOLD TO EJECT  □□□□□");
		expect(ejectArmingText(0.5)).toBe("HOLD TO EJECT  ■■□□□");
		expect(ejectArmingText(1)).toBe("HOLD TO EJECT  ■■■■■");
		// Spent is not arming: after the eject the line has nothing to fill.
		expect(ejectArming(hold(EJECT_HOLD_S * 2).state)).toBeNull();
	});

	test("the hold fits inside D12's second of reaction, with room to see it", () => {
		// #660 D12 derives the warning from about one second of reaction, and
		// node #704 adds this hold to that budget. A hold near a second would
		// be most of it; one under a fifth would be a tap.
		expect(EJECT_HOLD_S).toBeGreaterThan(0.2);
		expect(EJECT_HOLD_S).toBeLessThan(1);
	});
});

/**
 * The keyboard's dispatch law (#377): what a key event may reach.
 *
 * The four rulings, one describe each. The shape that hid the hole this node
 * closes is a *held* chord — a repeat of `Alt+D` got past a guard written for a
 * press — so every chord row is run twice, pressed and held.
 */
import { describe, expect, test } from "bun:test";
import { ALT_CHORDS, keyDispatch } from "../src/key-dispatch";
import { codeOf } from "./lib/source-scan";

const press = (key: string, code: string, mods: Partial<KeyMods> = {}) =>
	keyDispatch({ key, code, down: true, repeat: false, ...NONE, ...mods });
const hold = (key: string, code: string, mods: Partial<KeyMods> = {}) =>
	keyDispatch({ key, code, down: true, repeat: true, ...NONE, ...mods });
const release = (key: string, code: string, mods: Partial<KeyMods> = {}) =>
	keyDispatch({ key, code, down: false, repeat: false, ...NONE, ...mods });

interface KeyMods {
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	editable: boolean;
}
const NONE: KeyMods = {
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	editable: false,
};
const ALT = { altKey: true };

describe("a chord is one-shot, and never a held key", () => {
	test("a pressed Alt+D is swallowed", () => {
		expect(press("d", "KeyD", ALT)).toEqual({ kind: "swallow", prevent: true });
	});

	test("a held Alt+D is swallowed too — the repeat that yawed the ship", () => {
		expect(hold("d", "KeyD", ALT)).toEqual({ kind: "swallow", prevent: true });
	});

	test("a bound chord acts on its first press", () => {
		expect(press("arrowleft", "ArrowLeft", ALT)).toEqual({
			kind: "chord",
			key: ALT_CHORDS.ArrowLeft,
		});
	});

	test("and its repeats are swallowed, but still kept from the page", () => {
		// A held Alt+← is browser history on Windows and Linux; swallowing the
		// command must not hand the key back to the browser.
		expect(hold("arrowleft", "ArrowLeft", ALT)).toEqual({
			kind: "swallow",
			prevent: true,
		});
	});
});

describe("the chord table is keyed on the physical key", () => {
	test("macOS Option changes the character and not the code", () => {
		// Option+D types ∂. A table on `e.key` would never see `d` there.
		// An unbound chord is kept from the browser too: on Windows and Linux
		// Alt+D focuses the address bar (sage round 3 on #391).
		expect(press("∂", "KeyD", ALT)).toEqual({ kind: "swallow", prevent: true });
		expect(press("arrowright", "ArrowRight", ALT)).toEqual({
			kind: "chord",
			key: ALT_CHORDS.ArrowRight,
		});
	});

	test("today's table is the three head-look arrows", () => {
		expect(ALT_CHORDS).toEqual({
			ArrowLeft: "1",
			ArrowUp: "2",
			ArrowRight: "3",
		});
	});
});

describe("Ctrl runs no command, and Meta reaches nothing", () => {
	test("Ctrl+J is held but runs no command — cruise does not start", () => {
		expect(press("j", "KeyJ", { ctrlKey: true })).toEqual({
			kind: "key",
			key: "j",
			commands: false,
			oneShot: false,
			prevent: true,
		});
	});

	test("keys pressed while braking on Ctrl still fly and fire", () => {
		// Ctrl is THROTTLE_DOWN: the principal's refinement of ruling 3 on
		// #377 keeps steering and the trigger alive while it is held.
		// And each is kept from the browser: Ctrl+D is the bookmark dialog and
		// Ctrl+S the save dialog (sage round 3 on #391).
		for (const [key, code] of [
			["w", "KeyW"],
			["d", "KeyD"],
			["ArrowLeft", "ArrowLeft"],
			[" ", "Space"],
		])
			expect(press(key, code, { ctrlKey: true })).toMatchObject({
				kind: "key",
				key: key.toLowerCase(),
				commands: false,
				oneShot: false,
				prevent: true,
			});
	});

	test("Meta+R is swallowed", () => {
		expect(press("r", "KeyR", { metaKey: true })).toEqual({ kind: "swallow" });
	});

	test("Ctrl pressed alone is still the throttle", () => {
		// The Control key's own keydown carries ctrlKey: true.
		expect(press("control", "ControlLeft", { ctrlKey: true })).toEqual({
			kind: "key",
			key: "control",
			commands: true,
			oneShot: true,
			prevent: false,
		});
		expect(hold("control", "ControlLeft", { ctrlKey: true })).toEqual({
			kind: "key",
			key: "control",
			commands: true,
			oneShot: false,
			prevent: false,
		});
	});
});

describe("the ordinary path", () => {
	test("a plain key is held, and fires its command once", () => {
		expect(press("w", "KeyW")).toEqual({
			kind: "key",
			key: "w",
			commands: true,
			oneShot: true,
			prevent: false,
		});
		expect(hold("w", "KeyW")).toEqual({
			kind: "key",
			key: "w",
			commands: true,
			oneShot: false,
			prevent: false,
		});
	});

	test("? is the character, not a Shift chord", () => {
		expect(press("?", "Slash")).toEqual({
			kind: "key",
			key: "?",
			commands: true,
			oneShot: true,
			prevent: false,
		});
	});

	test("F1 reaches the dispatch, and is kept from the browser's help", () => {
		expect(press("F1", "F1")).toEqual({
			kind: "key",
			key: "f1",
			commands: true,
			oneShot: true,
			prevent: true,
		});
	});

	test("arrows and Space are kept from scrolling the page", () => {
		expect(press("ArrowUp", "ArrowUp")).toMatchObject({ prevent: true });
		expect(press(" ", "Space")).toMatchObject({ prevent: true });
	});

	test("a release clears the key it names, whatever is held with it", () => {
		// What it cannot do is clear a key whose release names another
		// character: on macOS a key released under Option reports that
		// character (`∂` for D), and `d` stays held. That is #390.
		for (const mods of [
			NONE,
			{ ...NONE, altKey: true },
			{ ...NONE, ctrlKey: true },
		])
			expect(
				keyDispatch({
					key: "d",
					code: "KeyD",
					down: false,
					repeat: false,
					...mods,
				}),
			).toEqual({ kind: "release", key: "d" });
	});
});

/**
 * A key typed into a field is the field's (#380).
 *
 * The cockpit holds two live text fields — the Navigation filter and the
 * chart's FIND SYSTEM — and a keyboard is the only thing that can type in
 * either, because the pad's cursor walks past both. So typing `cargo` must not
 * request clearance on `c`, cycle the target on `g`, or hold `a` as roll.
 */
describe("a key typed into a field reaches only the field", () => {
	const typed = (key: string, code: string, mods: Partial<KeyMods> = {}) =>
		press(key, code, { editable: true, ...mods });

	test("every letter of a word is swallowed, and left to the field", () => {
		// Not prevented: the field has to receive the character.
		for (const [key, code] of [
			["c", "KeyC"],
			["a", "KeyA"],
			["r", "KeyR"],
			["g", "KeyG"],
			["o", "KeyO"],
		])
			expect(typed(key, code)).toEqual({ kind: "swallow" });
	});

	test("so are Space, the digits and the arrows, which the field edits with", () => {
		// Space would fire and the arrows would fly; `1`–`3` would turn the head
		// away from the very console the field is on.
		for (const [key, code] of [
			[" ", "Space"],
			["1", "Digit1"],
			["3", "Digit3"],
			["ArrowLeft", "ArrowLeft"],
			["ArrowUp", "ArrowUp"],
			["F1", "F1"],
		])
			expect(typed(key, code)).toEqual({ kind: "swallow" });
	});

	test("a held key in a field is swallowed too, repeat after repeat", () => {
		expect(hold("e", "KeyE", { editable: true })).toEqual({ kind: "swallow" });
	});

	test("a chord or a Ctrl key in a field reaches nothing either", () => {
		// The field's own shortcuts — Alt+← by word, Ctrl+A to select — are the
		// browser's there, so none of them is prevented.
		expect(typed("ArrowLeft", "ArrowLeft", { altKey: true })).toEqual({
			kind: "swallow",
		});
		expect(typed("a", "KeyA", { ctrlKey: true })).toEqual({
			kind: "swallow",
		});
		expect(typed("control", "ControlLeft", { ctrlKey: true })).toEqual({
			kind: "swallow",
		});
	});

	test("a release in a field still clears the key it names", () => {
		// A key held in flight and released after a click into the field must
		// not stay held: ruling 1 comes first.
		expect(release("d", "KeyD", { editable: true })).toEqual({
			kind: "release",
			key: "d",
		});
	});

	test("and the same keys outside a field still fly — the row above can fail", () => {
		expect(press("g", "KeyG")).toMatchObject({ kind: "key", oneShot: true });
		expect(press(" ", "Space")).toMatchObject({ kind: "key", prevent: true });
	});
});

/**
 * The wiring, read off the source (sage round 1 on #391).
 *
 * The catalogue derives its Alt rows from `ALT_CHORDS`, so a check that those
 * rows are in the table holds by construction. What can break is `main.ts`
 * acting on the route — and `main.ts` cannot load headless — so its branches
 * are read as text. The browser probe holds the behaviour; this row makes a
 * dropped call a red `npm test`, which CI runs and the probe does not.
 */
describe("main.ts acts on the route", () => {
	const main = codeOf("src/main.ts");
	const branch = (kind: string) => {
		const at = main.indexOf(`if (route.kind === "${kind}") {`);
		if (at === -1) return null;
		return main.slice(at, main.indexOf("\n\t\t}", at));
	};

	test("onKey asks the law", () => {
		expect(main).toContain("keyDispatch({");
	});

	test("and tells it whether the key was typed into a field (#380)", () => {
		expect(main).toContain("editable: isEditable(e.target),");
	});

	test("a chord runs its key's command, in the cockpit", () => {
		const chord = branch("chord");
		expect(chord).toContain(
			'if (this.view === "cockpit") this.command(route.key);',
		);
		expect(chord).toContain("e.preventDefault();");
	});

	test("a release deletes the key, and a swallow reaches nothing", () => {
		expect(branch("release")).toContain("this.keys.delete(route.key);");
		const swallow = branch("swallow") ?? "";
		expect(swallow).not.toContain("this.keys.add");
		expect(swallow).not.toContain("this.command(");
	});
});

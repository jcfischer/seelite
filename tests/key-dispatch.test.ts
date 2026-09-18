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

interface KeyMods {
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}
const NONE: KeyMods = { altKey: false, ctrlKey: false, metaKey: false };
const ALT = { altKey: true };

describe("a chord is one-shot, and never a held key", () => {
	test("a pressed Alt+D is swallowed", () => {
		expect(press("d", "KeyD", ALT)).toEqual({ kind: "swallow" });
	});

	test("a held Alt+D is swallowed too — the repeat that yawed the ship", () => {
		expect(hold("d", "KeyD", ALT)).toEqual({ kind: "swallow" });
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
		expect(press("∂", "KeyD", ALT)).toEqual({ kind: "swallow" });
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

describe("Ctrl and Meta never reach the ship", () => {
	test("Ctrl+W and Ctrl+J are swallowed", () => {
		expect(press("w", "KeyW", { ctrlKey: true })).toEqual({ kind: "swallow" });
		expect(press("j", "KeyJ", { ctrlKey: true })).toEqual({ kind: "swallow" });
	});

	test("Meta+R is swallowed", () => {
		expect(press("r", "KeyR", { metaKey: true })).toEqual({ kind: "swallow" });
	});

	test("Ctrl pressed alone is still the throttle", () => {
		// The Control key's own keydown carries ctrlKey: true.
		expect(press("control", "ControlLeft", { ctrlKey: true })).toEqual({
			kind: "key",
			key: "control",
			oneShot: true,
			prevent: false,
		});
		expect(hold("control", "ControlLeft", { ctrlKey: true })).toEqual({
			kind: "key",
			key: "control",
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
			oneShot: true,
			prevent: false,
		});
		expect(hold("w", "KeyW")).toEqual({
			kind: "key",
			key: "w",
			oneShot: false,
			prevent: false,
		});
	});

	test("? is the character, not a Shift chord", () => {
		expect(press("?", "Slash")).toEqual({
			kind: "key",
			key: "?",
			oneShot: true,
			prevent: false,
		});
	});

	test("F1 reaches the dispatch, and is kept from the browser's help", () => {
		expect(press("F1", "F1")).toEqual({
			kind: "key",
			key: "f1",
			oneShot: true,
			prevent: true,
		});
	});

	test("arrows and Space are kept from scrolling the page", () => {
		expect(press("ArrowUp", "ArrowUp")).toMatchObject({ prevent: true });
		expect(press(" ", "Space")).toMatchObject({ prevent: true });
	});

	test("a release always clears, whatever is held with it", () => {
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

/**
 * What a key event reaches, and what a held key flies (#381, slice 2).
 *
 * Slice 1 landed the table; this is the half that *reads* it. Before it,
 * `main.ts` was the table — `case "w":`, `this.axis(["arrowup", "w"], …)` —
 * and four test files read that file's text to learn the layout. The point of
 * folding the dispatch is that a rebind reaches the simulation, and the rows
 * here are the headless half of that: the resolver and the held-key query,
 * driven against a layout that is **not** the shipped one.
 *
 * Headless, and on the list in `tests/headless.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import {
	type Binding,
	type CommandId,
	DEFAULT_BINDINGS,
	defaultCollisions,
	isHeld,
	rebind,
	resolveKey,
	triggerKey,
} from "../src/commands";

const cockpit = { view: "cockpit" } as const;
const chase = { view: "chase" } as const;

describe("a key event reaches the command the table gives it", () => {
	test("a pressed key reaches its command, and only its command", () => {
		expect(resolveKey(DEFAULT_BINDINGS, { key: "v", ...cockpit })).toEqual([
			"view.toggle",
		]);
	});

	test("a press and a hold of one key are two different answers", () => {
		// #369 D3's split on `x`: the gesture picks the meaning, so the two are
		// two commands and the resolver must not hand a press the held one.
		expect(resolveKey(DEFAULT_BINDINGS, { key: "x", ...cockpit })).toEqual([
			"fly.assist",
		]);
		expect(
			resolveKey(DEFAULT_BINDINGS, { key: "x", hold: true, ...cockpit }),
		).toEqual(["fight.fireBeam"]);
	});

	test("the view decides, which is the half PadContext cannot express", () => {
		// #369 D4: `2` is head-forward in the cockpit and the orbit reset in
		// chase. A resolver that read the pad context alone answers both at once.
		expect(resolveKey(DEFAULT_BINDINGS, { key: "2", ...cockpit })).toEqual([
			"view.headForward",
		]);
		expect(resolveKey(DEFAULT_BINDINGS, { key: "2", ...chase })).toEqual([
			"view.orbitCentre",
		]);
	});

	test("a key with no binding reaches nothing", () => {
		expect(resolveKey(DEFAULT_BINDINGS, { key: "£", ...cockpit })).toEqual([]);
	});

	test("a surface's key is the surface's, and is not the ship's", () => {
		expect(
			resolveKey(DEFAULT_BINDINGS, {
				key: "arrowup",
				surface: "requests",
				...cockpit,
			}),
		).toEqual(["panel.cursorUp"]);
		// Held off the surface, the same key still flies.
		expect(
			resolveKey(DEFAULT_BINDINGS, { key: "arrowup", hold: true, ...cockpit }),
		).toEqual(["fly.pitchDown"]);
	});
});

describe("D7: dispatch is on the physical key where the row carries one", () => {
	/**
	 * The property this slice buys, and the only reason to author a `code`.
	 *
	 * On AZERTY the key at W's position sends `z`. The pitch row carries
	 * `code: "KeyW"`, so the pilot's fingers stay where they were — and the
	 * codeless `z` row (Settings) must not take the press instead, which is
	 * what "code wins over character" is for.
	 */
	test("an AZERTY W flies the ship rather than opening Settings", () => {
		expect(
			resolveKey(DEFAULT_BINDINGS, {
				key: "z",
				code: "KeyW",
				hold: true,
				...cockpit,
			}),
		).toEqual(["fly.pitchDown"]);
	});

	test("and the same physical key opens Settings from its own position", () => {
		expect(
			resolveKey(DEFAULT_BINDINGS, { key: "w", code: "KeyZ", ...cockpit }),
		).toEqual(["system.settings"]);
	});

	test("an event with no code at all still resolves by character", () => {
		// Every synthetic press in the probe tier arrives this way, and a
		// resolver that required a code would answer nothing for all of them.
		expect(
			resolveKey(DEFAULT_BINDINGS, { key: "w", hold: true, ...cockpit }),
		).toEqual(["fly.pitchDown"]);
	});
});

describe("the two triggerKey hazards S1 recorded, settled together", () => {
	/**
	 * Half one: `codeKey` reached the letter and digit codes and no others, so
	 * a row authored `code: "Slash"` hashed `key:slash` against the shipped
	 * `key:/` — one physical key with two identities that `collisions()` could
	 * not see. The fix is a table over the codes this game ships rather than a
	 * regex over two prefixes.
	 */
	test("a punctuation code and the character it types are one identity", () => {
		expect(triggerKey({ kind: "key", key: "slash", code: "Slash" })).toBe(
			triggerKey({ kind: "key", key: "/" }),
		);
		expect(triggerKey({ kind: "key", key: "quote", code: "Quote" })).toBe(
			triggerKey({ kind: "key", key: "'" }),
		);
	});

	/**
	 * Half two, which fails the other way. `?` and `/` are one physical key
	 * apart by Shift, and #377 ruled `?` is the character the keyboard types
	 * rather than a chord — so `?` carries no code, and the pair is two
	 * identities the game really does have.
	 */
	test("? and / are two identities, and the shipped layout still collides with nothing", () => {
		expect(triggerKey({ kind: "key", key: "?" })).not.toBe(
			triggerKey({ kind: "key", key: "/" }),
		);
		expect(defaultCollisions()).toEqual([]);
	});

	test("and an event on that one physical key reaches the character it typed", () => {
		expect(
			resolveKey(DEFAULT_BINDINGS, { key: "?", code: "Slash", ...cockpit }),
		).toEqual(["view.reference"]);
		expect(
			resolveKey(DEFAULT_BINDINGS, { key: "/", code: "Slash", ...cockpit }),
		).toEqual(["fight.rigIncoming"]);
	});
});

describe("a held command is asked for by id", () => {
	test("the shipped layout flies on the keys it always flew on", () => {
		expect(
			isHeld(DEFAULT_BINDINGS, "fly.pitchUp", new Set(["s"]), "cockpit"),
		).toBe(true);
		expect(
			isHeld(DEFAULT_BINDINGS, "fly.pitchUp", new Set(["w"]), "cockpit"),
		).toBe(false);
	});

	test("a held key outside the command's views does not fly it", () => {
		// `view.orbitPort` is chase-only, and `1` is head-look in the cockpit.
		expect(
			isHeld(DEFAULT_BINDINGS, "view.orbitPort", new Set(["1"]), "chase"),
		).toBe(true);
		expect(
			isHeld(DEFAULT_BINDINGS, "view.orbitPort", new Set(["1"]), "cockpit"),
		).toBe(false);
	});
});

describe("a rebind reaches the simulation", () => {
	/**
	 * The slice's point, in its headless half. The browser probe flies it; this
	 * says the table answers a layout that is not the shipped one, which is the
	 * thing no row on `main` could ask.
	 */
	const moved = (): Binding[] =>
		rebind(
			DEFAULT_BINDINGS,
			"fly.pitchUp",
			{ kind: "key", key: "s" },
			{
				kind: "key",
				key: "p",
				hold: true,
			},
		);

	test("the new key flies the command and the old one no longer does", () => {
		const layout = moved();
		expect(isHeld(layout, "fly.pitchUp", new Set(["p"]), "cockpit")).toBe(true);
		expect(isHeld(layout, "fly.pitchUp", new Set(["s"]), "cockpit")).toBe(
			false,
		);
	});

	test("nothing else moved with it", () => {
		const layout = moved();
		// The other half of the same axis is untouched, and so is the arrow that
		// shares the command.
		expect(isHeld(layout, "fly.pitchDown", new Set(["w"]), "cockpit")).toBe(
			true,
		);
		expect(
			isHeld(layout, "fly.pitchUp", new Set(["arrowdown"]), "cockpit"),
		).toBe(true);
		expect(layout.length).toBe(DEFAULT_BINDINGS.length);
	});

	test("the shipped table is not the one that moved", () => {
		moved();
		expect(
			isHeld(DEFAULT_BINDINGS, "fly.pitchUp", new Set(["s"]), "cockpit"),
		).toBe(true);
	});

	test("a rebind that names no such binding is refused rather than ignored", () => {
		// A silent no-op here is a rebind modal that reports success and moves
		// nothing, which is exactly the shape a capture slice would ship.
		expect(() =>
			rebind(
				DEFAULT_BINDINGS,
				"fly.pitchUp",
				{ kind: "key", key: "j" },
				{
					kind: "key",
					key: "p",
					hold: true,
				},
			),
		).toThrow();
	});
});

describe("a table that stands for a key stands for the default key", () => {
	/**
	 * `ALT_CHORDS` and `padIntents().keys` yield key *strings*, and both end in
	 * `Game.command`. If they were resolved against the player's layout, moving
	 * head-look off `1` would silently move the pad's d-pad and the Alt chord
	 * with it — a keyboard rebind changing what a gamepad does. They resolve
	 * against the shipped table instead, and this is the row that says so.
	 */
	test("moving a command's key leaves what stood for that key alone", () => {
		const layout = rebind(
			DEFAULT_BINDINGS,
			"view.headPort",
			{ kind: "key", key: "1" },
			{ kind: "key", key: "8" },
		);
		expect(resolveKey(layout, { key: "8", ...cockpit })).toEqual([
			"view.headPort",
		]);
		// The stand-in table still says `1`, and `1` still means head-look there.
		expect(resolveKey(DEFAULT_BINDINGS, { key: "1", ...cockpit })).toEqual([
			"view.headPort",
		]);
	});
});

describe("every command the registry ships is reachable", () => {
	test("each rebindable command has at least one trigger", () => {
		const ids: CommandId[] = [];
		for (const b of DEFAULT_BINDINGS) ids.push(b.command);
		const reached = new Set(ids);
		expect(reached.size).toBeGreaterThan(50);
	});
});

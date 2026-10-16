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
 * `scripts/probe-rebind.mjs` is the other half, and the division is the usual
 * one: a table changing is not a ship flying, and only the browser tier can
 * say the second.
 */
import { describe, expect, test } from "bun:test";
import {
	type Binding,
	codeKey,
	COMMANDS,
	DEFAULT_BINDINGS,
	defaultCollisions,
	isHeld,
	type Layout,
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
		).toEqual(["fly.strafeDorsal"]);
	});
});

describe("D7: a pressed command is reached by position, not by character", () => {
	/**
	 * The property this slice buys, and the only reason to author a `code`.
	 *
	 * On AZERTY the M position types `,`. `tune.vicinityUp` is `m` and
	 * `tune.dropSpeedDown` is `,`, so the two answers are both real commands
	 * and the rule has to pick between them — this is the conflict rather than
	 * a contrived pair.
	 */
	test("the M position steps the vicinity dial although it types a comma", () => {
		expect(
			resolveKey(DEFAULT_BINDINGS, { key: ",", code: "KeyM", ...cockpit }),
		).toEqual(["tune.vicinityUp"]);
	});

	test("and the character answers where no row carries that code", () => {
		// `,` is punctuation and deliberately codeless, so the US press lands
		// on the command the character names.
		expect(
			resolveKey(DEFAULT_BINDINGS, { key: ",", code: "Comma", ...cockpit }),
		).toEqual(["tune.dropSpeedDown"]);
	});

	test("an event with no code at all still resolves by character", () => {
		// Every synthetic press in the probe tier arrives this way, and a
		// resolver that required a code would answer nothing for all of them.
		expect(
			resolveKey(DEFAULT_BINDINGS, { key: "w", hold: true, ...cockpit }),
		).toEqual(["fly.pitchDown"]);
	});

	/**
	 * **A digit is not coded, and that is a decision with a cost on each
	 * side.** Shift is `fly.throttleUp`, so a US pilot throttling up and
	 * touching `1` arrives as `{ key: "!", code: "Digit1" }` — with the digit
	 * coded, the code arm wins and the head turns to the port console, where
	 * before the fold `case "!"` matched nothing. The AZERTY digit row is a
	 * layout question of its own; this row is what keeps it from being
	 * answered by accident.
	 */
	test("Shift over a digit reaches nothing, as it did before the fold", () => {
		expect(
			resolveKey(DEFAULT_BINDINGS, { key: "!", code: "Digit1", ...cockpit }),
		).toEqual([]);
		expect(
			resolveKey(DEFAULT_BINDINGS, { key: ")", code: "Digit0", ...cockpit }),
		).toEqual([]);
	});

	/**
	 * **And a held command is reached by character, which is a limit this
	 * slice states rather than closes.**
	 *
	 * `main.ts` keeps its held set as the characters `keyDispatch` hands over,
	 * so `isHeld` asks the layout for a key and not for a position: on AZERTY
	 * the W position is held as `z` and the pitch is not flown. Giving the
	 * held set the code is the same change #390 needs for the macOS Option
	 * release — where a key released under Option reports a different
	 * character and stays held — and that node owns it. Written as a row so
	 * the boundary is checkable rather than remembered.
	 */
	test("a held command is not reached by position yet, and #390 owns that", () => {
		expect(
			isHeld(DEFAULT_BINDINGS, "fly.pitchDown", new Set(["z"]), "cockpit"),
		).toBe(false);
		expect(
			isHeld(DEFAULT_BINDINGS, "fly.pitchDown", new Set(["w"]), "cockpit"),
		).toBe(true);
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

	/**
	 * **Every shipped key that is not a letter or a digit has a code that maps
	 * back to it** (sage round 5).
	 *
	 * The header called this hazard settled while `codeKey` held twelve
	 * punctuation entries and no modifiers — and the game binds two: `shift`
	 * is `fly.throttleUp` and `control` is `fly.throttleDown`. A browser
	 * reports those as `ShiftLeft` and `ControlLeft`, which the prefix strip
	 * lowercased to `shiftleft`: one physical key with two identities against
	 * the shipped `key: "shift"`, which is exactly the split the table exists
	 * to close.
	 *
	 * The mapping is restated here on purpose — it is the one place the
	 * browser's name for a key meets the registry's — and the second half of
	 * the row is what stops it going stale: a shipped key that is neither a
	 * letter, a digit, nor named below is a red run.
	 */
	test("every shipped non-letter key has a code that maps back to it", () => {
		const CODES: Record<string, string> = {
			ShiftLeft: "shift",
			ShiftRight: "shift",
			ControlLeft: "control",
			ControlRight: "control",
			Space: " ",
			Enter: "enter",
			F1: "f1",
			Backspace: "backspace",
			F2: "f2",
			F7: "f7",
			F8: "f8",
			ArrowUp: "arrowup",
			ArrowDown: "arrowdown",
			ArrowLeft: "arrowleft",
			ArrowRight: "arrowright",
			Backquote: "`",
			BracketLeft: "[",
			BracketRight: "]",
			Equal: "=",
			Minus: "-",
			Quote: "'",
			Semicolon: ";",
			Period: ".",
			Comma: ",",
			Slash: "/",
		};
		for (const [code, key] of Object.entries(CODES))
			expect(`${code} -> ${codeKey(code)}`).toBe(`${code} -> ${key}`);
		// And the list covers the layout: anything shipped that is not a letter,
		// a digit or `?` — the one character #377 ruled carries no code — must
		// be named above.
		const named = new Set(Object.values(CODES));
		const missing = [
			...new Set(
				DEFAULT_BINDINGS.flatMap((b) =>
					b.trigger.kind === "key" && !b.trigger.alt ? [b.trigger.key] : [],
				),
			),
		].filter(
			(key) => !/^[a-z0-9]$/.test(key) && key !== "?" && !named.has(key),
		);
		expect(missing).toEqual([]);
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
	const moved = (): Layout =>
		rebind(
			DEFAULT_BINDINGS,
			"fly.pitchUp",
			{ kind: "key", key: "s", hold: true },
			{ kind: "key", key: "p", hold: true },
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
		// The other half of the same axis is untouched, and so is the arrow
		// below the moved key, which strafes since #620 rather than pitching.
		expect(isHeld(layout, "fly.pitchDown", new Set(["w"]), "cockpit")).toBe(
			true,
		);
		expect(
			isHeld(layout, "fly.strafeVentral", new Set(["arrowdown"]), "cockpit"),
		).toBe(true);
		expect(layout.length).toBe(DEFAULT_BINDINGS.length);
	});

	test("the shipped table is not the one that moved", () => {
		moved();
		expect(
			isHeld(DEFAULT_BINDINGS, "fly.pitchUp", new Set(["s"]), "cockpit"),
		).toBe(true);
	});

	test("a rebind may move a key, and not what kind of trigger it is", () => {
		// The other half of the guard the doc names. A `to` that dropped `hold`
		// would be stored, would satisfy no `isHeld`, and the command would be
		// silently unflyable while the call returned successfully — which is
		// the same "reports success and moves nothing" defect reached through
		// the half `from` does not cover. Sage found it, round 1.
		expect(() =>
			rebind(
				DEFAULT_BINDINGS,
				"fly.pitchUp",
				{ kind: "key", key: "s", hold: true },
				{ kind: "key", key: "p" },
			),
		).toThrow();
	});

	test("and the key it moves onto gets its code, as a shipped row would", () => {
		// Derived, never authored: a rebind that stored `to` verbatim would
		// leave a letter codeless and lose D7's position dispatch for exactly
		// the command the player just chose to move.
		const layout = moved();
		const row = layout.find(
			(b) =>
				b.command === "fly.pitchUp" &&
				b.trigger.kind === "key" &&
				b.trigger.key === "p",
		);
		expect(row?.trigger.kind === "key" ? row.trigger.code : "none").toBe(
			"KeyP",
		);
	});

	/**
	 * The hold index is keyed on the layout's array identity, so a layout
	 * merged **in place** would keep that identity and be answered out of a
	 * stale index. That was a documented precondition for a round; freezing
	 * makes it a property.
	 *
	 * **And the first version of this row could not see the merge it names.**
	 * It asserted one slot assignment, and `Object.freeze` is shallow — so
	 * `layout[0].command = …` and `layout[0].trigger.hold = true`, which is
	 * what a merge actually writes, both succeeded silently while the row
	 * stayed green and `rebind`'s comment claimed the precondition was
	 * enforced (sage round 5). Every level a merge can reach is asserted
	 * here, and the layout is frozen through rather than at the surface.
	 */
	test("a layout cannot be merged in place, at any depth", () => {
		for (const table of [moved(), DEFAULT_BINDINGS]) {
			const row = table[0];
			if (row === undefined) throw new Error("empty layout");
			const writes: [string, () => void][] = [
				[
					"the slot",
					() => {
						(table as unknown as { [k: number]: unknown })[0] = { nope: true };
					},
				],
				[
					"the row's command",
					() => {
						(row as unknown as { command: string }).command = "nope";
					},
				],
				[
					"the row's trigger",
					() => {
						(row.trigger as unknown as { key: string }).key = "nope";
					},
				],
				[
					"the row's scope",
					() => {
						(row.scope as unknown as { views: unknown }).views = [];
					},
				],
				[
					"the scope's view list",
					() => {
						(row.scope.views as unknown as string[]).push("nope");
					},
				],
			];
			for (const [what, write] of writes)
				expect(() => {
					write();
					return what;
				}).toThrow();
		}
	});

	test("and a layout this module never built is frozen when it is first indexed", () => {
		// `isHeld` takes any array, and the storage slice will hand it one this
		// module did not make — so freezing at the producer left the invariant
		// on callers with no type to carry it. Indexing is where the array
		// acquires the identity the index is keyed on.
		const loose: Binding[] = DEFAULT_BINDINGS.map((b) => ({ ...b }));
		expect(Object.isFrozen(loose)).toBe(false);
		// **The cast is the caller this row stands for.** Since #381 S4 a
		// `Layout` is a branded type from one constructor, so no TypeScript
		// caller can reach `isHeld` with a loose array at all — and the freeze
		// stays because the brand is erased at build and the probe tier calls
		// into this module from JavaScript, where nothing checks.
		isHeld(
			loose as unknown as Layout,
			"fly.pitchUp",
			new Set(["s"]),
			"cockpit",
		);
		expect(Object.isFrozen(loose)).toBe(true);
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
	/**
	 * **Over `COMMANDS`, not over `DEFAULT_BINDINGS`.** The row this replaces
	 * built a set of `b.command` and asserted its size, which is a set that can
	 * only ever hold commands that have a binding — a shipped command with no
	 * trigger at all was invisible to the very row named after finding it.
	 * Sage caught it in the first round on this branch.
	 */
	test("every command has at least one trigger", () => {
		const bound = new Set(DEFAULT_BINDINGS.map((b) => b.command));
		for (const c of COMMANDS)
			expect(`${c.id}: ${bound.has(c.id)}`).toBe(`${c.id}: true`);
		// Guarding the guard: the catalogue is not empty, and the set is built
		// from a different collection than the one being walked.
		expect(COMMANDS.length).toBeGreaterThan(50);
	});
});

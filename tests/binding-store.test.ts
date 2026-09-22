/**
 * What a stored layout is allowed to do to the ship (#381, slice 3).
 *
 * `tests/settings.test.ts` asks this question of a preference and the answers
 * are not the same, which is the whole reason this file exists beside that
 * one. A rejected preference costs a display choice and the player finds out
 * by looking at the screen. A rejected *binding* costs a control the player
 * moved on purpose, and a silent fallback leaves them pressing a key that
 * does nothing with nothing on screen saying why — so every refusal here is
 * checked for a notice as well as for the fallback.
 *
 * Three departures from the neighbour are what is actually under test:
 *
 * - the version lives **inside** the blob, because a key-versioned store
 *   discards a layout a player built by hand;
 * - the validator reads a **table**, which `accept()`'s set membership
 *   cannot; and
 * - a rejected row is **named**, not silently dropped.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	LAYOUT_KEY,
	LAYOUT_VERSION,
	type LayoutNotice,
	layoutMoves,
	loadLayout,
	parseLayout,
	saveLayout,
	serializeLayout,
} from "../src/binding-store";
import {
	type Binding,
	type CommandId,
	COMMANDS,
	commandById,
	DEFAULT_BINDINGS,
	rebind,
	type Trigger,
	triggerKey,
} from "../src/commands";
// The sentence a notice prints lives with every other printed control name
// (#369 D11), not in the store — so this file reaches for it where it is
// owned rather than letting the store grow a second formatter.
import { noticeText } from "../src/controls-reference";

/**
 * The real global, so it can be put back — `tests/settings.test.ts`'s reason
 * verbatim, because `bun test` shares one process across files and a file that
 * left a fake `window` behind decides what the next file thinks a browser is.
 */
const realWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

function installStorage(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial));
	(globalThis as unknown as { window: unknown }).window = {
		localStorage: {
			getItem: (k: string) => map.get(k) ?? null,
			setItem: (k: string, v: string) => void map.set(k, v),
		},
	};
	return map;
}

function restoreWindow() {
	if (realWindow) Object.defineProperty(globalThis, "window", realWindow);
	else delete (globalThis as { window?: unknown }).window;
}

/** The shipped trigger a command is authored on, by key. */
const shipped = (command: string, key: string): Trigger => {
	const found = DEFAULT_BINDINGS.find(
		(b) =>
			b.command === command &&
			b.trigger.kind === "key" &&
			b.trigger.key === key,
	);
	if (found === undefined)
		throw new Error(`no shipped ${command} binding on ${key}`);
	return found.trigger;
};

/**
 * Pitch up is flown by holding `s`, and `8` is bound to nothing at all.
 *
 * `scripts/probe-rebind.mjs` picked `8` for the same reason and states it: the
 * shipped layout binds `0` through `3` in the digit row and nothing else, so a
 * pass here cannot be the new key's *other* command answering.
 */
const PITCH_UP: CommandId = "fly.pitchUp";
const PITCH_DOWN: CommandId = "fly.pitchDown";
const FROM = shipped(PITCH_UP, "s");
const TO: Trigger = { kind: "key", key: "8", hold: true, code: "Digit8" };

/** `w` is `fly.pitchDown`'s held key, so moving pitch up onto it collides. */
const ONTO_PITCH_DOWN: Trigger = {
	kind: "key",
	key: "w",
	hold: true,
	code: "KeyW",
};

const moved = rebind(DEFAULT_BINDINGS, PITCH_UP, FROM, TO);

/** A blob with the shape the store writes, but rows the test dictates. */
const blob = (moves: unknown, version: unknown = LAYOUT_VERSION) =>
	JSON.stringify({ version, moves });

const keysOf = (rows: readonly Binding[]) =>
	rows.map((b) => `${b.command} ${triggerKey(b.trigger)}`);

const kinds = (notices: readonly LayoutNotice[]) => notices.map((n) => n.kind);

describe("a layout is stored as what the player changed", () => {
	test("the shipped layout is no moves at all", () => {
		// The blob is a diff, so a player who has never rebound anything stores
		// nothing — and, more to the point, a build that *moves* a default still
		// reaches them. A whole-table blob would pin the old default on disk and
		// the change would never arrive.
		expect(layoutMoves(DEFAULT_BINDINGS)).toEqual([]);
		expect(JSON.parse(serializeLayout(DEFAULT_BINDINGS))).toEqual({
			version: LAYOUT_VERSION,
			moves: [],
		});
	});

	test("one rebind is one move, from the shipped trigger", () => {
		const moves = layoutMoves(moved);
		expect(moves.length).toBe(1);
		expect(moves[0]?.command).toBe(PITCH_UP);
		// `from` is the *shipped* trigger and never an intermediate one, which is
		// what makes "the default moved under this row" exactly one failed
		// `rebind` rather than a history to replay.
		expect(triggerKey(moves[0]?.from as Trigger)).toBe(triggerKey(FROM));
		expect(triggerKey(moves[0]?.to as Trigger)).toBe(triggerKey(TO));
	});

	test("a second rebind of the same row does not grow the blob", () => {
		const again = rebind(moved, PITCH_UP, TO, {
			kind: "key",
			key: "9",
			hold: true,
			code: "Digit9",
		});
		const moves = layoutMoves(again);
		expect(moves.length).toBe(1);
		expect(triggerKey(moves[0]?.from as Trigger)).toBe(triggerKey(FROM));
		expect(moves[0]?.to.kind === "key" && moves[0]?.to.key).toBe("9");
	});

	test("a rebind put back where it came from stores nothing", () => {
		const back = rebind(moved, PITCH_UP, TO, FROM);
		expect(layoutMoves(back)).toEqual([]);
	});

	test("a round trip keeps every row on the trigger it was on", () => {
		const read = parseLayout(serializeLayout(moved));
		expect(read.notices).toEqual([]);
		expect(keysOf(read.layout)).toEqual(keysOf(moved));
		expect(read.source).toBe("player");
	});
});

describe("nothing stored, and nothing readable, fly the shipped layout", () => {
	test("no blob gives the defaults and says so", () => {
		const read = parseLayout(null);
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(read.notices).toEqual([]);
		expect(read.source).toBe("default");
	});

	test.each([
		["not JSON at all", "{not json"],
		["a string where the blob goes", `"layout"`],
		["null", "null"],
		["moves that are not a list", blob({ "fly.pitchUp": "8" })],
	])("%s is refused out loud", (_name, raw) => {
		const read = parseLayout(raw);
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(read.source).toBe("default");
		// Out loud: the settings loader may fall back in silence because a
		// preference is visible on the screen it changes. A layout is not.
		expect(kinds(read.notices)).toContain("unreadable");
	});
});

describe("the version is inside the blob, and an unknown one is not read", () => {
	test("the version the store writes is the one it reads", () => {
		expect(JSON.parse(serializeLayout(moved)).version).toBe(LAYOUT_VERSION);
	});

	test("a version this build does not know leaves the layout alone", () => {
		const raw = blob(JSON.parse(serializeLayout(moved)).moves, 2);
		const read = parseLayout(raw);
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(read.source).toBe("default");
		expect(kinds(read.notices)).toEqual(["version"]);
		expect(noticeText(read.notices[0] as LayoutNotice)).toContain("2");
	});

	test.each([
		["a missing version", JSON.stringify({ moves: [] })],
		["a version that is a string", blob([], "1")],
	])("%s is the same refusal", (_name, raw) => {
		expect(kinds(parseLayout(raw).notices)).toEqual(["version"]);
	});
});

describe("a rejected row costs that row and says which", () => {
	const good = {
		command: PITCH_UP,
		from: FROM,
		to: TO,
	};

	test("one bad row leaves its neighbour flying", () => {
		const raw = blob([
			good,
			{ command: "fly.rollPort", from: { kind: "key" }, to: { key: "k" } },
		]);
		const read = parseLayout(raw);
		// The good move applied.
		expect(keysOf(read.layout)).toEqual(keysOf(moved));
		expect(read.source).toBe("player");
		expect(kinds(read.notices)).toEqual(["rejected"]);
		expect(noticeText(read.notices[0] as LayoutNotice)).toContain(
			commandById("fly.rollPort").name,
		);
	});

	test.each([
		["a command id that is not one", { command: "fly.wiggle" }],
		["a command id that is a number", { command: 7 }],
		["a trigger kind the registry has no row for", { to: { kind: "wheel" } }],
		["a key that is not a string", { to: { kind: "key", key: 8 } }],
		[
			"a surface that is not one",
			{ to: { kind: "key", key: "8", surface: "hold" } },
		],
		[
			"a qualifier that is not `true`",
			{ to: { kind: "key", key: "8", hold: "yes" } },
		],
		// Shape-legal and law-illegal, which is the pair of checks this slice
		// owes: the validator lets it through and `rebind` refuses it, because a
		// qualifier belongs to the command and not to the player. Stored, it
		// would satisfy no `isHeld` and pitch would be silently unflyable.
		[
			"a `to` that drops the command's own hold",
			{ to: { kind: "key", key: "8" } },
		],
	])("%s is rejected by name", (_name, patch) => {
		const read = parseLayout(blob([{ ...good, ...patch }]));
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(kinds(read.notices)).toEqual(["rejected"]);
		expect(noticeText(read.notices[0] as LayoutNotice).length).toBeGreaterThan(
			0,
		);
	});

	test("a `from` no default carries is a rejection, not a silent drop", () => {
		// This is the migration case: a build moved `fly.pitchUp` off `s`, and a
		// blob written before it still says the move started there. The row
		// cannot be applied and the player is told which control it was.
		const raw = blob([
			{ ...good, from: { kind: "key", key: "§", hold: true } },
		]);
		const read = parseLayout(raw);
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(kinds(read.notices)).toEqual(["rejected"]);
		expect(noticeText(read.notices[0] as LayoutNotice)).toContain(
			commandById(PITCH_UP).name,
		);
	});

	test("a non-key rebind is refused here and S4 lifts it", () => {
		const raw = blob([
			{
				command: "fight.firePulse",
				from: { kind: "mouse-button", action: "hold" },
				to: { kind: "mouse-button", action: "click" },
			},
		]);
		const read = parseLayout(raw);
		expect(kinds(read.notices)).toEqual(["rejected"]);
	});

	test("every notice has something a screen can print", () => {
		// Anti-criterion: no refusal path is silent. A notice kind with no text
		// is a rejection the player never hears about, which is the failure this
		// whole slice exists to prevent.
		const raw = blob(
			[
				{ command: "fly.wiggle", from: FROM, to: TO },
				{ ...good, from: { kind: "key", key: "§", hold: true } },
			],
			LAYOUT_VERSION,
		);
		const read = parseLayout(raw);
		expect(read.notices.length).toBe(2);
		for (const n of read.notices)
			expect(noticeText(n).trim().length).toBeGreaterThan(0);
	});
});

describe("a player layout may collide, and is told that it does", () => {
	test("the shipped layout collides with nothing", () => {
		expect(parseLayout(serializeLayout(DEFAULT_BINDINGS)).notices).toEqual([]);
	});

	test("two commands on one held key are named, with where they meet", () => {
		const onto = rebind(DEFAULT_BINDINGS, PITCH_UP, FROM, ONTO_PITCH_DOWN);
		const read = parseLayout(serializeLayout(onto));
		expect(kinds(read.notices)).toEqual(["collision"]);
		const notice = read.notices[0] as LayoutNotice;
		if (notice.kind !== "collision") throw new Error("not a collision");
		expect([...notice.collision.commands].sort()).toEqual(
			[PITCH_UP, PITCH_DOWN].sort(),
		);
		expect(notice.collision.trigger).toBe(triggerKey(ONTO_PITCH_DOWN));
		expect(notice.collision.scope.views.length).toBeGreaterThan(0);
		// The trigger itself as well as its hash, so the sentence can print the
		// key the player pressed rather than the string `collisions()` groups on.
		expect(triggerKey(notice.at)).toBe(triggerKey(ONTO_PITCH_DOWN));
		const text = noticeText(notice);
		expect(text).toContain(commandById(PITCH_UP).name);
		expect(text).toContain(commandById(PITCH_DOWN).name);
	});

	test("a collision is a warning and the layout still loads", () => {
		// D5 is warn and allow. The rows are applied; what the notice buys is
		// that the player is not left wondering why one key does two things.
		const onto = rebind(DEFAULT_BINDINGS, PITCH_UP, FROM, ONTO_PITCH_DOWN);
		const read = parseLayout(serializeLayout(onto));
		expect(keysOf(read.layout)).toEqual(keysOf(onto));
		expect(read.source).toBe("player");
	});
});

describe("the layout handed back cannot be merged in place", () => {
	test("a loaded layout is frozen through", () => {
		// `holdRows` keys its index on the array identity, so a layout written
		// into rather than rebuilt would be answered out of a stale index. The
		// freeze is the enforcement of that precondition and this is the caller
		// S2's header named as the one most likely to break it.
		const read = parseLayout(serializeLayout(moved));
		const row = read.layout[0] as Binding;
		expect(() => {
			(read.layout as Binding[])[0] = row;
		}).toThrow();
		expect(() => {
			(row as { command: string }).command = "fly.wiggle";
		}).toThrow();
		expect(() => {
			(row.trigger as { kind: string }).kind = "mouse-move";
		}).toThrow();
	});
});

describe("the browser is a string store that may refuse", () => {
	beforeEach(() => installStorage());
	afterEach(restoreWindow);

	test("a save and a load round-trip through localStorage", () => {
		saveLayout(moved);
		expect(keysOf(loadLayout().layout)).toEqual(keysOf(moved));
	});

	test("the key carries no version, because the blob does", () => {
		const map = installStorage();
		saveLayout(moved);
		expect([...map.keys()]).toEqual([LAYOUT_KEY]);
		expect(LAYOUT_KEY).not.toContain("v1");
	});

	test("a save overwrites a blob this build refused to read", () => {
		// The downgrade case: a newer build wrote version 2, this one refused it
		// and said so, and the next rebind replaces it. Stated because the
		// alternative — preserving an unreadable blob — would make the notice
		// permanent with no way for the player to clear it.
		const map = installStorage({ [LAYOUT_KEY]: blob([], 2) });
		expect(kinds(loadLayout().notices)).toEqual(["version"]);
		saveLayout(moved);
		expect(JSON.parse(map.get(LAYOUT_KEY) as string).version).toBe(
			LAYOUT_VERSION,
		);
	});

	test("a storage that refuses to be read does not stop the game", () => {
		(globalThis as unknown as { window: unknown }).window = {
			get localStorage(): never {
				throw new Error("access denied");
			},
		};
		const read = loadLayout();
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(read.source).toBe("default");
	});

	test("a storage that refuses to be written loses a layout, not a session", () => {
		(globalThis as unknown as { window: unknown }).window = {
			localStorage: {
				getItem: () => null,
				setItem: () => {
					throw new Error("quota");
				},
			},
		};
		expect(() => saveLayout(moved)).not.toThrow();
	});
});

describe("the store speaks the registry's language", () => {
	test("every command a move may name is one the registry holds", () => {
		// The validator reads the shipped catalogue rather than a list of its
		// own, so a command added to `commands.ts` is storable the day it lands
		// and a command removed stops being accepted the same day.
		const ids = new Set(COMMANDS.map((c) => c.id));
		for (const move of layoutMoves(moved))
			expect(ids.has(move.command)).toBe(true);
	});
});

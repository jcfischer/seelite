import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	LAYOUT_KEY,
	LAYOUT_VERSION,
	loadLayout,
	parseLayout,
	saveLayout,
	serializeLayout,
} from "../src/binding-store";

import type { LayoutNotice } from "../src/layout-notice";
import {
	type Binding,
	type CommandId,
	COMMANDS,
	commandById,
	type Layout,
	layoutMoves,
	DEFAULT_BINDINGS,
	rebind,
	type Trigger,
	triggerKey,
} from "../src/commands";

import { noticeText } from "../src/controls-reference";

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

const PITCH_UP: CommandId = "fly.pitchUp";
const PITCH_DOWN: CommandId = "fly.pitchDown";
const FROM = shipped(PITCH_UP, "s");
const unshippedKey = (key: string): string => {
	if (
		DEFAULT_BINDINGS.some(
			(b) => b.trigger.kind === "key" && b.trigger.key === key,
		)
	)
		throw new Error(`the shipped layout binds ${key}`);
	return key;
};
const SPARE_KEY = unshippedKey("8");
const TO: Trigger = { kind: "key", key: SPARE_KEY, hold: true, code: "Digit8" };

const ONTO_PITCH_DOWN = shipped(PITCH_DOWN, "w");

const moved = rebind(DEFAULT_BINDINGS, PITCH_UP, FROM, TO);

const blob = (moves: unknown, version: unknown = LAYOUT_VERSION) =>
	JSON.stringify({ version, moves });

const keysOf = (rows: readonly Binding[]) =>
	rows.map((b) => `${b.command} ${triggerKey(b.trigger)}`);

const kinds = (notices: readonly LayoutNotice[]) => notices.map((n) => n.kind);

function only<K extends LayoutNotice["kind"]>(
	notices: readonly LayoutNotice[],
	kind: K,
): Extract<LayoutNotice, { kind: K }> {
	const found = notices[0];
	if (found === undefined || found.kind !== kind)
		throw new Error(
			`expected one ${kind}, got ${kinds(notices).join(",") || "none"}`,
		);
	return found as Extract<LayoutNotice, { kind: K }>;
}

const inForce = (read: { layout: Layout }) =>
	layoutMoves(read.layout).length > 0 ? "player" : "default";

describe("a layout is stored as what the player changed", () => {
	test("the shipped layout is no moves at all", () => {
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
		expect(inForce(read)).toBe("player");
	});
});

describe("nothing stored, and nothing readable, fly the shipped layout", () => {
	test("no blob gives the defaults and says so", () => {
		const read = parseLayout(null);
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(read.notices).toEqual([]);
		expect(inForce(read)).toBe("default");
	});

	test.each([
		["not JSON at all", "{not json"],
		["a string where the blob goes", `"layout"`],
		["null", "null"],
		["moves that are not a list", blob({ "fly.pitchUp": "8" })],
	])("%s is refused out loud", (_name, raw) => {
		const read = parseLayout(raw);
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(inForce(read)).toBe("default");
		expect(kinds(read.notices)).toContain("unreadable");
	});
});

describe("a string store is not a promise about size", () => {
	test("a blob naming more changes than the game has controls is refused", () => {
		const many = Array.from({ length: DEFAULT_BINDINGS.length + 1 }, () => ({
			command: PITCH_UP,
			from: FROM,
			to: TO,
		}));
		const read = parseLayout(blob(many));
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(kinds(read.notices)).toEqual(["unreadable"]);
	});

	test("and a blob exactly as long as the table is still read", () => {
		const full = Array.from({ length: DEFAULT_BINDINGS.length }, () => ({
			command: PITCH_UP,
			from: FROM,
			to: TO,
		}));
		const read = parseLayout(blob(full));
		expect(keysOf(read.layout)).toEqual(keysOf(moved));
		expect(kinds(read.notices)).not.toContain("unreadable");
	});

	test("a key longer than a key name is refused", () => {
		const read = parseLayout(
			blob([
				{ command: PITCH_UP, from: FROM, to: { ...TO, key: "k".repeat(64) } },
			]),
		);
		expect(kinds(read.notices)).toEqual(["rejected"]);
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
	});

	test("a physical key longer than a key name is refused too", () => {
		const read = parseLayout(
			blob([
				{
					command: PITCH_UP,
					from: FROM,
					to: { ...TO, code: `Key${"K".repeat(64)}` },
				},
			]),
		);
		expect(kinds(read.notices)).toEqual(["rejected"]);
	});

	test("and the longest key the game actually ships is not", () => {
		const longest = DEFAULT_BINDINGS.map((b) =>
			b.trigger.kind === "key" ? b.trigger.key.length : 0,
		).reduce((a, b) => Math.max(a, b), 0);
		const read = parseLayout(
			blob([
				{
					command: PITCH_UP,
					from: FROM,
					to: { ...TO, key: "k".repeat(longest) },
				},
			]),
		);
		expect(read.notices).toEqual([]);
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
		expect(inForce(read)).toBe("default");
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

	test("one bad row leaves the row beside it flying", () => {
		const raw = blob([
			good,
			{ command: "fly.rollPort", from: { kind: "key" }, to: { key: "k" } },
		]);
		const read = parseLayout(raw);
		expect(keysOf(read.layout)).toEqual(keysOf(moved));
		expect(inForce(read)).toBe("player");
		expect(kinds(read.notices)).toEqual(["rejected"]);
		expect(noticeText(read.notices[0] as LayoutNotice)).toContain(
			commandById("fly.rollPort").name,
		);
	});

	test.each([
		[
			"a command id that is not one",
			{ command: "fly.wiggle" },
			"unknown-control",
		],
		["a command id that is a number", { command: 7 }, "unknown-control"],
		[
			"a trigger kind the registry has no row for",
			{ to: { kind: "wheel" } },
			"unreadable-trigger",
		],
		[
			"a surface that is not one",
			{ to: { kind: "key", key: "8", hold: true, surface: "hold" } },
			"unreadable-trigger",
		],
		[
			"a qualifier that is not `true`",
			{ to: { kind: "key", key: "8", hold: "yes" } },
			"unreadable-trigger",
		],
		[
			"a `to` that drops the command's own hold",
			{ to: { kind: "key", key: "8" } },
			"refused-by-registry",
		],
	] as const)("%s is rejected by name", (_name, patch, reason) => {
		const read = parseLayout(blob([{ ...good, ...patch }]));
		expect(only(read.notices, "rejected").reason).toBe(reason);
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(kinds(read.notices)).toEqual(["rejected"]);
		expect(noticeText(read.notices[0] as LayoutNotice).length).toBeGreaterThan(
			0,
		);
	});

	test("a `from` no default carries is a rejection, not a silent drop", () => {
		const raw = blob([
			{ ...good, from: { kind: "key", key: "§", hold: true } },
		]);
		const read = parseLayout(raw);
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(inForce(read)).toBe("default");
		expect(kinds(read.notices)).toEqual(["rejected"]);
		expect(noticeText(read.notices[0] as LayoutNotice)).toContain(
			commandById(PITCH_UP).name,
		);
	});

	test("a second row for one control is not a moved default", () => {
		const raw = blob([good, { ...good, to: { ...TO, key: "9" } }]);
		const read = parseLayout(raw);
		expect(keysOf(read.layout)).toEqual(keysOf(moved));
		const notice = only(read.notices, "rejected");
		expect(notice.reason).toBe("already-changed");
		expect(noticeText(notice)).toContain(commandById(PITCH_UP).name);
	});

	test("and a `from` that never shipped still reads as a moved default", () => {
		const raw = blob([
			{ ...good, from: { kind: "key", key: "\u00a7", hold: true } },
		]);
		const notice = only(parseLayout(raw).notices, "rejected");
		expect(notice.reason).toBe("moved-default");
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

	test("what is printed is a sentence, not the registry's own hash", () => {
		const raw = blob([
			{
				command: "fly.rollPort",
				from: { kind: "key", key: "q", hold: true, code: "KeyQ" },
				to: { kind: "key", key: "k" },
			},
		]);
		const read = parseLayout(raw);
		const notice = only(read.notices, "rejected");
		expect(notice.reason).toBe("refused-by-registry");
		expect(notice.detail).toContain("key:q::hold");
		expect(noticeText(notice)).not.toContain("key:");
		expect(noticeText(notice)).toContain(commandById("fly.rollPort").name);
	});

	test("every notice has something a screen can print", () => {
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

describe("the validator answers what the registry's law cannot", () => {
	const legal = {
		command: PITCH_UP,
		from: FROM,
		to: { kind: "key", key: "8", hold: true },
	};
	const moved8 = rebind(DEFAULT_BINDINGS, PITCH_UP, FROM, {
		kind: "key",
		key: "8",
		hold: true,
	});

	test("a key that is not a string never reaches the layout", () => {
		const read = parseLayout(blob([{ ...legal, to: { ...legal.to, key: 8 } }]));
		expect(only(read.notices, "rejected").reason).toBe("unreadable-trigger");
		expect(kinds(read.notices)).toEqual(["rejected"]);
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
	});

	const storedTrigger = (read: { layout: readonly Binding[] }) =>
		read.layout.find(
			(b) =>
				b.command === PITCH_UP &&
				b.trigger.kind === "key" &&
				b.trigger.hold === true,
		)?.trigger;

	test("a field the registry has no place for is dropped, not carried", () => {
		const read = parseLayout(
			blob([{ ...legal, to: { ...legal.to, contexts: ["console"] } }]),
		);
		expect(read.notices).toEqual([]);
		expect(keysOf(read.layout)).toEqual(keysOf(moved8));
		expect(Object.keys(storedTrigger(read) ?? {})).not.toContain("contexts");
	});

	test("and a legal move stores exactly the fields a key trigger has", () => {
		const read = parseLayout(blob([legal]));
		expect(read.notices).toEqual([]);
		expect(Object.keys(storedTrigger(read) ?? {}).sort()).toEqual([
			"hold",
			"key",
			"kind",
		]);
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
		const notice = only(read.notices, "collision");
		expect([...notice.collision.commands].sort()).toEqual(
			[PITCH_UP, PITCH_DOWN].sort(),
		);
		expect(notice.collision.trigger).toBe(triggerKey(ONTO_PITCH_DOWN));
		expect(notice.collision.scope.views.length).toBeGreaterThan(0);
		expect(triggerKey(notice.at)).toBe(triggerKey(ONTO_PITCH_DOWN));
		const text = noticeText(notice);
		expect(text).toContain(commandById(PITCH_UP).name);
		expect(text).toContain(commandById(PITCH_DOWN).name);
	});

	test("a collision is a warning and the layout still loads", () => {
		const onto = rebind(DEFAULT_BINDINGS, PITCH_UP, FROM, ONTO_PITCH_DOWN);
		const read = parseLayout(serializeLayout(onto));
		expect(keysOf(read.layout)).toEqual(keysOf(onto));
		expect(inForce(read)).toBe("player");
	});
});

describe("the layout handed back cannot be merged in place", () => {
	test("a loaded layout is frozen through", () => {
		const read = parseLayout(serializeLayout(moved));
		const row = read.layout[0] as Binding;
		expect(() => {
			(read.layout as unknown as Binding[])[0] = row;
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
		const map = installStorage({ [LAYOUT_KEY]: blob([], 2) });
		expect(kinds(loadLayout().notices)).toEqual(["version"]);
		saveLayout(moved);
		expect(JSON.parse(map.get(LAYOUT_KEY) as string).version).toBe(
			LAYOUT_VERSION,
		);
	});

	test("a storage that refuses to be read does not stop the game, and says so", () => {
		(globalThis as unknown as { window: unknown }).window = {
			get localStorage(): never {
				throw new Error("access denied");
			},
		};
		const read = loadLayout();
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(inForce(read)).toBe("default");
		expect(kinds(read.notices)).toEqual(["unreadable"]);
	});

	test("a layout that is not this game's is a loud throw, not a failed write", () => {
		installStorage();
		expect(() =>
			saveLayout(DEFAULT_BINDINGS.slice(0, 3) as unknown as Layout),
		).toThrow();
	});

	test("a write that lands says so, because a notice depends on it", () => {
		expect(saveLayout(moved)).toBe(true);
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
		expect(saveLayout(moved)).toBe(false);
	});
});

describe("the store speaks the registry's language", () => {
	test("every command the registry holds is one a blob may name", () => {
		const named = new Set<string>();
		for (const b of DEFAULT_BINDINGS) {
			if (b.trigger.kind !== "key" || named.has(b.command)) continue;
			named.add(b.command);
			const read = parseLayout(
				blob([
					{
						command: b.command,
						from: b.trigger,
						to: { ...b.trigger, key: SPARE_KEY, code: undefined },
					},
				]),
			);
			expect(`${b.command}: ${kinds(read.notices).join(",")}`).toBe(
				`${b.command}: `,
			);
		}
		expect(named.size).toBeGreaterThan(20);
		for (const id of named)
			expect(COMMANDS.some((c) => c.id === id)).toBe(true);
	});
});

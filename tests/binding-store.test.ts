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
 * What is actually under test is the set of departures from that module, and
 * **`binding-store.ts`'s header states them** — a second list here is the
 * third copy this repo's history is about, and it was one for six rounds
 * (sage round 6). The rows below name the one they are about.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	LAYOUT_KEY,
	LAYOUT_VERSION,
	type LayoutNotice,
	loadLayout,
	retiredBySave,
	parseLayout,
	saveLayout,
	serializeLayout,
} from "../src/binding-store";
import {
	type Binding,
	type CommandId,
	COMMANDS,
	commandById,
	layoutMoves,
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

/**
 * One notice, narrowed to the kind the row is about.
 *
 * `if (notice.kind !== "rejected") throw` was written out four times, which is
 * four places to edit when a kind is added and four chances for the message to
 * stop matching the row (sage round 6).
 */
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

/**
 * Which layout is in force, asked of the registry.
 *
 * `LoadedLayout` carried a `source` field saying this, and nothing in the game
 * read it — `controlsCatalogue` derived the same answer from the same
 * predicate, so one rule had two homes (sage round 2). The store hands back
 * rows; what they *are* is `layoutMoves`' question.
 */
const inForce = (read: { layout: readonly Binding[] }) =>
	layoutMoves(read.layout).length > 0 ? "player" : "default";

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
		// Out loud: the settings loader may fall back in silence because a
		// preference is visible on the screen it changes. A layout is not.
		expect(kinds(read.notices)).toContain("unreadable");
	});
});

describe("a string store is not a promise about size", () => {
	test("a blob naming more changes than the game has controls is refused", () => {
		// Every row costs two full scans and a `rebind` that copies the table,
		// and this runs from a field initialiser at boot — so an unbounded list
		// out of `localStorage` stalls the game before the first frame. A
		// legitimate diff cannot be longer than the table it is a diff of.
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
		// The control: the cap is a cap and not an off-by-one that refuses a
		// legal blob. Every row but the first is a duplicate, so they are
		// rejected one by one rather than the list being refused whole.
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
		// The value reaches the tab's markup. `rowMarkup` escapes it, so this
		// is not the injection it resembles — but nothing else bounded it, and
		// a stored key of ten thousand characters draws off the screen.
		const read = parseLayout(
			blob([
				{ command: PITCH_UP, from: FROM, to: { ...TO, key: "k".repeat(64) } },
			]),
		);
		expect(kinds(read.notices)).toEqual(["rejected"]);
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
	});

	test("a physical key longer than a key name is refused too", () => {
		// `codeKey` strips a prefix and lowercases whatever it is handed, so an
		// unbounded `code` is an unbounded `triggerKey` — bounded beside the
		// key because it was not (sage round 4).
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
		// The control, taken off the shipped table rather than guessed: a bound
		// that refused a key the game itself binds would be a silent unbinding.
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
		// The good move applied.
		expect(keysOf(read.layout)).toEqual(keysOf(moved));
		expect(inForce(read)).toBe("player");
		expect(kinds(read.notices)).toEqual(["rejected"]);
		expect(noticeText(read.notices[0] as LayoutNotice)).toContain(
			commandById("fly.rollPort").name,
		);
	});

	// **Most of these are guarded twice**, and the two guards are named where
	// it matters: the validator refuses a shape, and `rebind` refuses a move
	// the registry's law does not allow. A row here says the blob does not
	// reach the layout, not which guard stopped it — the describe below is
	// where the validator is asked to answer on its own.
	test.each([
		["a command id that is not one", { command: "fly.wiggle" }],
		["a command id that is a number", { command: 7 }],
		["a trigger kind the registry has no row for", { to: { kind: "wheel" } }],
		[
			"a surface that is not one",
			{ to: { kind: "key", key: "8", hold: true, surface: "hold" } },
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
		// A blob existed and every row of it was refused, so the shipped layout
		// is what is flying — and the screen must not offer "PLAYER LAYOUT" for
		// a layout the player is not flying.
		expect(inForce(read)).toBe("default");
		expect(kinds(read.notices)).toEqual(["rejected"]);
		expect(noticeText(read.notices[0] as LayoutNotice)).toContain(
			commandById(PITCH_UP).name,
		);
	});

	test("a second row for one control is not a moved default", () => {
		// The `from` lookup ran against the *running* layout, so the first row
		// moved the command and the second could not find its `from` — and the
		// player was told "it has moved in this version", which is not what
		// happened (sage round 2). A hand-written blob is what reaches this;
		// the diff this build writes holds one row per moved binding.
		const raw = blob([good, { ...good, to: { ...TO, key: "9" } }]);
		const read = parseLayout(raw);
		expect(keysOf(read.layout)).toEqual(keysOf(moved));
		const notice = only(read.notices, "rejected");
		expect(notice.reason).toBe("already-changed");
		expect(noticeText(notice)).toContain(commandById(PITCH_UP).name);
	});

	test("and a `from` that never shipped still reads as a moved default", () => {
		// The control for the row above: the two reasons have to be told apart
		// by the trigger, not by the position of the row.
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
		// The tab read `Roll to port kept its default: a rebind may move a key,
		// not its qualifiers: key:q::hold -> key:k::press` for a round — half
		// English and half the string `triggerKey` groups on. `rebind`'s
		// message is kept as `detail` for a console; what a player reads is a
		// table over the reason.
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

describe("the validator answers what the registry's law cannot", () => {
	/**
	 * These two are the reason `accept()`'s set membership is not enough.
	 *
	 * Every other malformed row in this file is refused by `rebind` as well,
	 * so deleting the validator would leave the suite green — which is exactly
	 * the check-that-cannot-fail this repo keeps paying for. Both rows below
	 * pass `movedTrigger`'s law and are still wrong, so each fails if and only
	 * if the nested check is gone.
	 */
	const legal = {
		command: PITCH_UP,
		from: FROM,
		to: { kind: "key", key: "8", hold: true },
	};
	/** What `legal` produces: the same move as `moved`, minus the code the
	 *  capture modal would have recorded. */
	const moved8 = rebind(DEFAULT_BINDINGS, PITCH_UP, FROM, {
		kind: "key",
		key: "8",
		hold: true,
	});

	test("a key that is not a string never reaches the layout", () => {
		// `matchesQualifiers` compares `hold`, `alt` and `surface` and never
		// looks at the key, so `rebind` accepts this and stores a trigger whose
		// `key` is a number. `resolveKey` compares it with a string, so the
		// command is silently unflyable — a key that does nothing, which is the
		// failure the notice exists for.
		const read = parseLayout(blob([{ ...legal, to: { ...legal.to, key: 8 } }]));
		expect(kinds(read.notices)).toEqual(["rejected"]);
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
	});

	/** The trigger `PITCH_UP` ends up on, whatever the blob asked for. */
	const storedTrigger = (read: { layout: readonly Binding[] }) =>
		read.layout.find(
			(b) =>
				b.command === PITCH_UP &&
				b.trigger.kind === "key" &&
				b.trigger.hold === true,
		)?.trigger;

	test("a field the registry has no place for is dropped, not carried", () => {
		// **The row still loads**, and that is the answer rather than a
		// shortcut: the player moved a key, and one stray property in a string
		// store is not a reason to refuse them the move. What must not happen is
		// the field *travelling*. `keyTrigger` spreads what it is handed, so a
		// stored `contexts` would survive into the trigger — and `scopeOf` reads
		// `"contexts" in trigger` to decide whether a row is the pad's, so the
		// row would fly with a scope nobody authored and nothing would say so.
		const read = parseLayout(
			blob([{ ...legal, to: { ...legal.to, contexts: ["console"] } }]),
		);
		expect(read.notices).toEqual([]);
		expect(keysOf(read.layout)).toEqual(keysOf(moved8));
		expect(Object.keys(storedTrigger(read) ?? {})).not.toContain("contexts");
	});

	test("and a legal move stores exactly the fields a key trigger has", () => {
		// The control for the row above: the same blob without the stray field
		// stores the same three keys, so the assertion there is about the field
		// and not about the shape of the test. No `code`, because `8` is a digit
		// and `codeFor` deliberately leaves those codeless.
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
		expect(inForce(read)).toBe("player");
	});
});

describe("the layout handed back cannot be merged in place", () => {
	test("a loaded layout is frozen through", () => {
		// **Inherited from `rebind`, held here as a property of what the store
		// hands back.** `holdRows` keys its index on the array identity, so a
		// layout written into rather than rebuilt would be answered out of a
		// stale index — and S2's header named the storage slice as the caller
		// most likely to break that. It does not: every layout this module
		// returns is either `DEFAULT_BINDINGS` or something `rebind` built, and
		// both are frozen there. Removing the freeze from `holdRows` leaves
		// this row green, which is the honest reading of what it holds.
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

	test("a storage that refuses to be read does not stop the game, and says so", () => {
		(globalThis as unknown as { window: unknown }).window = {
			get localStorage(): never {
				throw new Error("access denied");
			},
		};
		const read = loadLayout();
		expect(keysOf(read.layout)).toEqual(keysOf(DEFAULT_BINDINGS));
		expect(inForce(read)).toBe("default");
		// **And not in silence.** A private window refuses `localStorage`
		// outright, so a player who had saved a layout flies the defaults —
		// which is the silent fallback this whole slice argues against, and the
		// first version did exactly that (sage round 3).
		expect(kinds(read.notices)).toEqual(["unreadable"]);
	});

	test("the store owns which notices a save retires", () => {
		// `main.ts` wrote this rule as `kind !== "collision"` for a round, so a
		// sixth kind would have been classified by its reader rather than by
		// the module that decides which kinds exist (sage round 2).
		expect(
			retiredBySave({ kind: "unreadable", cause: "corrupt", detail: "x" }),
		).toBe(true);
		expect(retiredBySave({ kind: "version", stored: 2 })).toBe(true);
		expect(
			retiredBySave({
				kind: "rejected",
				command: PITCH_UP,
				reason: "moved-default",
				detail: "x",
			}),
		).toBe(true);
		// A collision is a property of the table as it stands, not a fact about
		// the blob that was read, so replacing the blob does not retire it.
		expect(
			retiredBySave({
				kind: "collision",
				collision: {
					trigger: triggerKey(FROM),
					commands: [PITCH_UP, PITCH_DOWN],
					scope: { pad: ["flight"], views: ["cockpit"] },
				},
				at: FROM,
			}),
		).toBe(false);
	});

	test("a layout that is not this game's is a loud throw, not a failed write", () => {
		// `layoutMoves`' invariant used to be serialised *inside* the try, so a
		// programming error came back as `false` and was indistinguishable from
		// a full quota (sage round 2).
		installStorage();
		expect(() => saveLayout(DEFAULT_BINDINGS.slice(0, 3))).toThrow();
	});

	test("a write that lands says so, because a notice depends on it", () => {
		// `Game` retires the blob's own notices when a save replaces the blob,
		// and must not when the write was refused — the old blob is still there
		// and every one of those notices is still true. A `void` return made
		// the two indistinguishable.
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
		// **The claim this row makes is about `parseLayout`, so it calls it.**
		// The version it replaced iterated `layoutMoves(moved)` and asserted
		// the ids were in `COMMANDS` — but `layoutMoves` reads each command
		// straight off `DEFAULT_BINDINGS`, so the assertion could not fail and
		// neither `parseLayout` nor `COMMAND_IDS` was reached (sage round 5).
		//
		// The validator reads the shipped catalogue rather than a list of its
		// own, so a command added to `commands.ts` is storable the day it lands
		// and one removed stops being accepted the same day. Every command with
		// a key binding is driven; the rest have no `from` a key move could
		// name.
		const named = new Set<string>();
		for (const b of DEFAULT_BINDINGS) {
			if (b.trigger.kind !== "key" || named.has(b.command)) continue;
			named.add(b.command);
			const read = parseLayout(
				blob([
					{
						command: b.command,
						from: b.trigger,
						// A key nothing in the shipped table holds, with the
						// command's own qualifiers kept — the player moves which
						// key and never the rest.
						to: { ...b.trigger, key: "8", code: undefined },
					},
				]),
			);
			expect(`${b.command}: ${kinds(read.notices).join(",")}`).toBe(
				`${b.command}: `,
			);
		}
		// The control for the loop: it drove something, and the set it drove is
		// the shipped catalogue's.
		expect(named.size).toBeGreaterThan(20);
		for (const id of named)
			expect(COMMANDS.some((c) => c.id === id)).toBe(true);
	});
});

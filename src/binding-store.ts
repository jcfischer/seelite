/**
 * Where a player's layout lives, and what it is allowed to do (#381, slice 3).
 *
 * `settings.ts` is the neighbour this sits beside, and #369 D8 ruled the shape
 * by naming the three places the two part company. Each departure is a
 * property of what a binding *is*, not a preference about storage:
 *
 * - **The version is inside the blob.** `settings.ts` puts `v1` in the key
 *   name, so a bump silently abandons every stored row — which is the right
 *   trade for six preferences a player can re-pick from a screen in front of
 *   them, and the wrong one for a layout they built by hand. A version in the
 *   blob is a thing this module can *read* and answer, and the answer is not
 *   always "start again".
 * - **The validator reads a table.** `accept()` asks whether a value is in a
 *   set of literals, which settles a `Quality` and cannot see a `Trigger`: a
 *   trigger is an object with a discriminant, optional qualifiers and a
 *   surface drawn from another set. So the check here is nested, and it is a
 *   check rather than a cast.
 * - **A rejected row is named.** `loadSettings` falls back per field in
 *   silence because a rejected preference is visible on the screen it changes.
 *   A rejected *binding* is a key that does nothing, with nothing on screen
 *   saying why, on a control the player moved on purpose and will go looking
 *   for. Every refusal below produces a `LayoutNotice`.
 *
 * **What is stored is what the player changed, not the table.** A blob holding
 * the whole layout would pin the shipped defaults onto disk: a later build
 * that moves a default would never reach a player who had rebound anything at
 * all, and #381's "proof the shipped defaults reproduce the layout at the
 * ratified commit" would be true in the repository and false on the machine.
 * So the blob is a diff — `{ command, from, to }` for every row whose trigger
 * differs from its shipped one — and loading is one `rebind` per row over
 * `DEFAULT_BINDINGS`.
 *
 * **`from` is the shipped trigger and never an intermediate one**, which is
 * what makes this a diff rather than a history. `layoutMoves` derives it by
 * pairing the live layout against the shipped one, so rebinding the same row
 * five times stores one move, rebinding it back stores none, and "the default
 * moved under this row" is exactly one `rebind` that throws.
 *
 * **A qualifier is still the command's.** `rebind` refuses a `to` that changes
 * `hold`, `alt` or `surface`, and refuses every non-key trigger until the
 * capture modal (S4) can admit one. This module does not re-decide either: a
 * row the registry refuses becomes a notice, so the two cannot drift.
 *
 * **There is no `migrate()`, and that is the honest answer rather than a
 * gap.** Version 1 is the first version this game has ever written, so a
 * migration function here would be a path no red build can reach — and this
 * repo has paid for checks that could not fail. What *is* reachable, and is
 * tested, is a version this build does not know: the blob is not read, the
 * notice names the version, and the next save replaces it. The first real
 * migration arrives with the second version, beside the reason it exists.
 *
 * Headless, and on the list in `tests/headless.test.ts`.
 */
import {
	type Binding,
	type CommandId,
	type Collision,
	COMMANDS,
	collisions,
	DEFAULT_BINDINGS,
	rebind,
	SURFACES,
	type Surface,
	type Trigger,
	triggerKey,
} from "./commands";

/**
 * The key, with no version in it.
 *
 * `seelite:settings:v1` carries its version here because the settings loader
 * is allowed to abandon a blob; this one is not, so the version moves inside
 * and the key names only what it holds.
 */
export const LAYOUT_KEY = "seelite:bindings";

/** The blob shape this build writes and is the only one it reads. */
export const LAYOUT_VERSION = 1;

/**
 * Why a stored row could not be applied — five answers, because they are five
 * different things for the player to do about it.
 *
 * A code rather than a sentence, for #369 D11's reason: the sentence belongs
 * with every other printed control name, in `controls-reference.ts`.
 */
export type RejectReason =
	/** The entry is not even a row: nothing about it names a control. */
	| "unreadable-row"
	/** The blob names a control this build does not have. */
	| "unknown-control"
	/** The stored trigger is not a trigger this build can store. */
	| "unreadable-trigger"
	/** The control no longer ships on the trigger the row moved it off — a
	 *  default moved under a saved layout, which is the migration case. */
	| "moved-default"
	/** The registry refused the move itself: it asked for more than moving a
	 *  key, which is the command's to decide and not the player's. */
	| "not-just-a-key";

/** One row the player moved: which command, off what, onto what. */
export interface LayoutMove {
	readonly command: CommandId;
	readonly from: Trigger;
	readonly to: Trigger;
}

/**
 * Something the player is owed a sentence about.
 *
 * Data, not prose. The sentence is `controls-reference.ts`'s, beside every
 * other printed control name — #369 D11 gives that module the one owner, and
 * a formatter here would be the second copy.
 */
export type LayoutNotice =
	/** The blob is not a blob: not JSON, not an object, or no list of moves. */
	| { readonly kind: "unreadable"; readonly reason: string }
	/** A version this build does not know. The layout is left alone. */
	| { readonly kind: "version"; readonly stored: unknown }
	/** One row could not be applied. `command` is whatever the blob said, which
	 *  may not be a command at all. */
	| {
			readonly kind: "rejected";
			readonly command: string | null;
			readonly reason: RejectReason;
			/**
			 * What actually went wrong, for a console and for a probe.
			 *
			 * **Not printed.** The first pass put `rebind`'s thrown message
			 * straight on the screen and the `Controls` tab read
			 * `a rebind may move a key, not its qualifiers: key:q::hold ->
			 * key:k::press` — half English and half the hash `triggerKey`
			 * groups on, which is not a sentence a player can act on. The
			 * reason above is what prints; this is what a developer reads.
			 */
			readonly detail: string;
	  }
	/** Two commands one trigger reaches at once (#369 D5: warn and allow). */
	| {
			readonly kind: "collision";
			readonly collision: Collision;
			/** One of the two triggers, so the notice can print the key rather
			 *  than the hash `collisions()` groups on. */
			readonly at: Trigger;
	  };

export interface LoadedLayout {
	readonly layout: readonly Binding[];
	readonly notices: readonly LayoutNotice[];
	/** Derived from the result, not from whether storage held anything: a blob
	 *  every row of which was rejected leaves the shipped layout in force, and
	 *  the screen must not claim a player layout it is not flying. */
	readonly source: "default" | "player";
}

const COMMAND_IDS = new Set<string>(COMMANDS.map((c) => c.id));

/**
 * Every row whose trigger is not the one it shipped on.
 *
 * Paired by position, because `rebind` writes `next[at]` and returns a new
 * array of the same length — so row *i* of any layout this game can produce is
 * row *i* of the shipped one with, at most, a different trigger. The pairing
 * is asserted rather than assumed: a layout that is not the shipped table with
 * triggers moved is a programming error here, and one that silently produced
 * the wrong diff would write a blob that loads as a different layout than the
 * one saved.
 */
export function layoutMoves(layout: readonly Binding[]): LayoutMove[] {
	if (layout.length !== DEFAULT_BINDINGS.length)
		throw new Error(
			`a layout has ${DEFAULT_BINDINGS.length} rows, not ${layout.length}`,
		);
	const out: LayoutMove[] = [];
	for (let i = 0; i < layout.length; i++) {
		const live = layout[i] as Binding;
		const base = DEFAULT_BINDINGS[i] as Binding;
		if (live.command !== base.command)
			throw new Error(
				`layout row ${i} is ${live.command}, not ${base.command}`,
			);
		if (triggerKey(live.trigger) === triggerKey(base.trigger)) continue;
		out.push({ command: base.command, from: base.trigger, to: live.trigger });
	}
	return out;
}

/** The blob, as a string. */
export function serializeLayout(layout: readonly Binding[]): string {
	return JSON.stringify({
		version: LAYOUT_VERSION,
		moves: layoutMoves(layout),
	});
}

// ---------------------------------------------------------------------------
// The nested validator
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A qualifier is present and `true`, or absent — nothing else.
 *
 * `hold: false` is not the same object as no `hold` to `triggerKey`'s reader
 * but is to its arithmetic, and a blob that carried one would hash alike and
 * compare unlike. Refusing anything but `true` keeps the stored form and the
 * authored form the same shape.
 */
const acceptFlag = (v: unknown): true | undefined | null =>
	v === undefined ? undefined : v === true ? true : null;

const acceptSurface = (v: unknown): Surface | undefined | null =>
	v === undefined
		? undefined
		: SURFACES.includes(v as Surface)
			? (v as Surface)
			: null;

/**
 * A stored trigger, or `null` with the reason it is not one.
 *
 * **Key triggers only**, which is not this module narrowing the model: the
 * registry's `rebind` refuses every other kind until the capture modal can
 * admit a stick for one capture, so a stored pad or mouse row could never be
 * applied and accepting one here would move the refusal later and make it
 * harder to name. S4 lifts both together.
 *
 * What it checks is the shape a `Trigger` has, one field at a time — which is
 * the thing `settings.ts`'s `accept()` cannot do, because membership of a set
 * of literals has nothing to say about an object.
 */
function acceptTrigger(v: unknown): Trigger | string {
	if (!isRecord(v)) return "a trigger is an object";
	if (v.kind !== "key")
		return typeof v.kind === "string"
			? `only a key may be stored here, not a ${v.kind}`
			: "a trigger names its kind";
	if (typeof v.key !== "string" || v.key.length === 0)
		return "a key trigger carries the character it was recorded with";
	if (v.code !== undefined && typeof v.code !== "string")
		return "a physical key is a `KeyboardEvent.code`";
	const alt = acceptFlag(v.alt);
	if (alt === null) return "`alt` is `true` or absent";
	const hold = acceptFlag(v.hold);
	if (hold === null) return "`hold` is `true` or absent";
	const surface = acceptSurface(v.surface);
	if (surface === null) return `a surface is one of ${SURFACES.join(", ")}`;
	// Rebuilt field by field rather than spread, so nothing the blob carried
	// beyond these five reaches a `Trigger` — a stored `contexts` would make a
	// key trigger answer `"contexts" in trigger` and take the pad's branch in
	// `scopeOf`.
	return {
		kind: "key",
		key: v.key,
		...(v.code === undefined ? {} : { code: v.code as string }),
		...(alt === undefined ? {} : { alt }),
		...(hold === undefined ? {} : { hold }),
		...(surface === undefined ? {} : { surface }),
	};
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const unreadable = (reason: string): LoadedLayout => ({
	layout: DEFAULT_BINDINGS,
	notices: [{ kind: "unreadable", reason }],
	source: "default",
});

/**
 * A stored blob, applied to the shipped layout row by row.
 *
 * Pure, and it takes the string rather than reading it: every red case this
 * owes — a corrupt row, a `from` no default carries, a version from the
 * future — is a string, and routing each of them through a fake `window` would
 * make the browser the subject of a test about the layout.
 *
 * **Per-row, so one bad row costs that row.** #369 D8 rejected whole-table
 * fallback by name: a layout is the thing a player built, and deleting all of
 * it because one entry is malformed is the failure the per-field settings
 * loader already refuses for a preference.
 */
export function parseLayout(raw: string | null): LoadedLayout {
	if (raw === null || raw === "")
		return { layout: DEFAULT_BINDINGS, notices: [], source: "default" };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return unreadable("the stored layout is not JSON");
	}
	if (!isRecord(parsed))
		return unreadable("the stored layout is not an object");
	if (parsed.version !== LAYOUT_VERSION)
		return {
			layout: DEFAULT_BINDINGS,
			notices: [{ kind: "version", stored: parsed.version }],
			source: "default",
		};
	if (!Array.isArray(parsed.moves))
		return unreadable("the stored layout holds no list of changes");

	const notices: LayoutNotice[] = [];
	let layout = DEFAULT_BINDINGS;
	for (const entry of parsed.moves as unknown[]) {
		const named =
			isRecord(entry) && typeof entry.command === "string"
				? entry.command
				: null;
		const reject = (reason: RejectReason, detail: string) =>
			notices.push({ kind: "rejected", command: named, reason, detail });
		if (!isRecord(entry)) {
			reject("unreadable-row", "a stored change is an object");
			continue;
		}
		if (named === null || !COMMAND_IDS.has(named)) {
			reject(
				"unknown-control",
				`no command is called ${String(entry.command)}`,
			);
			continue;
		}
		const from = acceptTrigger(entry.from);
		if (typeof from === "string") {
			reject("unreadable-trigger", `from: ${from}`);
			continue;
		}
		const to = acceptTrigger(entry.to);
		if (typeof to === "string") {
			reject("unreadable-trigger", `to: ${to}`);
			continue;
		}
		// **Asked before `rebind` is, and the duplicated lookup is the point.**
		// `rebind` throws for both of the next two reasons and its message is
		// one string; the player's answer is two different sentences — "this
		// control has moved since you saved" is something they can redo, and
		// "that change asked for more than a key" is not. Only this module
		// knows which sentence to print, so it asks the cheap question itself
		// rather than reading a thrown message for a verdict.
		if (
			!layout.some(
				(b) =>
					b.command === named && triggerKey(b.trigger) === triggerKey(from),
			)
		) {
			reject(
				"moved-default",
				`${named} no longer ships on ${triggerKey(from)}`,
			);
			continue;
		}
		try {
			// The registry decides whether the move itself is legal, not this
			// module: a `to` that changes a qualifier the command owns is
			// refused there, so the two cannot drift.
			layout = rebind(layout, named as CommandId, from, to);
		} catch (e) {
			reject("not-just-a-key", e instanceof Error ? e.message : String(e));
		}
	}

	notices.push(...collisionNotices(layout));

	return {
		layout,
		notices,
		source: layoutMoves(layout).length > 0 ? "player" : "default",
	};
}

/**
 * What is wrong with a layout *as it stands*, which is only ever collisions.
 *
 * D5's second predicate, and its first player-layout caller: the shipped
 * layout must not collide and CI holds that, while a player's may and is told
 * that it does. Exported because a **rebind** needs the same answer about the
 * table it just produced, and `main.ts` building the notice itself would be a
 * second place that decides what a collision notice looks like.
 *
 * It is not the whole of `parseLayout`'s answer: a rejected row leaves no
 * trace in the table it failed to change, so those notices are a fact about
 * the blob and have to be carried rather than recomputed.
 */
export function collisionNotices(layout: readonly Binding[]): LayoutNotice[] {
	return collisions(layout).map((collision) => ({
		kind: "collision",
		collision,
		at: triggerFor(layout, collision),
	}));
}

/** One of the two triggers a collision is on, for a notice that prints a key
 *  rather than the hash `collisions()` groups by. */
const triggerFor = (
	layout: readonly Binding[],
	collision: Collision,
): Trigger => {
	const found = layout.find(
		(b) =>
			b.command === collision.commands[0] &&
			triggerKey(b.trigger) === collision.trigger,
	);
	// `collisions` reports only pairs it found in this layout, so the lookup
	// cannot miss; the throw says so rather than handing a caller a trigger
	// from somewhere else.
	if (found === undefined)
		throw new Error(`no ${collision.commands[0]} row on ${collision.trigger}`);
	return found.trigger;
};

// ---------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------

/**
 * Read the stored layout. Never throws, for `loadSettings`' reason: a private
 * window refuses `localStorage` outright, and a game that cannot start because
 * it cannot read a layout would be a poor trade for a layout.
 */
export function loadLayout(): LoadedLayout {
	let raw: string | null = null;
	try {
		raw = window.localStorage.getItem(LAYOUT_KEY);
	} catch {
		return { layout: DEFAULT_BINDINGS, notices: [], source: "default" };
	}
	return parseLayout(raw);
}

/**
 * Write the layout, and say nothing if the browser refuses.
 *
 * It writes whatever this build can express, so it also **replaces a blob this
 * build refused to read** — the downgrade case, where a newer build wrote a
 * version 2. That is deliberate: preserving the unreadable blob would make its
 * notice permanent, with no move the player could make to clear it.
 */
export function saveLayout(layout: readonly Binding[]) {
	try {
		window.localStorage.setItem(LAYOUT_KEY, serializeLayout(layout));
	} catch {
		/* private mode, quota, or a disabled store */
	}
}

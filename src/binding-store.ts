/**
 * Where a player's layout lives, and what it is allowed to do (#381, slice 3).
 *
 * `settings.ts` is the module this sits beside, and #369 D8 ruled the shape
 * by naming the three places the two part company. Each departure is a
 * property of what a binding *is*, not a preference about storage:
 *
 * - **The version is inside the blob.** `settings.ts` puts `v1` in the key
 *   name, so a bump silently abandons every stored row — which is the right
 *   trade for six preferences a player can re-pick from a screen in front of
 *   them, and the wrong one for a layout they built by hand. **What it buys
 *   today is that the refusal is not silent** — a version this build does not
 *   know is named on screen rather than a key that quietly matches nothing —
 *   and what it buys later is the option of answering something other than
 *   "start again", which a key-versioned store does not have because the rows
 *   are simply not there to read.
 * - **The validator reads a table.** `accept()` asks whether a value is in a
 *   set of literals, which settles a `Quality` and cannot see a `Trigger`: a
 *   trigger is an object with a discriminant, optional qualifiers and a
 *   surface drawn from another set. So the check here is nested, and it is a
 *   check rather than a cast.
 * - **A rejected row is named.** `loadSettings` falls back per field in
 *   silence because a rejected preference is visible on the screen it changes.
 *   A rejected *binding* is a key that does nothing, with nothing on screen
 *   saying why, on a control the player moved on purpose and will go looking
 *   for. Every refusal below produces a `LayoutNotice` — a kind this module
 *   makes and, since #381 S4, does not define: `layout-notice.ts` owns the
 *   vocabulary, because `collisionNotices` answers a question about a table
 *   in memory and no store is involved in it at all.
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
 * **A qualifier is still the command's, and the registry is what says so.**
 * `rebind` refuses a `to` that changes `hold`, `alt` or `surface`; a row it
 * refuses becomes a notice here and the rule is not restated. **One rule is
 * written twice on purpose and it is named rather than left to be found**:
 * only a *key* may be stored, which `acceptTrigger` refuses and `movedTrigger`
 * refuses again. The reason is that the two refusals answer different
 * questions — the store cannot hold a pad trigger's shape at all, and the
 * registry cannot move one — and S4 lifts both together, in one change, which
 * is where that pair has to be re-read.
 *
 * **The format is forward-only, and a downgrade is not clean** (#381 S4, sage
 * round 4). This slice widened the blob: a stored trigger may now be a
 * `pad-button`, and `LAYOUT_VERSION` did not move. A *newer* build reads
 * everything an older one wrote, which is the direction that matters. An
 * older build meets a pad row as `unreadable-trigger` — one rejected row,
 * named on screen — and its next save drops it, because `retiredBySave`
 * retires that notice. The version was not bumped because a bump is worse in
 * the direction players actually travel: this build refuses a version it does
 * not know, so every existing `v1` layout would be abandoned to protect a
 * downgrade nobody performs. The cost is named here rather than discovered.
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
	type Layout,
	type Collision,
	type CommandId,
	COMMANDS,
	collisions,
	DEFAULT_BINDINGS,
	layoutMoves,
	rebind,
	type Surface,
	SURFACES,
	type Trigger,
	triggerKey,
} from "./commands";
import { type PadButtonName, STANDARD_BUTTONS } from "./gamepad";
// The notice vocabulary is not this module's, and has not been since #381 S4:
// `collisionNotices` diagnoses a table with no store in the room, and a second
// storage-free caller — the capture modal's bind-time warning — is what took
// the kinds out from behind the persistence module. This one produces them.
import {
	collisionNotices,
	type LayoutNotice,
	type RejectReason,
} from "./layout-notice";

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
 * The longest blob this store will parse at all.
 *
 * The row cap below bounds the *merge*, and it runs after `JSON.parse` — so a
 * multi-megabyte value still parsed on the boot path, from a field
 * initialiser (sage round 6). Only a same-origin writer can put one there, so
 * this is self-inflicted rather than reachable by anyone else; it is bounded
 * because there is no reason not to. A full layout serialises to a few
 * kilobytes.
 */
const RAW_MAX = 256 * 1024;

/** The longest `KeyboardEvent.key` this store will hold. The shipped table's
 *  longest is `arrowright`; the bound is generous and finite, which is the
 *  property that matters. */
const KEY_NAME_MAX = 32;

export interface LoadedLayout {
	readonly layout: Layout;
	readonly notices: readonly LayoutNotice[];
}

const COMMAND_IDS = new Set<string>(COMMANDS.map((c) => c.id));

/**
 * The blob, as a string.
 *
 * **A pad row is written without its contexts** (sage round 5 on #497). They
 * are `pad-bindings.ts`' answer, re-derived by `movedTrigger` on every load,
 * and `acceptPadButton` already drops whatever a blob carries. Writing them
 * anyway put a field into a durable store whose meaning the format disowns —
 * and with the version deliberately unbumped, a later slice that gives stored
 * contexts a meaning would find existing blobs holding values nobody chose.
 * The read stays lenient, for the blobs this build already wrote.
 */
export function serializeLayout(layout: Layout): string {
	return JSON.stringify({
		version: LAYOUT_VERSION,
		moves: layoutMoves(layout).map((move) => ({
			...move,
			from: withoutContexts(move.from),
			to: withoutContexts(move.to),
		})),
	});
}

/** A trigger as the store holds it: the pad's derived half left off. */
const withoutContexts = (t: Trigger): Trigger => {
	if (!("contexts" in t)) return t;
	const { contexts: _contexts, ...rest } = t;
	return rest as Trigger;
};

// ---------------------------------------------------------------------------
// The nested validator
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A qualifier is present and `true`, or absent — nothing else.
 *
 * Returns the value or **the reason it is not one**, on `acceptTrigger`'s
 * convention, so one `typeof x === "string"` test reads the whole validator.
 * Three conventions in one function — `null` for no, `undefined` for absent,
 * a string for a reason — was three things a reader had to hold, and a bare
 * `Surface | string` cannot tell a valid surface from a complaint about one
 * (sage round 4). Hence the wrapper.
 *
 * `hold: false` is not the same object as no `hold` to `triggerKey`'s reader
 * but is to its arithmetic, and a blob that carried one would hash alike and
 * compare unlike. Refusing anything but `true` keeps the stored form and the
 * authored form the same shape.
 */
type Accepted<T> = { readonly value: T | undefined } | string;

const acceptFlag = (name: string, v: unknown): Accepted<true> =>
	v === undefined
		? { value: undefined }
		: v === true
			? { value: true }
			: `\`${name}\` is \`true\` or absent`;

const acceptSurface = (v: unknown): Accepted<Surface> =>
	v === undefined
		? { value: undefined }
		: SURFACES.includes(v as Surface)
			? { value: v as Surface }
			: `a surface is one of ${SURFACES.join(", ")}`;

/**
 * A stored trigger, or the reason it is not one.
 *
 * **Keys and pad buttons**, which is the shape half of #381 S4's lift. It was
 * keys alone, because `rebind` refused every other kind and a stored row that
 * could never be applied would move the refusal later and make it harder to
 * name. `rebind` admits a pad button now, so this does — and the two refusals
 * stay two, because they answer different questions: this one is about a
 * *shape* this module can hold, and `movedTrigger`'s is about a *move* the
 * registry will make. A stick fails here on shape and would fail there on the
 * reader; that is not a duplicated rule, it is the same input refused by the
 * layer it reaches first, and the sentence the player reads differs. Both
 * lift together again or not at all, and
 * [#496](https://github.com/jcfischer/seelite/issues/496) is where.
 *
 * **A stored `contexts` is not read.** Loading is one `rebind` per row and
 * `movedTrigger` derives the contexts from `pad-bindings.ts`, so a blob that
 * claimed a button is live everywhere gets the button's real set back. It is
 * accepted as a shape and dropped, rather than refused, because a blob this
 * build wrote carries one.
 *
 * What it checks is the shape a `Trigger` has, one field at a time — which is
 * the thing `settings.ts`'s `accept()` cannot do, because membership of a set
 * of literals has nothing to say about an object.
 */
function acceptTrigger(v: unknown): Trigger | string {
	if (!isRecord(v)) return "a trigger is an object";
	if (v.kind === "pad-button") return acceptPadButton(v);
	if (v.kind !== "key")
		return typeof v.kind === "string"
			? `only a key or a pad button may be stored here, not a ${v.kind}`
			: "a trigger names its kind";
	if (typeof v.key !== "string" || v.key.length === 0)
		return "a key trigger carries the character it was recorded with";
	// **Bounded**, because the value reaches the `Controls` tab's markup.
	// `rowMarkup` runs every label through `escapeHtml`, so this is not the
	// injection it looks like — but nothing else bounds it, and a stored key of
	// ten thousand characters is a row that draws off the screen.
	// `KeyboardEvent.key` is a character or a name like `arrowdown`; the
	// longest the shipped table holds is well inside this.
	if (v.key.length > KEY_NAME_MAX)
		return "a key trigger carries one key, not a string of them";
	if (v.code !== undefined && typeof v.code !== "string")
		return "a physical key is a `KeyboardEvent.code`";
	// Bounded beside the key, for the key's reason and because it was not:
	// `codeKey` strips a prefix and lowercases whatever it is handed, so an
	// unbounded `code` is an unbounded `triggerKey` (sage round 4). The
	// longest this game authors is `ArrowRight`.
	if (v.code !== undefined && v.code.length > KEY_NAME_MAX)
		return "a physical key is one key, not a string of them";
	const alt = acceptFlag("alt", v.alt);
	if (typeof alt === "string") return alt;
	const hold = acceptFlag("hold", v.hold);
	if (typeof hold === "string") return hold;
	const surface = acceptSurface(v.surface);
	if (typeof surface === "string") return surface;
	// Rebuilt field by field rather than spread, so nothing the blob carried
	// beyond these five reaches a `Trigger` — a stored `contexts` would make a
	// key trigger answer `"contexts" in trigger` and take the pad's branch in
	// `scopeOf`.
	return {
		kind: "key",
		key: v.key,
		...(v.code === undefined ? {} : { code: v.code as string }),
		...(alt.value === undefined ? {} : { alt: alt.value }),
		...(hold.value === undefined ? {} : { hold: hold.value }),
		...(surface.value === undefined ? {} : { surface: surface.value }),
	};
}

/**
 * A stored pad button, rebuilt to the shape the registry will accept.
 *
 * The `contexts` a blob carried are **dropped and re-derived**, which is the
 * pad's version of the rule that a code is derived for a key: what a button is
 * live in is `pad-bindings.ts`' answer and never a player's, so a hand-written
 * blob cannot widen one. `movedTrigger` fills them in, and the empty list here
 * is what it replaces — it is never the set a row ends up with.
 *
 * `hold` is accepted as a shape and refused as a move: `padFireHeld` reads a
 * fixed position, so the registry says no and names that reader, which is a
 * better sentence than "a pad button does not have a hold" would be.
 */
function acceptPadButton(v: Record<string, unknown>): Trigger | string {
	if (
		typeof v.button !== "string" ||
		!STANDARD_BUTTONS.includes(v.button as PadButtonName)
	)
		return `a pad button is one of ${STANDARD_BUTTONS.join(", ")}`;
	const hold = acceptFlag("hold", v.hold);
	if (typeof hold === "string") return hold;
	return {
		kind: "pad-button",
		button: v.button as PadButtonName,
		...(hold.value === undefined ? {} : { hold: hold.value }),
		contexts: [],
	};
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const unreadable = (detail: string): LoadedLayout => ({
	layout: DEFAULT_BINDINGS,
	notices: [{ kind: "unreadable", cause: "corrupt", detail }],
});

/**
 * One stored change applied to a layout, or the notice saying why it was not.
 *
 * Its own function rather than five `continue`s at depth three inside
 * `parseLayout`, which also owns the JSON, the version and the collision pass:
 * a reader had to hold the blob-level refusals and the row-level ones at once
 * (sage round 6).
 */
function applyMove(
	layout: Layout,
	entry: unknown,
): { layout: Layout } | { notice: LayoutNotice } {
	const named =
		isRecord(entry) && typeof entry.command === "string" ? entry.command : null;
	const rejected = (
		reason: RejectReason,
		detail: string,
	): { notice: LayoutNotice } => ({
		notice: { kind: "rejected", command: named, reason, detail },
	});
	if (!isRecord(entry))
		return rejected("unreadable-row", "a stored change is an object");
	if (named === null || !COMMAND_IDS.has(named))
		return rejected(
			"unknown-control",
			`no command is called ${String(entry.command)}`,
		);
	/** The two trigger fields, checked the same way and named in the detail —
	 *  the block was written out twice with only the field name differing. */
	const accepted: Partial<Record<"from" | "to", Trigger>> = {};
	for (const field of ["from", "to"] as const) {
		const t = acceptTrigger(entry[field]);
		if (typeof t === "string")
			return rejected("unreadable-trigger", `${field}: ${t}`);
		accepted[field] = t;
	}
	const from = accepted.from as Trigger;
	const to = accepted.to as Trigger;
	// **Asked before `rebind` is, and the duplicated lookup is the point.**
	// `rebind` throws for all three of the next reasons and its message is one
	// string; the player's answers are three different sentences, and only
	// this module knows which to print.
	//
	// **The shipped table answers first, and the running one second.** Asking
	// only the running layout called a *duplicate row* a moved default — the
	// first row moves the command, the second cannot find its `from`, and the
	// player is told "it has moved in this version", which is not what
	// happened (sage round 2). A hand-written blob is exactly what reaches
	// that; one this build wrote cannot, because the diff holds one row per
	// moved binding.
	// Hashed once rather than per row of each of the two scans.
	const wanted = triggerKey(from);
	const on = (rows: Layout) =>
		rows.some((b) => b.command === named && triggerKey(b.trigger) === wanted);
	if (!on(DEFAULT_BINDINGS))
		return rejected("moved-default", `${named} no longer ships on ${wanted}`);
	if (!on(layout))
		return rejected(
			"already-changed",
			`an earlier row already moved ${named} off ${wanted}`,
		);
	try {
		// The registry decides whether the *move* is legal — a `to` that changes
		// a qualifier the command owns is refused there and not restated here.
		return { layout: rebind(layout, named as CommandId, from, to) };
	} catch (e) {
		return rejected(
			"refused-by-registry",
			e instanceof Error ? e.message : String(e),
		);
	}
}

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
 *
 * **Not every refusal is per-row, and the ones that are not are refusals of
 * the blob rather than of a row in it.** Two of them have no rows to be
 * per-row about — a blob that is not an object, and one whose version this
 * build does not know, whose rows *mean* something this build cannot read. The
 * third does: a list longer than the table it is a diff of is discarded whole,
 * first row included, because the length is the tell that the list is not a
 * diff of this table at all and walking it is the cost the cap exists to
 * refuse. All three are notices; none is silent.
 */
export function parseLayout(raw: string | null): LoadedLayout {
	if (raw === null || raw === "")
		return { layout: DEFAULT_BINDINGS, notices: [] };
	if (raw.length > RAW_MAX)
		return unreadable("the stored layout is larger than any layout can be");
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
		};
	if (!Array.isArray(parsed.moves))
		return unreadable("the stored layout holds no list of changes");
	// **Capped at the size of the table it is a diff of**, which bounds the
	// *merge*: a legitimate diff cannot name more rows than the layout has,
	// and every row costs two full scans plus a `rebind` that copies the whole
	// array. The parse itself is bounded by `RAW_MAX` above, because this cap
	// necessarily runs after it.
	if (parsed.moves.length > DEFAULT_BINDINGS.length)
		return unreadable(
			`the stored layout names more changes than this game has controls`,
		);

	const notices: LayoutNotice[] = [];
	let layout = DEFAULT_BINDINGS;
	for (const entry of parsed.moves as unknown[]) {
		const applied = applyMove(layout, entry);
		if ("notice" in applied) notices.push(applied.notice);
		else layout = applied.layout;
	}

	notices.push(...collisionNotices(layout));

	return { layout, notices };
}

// ---------------------------------------------------------------------------
// The browser
// ---------------------------------------------------------------------------

/**
 * Read the stored layout.
 *
 * **It does not throw on anything a player's browser can do to it**, which is
 * `loadSettings`' reason: a private window refuses `localStorage` outright,
 * and a game that cannot start because it cannot read a layout would be a poor
 * trade for a layout. Nor does it fall back in *silence*, which is the
 * difference between this and its neighbour.
 *
 * **It is not an unqualified "never throws", and the headline said so for a
 * round** (sage round 6). `parseLayout` is deliberately outside the storage
 * guard, and `triggerFor` inside it ends in a `throw` that is unreachable by
 * construction. If that invariant ever breaks, this crashes — which is the
 * intended behaviour and not a gap, because the alternative is a sentence
 * blaming the player's browser for a bug in this file. `main.ts` calls this
 * from a field initialiser, so a crash there is a boot that does not start,
 * loudly.
 */
export function loadLayout(): LoadedLayout {
	let raw: string | null;
	try {
		raw = window.localStorage.getItem(LAYOUT_KEY);
	} catch (e) {
		// **A refusal here is a notice and not a silence**, which is the whole
		// argument of this module and the first version broke it: a private
		// window refuses `localStorage` outright, so a player who had saved a
		// layout flew the defaults with nothing on screen (sage round 3).
		//
		// **The read is guarded on its own**, because `cause: "refused"` prints
		// "your browser is not letting this game read what it stored" — and a
		// guard that also covered the parse would blame the browser for an
		// internal invariant failure, with the only distinguishing evidence in
		// a `detail` that is deliberately never drawn (sage round 5).
		return {
			layout: DEFAULT_BINDINGS,
			notices: [
				{
					kind: "unreadable",
					cause: "refused",
					detail: e instanceof Error ? e.message : String(e),
				},
			],
		};
	}
	// Outside the guard, and `parseLayout` is the function that must not
	// throw: `triggerFor`'s `throw` is unreachable by construction, and a
	// contract resting on a reader proving that is not a contract. If it ever
	// does, it is a crash here rather than a sentence blaming a private window.
	return parseLayout(raw);
}

/**
 * Write the layout. Returns whether it landed.
 *
 * It writes whatever this build can express, so it also **replaces a blob this
 * build refused to read** — the downgrade case, where a newer build wrote a
 * version 2. That is deliberate: preserving the unreadable blob would make its
 * notice permanent, with no move the player could make to clear it.
 *
 * **And that is why it reports.** Every notice `parseLayout` produced is a
 * fact about the blob that was *read*, so a successful write retires all of
 * them — and a refused write does not, because the old blob is still there and
 * every one of those notices is still true. A `void` return made the two
 * indistinguishable, and the panel went on printing "the default layout is in
 * force" beside `PLAYER LAYOUT` for the rest of the session (sage round 1).
 */
export function saveLayout(layout: Layout): boolean {
	// **Serialized outside the try**, so `layoutMoves`' invariant throw stays
	// loud. Inside it, a layout that is not the shipped table with triggers
	// moved — a programming error the assertion exists to shout about —
	// returned `false` and was indistinguishable from a full quota (sage
	// round 2).
	const blob = serializeLayout(layout);
	try {
		window.localStorage.setItem(LAYOUT_KEY, blob);
		return true;
	} catch {
		/* private mode, quota, or a disabled store */
		return false;
	}
}

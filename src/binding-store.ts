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

/** The longest `KeyboardEvent.key` this store will hold. The shipped table's
 *  longest is `arrowright`; the bound is generous and finite, which is the
 *  property that matters. */
const KEY_NAME_MAX = 32;

/**
 * Why a stored row could not be applied. One reason per thing the player can
 * do about it — **the count is not stated here**, because it was written as
 * five while the union held six inside one round (sage round 3), which is what
 * a count of a list right below it is worth.
 *
 * A code rather than a sentence, for #369 D11's reason: the sentence belongs
 * with every other printed control name, in `controls-reference.ts`.
 */
export type RejectReason =
	/** The entry is not an object at all. A record whose `command` is not a
	 *  string is `unknown-control` instead, because it does name something. */
	| "unreadable-row"
	/** The blob names a control this build does not have. */
	| "unknown-control"
	/** The stored trigger is not a trigger this build can store. */
	| "unreadable-trigger"
	/** The control no longer ships on the trigger the row moved it off — a
	 *  default moved under a saved layout, which is the migration case. */
	| "moved-default"
	/** An earlier row in the same blob already moved this control off that
	 *  trigger. Hand-written blobs reach it; one this build wrote cannot,
	 *  because the diff holds one row per moved binding. */
	| "already-changed"
	/** The registry refused the move itself: it asked for more than moving a
	 *  key, which is the command's to decide and not the player's. */
	| "not-just-a-key";

/**
 * Something the player is owed a sentence about.
 *
 * Data, not prose. The sentence is `controls-reference.ts`'s, beside every
 * other printed control name — #369 D11 gives that module the one owner, and
 * a formatter here would be the second copy.
 */
export type LayoutNotice =
	/**
	 * The stored layout could not be read, for one of two reasons that are
	 * not one thing to a player.
	 *
	 * `corrupt` is a blob that is there and is not a blob — not JSON, not an
	 * object, no list of moves, more rows than the game has controls. The
	 * store still works, so changing a control replaces it.
	 *
	 * `refused` is the browser declining to hand it over at all, which a
	 * private window does. **Nothing can be replaced there**, because a store
	 * that throws on a read throws on a write, and the first version printed
	 * "changing a control will replace them" beside "This change could not be
	 * saved" (sage round 4).
	 *
	 * `detail` is the thrown message or the shape that failed, and is **not
	 * printed** — the first version interpolated it into the sentence, which
	 * is the half-machine string this slice abolished for a rejection.
	 */
	| {
			readonly kind: "unreadable";
			readonly cause: "corrupt" | "refused";
			readonly detail: string;
	  }
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
	/**
	 * A change the browser would not store.
	 *
	 * A private window refuses `localStorage` outright and a full one refuses
	 * a write, and the rebind still *flies* — so the layout is right until the
	 * page is reloaded and then silently is not. The first pass said nothing
	 * at all here, against this module's own header claiming every refusal
	 * produces a notice (sage round 2).
	 */
	| { readonly kind: "unsaved" }
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
}

/**
 * Whether a successful save makes this notice stop being true.
 *
 * **The store's rule, not its reader's.** Every notice but a collision is a
 * fact about the blob that was *read*, so a write that lands replaces the
 * thing they describe; a collision is a property of the table as it stands and
 * survives. `main.ts` encoded exactly this expression for a round, which would
 * have silently classified a later kind without the module that owns the kinds
 * saying anything (sage round 2).
 *
 * **It does not except `unsaved`, and the first version did.** That clause was
 * unreachable — the only caller filters `parseLayout`'s output, which never
 * holds one — and it was also the wrong sign: a write that lands is precisely
 * what makes an earlier refusal stop being true. `main.ts` clears that flag on
 * the same branch, so there is one rule and not two (sage round 3).
 */
export const retiredBySave = (notice: LayoutNotice): boolean =>
	notice.kind !== "collision";

const COMMAND_IDS = new Set<string>(COMMANDS.map((c) => c.id));

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
 * (sage round 1).
 */
function applyMove(
	layout: readonly Binding[],
	entry: unknown,
): { layout: readonly Binding[] } | { notice: LayoutNotice } {
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
	const on = (rows: readonly Binding[]) =>
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
			"not-just-a-key",
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
	// **Capped at the size of the table it is a diff of.** A legitimate diff
	// cannot name more rows than the layout has, and every row costs two full
	// scans plus a `rebind` that copies the whole array — so an unbounded list
	// out of a player-writable string store stalls the boot before the first
	// frame, from a field initialiser (sage round 3).
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
 * it cannot read a layout would be a poor trade for a layout. It does not fall
 * back in *silence*, which is the difference between this and its neighbour.
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
export function saveLayout(layout: readonly Binding[]): boolean {
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

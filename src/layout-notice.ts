/**
 * What a player is owed a sentence about, and the one question about a layout
 * that needs no store to answer (#381 S4).
 *
 * **Taken out of `src/binding-store.ts`, and the reason is `collisionNotices`.**
 * The kinds were declared beside the code that produced them through the
 * storage slice, which was right while every one of them was a fact about a
 * blob that had been read. `collisionNotices` is not: it diagnoses a table as
 * it stands, `main.ts` calls it on every rebind with nothing saved yet, and
 * the capture modal calls it again to warn *before* a bind is taken — #369
 * D5's warn-and-allow. Two storage-free callers is what makes this a file
 * rather than a paragraph.
 *
 * Sage asked for the move four times on #486 and it was declined there,
 * because splitting a vocabulary for no change in behaviour on a slice six
 * rounds deep buys a seventh round and nothing else. The change that makes it
 * pay is the second caller, which is this slice's.
 *
 * **Data, not prose.** The sentence each of these prints is
 * `controls-reference.ts`'s, beside every other printed control name — #369
 * D11 gives that module the one owner, and a formatter here would be the
 * second copy. What the split buys a reader beyond tidiness is an edge
 * removed: the tab's formatter used to reach *through* the persistence module
 * to name the union, and does not now.
 *
 * **And `proposedRebind` lives here too**, which the header did not say for a
 * round (sage round 2 on #497). It is the bind-time wrapper: it calls `rebind`
 * and hands back the candidate layout with the notices it produced, or the
 * refusal. It is here rather than beside `rebind` because what it returns is
 * a `LayoutNotice[]`, and a reader looking for the notice vocabulary is the
 * reader who needs it.
 *
 * Headless, a leaf but for the registry, and on the list in
 * `tests/headless.test.ts`.
 */
import {
	type Collision,
	collisions,
	type CommandId,
	type Layout,
	type RebindRefusal,
	RebindRefused,
	rebound,
	type Trigger,
	triggerKey,
} from "./commands";

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
	/**
	 * The registry refused the move itself.
	 *
	 * It is named for the *refusal* and not for any one law behind it, and
	 * that has paid off twice. When this was written the only reachable cause
	 * was the qualifier rule; #381 S4 gave `movedTrigger` a per-kind switch
	 * with six `RebindRefusal` codes, and this row needed no edit. What
	 * reaches a *stored* row is narrower than what reaches the capture modal,
	 * because `acceptTrigger` refuses most of those shapes one layer earlier
	 * — so the two have different vocabularies on purpose (sage round 1 on
	 * #380, and round 1 on #497).
	 */
	| "refused-by-registry";

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
export function collisionNotices(layout: Layout): LayoutNotice[] {
	return collisions(layout).map((collision) => ({
		kind: "collision",
		collision,
		at: triggerFor(layout, collision),
	}));
}

/** One of the two triggers a collision is on, for a notice that prints a key
 *  rather than the hash `collisions()` groups by. */
const triggerFor = (layout: Layout, collision: Collision): Trigger => {
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

/**
 * A move, offered with its warnings — or refused (#369 D5, D9).
 *
 * **The second storage-free caller this module was split out for**, and the
 * shape is what makes D5 structural rather than remembered. D5 is *warn at
 * bind time, allow the bind, resolve by one stated law*, and a warning that
 * comes after the bind is a different promise: the modal has to be able to
 * tell a player that the trigger they just pressed already means something,
 * **before** it commits, and commit anyway if they say so.
 *
 * So a caller cannot get the candidate without the warnings beside it. The
 * version this replaces would have been a `rebind` call with a
 * `collisionNotices` call under it — the same two lines with the second one
 * optional, which is the one a later edit drops and nothing goes red.
 *
 * **A refusal carries no layout.** `rebind` throws on a move the registry will
 * not make — a stick, a held button, a qualifier that is the command's — and
 * there is nothing to warn about there, because there is nothing to commit.
 * A **code** comes back, and the sentence beside it is the developer's —
 * `detail` is for a console and for a probe and nothing prints it. This doc
 * said the sentence came back "so the modal can print it", which is what the
 * first version did and the whole reason the codes exist (sage round 4 on
 * #497). `CAPTURE_REFUSED_WHY` in `controls-reference.ts` is what a player
 * reads here, as `REJECTED_WHY` there is for a *stored* row's refusal.
 *
 * **Nothing is mutated.** `rebind` returns a new table, so a player who reads
 * the warning and backs out has changed nothing — which is the property a
 * modal that previewed a bind by writing into the layout would break, and the
 * `Layout` brand is what stops it trying.
 */
export function proposedRebind(
	bindings: Layout,
	command: CommandId,
	from: Trigger,
	to: Trigger,
):
	| {
			readonly layout: Layout;
			/**
			 * The trigger the registry actually stored.
			 *
			 * **Returned rather than inferred** (sage round 3 on #497). The
			 * modal has to *show* what it will bind, and `movedTrigger`
			 * completes a captured trigger — it derives a missing code and
			 * takes an Alt chord's character from its position. The first fix
			 * read the changed row back by comparing slot identity against the
			 * table before it, which is an undocumented property of `rebind`'s
			 * implementation rather than its contract: a `rebind` that ever
			 * copied rows would silently fall back to the offered trigger, and
			 * the screen would read `Alt + ∂` again.
			 */
			readonly stored: Trigger;
			readonly warnings: LayoutNotice[];
	  }
	| { readonly refused: RebindRefusal; readonly detail: string } {
	// **`rebound` hands the stored trigger back**, because working it out here
	// is reading `rebind`'s internals from outside it — first by slot identity
	// and then by repeating its own `findIndex` (sage rounds 3 and 5 on #497).
	let moved: { layout: Layout; stored: Trigger };
	try {
		moved = rebound(bindings, command, from, to);
	} catch (e) {
		// **A throw that is not `RebindRefused` is not a refusal**, and folding
		// it into one would print a player sentence about a programming error.
		// It is rethrown, the way an unknown command already is.
		if (!(e instanceof RebindRefused)) throw e;
		return { refused: e.refusal, detail: e.message };
	}
	return {
		layout: moved.layout,
		stored: moved.stored,
		warnings: collisionNotices(moved.layout),
	};
}

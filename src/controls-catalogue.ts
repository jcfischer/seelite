/**
 * Every control the game has, as data a screen can print (#370, #372, #381).
 *
 * **This is the interface #370's D2 declared, and #381's registry now fills
 * it.** What was here — an authored table of commands, and the derivation that
 * asked `pad-bindings.ts` what each button does — moved into `src/commands.ts`
 * when #369's model landed: a command has a namespaced id of its own, a
 * binding carries the contexts it is live in, and the registry owns every
 * printed key name. This module is what remains: the view of that registry the
 * `Controls` tab and the `?` reference render, and nothing else.
 *
 * **Two things it does not do.** It authors no binding — a row here that the
 * registry does not hold is impossible rather than merely wrong — and it does
 * not fold the registry's rows back together. #369 D2 ruled that the smallest
 * thing one trigger can cause is one command, so pitch up and pitch down are
 * two rows, and the tab folds by task rather than by pair.
 *
 * **One import path per symbol.** This module exports the catalogue and
 * nothing else — every registry symbol (`Trigger`, `TaskGroup`,
 * `PAD_CONTEXTS`, `CommandId`) is imported from `./commands` by its consumers,
 * so the slices after this one cannot each pick a different path.
 *
 * Headless, and on the list in `tests/headless.test.ts`: the unit tier renders
 * **this** catalogue, never a struct a test built.
 */
import type { LayoutNotice } from "./layout-notice";
import {
	type Command,
	type CommandId,
	COMMANDS,
	DEFAULT_BINDINGS,
	type Layout,
	layoutMoves,
	type Trigger,
} from "./commands";

/**
 * A registry row, plus the one thing a screen needs that a registry row does
 * not carry: what is bound **now**.
 *
 * It extends `Command` rather than restating it: a second declaration of the
 * same seven fields is a second thing to edit every time the registry gains
 * one, which is the drift this repo pays for elsewhere.
 */
export interface ControlCommand extends Command {
	/** What is bound now. Until the settings row lands this *is* the default. */
	readonly currentTriggers: readonly Trigger[];
}

export interface ControlsCatalogue {
	/**
	 * #370 D5: which layout the rows below are.
	 *
	 * **Derived, never stored.** A blob may exist and still leave the shipped
	 * layout in force — every row of it rejected, or a version this build
	 * refused — and a screen that read "a layout was saved" would then claim a
	 * player layout it is not flying. The answer is whether the rows differ
	 * from the ones that shipped.
	 */
	readonly layout: "default" | "player";
	readonly commands: readonly ControlCommand[];
	/** What the store could not do, for the band above the tree (#381 S3).
	 *  Empty on the shipped layout, which is the common case. */
	readonly notices: readonly LayoutNotice[];
}

const row = (
	c: Command,
	bound: ReadonlyMap<CommandId, Trigger[]>,
): ControlCommand => ({
	...c,
	currentTriggers: bound.get(c.id) ?? [],
});

/**
 * The catalogue for one layout.
 *
 * A function since the storage slice, because the tab now prints what the
 * player is flying rather than what shipped — and `currentTriggers` is read
 * out of the layout rather than copied off `defaultTriggers`, which is what
 * made the two the same thing for two slices.
 */
export function controlsCatalogue(
	bindings: Layout = DEFAULT_BINDINGS,
	notices: readonly LayoutNotice[] = [],
): ControlsCatalogue {
	// **The diff first, and it is the guard as well as the answer.**
	// `layoutMoves` throws on a table that is not the shipped one with
	// triggers moved, so a command missing from `bound` below is impossible
	// rather than drawn blank — a row that shows no key at all would be a
	// control the tab claims exists and gives no way to press (sage round 3).
	// A command with *no shipped trigger* is a different thing and is drawn
	// `unbound` by `rowMarkup`, which is what it is.
	const moves = layoutMoves(bindings);
	// One pass over the table rather than one scan per command: the filter this
	// replaced was `COMMANDS.length` walks of the whole binding table. Cheap
	// either way at these sizes, and it runs on every rebind (sage round 2).
	const bound = new Map<CommandId, Trigger[]>();
	for (const b of bindings) {
		const rows = bound.get(b.command);
		if (rows === undefined) bound.set(b.command, [b.trigger]);
		else rows.push(b.trigger);
	}
	return {
		layout: moves.length > 0 ? "player" : "default",
		commands: COMMANDS.map((c) => row(c, bound)),
		notices,
	};
}

/**
 * The shipped layout's catalogue.
 *
 * Kept as a value because the unit tier renders **this** — a catalogue built
 * by a test is a struct the test itself authored, which is the thing
 * `tests/controls-catalogue.test.ts` exists to refuse.
 */
export const CONTROLS: ControlsCatalogue = controlsCatalogue();

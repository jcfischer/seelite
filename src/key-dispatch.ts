/**
 * What a key event may reach: the keyboard's dispatch law (#377).
 *
 * `main.ts` hands every keydown and keyup here before it touches the held-key
 * set or `Game.command`, and acts on the answer. The law is the principal's four
 * rulings on #377 and #380's field gate, in the order they are applied:
 *
 * 1. **A release clears the key it names.** Whatever is held with it, a keyup
 *    takes its key out of the held set — a flight key stuck down is worse than
 *    any modifier rule. The limit is the *name*: on macOS a key released under
 *    Option reports the Option character (`∂` for D), and the key it was
 *    pressed as stays held. That is #390, and it is older than this module.
 *
 * Between rulings 1 and 2 sits #380's gate, which is not one of #377's four and
 * so takes no number: **a key typed into a field is the field's.** The cockpit
 * holds two live text fields, the Navigation filter and the chart's FIND
 * SYSTEM, and typing `cargo` into one requested clearance on `c` and cycled the
 * target on `g`. A press there reaches nothing and is not prevented, so the
 * field keeps the character. It comes after the release, which still clears a
 * key held in flight before the click into the field.
 *
 * 2. **Ctrl runs no command, and Meta reaches nothing.** `Ctrl`+letter fired
 *    the letter's command *and* throttled down, so `Ctrl+J` started cruise.
 *    Now a key pressed with Ctrl down is held but runs no command: Ctrl is
 *    `THROTTLE_DOWN`, and a pilot braking on it must still be able to start a
 *    turn and pull the trigger (the principal's refinement of ruling 3, from
 *    sage round 2 on #391). Meta is not a flight key, and with it down nothing
 *    reaches the game, as the three panel listeners already did.
 * 3. **Alt is the chord prefix, and a chord is one-shot.** Any press with Alt
 *    down takes the chord path, repeat or not, and nothing on it reaches the
 *    held set. *Which* chords are bound is not this module's question since
 *    #381 S4 — the route carries the physical key and the binding registry
 *    answers it. The old guard was `down && !e.repeat && e.altKey`, so the first
 *    auto-repeat of a held `Alt+D` fell past it and yawed the ship — a rule
 *    that was untrue for exactly the case a player holds a modifier for.
 * 4. **Everything else is the ordinary path**: held while down, its command on
 *    the first press. `?` is the character the keyboard types, not a Shift
 *    chord, and `F1` is kept from the browser's help.
 *
 * Headless and a leaf, so the unit tier runs the law itself rather than a
 * description of it.
 */

export interface KeyEventFacts {
	readonly key: string;
	readonly code: string;
	readonly down: boolean;
	readonly repeat: boolean;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	/** Whether the target is a text field (`isEditable`). */
	readonly editable: boolean;
}

export type KeyRoute =
	/** Take `key` out of the held set. */
	| { readonly kind: "release"; readonly key: string }
	/** Nothing reaches the game. `prevent`: nor the browser. */
	| { readonly kind: "swallow"; readonly prevent?: true }
	/**
	 * An Alt press, once, kept from the browser — resolve it and run what it
	 * reaches.
	 *
	 * **It carries the physical key, and that is what the caller matches on.**
	 * On macOS Option changes the character (`Alt+D` arrives as `∂`), so a
	 * chord asked for by character could never be an `Alt`+letter there; the
	 * arrows were the only chords that worked, because Option leaves them
	 * alone. `key` rides along for the fallback `resolveKey` gives a row that
	 * carries no code.
	 */
	| { readonly kind: "chord"; readonly key: string; readonly code: string }
	/** Hold `key`; on the first press also run its command. */
	| {
			readonly kind: "key";
			readonly key: string;
			/** Whether this key may run a command at all: false under Ctrl. */
			readonly commands: boolean;
			/** Run the command now: a first press that may run one. */
			readonly oneShot: boolean;
			readonly prevent: boolean;
	  };

/**
 * Keys whose browser default would fight the game: the arrows and Space scroll
 * the page under a full-viewport canvas, which looks like the controls simply
 * not working, and F1 opens the browser's help. Backspace is the eject
 * (node #703), and a browser configured to go back on it would leave the page
 * the pilot was ejecting from.
 */
const preventsDefault = (key: string) =>
	key.startsWith("arrow") || key === " " || key === "f1" || key === "backspace";

export function keyDispatch(e: KeyEventFacts): KeyRoute {
	const key = e.key.toLowerCase();
	if (!e.down) return { kind: "release", key };
	if (e.editable) return { kind: "swallow" };
	if (e.metaKey) return { kind: "swallow" };
	if (e.altKey) {
		// **Every Alt press is a chord here, and the layout decides what it
		// reaches** (#381 S4). This branch used to consult `ALT_CHORDS`, a
		// code-to-key table that stood for the *shipped* keyboard — so a chord
		// moved in the registry was expressible and dead, which is the same
		// defect `PAD_FLIGHT_KEYS` had and it is fixed the same way. The law
		// decides *that* a press is a chord; it is not a second binding table.
		//
		// **Nothing is lost by dropping the lookup.** An Alt press the layout
		// does not bind resolves to no command and runs nothing, which is what
		// the swallow did — and the caller prevents the browser's default on
		// this route unconditionally, so `Alt+D`'s address bar and `Alt+F`'s
		// menu are still kept from the page on Windows and Linux (sage round 3
		// on #391).
		//
		// A chord is still one-shot: a held `Alt+D` on auto-repeat reaches
		// nothing, which is #377's third ruling and the defect it was written
		// for.
		return e.repeat
			? { kind: "swallow", prevent: true }
			: { kind: "chord", key, code: e.code };
	}
	// The Control key itself is the throttle, and its own keydown carries
	// ctrlKey; everything else pressed under Ctrl is held and runs nothing.
	const commands = !e.ctrlKey || key === "control";
	return {
		kind: "key",
		key,
		commands,
		oneShot: !e.repeat && commands,
		// A key pressed while braking on Ctrl is kept from the browser as well:
		// Ctrl+D is the bookmark dialog, Ctrl+S the save dialog. Chrome reserves
		// Ctrl+W, Ctrl+T and Ctrl+N and lets no page cancel them, so braking on
		// Ctrl while pitching on W still closes the tab there (sage round 3).
		prevent: preventsDefault(key) || !commands,
	};
}

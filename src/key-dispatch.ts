/**
 * What a key event may reach: the keyboard's dispatch law (#377).
 *
 * `main.ts` hands every keydown and keyup here before it touches the held-key
 * set or `Game.command`, and acts on the answer. The law is the principal's four
 * rulings on #377, in the order they are applied:
 *
 * 1. **A release clears the key it names.** Whatever is held with it, a keyup
 *    takes its key out of the held set — a flight key stuck down is worse than
 *    any modifier rule. The limit is the *name*: on macOS a key released under
 *    Option reports the Option character (`∂` for D), and the key it was
 *    pressed as stays held. That is #390, and it is older than this module.
 * 2. **Ctrl runs no command, and Meta reaches nothing.** `Ctrl`+letter fired
 *    the letter's command *and* throttled down, so `Ctrl+J` started cruise.
 *    Now a key pressed with Ctrl down is held but runs no command: Ctrl is
 *    `THROTTLE_DOWN`, and a pilot braking on it must still be able to start a
 *    turn and pull the trigger (the principal's refinement of ruling 3, from
 *    sage round 2 on #391). Meta is not a flight key, and with it down nothing
 *    reaches the game, as the three panel listeners already did.
 * 3. **Alt is the chord prefix, and a chord is one-shot.** Any press with Alt
 *    down takes the chord path, repeat or not, and nothing on it reaches the
 *    held set. The old guard was `down && !e.repeat && e.altKey`, so the first
 *    auto-repeat of a held `Alt+D` fell past it and yawed the ship — a rule
 *    that was untrue for exactly the case a player holds a modifier for.
 * 4. **Everything else is the ordinary path**: held while down, its command on
 *    the first press. `?` is the character the keyboard types, not a Shift
 *    chord, and `F1` is kept from the browser's help.
 *
 * Headless and a leaf, so the unit tier runs the law itself rather than a
 * description of it.
 */

/**
 * The chord table: a physical key (`KeyboardEvent.code`) under Alt, and the key
 * `Game.command` receives for it.
 *
 * **Keyed on `code`, not on the character.** On macOS, Option changes the
 * character — `Alt+D` arrives as `∂` and `Alt+/` as `÷` — so a table on `e.key`
 * could never hold an `Alt`+letter there. The arrows were the only chords that
 * worked, because Option leaves them alone.
 *
 * **The value is a command key, as `PAD_FLIGHT_KEYS`' is,** so a chord runs the
 * same code as the key it stands for and the controls catalogue can derive its
 * Alt rows from this table rather than restating them. #381's registry fills it.
 */
export const ALT_CHORDS: Readonly<Record<string, string>> = {
	ArrowLeft: "1",
	ArrowUp: "2",
	ArrowRight: "3",
};

export interface KeyEventFacts {
	readonly key: string;
	readonly code: string;
	readonly down: boolean;
	readonly repeat: boolean;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
}

export type KeyRoute =
	/** Take `key` out of the held set. */
	| { readonly kind: "release"; readonly key: string }
	/** Nothing reaches the game. `prevent`: nor the browser. */
	| { readonly kind: "swallow"; readonly prevent?: true }
	/** Run `Game.command(key)` once, and keep the event from the browser. */
	| { readonly kind: "chord"; readonly key: string }
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
 * not working, and F1 opens the browser's help.
 */
const preventsDefault = (key: string) =>
	key.startsWith("arrow") || key === " " || key === "f1";

export function keyDispatch(e: KeyEventFacts): KeyRoute {
	const key = e.key.toLowerCase();
	if (!e.down) return { kind: "release", key };
	if (e.metaKey) return { kind: "swallow" };
	if (e.altKey) {
		const chord = ALT_CHORDS[e.code];
		// Unbound, it is still kept from the browser: on Windows and Linux Alt+D
		// focuses the address bar and Alt+F opens a menu (sage round 3 on #391).
		if (chord === undefined) return { kind: "swallow", prevent: true };
		return e.repeat
			? { kind: "swallow", prevent: true }
			: { kind: "chord", key: chord };
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

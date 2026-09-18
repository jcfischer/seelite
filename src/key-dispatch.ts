/**
 * What a key event may reach: the keyboard's dispatch law (#377).
 *
 * `main.ts` hands every keydown and keyup here before it touches the held-key
 * set or `Game.command`, and acts on the answer. The law is the principal's four
 * rulings on #377, in the order they are applied:
 *
 * 1. **A release always clears.** Whatever is held with it, a keyup takes its key
 *    out of the held set — a flight key stuck down is worse than any modifier
 *    rule.
 * 2. **Ctrl and Meta never reach the ship.** A key pressed with either down is
 *    swallowed, which is what the three panel listeners already did and
 *    `main.ts` did not: `Ctrl`+letter fired the letter's command *and*
 *    throttled down. The Control key pressed alone is still `THROTTLE_DOWN`.
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
	if (e.metaKey || (e.ctrlKey && key !== "control")) return { kind: "swallow" };
	if (e.altKey) {
		const chord = ALT_CHORDS[e.code];
		if (chord === undefined) return { kind: "swallow" };
		return e.repeat
			? { kind: "swallow", prevent: true }
			: { kind: "chord", key: chord };
	}
	return {
		kind: "key",
		key,
		oneShot: !e.repeat,
		prevent: preventsDefault(key),
	};
}

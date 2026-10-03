/**
 * Which input opens the sound, and when the game stops listening (node #550).
 *
 * A browser runs an `AudioContext` only after *user activation*, and the HTML
 * specification grants that only on its **activation-triggering input
 * events** (https://html.spec.whatwg.org/multipage/interaction.html):
 *
 * - `keydown`, other than the Escape key;
 * - `mousedown`;
 * - `pointerdown`, but only when its `pointerType` is `"mouse"`;
 * - `pointerup`, when its `pointerType` is not `"mouse"`;
 * - `touchend`.
 *
 * So `pointerdown` alone unlocks a mouse and never a finger: a touch grants
 * activation on its **release**, at `pointerup` or `touchend`. Listening for
 * `pointerdown` and `keydown` only, as `main.ts` did, left a player who only
 * touches the screen with no event that could open the context. #541 found it
 * (F6) and it follows from the specification; no touch browser has been tested
 * here.
 *
 * The game listens for more than the browser honours on purpose. An event that
 * grants nothing — Escape, a touch's `pointerdown` — calls `ensure()` while the
 * context stays suspended, and the listeners stay. That is the rule below.
 *
 * **Removal waits for the unlock, not for the attempt.** The listeners go only
 * once `tryUnlock` reports the context running. Removing them on any input
 * spent them on Escape and left every later key and click with nothing to
 * hear it (sage, round 5 on PR #285, node #283). And `onUnlocked` runs once: a single tap now
 * fires `pointerdown`, `pointerup` and `touchend` in turn, and what follows an
 * unlock — attaching the music, which is final for the session if it fails —
 * must not run three times.
 *
 * **What can check this, and what cannot.** No browser probe in this repo can
 * see the gesture rule: #541 measured that Playwright's Chromium creates an
 * `AudioContext` `running` before any input, and headless WebKit does too, so
 * a probe that "unlocks" sound passes whether the listeners are right or not.
 * The headless half is the listener set, held by `tests/audio-unlock.test.ts`.
 * The rest rests on the specification cited above.
 *
 * This module imports nothing, so the headless tier reads it whole.
 */

/** Every event the game listens on to open the sound. */
export const AUDIO_UNLOCK_EVENTS = [
	"keydown",
	"pointerdown",
	"pointerup",
	"touchend",
] as const;

export type AudioUnlockEvent = (typeof AUDIO_UNLOCK_EVENTS)[number];

/** The two calls the unlock makes on its target — `window` in the game. */
export type UnlockTarget = {
	addEventListener(type: string, listener: () => void): void;
	removeEventListener(type: string, listener: () => void): void;
};

/**
 * Listen on `target` for every {@link AUDIO_UNLOCK_EVENTS} event. Each one
 * calls `tryUnlock`, which tries to open the context and answers whether it is
 * running now. On the first `true`, every listener is removed and `onUnlocked`
 * runs, once.
 */
export function armAudioUnlock(
	target: UnlockTarget,
	tryUnlock: () => boolean,
	onUnlocked: () => void,
): void {
	let done = false;
	const listener = () => {
		if (done || !tryUnlock()) return;
		done = true;
		for (const type of AUDIO_UNLOCK_EVENTS)
			target.removeEventListener(type, listener);
		onUnlocked();
	};
	for (const type of AUDIO_UNLOCK_EVENTS)
		target.addEventListener(type, listener);
}

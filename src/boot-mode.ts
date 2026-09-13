/**
 * How a boot of the game's default route begins (`persistent-world-state.md`
 * §11.2 and §11.6).
 *
 * A player's boot opens the Commander overlay first. `?boot=direct` boots as
 * the game did before §11 — no overlay, the clock running, the store attached —
 * and it exists for the browser scripts, which load the page and wait for a
 * booted game with nobody there to answer an overlay.
 *
 * A leaf: it imports nothing. `scripts/lib/game-url.mjs` builds the parameter
 * and runs under node, so it cannot import this file; `tests/game-url.test.ts`
 * asserts the two spell it the same way instead.
 */

/** The query parameter a boot mode is read from. */
export const BOOT_QUERY = "boot";

/** The value that skips the overlay. Nothing else does. */
export const BOOT_DIRECT = "direct";

export type BootMode = "direct" | "overlay";

/**
 * The boot mode a query asks for.
 *
 * Exact match only. Every other value — absent, empty, a different case — is
 * the overlay, because the overlay is what a player gets and a mistyped probe
 * URL should fail by waiting on it rather than by skipping it for a player.
 */
export function bootMode(query: URLSearchParams): BootMode {
	return query.get(BOOT_QUERY) === BOOT_DIRECT ? "direct" : "overlay";
}

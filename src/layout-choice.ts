/**
 * Which shipped layout a player flies, as the settings screen offers it (#639).
 *
 * The selection is not a setting. It lives in the binding blob beside the
 * moves it is the base of (`binding-store.ts`), under one key and one write,
 * so the name and the moves cannot disagree — which two stores could.
 *
 * Headless, and on the list in `tests/headless.test.ts`.
 */
import {
	type Layout,
	type LayoutName,
	layoutMoves,
	SHIPPED_LAYOUTS,
} from "./commands";

/** What the settings row and the `Controls` tab call each shipped layout. */
export const LAYOUT_LABELS: Readonly<Record<LayoutName, string>> = {
	default: "Default",
	"mouse-flight": "Mouse flight",
};

/**
 * Put another shipped layout in force, and count what that drops.
 *
 * **The player's moves do not come across**, by the principal's ruling on
 * #639: a move is a diff against one table and means nothing against
 * another. `dropped` is how many there were, so the screen can say so.
 */
export function switchLayout(
	current: Layout,
	to: LayoutName,
): { readonly layout: Layout; readonly dropped: number } {
	return { layout: SHIPPED_LAYOUTS[to], dropped: layoutMoves(current).length };
}

/**
 * Whether Chrome takes `Ctrl`+`W` before the page sees it.
 *
 * Everywhere but macOS, where the browser's shortcuts are on `Cmd`. The
 * argument is `navigator.userAgentData.platform` where the browser has it and
 * `navigator.platform` where it does not — `"macOS"` and `"MacIntel"`.
 */
export const ctrlChordsReachBrowser = (platform: string): boolean =>
	!/^mac/i.test(platform);

/**
 * The line under the layout row.
 *
 * What the layout is, what a switch would drop, and — on the mouse-flight
 * layout off macOS — that `Ctrl`+`W` closes the tab. In that layout `Ctrl` is
 * strafe up and `W` is forward, so the chord is half the three-axis burn, and
 * Chrome reserves it: no page handler runs before the tab closes.
 */
export function layoutChoiceNote(
	selected: LayoutName,
	moves: number,
	platform: string,
): string {
	const what =
		selected === "default"
			? "W/S/A/D pitch and yaw, the arrows strafe, Shift/Ctrl fore and aft."
			: "For the mouse on pitch and yaw: W/S fore and aft, A/D strafe, Ctrl/Space up and down, the arrows pitch and yaw.";
	const loss =
		moves === 0
			? ""
			: ` Switching drops your ${moves} rebind${moves === 1 ? "" : "s"}.`;
	const warning =
		selected === "mouse-flight" && ctrlChordsReachBrowser(platform)
			? " Warning: in Chrome on this system Ctrl+W closes the tab, and the game cannot stop it. Here that is strafe up with forward."
			: "";
	return `${what}${loss}${warning}`;
}

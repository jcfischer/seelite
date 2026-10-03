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
	type CommandId,
	type Layout,
	type LayoutName,
	layoutMoves,
	shippedOf,
} from "./commands";
import { boundNames, onKeyboard } from "./key-names";

/** What the settings row and the `Controls` tab call each shipped layout. */
export const LAYOUT_LABELS: Readonly<Record<LayoutName, string>> = {
	default: "Default",
	"mouse-flight": "Mouse flight",
};

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
export function layoutChoiceNote(current: Layout, platform: string): string {
	const selected = current.base;
	// **A switch drops the player's moves**, by the principal's ruling on #639:
	// a move is a diff against one table and means nothing against another.
	// Counted here, the one place, so the line says so before the step.
	const moves = layoutMoves(current).length;
	// Read off the shipped table rather than typed (sage round 1), so a key
	// moved in `MOUSE_FLIGHT_KEYS` moves this line with it.
	const table = shippedOf(selected);
	const key = (id: CommandId) =>
		(boundNames(table, id, onKeyboard)[0] ?? "unbound").replace(/^hold /, "");
	const pair = (a: CommandId, b: CommandId) => `${key(a)}/${key(b)}`;
	const keys = `${pair("fly.throttleUp", "fly.throttleDown")} fore and aft, ${pair("fly.strafePort", "fly.strafeStarboard")} strafe, ${pair("fly.strafeDorsal", "fly.strafeVentral")} up and down, ${pair("fly.pitchDown", "fly.pitchUp")} and ${pair("fly.yawPort", "fly.yawStarboard")} pitch and yaw.`;
	const what =
		selected === "default" ? keys : `For the mouse on pitch and yaw: ${keys}`;
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

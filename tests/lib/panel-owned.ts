/**
 * The commands a panel opens itself, rather than the ship's dispatch reaching.
 *
 * `settings-panel.ts` and `commander-overlay.ts` each listen for their own key
 * on their own capture-phase listener, so neither id appears at a dispatch
 * site and both partitions that walk the catalogue have to exempt them.
 *
 * **A written list, and the registry should own it instead.** There is no axis
 * for "a panel owns this open key" — `fixed` is the wrong one, because #381
 * makes `z` remappable — so the pair lives here rather than in two test files
 * (sage round 3), which is one edit for a third panel rather than two. The
 * axis itself belongs with the capture slice, since that is what gives `z` a
 * non-binding route in the first place.
 */
export const PANEL_OWNED_COMMANDS: readonly string[] = [
	"system.settings",
	"system.commander",
];

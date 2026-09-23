/**
 * The commands a panel opens itself, rather than the ship's dispatch reaching.
 *
 * `commander-overlay.ts` listens for its own key on its own capture-phase
 * listener, so its id appears at no dispatch site and both partitions that
 * walk the catalogue have to exempt it.
 *
 * **`system.settings` left this list in #381 S4, which is what this comment
 * said should happen.** It read: "the axis itself belongs with the capture
 * slice, since that is what gives `z` a non-binding route in the first place."
 * That route is the `Controls` tab's settings door, and until the fold, #369
 * D12's "`z` is an ordinary command and can be moved" was false — a player who
 * rebound `system.settings` still opened the screen with `z`, and the key they
 * chose did nothing. Sage round 5 on #497 found it by pressing the key twice.
 *
 * **`system.commander` stays**, and deliberately: it has no such door, so
 * folding its open key would be the thing S2 refused — a rebind that can lock
 * the only way in. That is a node of its own.
 */
export const PANEL_OWNED_COMMANDS: readonly string[] = ["system.commander"];

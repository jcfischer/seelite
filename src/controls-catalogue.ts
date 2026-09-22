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
import { type Command, COMMANDS, type Trigger } from "./commands";

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
	/** #370 D5: `default` until the registry can report a player layout. */
	readonly layout: "default" | "player";
	readonly commands: readonly ControlCommand[];
}

// The player's layout is #381's storage slice; until it lands the only layout
// is the shipped one, and `layout` below says so rather than the screen
// claiming a layout it cannot report.
const row = (c: Command): ControlCommand => ({
	...c,
	currentTriggers: c.defaultTriggers,
});

export const CONTROLS: ControlsCatalogue = {
	layout: "default",
	commands: COMMANDS.map(row),
};

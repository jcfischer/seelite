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
 * Headless, and on the list in `tests/headless.test.ts`: the unit tier renders
 * **this** catalogue, never a struct a test built.
 */
import {
	COMMANDS,
	type Command,
	type CommandId,
	type Half,
	isPressedKey,
	PAD_CONTEXTS,
	PANEL_INTENTS,
	type PanelIntent,
	type Scope,
	TASK_GROUPS,
	type TaskGroup,
	type Trigger,
	VIEW_MODES,
	type ViewMode,
} from "./commands";
import type { PadContext } from "./pad-bindings";

export { isPressedKey, PAD_CONTEXTS, PANEL_INTENTS, TASK_GROUPS, VIEW_MODES };
export type {
	Command,
	CommandId,
	Half,
	PanelIntent,
	Scope,
	TaskGroup,
	Trigger,
	ViewMode,
};

export interface ControlCommand {
	/** Not a key string: a command keeps its id when #381 rebinds it. */
	readonly id: CommandId;
	readonly name: string;
	readonly group: TaskGroup;
	readonly defaultTriggers: readonly Trigger[];
	/** What is bound now. Until the settings row lands this *is* the default. */
	readonly currentTriggers: readonly Trigger[];
	/**
	 * The pad contexts this command is live in, from its pad triggers. Empty
	 * when it has none — the keyboard and the mouse are not part of the pad's
	 * context model, so a key-only command carries no note.
	 */
	readonly contexts: readonly PadContext[];
	/**
	 * The views it is live in (#369 D4's second half). Both, unless the command
	 * is one of the six the cockpit and the chase camera share digits over.
	 */
	readonly views: readonly ViewMode[];
	/** Whether the player may move it: the diagnostics and the rig keys may not. */
	readonly rebindable: boolean;
}

export interface ControlsCatalogue {
	/** #370 D5: `default` until the registry can report a player layout. */
	readonly layout: "default" | "player";
	readonly commands: readonly ControlCommand[];
}

const row = (c: Command): ControlCommand => ({
	id: c.id,
	name: c.name,
	group: c.group,
	defaultTriggers: c.defaultTriggers,
	// The player's layout is #381's storage slice; until it lands the only
	// layout is the shipped one, and `layout` below says so rather than the
	// screen claiming a layout it cannot report.
	currentTriggers: c.defaultTriggers,
	contexts: c.contexts,
	views: c.views,
	rebindable: c.rebindable,
});

export const CONTROLS: ControlsCatalogue = {
	layout: "default",
	commands: COMMANDS.map(row),
};

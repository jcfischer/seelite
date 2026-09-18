/**
 * Every control the game has, as data a screen can print (#370, #372).
 *
 * **This is the interface #370's D2 declared, and an interim filling of it.**
 * #369's binding registry will replace what is below the interface; the
 * interface — one entry per command, default and current triggers, trigger
 * kinds, the contexts a command is live in, and a task group — is what the
 * Controls tab renders from and what `tests/controls-catalogue.test.ts` holds.
 *
 * **What is derived, and what is stated.** The pad's half is derived here, at
 * load, by asking `pad-bindings.ts` what each button does in each context — the
 * same functions the game calls — so a rebound button moves its row with no
 * edit to this file. The keyboard's half cannot be: its bindings live in
 * `main.ts`'s key switch, which the unit tier cannot load. So the keys are
 * stated, and the completeness test reads `main.ts` with the partition test's
 * own scanner and goes red in both directions — a bound key the catalogue
 * lacks, and a printed key nothing binds. Three of the stated keys are
 * restated rather than imported for a different reason: `PERF_KEYS`,
 * `RESTORE_KEY` and `SETTINGS_KEY` live in modules the game loads on demand,
 * and a static import from here would pull both into the eager bundle. The
 * test imports them instead.
 *
 * Authored, because the code carries neither: the display names and the task
 * groups.
 *
 * Headless, and on the list in `tests/headless.test.ts`: the unit tier renders
 * **this** catalogue, never a struct a test built.
 */
import { type PadButtonName, type PadFrame, STANDARD_BUTTONS } from "./gamepad";
import { COMMANDER_KEY } from "./commander-overlay";
import {
	type PadContext,
	type PadIntents,
	padFireHeld,
	padFlightAxes,
	padIntents,
} from "./pad-bindings";

/** #370 D6: grouped by task, in this order. */
export const TASK_GROUPS = [
	"fly",
	"fight",
	"dock",
	"trade",
	"view",
	"system",
] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

/** The four contexts the pad model knows, in the order a note prints them. */
export const PAD_CONTEXTS: readonly PadContext[] = [
	"flight",
	"instrument",
	"console",
	"modal",
];

/** `PadIntents` less its `keys`: the six things a pad does that are not a key. */
export type PanelIntent = Exclude<keyof PadIntents, "keys">;
export const PANEL_INTENTS: readonly PanelIntent[] = [
	"focusDelta",
	"tabDelta",
	"valueDelta",
	"activate",
	"back",
	"instrument",
];

/**
 * One way to reach a command.
 *
 * #370 D2's trigger kinds: a character key, a mouse button, mouse movement, a
 * pad button, a pad stick, a pad trigger, and the non-key pad intents. The pad
 * kinds carry the contexts they are live in, because that is where a pad
 * button's meaning changes and the reason a row needs a context note at all.
 */
export type Trigger =
	| {
			readonly kind: "key";
			/** `KeyboardEvent.key`, lowercased — what `onKey` compares. */
			readonly key: string;
			readonly alt?: true;
			/** Held rather than pressed. */
			readonly hold?: true;
			/** Named when only one surface takes the key. */
			readonly surface?: string;
	  }
	| { readonly kind: "mouse-button"; readonly action: "hold" | "click" }
	| { readonly kind: "mouse-move"; readonly axis: "x" | "y" }
	| {
			readonly kind: "pad-button";
			readonly button: PadButtonName;
			readonly hold?: true;
			readonly contexts: readonly PadContext[];
	  }
	| {
			readonly kind: "pad-stick";
			readonly stick: "left" | "right";
			readonly axis: "x" | "y";
			readonly contexts: readonly PadContext[];
	  }
	| {
			readonly kind: "pad-trigger";
			readonly trigger: "l2" | "r2";
			readonly contexts: readonly PadContext[];
	  }
	| {
			readonly kind: "pad-intent";
			readonly intent: PanelIntent;
			readonly button: PadButtonName;
			readonly contexts: readonly PadContext[];
	  };

export interface ControlCommand {
	/** Not a key string: a command keeps its id when #369 rebinds it. */
	readonly id: string;
	readonly name: string;
	readonly group: TaskGroup;
	readonly defaultTriggers: readonly Trigger[];
	/** What is bound now. Until #369 lands this *is* the default. */
	readonly currentTriggers: readonly Trigger[];
	/**
	 * The pad contexts this command is live in, from its pad triggers. Empty
	 * when it has none — the keyboard and the mouse are not part of the pad's
	 * context model, so a key-only command carries no note.
	 */
	readonly contexts: readonly PadContext[];
}

export interface ControlsCatalogue {
	/** #370 D5: `default` until the registry can report a player layout. */
	readonly layout: "default" | "player";
	readonly commands: readonly ControlCommand[];
}

// ---------------------------------------------------------------------------
// The pad, asked
// ---------------------------------------------------------------------------

const ZERO_VALUES = Object.fromEntries(
	STANDARD_BUTTONS.map((b) => [b, 0]),
) as Record<PadButtonName, number>;

function frame(part: Partial<PadFrame>): PadFrame {
	return {
		connected: true,
		id: "controls-catalogue",
		axes: { leftX: 0, leftY: 0, rightX: 0, rightY: 0 },
		values: ZERO_VALUES,
		held: new Set(),
		pressed: new Set(),
		released: new Set(),
		...part,
	};
}

/** What one pressed button does in each context: keys and intents. */
function padPresses() {
	const keys = new Map<string, Map<PadButtonName, PadContext[]>>();
	const intents = new Map<PanelIntent, Map<PadButtonName, PadContext[]>>();
	const note = <K>(
		into: Map<K, Map<PadButtonName, PadContext[]>>,
		what: K,
		button: PadButtonName,
		context: PadContext,
	) => {
		const byButton = into.get(what) ?? new Map<PadButtonName, PadContext[]>();
		into.set(what, byButton);
		byButton.set(button, [...(byButton.get(button) ?? []), context]);
	};
	for (const button of STANDARD_BUTTONS)
		for (const context of PAD_CONTEXTS) {
			const out = padIntents(frame({ pressed: new Set([button]) }), context);
			for (const key of out.keys) note(keys, key, button, context);
			for (const intent of PANEL_INTENTS)
				if (out[intent] !== 0 && out[intent] !== false)
					note(intents, intent, button, context);
		}
	return { keys, intents };
}

const PRESSES = padPresses();

/** The contexts in which `live` answers yes. */
const liveIn = (live: (context: PadContext) => boolean) =>
	PAD_CONTEXTS.filter(live);

type Axis = "yaw" | "pitch" | "roll";

/** The stick axis that drives `axis`, found by pushing each one. */
function stickFor(axis: Axis): Trigger[] {
	const out: Trigger[] = [];
	for (const [name, stick, dir] of [
		["leftX", "left", "x"],
		["leftY", "left", "y"],
		["rightX", "right", "x"],
		["rightY", "right", "y"],
	] as const) {
		const axes = { leftX: 0, leftY: 0, rightX: 0, rightY: 0, [name]: 1 };
		const contexts = liveIn(
			(c) => padFlightAxes(frame({ axes }), c)[axis] !== 0,
		);
		if (contexts.length > 0)
			out.push({ kind: "pad-stick", stick, axis: dir, contexts });
	}
	return out;
}

/** The trigger that moves the throttle in `sign`'s direction. */
function triggerFor(sign: 1 | -1): Trigger[] {
	return (["l2", "r2"] as const).flatMap((trigger) => {
		const values = { ...ZERO_VALUES, [trigger]: 1 };
		const contexts = liveIn(
			(c) =>
				Math.sign(padFlightAxes(frame({ values }), c).throttleTrim) === sign,
		);
		return contexts.length > 0
			? [{ kind: "pad-trigger" as const, trigger, contexts }]
			: [];
	});
}

/** The button held for the pulse laser. */
function fireButtons(): Trigger[] {
	return STANDARD_BUTTONS.flatMap((button) => {
		const contexts = liveIn((c) =>
			padFireHeld(frame({ held: new Set([button]) }), c),
		);
		return contexts.length > 0
			? [{ kind: "pad-button" as const, button, hold: true as const, contexts }]
			: [];
	});
}

// ---------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------

type KeySpec = string | Omit<Extract<Trigger, { kind: "key" }>, "kind">;

interface Authored {
	id: string;
	name: string;
	group: TaskGroup;
	keys?: KeySpec[];
	/** Triggers that are not keys, or pad triggers not reached through a key. */
	more?: Trigger[];
	intent?: PanelIntent;
}

const PERF = "perf panel, behind ?perf";

/**
 * The authored half: names and groups, and the keys `main.ts` cannot export.
 *
 * `PERF_KEYS` is `b h y r o p` and `RESTORE_KEY` is `i` in `perf-panel.ts`;
 * `SETTINGS_KEY` is `z` in `settings-panel.ts`. See the header for why they are
 * restated, and the test for what holds them.
 */
const AUTHORED: readonly Authored[] = [
	// fly
	{
		id: "pitch",
		name: "Pitch: nose up / nose down",
		group: "fly",
		keys: [
			{ key: "s", hold: true },
			{ key: "w", hold: true },
			{ key: "arrowdown", hold: true },
			{ key: "arrowup", hold: true },
		],
		more: [{ kind: "mouse-move", axis: "y" }, ...stickFor("pitch")],
	},
	{
		id: "yaw",
		name: "Yaw: nose left / nose right",
		group: "fly",
		keys: [
			{ key: "a", hold: true },
			{ key: "d", hold: true },
			{ key: "arrowleft", hold: true },
			{ key: "arrowright", hold: true },
		],
		more: [{ kind: "mouse-move", axis: "x" }, ...stickFor("yaw")],
	},
	{
		id: "roll",
		name: "Roll left / roll right",
		group: "fly",
		keys: [
			{ key: "q", hold: true },
			{ key: "e", hold: true },
		],
		more: stickFor("roll"),
	},
	{
		id: "throttle-up",
		name: "Throttle up",
		group: "fly",
		keys: [{ key: "shift", hold: true }],
		more: triggerFor(1),
	},
	{
		id: "throttle-down",
		name: "Throttle down",
		group: "fly",
		keys: [{ key: "control", hold: true }],
		more: triggerFor(-1),
	},
	{
		id: "assist-or-beam",
		name: "Flight assist on/off (press) · fire the beam (hold, combat rig)",
		group: "fly",
		keys: ["x"],
	},
	{
		id: "cruise",
		name: "Engage or drop cruise",
		group: "fly",
		keys: ["j"],
	},
	{ id: "jump", name: "Wind up the jump", group: "fly", keys: ["`"] },
	{
		// #371: a console gives the pointer up, and nothing takes it back but
		// the next click on the glass.
		id: "take-pointer",
		name: "Give the mouse back to the ship: click the view",
		group: "fly",
		more: [{ kind: "mouse-button", action: "click" }],
	},
	// fight
	{
		id: "fire",
		name: "Fire the pulse laser",
		group: "fight",
		keys: [{ key: " ", hold: true }],
		more: [{ kind: "mouse-button", action: "hold" }, ...fireButtons()],
	},
	{ id: "target-next", name: "Next target", group: "fight", keys: ["t"] },
	{
		id: "target-previous",
		name: "Previous target",
		group: "fight",
		keys: ["g"],
	},
	{ id: "face-target", name: "Face the target", group: "fight", keys: ["f"] },
	{
		id: "rig-incoming",
		name: "Call an incoming raider (combat rig)",
		group: "fight",
		keys: ["/"],
	},
	{
		id: "rig-ecm",
		name: "Fire the ECM (combat rig)",
		group: "fight",
		keys: ["q"],
	},
	// dock
	{
		id: "clearance",
		name: "Request docking clearance",
		group: "dock",
		keys: ["c"],
	},
	{
		id: "docking-computer",
		name: "Docking computer on/off",
		group: "dock",
		keys: ["u"],
	},
	{
		id: "launch",
		name: "Launch, or skip the traversal",
		group: "dock",
		keys: ["enter"],
	},
	// trade
	{
		id: "market-row",
		name: "Buy, sell or fit: act on a station row",
		group: "trade",
		more: [{ kind: "mouse-button", action: "click" }],
		intent: "activate",
	},
	// view
	{
		id: "head-left",
		name: "Head to port console",
		group: "view",
		keys: ["1", { key: "arrowleft", alt: true }],
	},
	{
		id: "head-forward",
		name: "Head forward",
		group: "view",
		keys: ["2", { key: "arrowup", alt: true }],
	},
	{
		id: "head-right",
		name: "Head to starboard console",
		group: "view",
		keys: ["3", { key: "arrowright", alt: true }],
	},
	{
		id: "controls-reference",
		name: "This reference: open or close",
		group: "view",
		keys: ["?"],
	},
	{ id: "view", name: "Cockpit or chase view", group: "view", keys: ["v"] },
	{
		id: "chase-orbit",
		name: "Orbit the chase camera (chase view)",
		group: "view",
		keys: [
			{ key: "1", hold: true },
			{ key: "3", hold: true },
		],
	},
	{
		id: "chase-centre",
		name: "Centre the chase camera (chase view)",
		group: "view",
		keys: ["2"],
	},
	// system
	{ id: "settings", name: "Settings", group: "system", keys: ["z"] },
	{
		id: "commander",
		name: "Commanders: save, load, switch",
		group: "system",
		keys: [COMMANDER_KEY],
	},
	{
		id: "console-cursor",
		name: "Walk a console's cursor",
		group: "system",
		keys: [
			{ key: "arrowup", surface: "Requests" },
			{ key: "arrowdown", surface: "Requests" },
		],
		intent: "focusDelta",
	},
	{
		id: "console-tab",
		name: "Change a console's tab",
		group: "system",
		keys: [
			{ key: "arrowleft", surface: "Requests" },
			{ key: "arrowright", surface: "Requests" },
		],
		more: [{ kind: "mouse-button", action: "click" }],
		intent: "tabDelta",
	},
	{
		id: "console-activate",
		name: "Select the row under the cursor",
		group: "system",
		keys: [{ key: "enter", surface: "Requests" }],
		more: [{ kind: "mouse-button", action: "click" }],
		intent: "activate",
	},
	{
		id: "console-back",
		name: "Close a console, or turn the head forward",
		group: "system",
		intent: "back",
	},
	{
		id: "menu-value",
		name: "Change a setting's value",
		group: "system",
		intent: "valueDelta",
	},
	{
		id: "instrument",
		name: "Hand the pad to the frame instrument, and back",
		group: "system",
		intent: "instrument",
	},
	{
		id: "dial-reset",
		name: "Reset the cruise dials",
		group: "system",
		keys: ["0"],
	},
	{
		id: "dial-exponent",
		name: "Cruise dial: exponent up / down",
		group: "system",
		keys: ["]", "["],
	},
	{
		id: "dial-vmax",
		name: "Cruise dial: top speed up / down",
		group: "system",
		keys: ["=", "-"],
	},
	{
		id: "dial-drop-radius",
		name: "Cruise dial: drop radius up / down",
		group: "system",
		keys: ["'", ";"],
	},
	{
		id: "dial-drop-speed",
		name: "Cruise dial: drop speed up / down",
		group: "system",
		keys: [".", ","],
	},
	{
		id: "dial-vicinity",
		name: "Cruise dial: vicinity up / down",
		group: "system",
		keys: ["m", "n"],
	},
	{
		id: "dial-approach-lead",
		name: "Cruise dial: approach lead up / down",
		group: "system",
		keys: ["l", "k"],
	},
	{ id: "perf-bloom", name: `Bloom (${PERF})`, group: "system", keys: ["b"] },
	{
		id: "perf-atmosphere",
		name: `Atmosphere (${PERF})`,
		group: "system",
		keys: ["h"],
	},
	{ id: "perf-clouds", name: `Clouds (${PERF})`, group: "system", keys: ["y"] },
	{ id: "perf-relief", name: `Relief (${PERF})`, group: "system", keys: ["r"] },
	{
		id: "perf-craters",
		name: `Craters (${PERF})`,
		group: "system",
		keys: ["o"],
	},
	{
		id: "perf-class",
		name: `Planet class (${PERF})`,
		group: "system",
		keys: ["p"],
	},
	{
		id: "perf-restore",
		name: `Restore every switch (${PERF})`,
		group: "system",
		keys: ["i"],
	},
];

const keyTrigger = (spec: KeySpec): Trigger =>
	typeof spec === "string"
		? { kind: "key", key: spec }
		: { kind: "key", ...spec };

/**
 * The pad buttons that press one of this command's keys.
 *
 * Only a key that is *pressed* — a pad button is a press, and `padIntents`
 * hands `Game.command` a key, never a held one. So the d-pad reaches head-look
 * through `1` and does not reach the chase orbit, which reads `1` held.
 */
function padButtonsFor(keys: readonly Trigger[]): Trigger[] {
	const out: Trigger[] = [];
	for (const t of keys) {
		if (t.kind !== "key" || t.hold || t.alt || t.surface) continue;
		for (const [button, contexts] of PRESSES.keys.get(t.key) ?? [])
			out.push({ kind: "pad-button", button, contexts });
	}
	return out;
}

function padIntentTriggers(intent: PanelIntent): Trigger[] {
	return [...(PRESSES.intents.get(intent) ?? [])].map(([button, contexts]) => ({
		kind: "pad-intent" as const,
		intent,
		button,
		contexts,
	}));
}

const contextsOf = (triggers: readonly Trigger[]): PadContext[] => {
	const live = new Set<PadContext>();
	for (const t of triggers)
		if ("contexts" in t) for (const c of t.contexts) live.add(c);
	return PAD_CONTEXTS.filter((c) => live.has(c));
};

function build(a: Authored): ControlCommand {
	const keys = (a.keys ?? []).map(keyTrigger);
	const triggers: Trigger[] = [
		...keys,
		...padButtonsFor(keys),
		...(a.more ?? []),
		...(a.intent ? padIntentTriggers(a.intent) : []),
	];
	return {
		id: a.id,
		name: a.name,
		group: a.group,
		defaultTriggers: triggers,
		currentTriggers: triggers,
		contexts: contextsOf(triggers),
	};
}

export const CONTROLS: ControlsCatalogue = {
	layout: "default",
	commands: AUTHORED.map(build),
};

/**
 * The binding registry: what a command is called, and what reaches it (#381).
 *
 * #369 ratified the model this module implements, and the rulings are its law
 * rather than this file's preference:
 *
 * - **D1** — a command has a namespaced id of its own, never a key string. A
 *   key is one way to reach `fly.pitchUp`; it is not its name.
 * - **D2** — the smallest thing one trigger can cause is one command. Pitch up
 *   and pitch down are two, the twelve dial steps are twelve, head-look is
 *   three. A stick does cause both directions, and that is answered without a
 *   second kind of bindable thing: a stick's two halves are two signed
 *   bindings on two directional commands, exactly as `r2`/`l2` already produce
 *   the throttle trim.
 * - **D3** — a trigger whose meaning *game state* picks is one command with
 *   state-resolved arms (`fly.cruise`, `dock.launch`, `view.headForward`); a
 *   trigger whose meaning the *gesture* picks is two commands (`x` pressed is
 *   `fly.assist`, `x` held is `fight.fireBeam`).
 * - **D4** — a binding is `(command, trigger, context-set)` in one table. The
 *   player edits the trigger; the context set is the command's. And the
 *   context set is **not** `PadContext` alone: `view` decides meaning too, so
 *   `1` is head-look in the cockpit and the chase orbit in chase, and a note
 *   that reads only the four-value union is confidently wrong on exactly the
 *   rows a player asks about.
 * - **D5** — two predicates, not one. A *default* layout that collides is red;
 *   a *player* layout that collides is a printed warning. They are different
 *   questions and cannot share a row.
 * - **D7** — dispatch is on the physical key (`code`) and print is on the
 *   character the binding was *recorded* with, so the tab keeps printing
 *   characters. **The shipped letter defaults do not carry a `code` yet**, and
 *   saying otherwise would be claiming the AZERTY property this slice has not
 *   built: only the three Alt chords carry one, because `ALT_CHORDS` is keyed
 *   on `code` already. `triggerKey` reads `code ?? key`, so it is ready for
 *   them; authoring the letter rows and migrating a saved layout belongs to
 *   the dispatch slice, which is where the codes have a consumer.
 *
 * **What is derived and what is authored**, unchanged from #372's interim
 * module because the reason has not changed: the pad's half is derived here,
 * at load, by asking `pad-bindings.ts` what each button does in each context —
 * the same functions the game calls — so a rebound button moves its row with
 * no edit here. The keyboard's half cannot be: its bindings live in `main.ts`'s
 * key switch, which the unit tier cannot load. So the keys are stated and
 * `tests/controls-catalogue.test.ts` reads `main.ts` with the partition test's
 * own scanner, in both directions.
 *
 * Headless, and on the list in `tests/headless.test.ts`.
 */
import { COMMANDER_KEY } from "./commander-overlay";
import { type PadButtonName, type PadFrame, STANDARD_BUTTONS } from "./gamepad";
import { ALT_CHORDS } from "./key-dispatch";
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

/**
 * The second half of a context, and the half `PadContext` cannot express
 * (#369 D4's consequence). `1` and `3` are head-look in the cockpit and the
 * chase orbit in chase; `2` is head-forward in one and a reset in the other.
 */
export const VIEW_MODES = ["cockpit", "chase"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

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
 * Which half of a signed input this binding is.
 *
 * D2's hard case. A stick, a mouse axis and a signed pad intent each cause
 * both directions of a pair, and the registry holds no `axis` entity — so the
 * two halves are two bindings, one on each of the pair's commands, and this
 * says which.
 */
export type Half = "+" | "-";

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
			/** `KeyboardEvent.key`, lowercased — what `onKey` compares, and, per
			 *  D7, the character this binding was *recorded* with, which is how it
			 *  prints. */
			readonly key: string;
			readonly alt?: true;
			/** The physical key (`KeyboardEvent.code`) the dispatch matches on
			 *  (D7). Absent where the character is all the code states. */
			readonly code?: string;
			/** Held rather than pressed. */
			readonly hold?: true;
			/** The screen that claims this key, when one does. Absent is the
			 *  ship's own surface — see `Scope`. */
			readonly surface?: string;
	  }
	| {
			readonly kind: "mouse-button";
			readonly action: "hold" | "click";
			readonly surface?: string;
	  }
	| {
			readonly kind: "mouse-move";
			readonly axis: "x" | "y";
			readonly half: Half;
	  }
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
			readonly half: Half;
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
			readonly half?: Half;
			readonly contexts: readonly PadContext[];
	  };

// ---------------------------------------------------------------------------
// The pad, asked
// ---------------------------------------------------------------------------

const ZERO_VALUES = Object.fromEntries(
	STANDARD_BUTTONS.map((b) => [b, 0]),
) as Record<PadButtonName, number>;

function frame(part: Partial<PadFrame>): PadFrame {
	return {
		connected: true,
		id: "commands",
		axes: { leftX: 0, leftY: 0, rightX: 0, rightY: 0 },
		values: ZERO_VALUES,
		held: new Set(),
		pressed: new Set(),
		released: new Set(),
		...part,
	};
}

const halfOf = (value: number): Half => (value > 0 ? "+" : "-");

/** What one pressed button does in each context: keys, and signed intents. */
function padPresses() {
	const keys = new Map<string, Map<PadButtonName, PadContext[]>>();
	type IntentKey = `${PanelIntent}${Half}`;
	const intents = new Map<IntentKey, Map<PadButtonName, PadContext[]>>();
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
			for (const intent of PANEL_INTENTS) {
				const value = out[intent];
				if (value === 0 || value === false) continue;
				// A boolean intent has no sign and no pair; a numeric one is one
				// half of a pair, and which half is what the pad says it is.
				const half = typeof value === "number" ? halfOf(value) : "+";
				note(intents, `${intent}${half}` as IntentKey, button, context);
			}
		}
	return { keys, intents };
}

const PRESSES = padPresses();

/** The contexts in which `live` answers yes. */
const liveIn = (live: (context: PadContext) => boolean) =>
	PAD_CONTEXTS.filter(live);

type Axis = "yaw" | "pitch" | "roll";

/**
 * The stick push that drives `axis` in the direction `sign` names, found by
 * pushing each stick both ways and reading the sign the axis law returns —
 * never by restating a sign this module would then own a second copy of.
 *
 * `half` is the direction the *player* pushes, which is what a row prints and
 * what a capture would record; the command it lands on is what carries the
 * meaning.
 */
function stickFor(axis: Axis, sign: 1 | -1): Trigger[] {
	const out: Trigger[] = [];
	for (const [name, stick, dir] of [
		["leftX", "left", "x"],
		["leftY", "left", "y"],
		["rightX", "right", "x"],
		["rightY", "right", "y"],
	] as const)
		for (const push of [1, -1] as const) {
			const axes = { leftX: 0, leftY: 0, rightX: 0, rightY: 0, [name]: push };
			const contexts = liveIn(
				(c) => Math.sign(padFlightAxes(frame({ axes }), c)[axis]) === sign,
			);
			if (contexts.length > 0)
				out.push({
					kind: "pad-stick",
					stick,
					axis: dir,
					half: halfOf(push),
					contexts,
				});
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

/**
 * A key the player *presses*, as opposed to holds, chords or presses on one
 * surface: what a pad button and an Alt chord can stand for, and what the
 * mapping test looks up in `main.ts`'s switch. One predicate for all three.
 */
export const isPressedKey = (
	t: Trigger,
): t is Extract<Trigger, { kind: "key" }> =>
	t.kind === "key" && !t.hold && !t.alt && !t.surface;

type KeySpec = string | Omit<Extract<Trigger, { kind: "key" }>, "kind">;

interface Authored {
	readonly id: string;
	readonly name: string;
	readonly group: TaskGroup;
	/** The views this command is live in. Absent means both (#369 D4). */
	views?: readonly ViewMode[];
	/**
	 * Catalogued and printed, but not offered for rebinding. Three different
	 * reasons, and a consumer that conflates them will be wrong about one:
	 *
	 * - the `?perf` diagnostics (#369's D12 rider), which
	 *   `tests/perf-panel-keys.test.ts` exists to keep off the flight path;
	 * - the two combat-rig keys, inert outside `?combat=1`;
	 * - the pointer rows, which have **no movable trigger at all** — a click on
	 *   a station row or on the glass is #370's standing premise that a screen
	 *   is always clickable, not a binding a player could move elsewhere.
	 */
	readonly rebindable?: false;
	readonly keys?: readonly KeySpec[];
	/** Triggers that are not keys, or pad triggers not reached through a key. */
	readonly more?: readonly Trigger[];
	readonly intent?: PanelIntent;
	/** Which half of a signed intent. Absent on the boolean three. */
	readonly intentHalf?: Half;
}

const PERF = "perf panel, behind ?perf";
const COCKPIT = ["cockpit"] as const;
const CHASE = ["chase"] as const;

/**
 * Every command the game has, at D2's granularity.
 *
 * The ids are namespaced and none of them is a key string. The names, the task
 * groups and the view liveness are authored, because the code carries none of
 * the three; everything else on a row is derived.
 *
 * `PERF_KEYS` is `b h y r o p` and `RESTORE_KEY` is `i` in `perf-panel.ts`;
 * `SETTINGS_KEY` is `z` in `settings-panel.ts`. They are restated rather than
 * imported because those modules are loaded on demand and a static import from
 * here would pull both into the eager bundle; the test imports them instead.
 */
const AUTHORED = [
	// fly ---------------------------------------------------------------
	{
		id: "fly.pitchUp",
		name: "Pitch: nose up",
		group: "fly",
		keys: [
			{ key: "s", hold: true },
			{ key: "arrowdown", hold: true },
		],
		// `pitch` is negated off `mouseDy` (`main.ts:10886`), so the nose comes
		// up as the mouse comes back.
		more: [
			{ kind: "mouse-move", axis: "y", half: "+" },
			...stickFor("pitch", -1),
		],
	},
	{
		id: "fly.pitchDown",
		name: "Pitch: nose down",
		group: "fly",
		keys: [
			{ key: "w", hold: true },
			{ key: "arrowup", hold: true },
		],
		more: [
			{ kind: "mouse-move", axis: "y", half: "-" },
			...stickFor("pitch", 1),
		],
	},
	{
		id: "fly.yawPort",
		name: "Yaw: nose to port",
		group: "fly",
		keys: [
			{ key: "a", hold: true },
			{ key: "arrowleft", hold: true },
		],
		more: [{ kind: "mouse-move", axis: "x", half: "-" }, ...stickFor("yaw", 1)],
	},
	{
		id: "fly.yawStarboard",
		name: "Yaw: nose to starboard",
		group: "fly",
		keys: [
			{ key: "d", hold: true },
			{ key: "arrowright", hold: true },
		],
		more: [
			{ kind: "mouse-move", axis: "x", half: "+" },
			...stickFor("yaw", -1),
		],
	},
	{
		// `axis(["e"], ["q"])` at `main.ts:10796`: `q` is the positive term, and
		// positive is port in all three axes — `chaseOrbitInput`'s own comment
		// holds the same convention for `1` and `3`. There is no mouse roll:
		// `impulse.roll` is a hard `0`.
		id: "fly.rollPort",
		name: "Roll to port",
		group: "fly",
		keys: [{ key: "q", hold: true }],
		more: stickFor("roll", 1),
	},
	{
		id: "fly.rollStarboard",
		name: "Roll to starboard",
		group: "fly",
		keys: [{ key: "e", hold: true }],
		more: stickFor("roll", -1),
	},
	{
		id: "fly.throttleUp",
		name: "Throttle up",
		group: "fly",
		keys: [{ key: "shift", hold: true }],
		more: triggerFor(1),
	},
	{
		id: "fly.throttleDown",
		name: "Throttle down",
		group: "fly",
		keys: [{ key: "control", hold: true }],
		more: triggerFor(-1),
	},
	{
		// D3: the gesture picks the meaning, so the press and the hold are two
		// commands. The press is here; the hold is `fight.fireBeam`.
		id: "fly.assist",
		name: "Flight assist on/off",
		group: "fly",
		keys: ["x"],
	},
	{
		// D3: game state picks the meaning — engage, drop out, or cancel the
		// spool — so it is one command with three arms and one row.
		id: "fly.cruise",
		name: "Engage or drop cruise",
		group: "fly",
		keys: ["j"],
	},
	{ id: "fly.jump", name: "Wind up the jump", group: "fly", keys: ["`"] },
	{
		// #371: a console gives the pointer up, and nothing takes it back but
		// the next click on the glass.
		id: "fly.takePointer",
		name: "Give the mouse back to the ship: click the view",
		group: "fly",
		// A pointer row, for `trade.actOnRow`'s reason: its only trigger is the
		// click that acquires pointer lock, and there is nowhere else to put it.
		rebindable: false,
		more: [{ kind: "mouse-button", action: "click", surface: "the view" }],
	},
	// fight -------------------------------------------------------------
	{
		id: "fight.firePulse",
		name: "Fire the pulse laser",
		group: "fight",
		keys: [{ key: " ", hold: true }],
		more: [{ kind: "mouse-button", action: "hold" }, ...fireButtons()],
	},
	{
		// The other half of D3's split on `x`. `combat-rig.ts` reads `BEAM_KEY`
		// held every frame; `fly.assist` takes the press.
		id: "fight.fireBeam",
		name: "Fire the beam (combat rig)",
		group: "fight",
		keys: [{ key: "x", hold: true }],
	},
	{ id: "fight.targetNext", name: "Next target", group: "fight", keys: ["t"] },
	{
		id: "fight.targetPrevious",
		name: "Previous target",
		group: "fight",
		keys: ["g"],
	},
	{
		id: "fight.faceTarget",
		name: "Face the target",
		group: "fight",
		keys: ["f"],
	},
	{
		id: "fight.rigIncoming",
		name: "Call an incoming raider (combat rig)",
		group: "fight",
		rebindable: false,
		keys: ["/"],
	},
	{
		id: "fight.rigEcm",
		name: "Fire the ECM (combat rig)",
		group: "fight",
		rebindable: false,
		keys: ["q"],
	},
	// dock --------------------------------------------------------------
	{
		id: "dock.clearance",
		name: "Request docking clearance",
		group: "dock",
		keys: ["c"],
	},
	{
		id: "dock.computer",
		name: "Docking computer on/off",
		group: "dock",
		keys: ["u"],
	},
	{
		// D3 again: docked it launches, in the traversal it skips. One command.
		id: "dock.launch",
		name: "Launch, or skip the traversal",
		group: "dock",
		keys: ["enter"],
	},
	// trade -------------------------------------------------------------
	{
		// A pointer on a station row, and deliberately not a binding: #370's
		// standing premise is that the mouse is always available, and the pad
		// reaches the same row through `panel.activate`.
		id: "trade.actOnRow",
		name: "Buy, sell or fit: click a station row",
		group: "trade",
		rebindable: false,
		more: [
			{ kind: "mouse-button", action: "click", surface: "a station console" },
		],
	},
	// view --------------------------------------------------------------
	{
		id: "view.headPort",
		name: "Head to port console",
		group: "view",
		views: COCKPIT,
		keys: ["1"],
	},
	{
		id: "view.headForward",
		name: "Head forward",
		group: "view",
		views: COCKPIT,
		keys: ["2"],
	},
	{
		id: "view.headStarboard",
		name: "Head to starboard console",
		group: "view",
		views: COCKPIT,
		keys: ["3"],
	},
	{
		id: "view.reference",
		name: "This reference: open or close",
		group: "view",
		keys: ["?", "f1"],
	},
	{
		id: "view.toggle",
		name: "Cockpit or chase view",
		group: "view",
		keys: ["v"],
	},
	{
		// Chase only, and held rather than pressed — which is why the same two
		// digits are not a collision with head-look, twice over.
		id: "view.orbitPort",
		name: "Orbit the chase camera to port",
		group: "view",
		views: CHASE,
		keys: [{ key: "1", hold: true }],
	},
	{
		id: "view.orbitStarboard",
		name: "Orbit the chase camera to starboard",
		group: "view",
		views: CHASE,
		keys: [{ key: "3", hold: true }],
	},
	{
		id: "view.orbitCentre",
		name: "Centre the chase camera",
		group: "view",
		views: CHASE,
		keys: ["2"],
	},
	// system: the two player screens ------------------------------------
	{ id: "system.settings", name: "Settings", group: "system", keys: ["z"] },
	{
		id: "system.commander",
		name: "Commanders: save, load, switch",
		group: "system",
		keys: [COMMANDER_KEY],
	},
	// system: the panel grammar -----------------------------------------
	{
		id: "panel.cursorUp",
		name: "Walk a console's cursor up",
		group: "system",
		keys: [{ key: "arrowup", surface: "Requests" }],
		intent: "focusDelta",
		intentHalf: "-",
	},
	{
		id: "panel.cursorDown",
		name: "Walk a console's cursor down",
		group: "system",
		keys: [{ key: "arrowdown", surface: "Requests" }],
		intent: "focusDelta",
		intentHalf: "+",
	},
	{
		// **A pointer names a tab; it does not step one.** The interim module
		// carried the tab click on a single combined row, where the direction
		// was not being claimed. Split per D2, the same click would be a
		// binding on *both* halves and the two would collide on it — which is
		// the resolution's own ruling about DOM rows arriving at the tab strip:
		// the mouse is #370's standing premise that a screen is always
		// clickable, not a trigger a player can move.
		id: "panel.tabPrevious",
		name: "Previous console tab",
		group: "system",
		keys: [{ key: "arrowleft", surface: "Requests" }],
		intent: "tabDelta",
		intentHalf: "-",
	},
	{
		id: "panel.tabNext",
		name: "Next console tab",
		group: "system",
		keys: [{ key: "arrowright", surface: "Requests" }],
		intent: "tabDelta",
		intentHalf: "+",
	},
	{
		id: "panel.activate",
		name: "Select the row under the cursor",
		group: "system",
		keys: [{ key: "enter", surface: "Requests" }],
		more: [{ kind: "mouse-button", action: "click", surface: "a console row" }],
		intent: "activate",
	},
	{
		id: "panel.back",
		name: "Close a console, or turn the head forward",
		group: "system",
		intent: "back",
	},
	{
		id: "panel.valueDown",
		name: "Turn a setting down",
		group: "system",
		intent: "valueDelta",
		intentHalf: "-",
	},
	{
		id: "panel.valueUp",
		name: "Turn a setting up",
		group: "system",
		intent: "valueDelta",
		intentHalf: "+",
	},
	{
		id: "panel.instrument",
		name: "Hand the pad to the frame instrument, and back",
		group: "system",
		intent: "instrument",
	},
	// system: the cruise dials, twelve steps and a reset -----------------
	{
		id: "tune.reset",
		name: "Reset the cruise dials",
		group: "system",
		keys: ["0"],
	},
	{
		id: "tune.exponentUp",
		name: "Cruise dial: exponent up",
		group: "system",
		keys: ["]"],
	},
	{
		id: "tune.exponentDown",
		name: "Cruise dial: exponent down",
		group: "system",
		keys: ["["],
	},
	{
		id: "tune.vMaxUp",
		name: "Cruise dial: top speed up",
		group: "system",
		keys: ["="],
	},
	{
		id: "tune.vMaxDown",
		name: "Cruise dial: top speed down",
		group: "system",
		keys: ["-"],
	},
	{
		id: "tune.dropRadiusUp",
		name: "Cruise dial: drop radius up",
		group: "system",
		keys: ["'"],
	},
	{
		id: "tune.dropRadiusDown",
		name: "Cruise dial: drop radius down",
		group: "system",
		keys: [";"],
	},
	{
		id: "tune.dropSpeedUp",
		name: "Cruise dial: drop speed up",
		group: "system",
		keys: ["."],
	},
	{
		id: "tune.dropSpeedDown",
		name: "Cruise dial: drop speed down",
		group: "system",
		keys: [","],
	},
	{
		id: "tune.vicinityUp",
		name: "Cruise dial: vicinity up",
		group: "system",
		keys: ["m"],
	},
	{
		id: "tune.vicinityDown",
		name: "Cruise dial: vicinity down",
		group: "system",
		keys: ["n"],
	},
	{
		id: "tune.approachLeadUp",
		name: "Cruise dial: approach lead up",
		group: "system",
		keys: ["l"],
	},
	{
		id: "tune.approachLeadDown",
		name: "Cruise dial: approach lead down",
		group: "system",
		keys: ["k"],
	},
	// system: the diagnostics, catalogued and not rebindable -------------
	{
		id: "perf.bloom",
		name: `Bloom (${PERF})`,
		group: "system",
		rebindable: false,
		keys: ["b"],
	},
	{
		id: "perf.atmosphere",
		name: `Atmosphere (${PERF})`,
		group: "system",
		rebindable: false,
		keys: ["h"],
	},
	{
		id: "perf.clouds",
		name: `Clouds (${PERF})`,
		group: "system",
		rebindable: false,
		keys: ["y"],
	},
	{
		id: "perf.relief",
		name: `Relief (${PERF})`,
		group: "system",
		rebindable: false,
		keys: ["r"],
	},
	{
		id: "perf.craters",
		name: `Craters (${PERF})`,
		group: "system",
		rebindable: false,
		keys: ["o"],
	},
	{
		id: "perf.class",
		name: `Planet class (${PERF})`,
		group: "system",
		rebindable: false,
		keys: ["p"],
	},
	{
		id: "perf.restore",
		name: `Restore every switch (${PERF})`,
		group: "system",
		rebindable: false,
		keys: ["i"],
	},
] as const satisfies readonly Authored[];

/** Every command's id, and the type every dispatch site takes. */
export type CommandId = (typeof AUTHORED)[number]["id"];

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
		if (!isPressedKey(t)) continue;
		for (const [button, contexts] of PRESSES.keys.get(t.key) ?? [])
			out.push({ kind: "pad-button", button, contexts });
	}
	return out;
}

/** How a physical key prints: a letter or digit key by its character, an
 *  arrow by the key it sends.
 *
 *  **Punctuation is the hole, and it is still open.** A `Slash` or `Comma`
 *  code would print as its code name, because the character a punctuation key
 *  types is a property of the keyboard layout and `ALT_CHORDS` holds only the
 *  three arrows today. The capture slice records the character a binding was
 *  made with (D7), which is what closes it; until then a chord authored on a
 *  punctuation key prints wrong. */
const codeKey = (code: string) =>
	code.replace(/^(Key|Digit)/, "").toLowerCase();

/**
 * The Alt chords that stand for one of this command's pressed keys — derived
 * from `ALT_CHORDS`, the table the dispatch reads, so a chord added there gets
 * its row here with no edit to this file (#377).
 */
function chordsFor(keys: readonly Trigger[]): Trigger[] {
	const pressed = new Set(
		keys.flatMap((t) => (isPressedKey(t) ? [t.key] : [])),
	);
	return Object.entries(ALT_CHORDS)
		.filter(([, key]) => pressed.has(key))
		.map(([code]) => ({ kind: "key", key: codeKey(code), alt: true, code }));
}

/**
 * The pad buttons that produce one half of an intent.
 *
 * `signed` is what separates a pair from the boolean three: `panel.valueUp`
 * carries `half: "+"` and `panel.back` carries no half at all, so a consumer
 * can tell "the positive half of a pair" from "not a pair".
 */
function padIntentTriggers(
	intent: PanelIntent,
	half: Half,
	signed: boolean,
): Trigger[] {
	const found = PRESSES.intents.get(`${intent}${half}`) ?? new Map();
	return [...found].map(([button, contexts]) => ({
		kind: "pad-intent" as const,
		intent,
		button,
		...(signed ? { half } : {}),
		contexts,
	}));
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * Where a binding is live: D4's context set, both halves of it.
 *
 * `pad` is the four-value union and `views` is the half `PadContext` cannot
 * express. `surface` is the third axis, and it is **the screen that claims the
 * trigger**, not a hint about where a row prints.
 *
 * **Absent means the ship's own surface**, which is the one the flight keys are
 * on — deliberately not "every surface". `main.ts` returns out of its key
 * handler while the Requests console is up for exactly the five keys that
 * console claims, so a press of `Enter` there reaches
 * `activateKeyboardFocus` and never the switch that launches. Two bindings on
 * different surfaces are never live at once, which is why `dock.launch` and
 * `panel.activate` both hold `Enter` and are not a collision — and why a
 * *second* unscoped `Enter` would be one. `tests/commands.test.ts` holds both
 * directions.
 */
export interface Scope {
	readonly pad: readonly PadContext[];
	readonly views: readonly ViewMode[];
	readonly surface?: string;
}

export interface Command {
	/** Not a key string: a command keeps its id when it is rebound. */
	readonly id: CommandId;
	readonly name: string;
	readonly group: TaskGroup;
	/** Whether the player may move it (#369 D12's rider). */
	readonly rebindable: boolean;
	readonly views: readonly ViewMode[];
	/** The pad contexts this command is live in, from its pad triggers. */
	readonly contexts: readonly PadContext[];
	readonly defaultTriggers: readonly Trigger[];
}

/** D4's row: a command, a trigger, and the contexts the pair is live in. */
export interface Binding {
	readonly command: CommandId;
	readonly trigger: Trigger;
	readonly scope: Scope;
}

const ALL_PAD: readonly PadContext[] = PAD_CONTEXTS;

/**
 * The pad contexts a trigger is live in.
 *
 * A pad trigger says so itself, because `pad-bindings.ts` was asked. The other
 * kinds are the keyboard's and the mouse's, and neither is part of the pad's
 * context model:
 *
 * - **The keyboard still flies**, which #283 settled and `main.ts:9552-9562`
 *   records — a key reaches the game whatever the head is doing.
 * - **Mouse movement does not.** Since #371 a console surrenders the pointer
 *   lock and the delta is zeroed, so the look is a flight input only.
 * - **The mouse trigger is on the other side of that line**, and deliberately
 *   recorded as live everywhere rather than tidied: `triggerHeld` ORs
 *   `mouseFiring` with no context test while the pad's `x` is gated. That is
 *   #369's defect 2, and #378 owns the ruling. A registry that quietly gated
 *   it here would be deciding that node by implementation.
 */
const scopeOf = (trigger: Trigger, views: readonly ViewMode[]): Scope => {
	const pad =
		"contexts" in trigger
			? trigger.contexts
			: trigger.kind === "mouse-move"
				? (["flight"] as const)
				: ALL_PAD;
	const surface =
		(trigger.kind === "key" || trigger.kind === "mouse-button") &&
		trigger.surface !== undefined
			? trigger.surface
			: undefined;
	return surface === undefined ? { pad, views } : { pad, views, surface };
};

function triggersOf(a: Authored): Trigger[] {
	const keys = (a.keys ?? []).map(keyTrigger);
	const views = a.views ?? VIEW_MODES;
	// A chord runs its key's command, and `command()` answers `1`, `2` and `3`
	// in the cockpit only — so a chase-only command has no chord (#377).
	const chords = views.includes("cockpit") ? chordsFor(keys) : [];
	return [
		...keys,
		...chords,
		...padButtonsFor(keys),
		...(a.more ?? []),
		...(a.intent
			? padIntentTriggers(
					a.intent,
					a.intentHalf ?? "+",
					a.intentHalf !== undefined,
				)
			: []),
	];
}

const contextsOf = (triggers: readonly Trigger[]): PadContext[] => {
	const live = new Set<PadContext>();
	for (const t of triggers)
		if ("contexts" in t) for (const c of t.contexts) live.add(c);
	return PAD_CONTEXTS.filter((c) => live.has(c));
};

function toCommand(a: Authored): Command {
	const defaultTriggers = triggersOf(a);
	return {
		id: a.id as CommandId,
		name: a.name,
		group: a.group,
		rebindable: a.rebindable ?? true,
		views: a.views ?? VIEW_MODES,
		contexts: contextsOf(defaultTriggers),
		defaultTriggers,
	};
}

export const COMMANDS: readonly Command[] = AUTHORED.map(toCommand);

const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

export const commandById = (id: CommandId): Command => {
	const found = BY_ID.get(id);
	if (found === undefined) throw new Error(`no such command: ${id}`);
	return found;
};

/** The shipped layout, as bindings rather than as rows. */
export const DEFAULT_BINDINGS: readonly Binding[] = COMMANDS.flatMap((c) =>
	c.defaultTriggers.map((trigger) => ({
		command: c.id,
		trigger,
		scope: scopeOf(trigger, c.views),
	})),
);

// ---------------------------------------------------------------------------
// D5's two predicates
// ---------------------------------------------------------------------------

/**
 * What makes two bindings the *same* trigger.
 *
 * Physical identity, not printed identity: a key is its physical position
 * under D7 (`code` when the binding carries one, the character otherwise),
 * and a press and a hold of the same key are different triggers — which is
 * what makes D3's split on `x` a split rather than a collision. A pad button
 * and a pad intent share one namespace because they are one button.
 */
export function triggerKey(t: Trigger): string {
	switch (t.kind) {
		case "key":
			return `key:${t.code ?? t.key}:${t.alt ? "alt" : ""}:${t.hold ? "hold" : "press"}`;
		case "mouse-button":
			return `mouse-button:${t.action}`;
		case "mouse-move":
			return `mouse-move:${t.axis}${t.half}`;
		case "pad-stick":
			return `pad-stick:${t.stick}${t.axis}${t.half}`;
		case "pad-trigger":
			return `pad-trigger:${t.trigger}`;
		case "pad-button":
			return `pad:${t.button}:${t.hold ? "hold" : "press"}`;
		case "pad-intent":
			// One namespace with `pad-button`, because they are one button: the
			// d-pad's ↑ presses a key in flight and steps a cursor in a console,
			// and a model that gave them two identities could not see that.
			return `pad:${t.button}:press`;
	}
}

const intersects = <T>(a: readonly T[], b: readonly T[]) =>
	a.some((x) => b.includes(x));

/** Two bindings are live at the same time, so one trigger would mean two things. */
const overlaps = (a: Scope, b: Scope) =>
	a.surface === b.surface &&
	intersects(a.pad, b.pad) &&
	intersects(a.views, b.views);

export interface Collision {
	readonly trigger: string;
	readonly commands: readonly [CommandId, CommandId];
	readonly scope: Scope;
}

/**
 * Every pair of commands one trigger would reach at the same time.
 *
 * D5's resolution is *warn and allow*, resolved by one stated law, so this is
 * a report rather than a refusal. What differs is who reads it: the **default**
 * layout hands its list to CI, where it must be empty — F5's half that
 * survives remapping — and a **player's** layout will hand its list to the
 * panel.
 *
 * **Will, not does.** There is no player layout and no panel in this slice;
 * `tests/commands.test.ts` is the only caller today, and it drives both arms.
 * The function is one function so that the two questions cannot drift apart
 * when the second caller arrives, which is the storage slice's.
 */
export function collisions(bindings: readonly Binding[]): Collision[] {
	const byTrigger = new Map<string, Binding[]>();
	for (const b of bindings) {
		const key = triggerKey(b.trigger);
		byTrigger.set(key, [...(byTrigger.get(key) ?? []), b]);
	}
	const out: Collision[] = [];
	for (const [trigger, group] of byTrigger)
		for (let i = 0; i < group.length; i++)
			for (let j = i + 1; j < group.length; j++) {
				const a = group[i];
				const b = group[j];
				if (a === undefined || b === undefined) continue;
				if (a.command === b.command) continue;
				if (!overlaps(a.scope, b.scope)) continue;
				out.push({
					trigger,
					commands: [a.command, b.command],
					// The **overlap**, not one side's scope: `overlaps` asked only
					// for an intersection, so `a`'s own scope would name contexts
					// and views where `b` is not live — a panel warning that
					// pointed at the wrong half of the game.
					scope: {
						pad: a.scope.pad.filter((c) => b.scope.pad.includes(c)),
						views: a.scope.views.filter((v) => b.scope.views.includes(v)),
						...(a.scope.surface === undefined
							? {}
							: { surface: a.scope.surface }),
					},
				});
			}
	return out;
}

/** The shipped layout's collisions, which must be none. */
export const defaultCollisions = (): Collision[] =>
	collisions(DEFAULT_BINDINGS);

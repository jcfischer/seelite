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
 * - **D5** — two *predicates*, and one function. A default layout that
 *   collides is red in CI; a player layout that collides is a printed warning.
 *   They are different questions and cannot share a test row — but they are
 *   the same arithmetic, and two implementations of one question drift, so
 *   `collisions()` answers both and each caller decides what an answer means.
 * - **D7** — dispatch is on the physical key (`code`) and print is on the
 *   character the binding was *recorded* with, so the tab keeps printing
 *   characters. The letter rows carry a code since the dispatch slice, derived
 *   in `keyTrigger` rather than authored fifty times; the Alt chords carried
 *   one already, because `ALT_CHORDS` is keyed on `code`. **Two groups do not,
 *   and `codeFor` owns both reasons** rather than this list restating them.
 *   The property reaches a *pressed* command only: the held set is characters,
 *   so `isHeld` asks for a key rather than a position, and #390 owns the
 *   change that would move it. Migrating a saved layout is the storage
 *   slice's.
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
 * **The hazard S1 recorded, and how the dispatch slice settled it.** `codeKey`
 * reached the letter and digit codes and no others, so a row authored
 * `code: "Slash"` hashed `key:slash` against the shipped `key:/` — one
 * physical key with two identities that `collisions()` could not see, over ten
 * punctuation keys. It is a table over the codes this game ships now, mapping
 * each to the **unshifted** character — which is the other half of the same
 * hazard, for the reason `codeFor` gives. One rule settled both, and
 * `tests/dispatch.test.ts` holds all three consequences.
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
 * Why a command's trigger cannot be moved.
 *
 * `diagnostic` and `rig` have a trigger the player is not offered;
 * `pointer` has no movable trigger at all, which is a different question for
 * a capture modal and for a panel that prints "unbound".
 */
export type FixedReason = "diagnostic" | "rig" | "pointer";

/**
 * The screens that claim a trigger of their own.
 *
 * **They are mutually exclusive by construction**, which is what lets
 * `overlapScope` decide with inequality: the right console's Requests tab and
 * the docked station screen are two places, never one drawn inside another,
 * and **the glass is not in the union at all** — it is what *absent* means,
 * so it has one encoding rather than two. A `"view"` value was written here
 * and removed for that: `fly.takePointer` carried it while every flight key
 * carried nothing, which is one surface with two names inside a union
 * compared by inequality. A surface that *contained* another would need containment
 * rather than inequality, and this union may not gain one without that
 * change — which is why there is no `console-row` beside `station-console`.
 * The pair was written and removed inside one review round: two click rows
 * whose prose put one inside the other were reported as disjoint by
 * inequality, so the zero-collision result was the split rather than the
 * absence of a shared trigger.
 *
 * A closed union rather than a phrase, because `overlaps` decides liveness by
 * comparing two of these and `controls-reference.ts` prints them: with prose
 * in the field, two bindings on one screen worded differently could never be
 * reported as a collision, and rewording a label would silently move a scope.
 * The printed phrase is `SURFACE_WORDS` there, beside `CONTEXT_WORDS`.
 */
const SURFACES = ["requests", "station-console"] as const;
export type Surface = (typeof SURFACES)[number];

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
			readonly surface?: Surface;
	  }
	| {
			readonly kind: "mouse-button";
			readonly action: "hold" | "click";
			readonly surface?: Surface;
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
	 * Why this row is not offered for rebinding, when it is not. Three
	 * different reasons, and the field carries **which** rather than a bit,
	 * because the capture slice needs "nothing to move" to be a different
	 * answer from "has a trigger, not offered":
	 *
	 * - the `?perf` diagnostics (#369's D12 rider), which
	 *   `tests/perf-panel-keys.test.ts` exists to keep off the flight path;
	 * - the two combat-rig keys `/` and `q`, which reach nothing but the rig:
	 *   `command()` breaks out of the switch for both in normal play. Note what
	 *   this does **not** cover — `fight.fireBeam` is `x` held, which
	 *   `combat-rig.ts` reads and the assist toggle shares, so it is a key a
	 *   player holds in a game that ships and it stays rebindable;
	 * - the pointer rows, which have **no movable trigger at all** — a click on
	 *   a station row or on the glass is #370's standing premise that a screen
	 *   is always clickable, not a binding a player could move elsewhere.
	 */
	readonly fixed?: FixedReason;
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
 * `COMMANDER_KEY` **is** imported, because `commander-overlay.ts` is already
 * eager — `main.ts` imports it at the top level for the boot flow. If that
 * ever changes, this import is the third restatement, not an exception.
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
		// `pitch` is negated off `mouseDy` in `main.ts`, so the nose comes up as
		// the mouse comes back — and `tests/commands.test.ts` reads that
		// negation out of the source rather than trusting this sentence.
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
		// `axis(["e"], ["q"])` in `main.ts`: `q` is the positive term, and
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
		fixed: "pointer",
		// Unscoped, because the glass *is* the ship's own surface — see `Scope`.
		more: [{ kind: "mouse-button", action: "click" }],
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
		// The other half of D3's split on `x`. `combat-rig.ts` asks whether
		// this command is held every frame; `fly.assist` takes the press.
		//
		// **`x`, not `s`, and the reason moved here with the key.** `s` is
		// pitch-up, so a beam bound to it meant every held shot also pushed the
		// nose off the thing being shot at — invisible against a scripted
		// target and the whole difficulty against a flown one.
		// `probe-live-cockpit.mjs` held the old key for fifteen seconds and
		// timed out rather than saying so.
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
		fixed: "rig",
		keys: ["/"],
	},
	{
		id: "fight.rigEcm",
		name: "Fire the ECM (combat rig)",
		group: "fight",
		fixed: "rig",
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
		fixed: "pointer",
		// **The one pointer row on a console**, and the reason `panel.activate`
		// has no click of its own: a click that selects a row is this, wherever
		// the row is drawn. Two click rows was the containment `Scope`'s doc
		// now forbids.
		more: [
			{ kind: "mouse-button", action: "click", surface: "station-console" },
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
		keys: [{ key: "arrowup", surface: "requests" }],
		intent: "focusDelta",
		intentHalf: "-",
	},
	{
		id: "panel.cursorDown",
		name: "Walk a console's cursor down",
		group: "system",
		keys: [{ key: "arrowdown", surface: "requests" }],
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
		keys: [{ key: "arrowleft", surface: "requests" }],
		intent: "tabDelta",
		intentHalf: "-",
	},
	{
		id: "panel.tabNext",
		name: "Next console tab",
		group: "system",
		keys: [{ key: "arrowright", surface: "requests" }],
		intent: "tabDelta",
		intentHalf: "+",
	},
	{
		id: "panel.activate",
		name: "Select the row under the cursor",
		group: "system",
		keys: [{ key: "enter", surface: "requests" }],
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
		fixed: "diagnostic",
		keys: ["b"],
	},
	{
		id: "perf.atmosphere",
		name: `Atmosphere (${PERF})`,
		group: "system",
		fixed: "diagnostic",
		keys: ["h"],
	},
	{
		id: "perf.clouds",
		name: `Clouds (${PERF})`,
		group: "system",
		fixed: "diagnostic",
		keys: ["y"],
	},
	{
		id: "perf.relief",
		name: `Relief (${PERF})`,
		group: "system",
		fixed: "diagnostic",
		keys: ["r"],
	},
	{
		id: "perf.craters",
		name: `Craters (${PERF})`,
		group: "system",
		fixed: "diagnostic",
		keys: ["o"],
	},
	{
		id: "perf.class",
		name: `Planet class (${PERF})`,
		group: "system",
		fixed: "diagnostic",
		keys: ["p"],
	},
	{
		id: "perf.restore",
		name: `Restore every switch (${PERF})`,
		group: "system",
		fixed: "diagnostic",
		keys: ["i"],
	},
] as const satisfies readonly Authored[];

/** Every command's id, and the type every dispatch site takes. */
export type CommandId = (typeof AUTHORED)[number]["id"];

const keyTrigger = (spec: KeySpec): Trigger => {
	const base = typeof spec === "string" ? { key: spec } : spec;
	// Derived rather than authored, so a letter row cannot be added without
	// one: fifty-odd hand-written `code` fields is fifty-odd chances to omit
	// the one that matters, and the omission is invisible on a US keyboard.
	const code = base.code ?? codeFor(base.key);
	return code === undefined
		? { kind: "key", ...base }
		: { kind: "key", ...base, code };
};

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

/**
 * The punctuation keys, by the character they type unshifted.
 *
 * A prefix strip cannot reach these: `Slash` is not `Key`- or `Digit`-prefixed
 * and lowercases to `slash`, which is a string no keypress produces. That was
 * half of the hazard S1's header recorded — a row authored `code: "Slash"`
 * hashed against the shipped `key: "/"` as two identities of one physical key,
 * invisible to `collisions()`.
 *
 * The **unshifted** character on purpose, and the reason is `codeFor`'s to
 * give: it decides which characters carry a code at all, and this table is
 * only the other direction of that decision.
 */
const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
	Backquote: "`",
	Backslash: "\\",
	BracketLeft: "[",
	BracketRight: "]",
	Comma: ",",
	Equal: "=",
	Minus: "-",
	Period: ".",
	Quote: "'",
	Semicolon: ";",
	Slash: "/",
	Space: " ",
};

/**
 * How a physical key prints: a letter or digit key by its character, an arrow
 * by the key it sends, and punctuation by the table above.
 *
 * Exported because `tests/commands.test.ts` labels a press/hold pair by the
 * physical key it is on, and a second normalisation written there is exactly
 * the drift `triggerKey`'s own doc warns about — it read `code ?? key` and
 * printed `Digit1` the moment a digit row carried a code.
 */
export const codeKey = (code: string) =>
	// `Object.hasOwn`, not `??`: a bare index returns an inherited member for
	// `"constructor"` or `"toString"`, so this would hand back a *function*
	// instead of falling through. Every caller passes an authored `trigger.code`
	// today; the capture modal will pass a `KeyboardEvent.code` off the page,
	// and that is the slice this guard is here for.
	Object.hasOwn(PUNCTUATION_CODES, code)
		? (PUNCTUATION_CODES[code] as string)
		: code.replace(/^(Key|Digit)/, "").toLowerCase();

/**
 * The physical key a character is typed by on the layout the defaults were
 * authored on — **letters, and nothing else** (#369 D7).
 *
 * This is the AZERTY property, and it is the only reason to author a code: the
 * key at W's position sends `z` there, and a pilot's fingers should stay where
 * they were. Two groups are deliberately left codeless, for two different
 * reasons, and both were flown before they were refused.
 *
 * **Punctuation**, because `?` and `/` share one physical key. #377 ruled `?`
 * is the character the keyboard types rather than a chord, so a code on either
 * would report a collision the game does not have. The resolver falls back to
 * the character there, which is the answer #377 already gave.
 *
 * **Digits**, because the code arm wins over the character and Shift is
 * `fly.throttleUp`. With `Digit1` authored, a US pilot throttling up and
 * touching `1` arrives as `{ key: "!", code: "Digit1" }`, the coded arm
 * matches, and the head turns to the port console; `0` resets the cruise
 * dials the same way. Before the fold `case "!"` matched nothing. That is a
 * regression bought for a property nobody has asked for, and the AZERTY digit
 * row — where the digits are themselves the shifted characters — is a layout
 * question of its own rather than something this slice should settle in
 * passing.
 */
const codeFor = (key: string): string | undefined =>
	/^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : undefined;

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
	intentHalf: Half | undefined,
): Trigger[] {
	const half = intentHalf ?? "+";
	const signed = intentHalf !== undefined;
	const found =
		PRESSES.intents.get(`${intent}${half}`) ??
		new Map<PadButtonName, PadContext[]>();
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
const makeScope = (
	pad: readonly PadContext[],
	views: readonly ViewMode[],
	surface?: Surface,
): Scope => (surface === undefined ? { pad, views } : { pad, views, surface });

export interface Scope {
	readonly pad: readonly PadContext[];
	readonly views: readonly ViewMode[];
	readonly surface?: Surface;
}

export interface Command {
	/** Not a key string: a command keeps its id when it is rebound. */
	readonly id: CommandId;
	readonly name: string;
	readonly group: TaskGroup;
	/** Absent when the player may move it; otherwise why not (#369 D12's rider). */
	readonly fixed?: FixedReason;
	/** Derived from `fixed`, for the common question. */
	readonly rebindable: boolean;
	readonly views: readonly ViewMode[];
	/**
	 * The pad contexts this command's **pad triggers** are live in, and empty
	 * for a command the pad does not reach. Deliberately not the same question
	 * as a binding's `Scope.pad`, which answers for one trigger and gives a
	 * keyboard binding every context — the name says which.
	 */
	readonly padTriggerContexts: readonly PadContext[];
	readonly defaultTriggers: readonly Trigger[];
}

/** D4's row: a command, a trigger, and the contexts the pair is live in. */
export interface Binding {
	readonly command: CommandId;
	readonly trigger: Trigger;
	readonly scope: Scope;
}

/**
 * The pad contexts a trigger is live in.
 *
 * A pad trigger says so itself, because `pad-bindings.ts` was asked. The other
 * kinds are the keyboard's and the mouse's, and neither is part of the pad's
 * context model:
 *
 * - **The keyboard still flies**, which #283 settled and the comment beside
 *   `main.ts`'s mouse-delta zeroing records — a key reaches the game whatever
 *   the head is doing.
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
				: PAD_CONTEXTS;
	const surface =
		(trigger.kind === "key" || trigger.kind === "mouse-button") &&
		trigger.surface !== undefined
			? trigger.surface
			: undefined;
	return makeScope(pad, views, surface);
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
		...(a.intent ? padIntentTriggers(a.intent, a.intentHalf) : []),
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
		...(a.fixed === undefined ? {} : { fixed: a.fixed }),
		rebindable: a.fixed === undefined,
		views: a.views ?? VIEW_MODES,
		padTriggerContexts: contextsOf(defaultTriggers),
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
 * under D7, normalised through `codeKey` — which reaches the letters and
 * digits and no others, so `KeyW` and `w` hash alike and the punctuation half
 * is a hole `codeKey`'s own doc owns,
 * and a press and a hold of the same key are different triggers — which is
 * what makes D3's split on `x` a split rather than a collision. A pad button
 * and a pad intent share one namespace because they are one button.
 */
export function triggerKey(t: Trigger): string {
	switch (t.kind) {
		case "key":
			return `key:${t.code === undefined ? t.key : codeKey(t.code)}:${t.alt ? "alt" : ""}:${t.hold ? "hold" : "press"}`;
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

const intersection = <T>(a: readonly T[], b: readonly T[]) =>
	a.filter((x) => b.includes(x));

/**
 * Where two bindings are both live — the empty answer on either axis, or a
 * different surface, means they never meet.
 *
 * One function rather than a predicate beside a rebuild of the same filters:
 * the report has to name the **overlap**, because `a`'s own scope would point
 * a panel warning at contexts where `b` is not live at all.
 */
const overlapScope = (a: Scope, b: Scope): Scope | null => {
	if (a.surface !== b.surface) return null;
	const pad = intersection(a.pad, b.pad);
	const views = intersection(a.views, b.views);
	if (pad.length === 0 || views.length === 0) return null;
	return makeScope(pad, views, a.surface);
};

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
				const scope = overlapScope(a.scope, b.scope);
				if (scope === null) continue;
				out.push({ trigger, commands: [a.command, b.command], scope });
			}
	return out;
}

/** The shipped layout's collisions, which must be none. It exists as a name
 *  because the storage slice adds the CI gate that calls it; until then the
 *  test row calls it so the alias cannot rot beside a direct call. */
export const defaultCollisions = (): Collision[] =>
	collisions(DEFAULT_BINDINGS);

// ---------------------------------------------------------------------------
// The dispatch (#381 slice 2)
// ---------------------------------------------------------------------------

/**
 * What a keyboard event states, as much of it as the table reads.
 *
 * Not a `KeyboardEvent`: `src/key-dispatch.ts` already decided what the event
 * *means* — release, swallow, chord or ordinary key — and this answers the
 * next question, which is which command that key reaches. **Neither module
 * imports the other for the facts**, which is a stronger boundary than a
 * direction and is why this shape is restated here rather than shared: this
 * module imports `ALT_CHORDS` from there and nothing else, and a shared facts
 * type would couple the law to the table it is asked about.
 *
 * `view` is required for the reason #369 D4 gives — `2` is head-forward in the
 * cockpit and the orbit reset in chase, and a resolver that defaulted it would
 * answer one of those silently.
 */
export interface KeyFacts {
	/** `KeyboardEvent.key`, lowercased, as `keyDispatch` hands it over. */
	readonly key: string;
	/** `KeyboardEvent.code`. Absent on a synthetic press, which is every press
	 *  the probe tier makes. */
	readonly code?: string;
	readonly alt?: boolean;
	/** Asking what this key flies rather than what it presses. */
	readonly hold?: boolean;
	readonly view: ViewMode;
	/** The screen that owns the keyboard right now, when one does. */
	readonly surface?: Surface;
}

const keyBinding = (
	b: Binding,
): (Binding & { trigger: Extract<Trigger, { kind: "key" }> }) | null =>
	b.trigger.kind === "key"
		? (b as Binding & { trigger: Extract<Trigger, { kind: "key" }> })
		: null;

/**
 * Everything about a key trigger except which key it is and where it is live.
 *
 * One owner, because `resolveKey` and `isHeld` both ask it and two hand-rolled
 * walks of one table drift the moment `Trigger` grows an axis. The second walk
 * existed for a round and had already diverged: it compared no `alt` at all,
 * so an Alt-qualified hold row would have flown on the bare key.
 */
const matchesQualifiers = (
	t: Extract<Trigger, { kind: "key" }>,
	facts: {
		readonly alt?: boolean;
		readonly hold?: boolean;
		readonly surface?: Surface;
	},
): boolean =>
	(t.alt ?? false) === (facts.alt ?? false) &&
	(t.hold ?? false) === (facts.hold ?? false) &&
	t.surface === facts.surface;

/** Everything about a key binding except which key it is. */
const liveFor = (b: Binding, facts: KeyFacts): boolean => {
	const keyed = keyBinding(b);
	return (
		keyed !== null &&
		matchesQualifiers(keyed.trigger, facts) &&
		b.scope.views.includes(facts.view)
	);
};

/**
 * The commands this key event reaches, in `bindings`.
 *
 * **The physical key wins, and the character is the fallback** — which is D7's
 * two halves in one rule rather than two. A row that carries a `code` is
 * matched on the event's `code`, so an AZERTY pilot pressing the M position
 * still steps the vicinity dial although it types `,` there. A row that
 * carries none is matched on the character, so `?` reaches the reference and
 * `/` reaches the rig although both arrive on `Slash` — and so does every
 * synthetic press in the probe tier, which carries no code at all.
 *
 * **This reaches a *pressed* command and not a held one, and that is a limit
 * rather than an omission.** `main.ts` keeps its held set as the characters
 * `keyDispatch` hands it, so `isHeld` asks the layout for a key rather than a
 * position: on AZERTY the W position is held as `z` and pitch is not flown.
 * Giving the held set the code is the same change #390 needs for the macOS
 * Option release — where a key released under Option reports a different
 * character and stays held — and that node owns it.
 *
 * A list rather than one id: nothing in the shipped layout answers twice, and
 * `collisions()` is what holds that, but a player layout may — D5 is warn and
 * allow, so the dispatch has to be able to run both.
 */
export function resolveKey(
	bindings: readonly Binding[],
	facts: KeyFacts,
): CommandId[] {
	const live = bindings.filter((b) => liveFor(b, facts));
	const byCode =
		facts.code === undefined
			? []
			: live.filter((b) => keyBinding(b)?.trigger.code === facts.code);
	const hits =
		byCode.length > 0
			? byCode
			: live.filter((b) => keyBinding(b)?.trigger.key === facts.key);
	return [...new Set(hits.map((b) => b.command))];
}

/**
 * The hold rows of one layout, by command — built once per table.
 *
 * `isHeld` is asked about a dozen times a frame (both axes, the roll, the
 * chase orbit, the throttle's two and the rig's four), and a scan of the whole
 * table for each of those is a dozen walks of two hundred rows where the code
 * this replaced did one hash probe. The index is keyed on the layout array
 * itself, so a `rebind` — which returns a new array rather than mutating one —
 * simply builds a new one, and no invalidation step exists to be forgotten.
 *
 * **That is a precondition and not a property**, and the storage slice is the
 * obvious candidate to break it: a layout merged *in place* keeps its array
 * identity and would be answered out of a stale index. Every layout is a new
 * array here, and `isHeld` is pure only for callers that hold to it.
 *
 * **The view is not indexed**, because it changes between frames while the
 * layout does not; it is checked on the way out, over a list that is one or
 * two rows long.
 */
const HOLD_INDEX = new WeakMap<readonly Binding[], Map<CommandId, Binding[]>>();

const holdRows = (bindings: readonly Binding[]): Map<CommandId, Binding[]> => {
	const found = HOLD_INDEX.get(bindings);
	if (found !== undefined) return found;
	const index = new Map<CommandId, Binding[]>();
	for (const b of bindings) {
		const keyed = keyBinding(b);
		if (keyed === null || !matchesQualifiers(keyed.trigger, { hold: true }))
			continue;
		index.set(b.command, [...(index.get(b.command) ?? []), b]);
	}
	HOLD_INDEX.set(bindings, index);
	return index;
};

/**
 * Is this command being flown right now?
 *
 * `keys` is the held set as `main.ts` keeps it: **the characters
 * `keyDispatch` hands over**, which is what #377's first ruling and #390's
 * limit depend on — a release clears the key it names, and a set of command
 * ids could not be cleared by a keyup that reports a different character. So
 * the store does not change and the query does: an id, resolved to its live
 * hold triggers.
 *
 * It follows that a held command is reached by **character and not by
 * position**, so `resolveKey`'s code arm does not extend to one. See that
 * function's note: the fix is the held set carrying the code, and #390 owns
 * it.
 */
export function isHeld(
	bindings: readonly Binding[],
	command: CommandId,
	keys: ReadonlySet<string>,
	view: ViewMode,
): boolean {
	for (const b of holdRows(bindings).get(command) ?? []) {
		const keyed = keyBinding(b);
		if (keyed === null || !b.scope.views.includes(view)) continue;
		if (keys.has(keyed.trigger.key)) return true;
	}
	return false;
}

/**
 * One binding moved onto a new trigger, as a new table.
 *
 * Pure, and it returns a table rather than mutating one, because the layout is
 * the `Game`'s state and not this module's. A finish was module state once and
 * every test that set one owed an `afterEach`; a layout is the same shape of
 * hazard with a worse failure, since a leaked rebind flies the next test's
 * ship.
 *
 * **It throws on a trigger the command does not have.** A silent no-op is a
 * capture modal that reports success and moves nothing, which is exactly the
 * defect a rebind screen ships with.
 */
export function rebind(
	bindings: readonly Binding[],
	command: CommandId,
	from: Trigger,
	to: Trigger,
): Binding[] {
	const wanted = triggerKey(from);
	const at = bindings.findIndex(
		(b) => b.command === command && triggerKey(b.trigger) === wanted,
	);
	if (at === -1) throw new Error(`${command} has no binding on ${wanted}`);
	const moved = movedTrigger(from, to);
	const next = [...bindings];
	next[at] = {
		command,
		trigger: moved,
		scope: scopeOf(moved, commandById(command).views),
	};
	return next;
}

/**
 * The trigger a rebind actually stores — `to`, checked and completed.
 *
 * Two things the bare `to` gets wrong, and both produce the defect `rebind`'s
 * doc names rather than preventing it.
 *
 * **A qualifier is the command's, not the player's.** `fly.pitchUp` is flown
 * by holding a key; a `to` that dropped `hold` would be stored, would satisfy
 * no `isHeld`, and the command would be silently unflyable while the call
 * returned successfully. The player moves *which key*, which is #369 D4's
 * "the player edits the trigger; the context set is the command's" applied to
 * the half of a trigger that is not the key.
 *
 * **And a code is derived when the caller does not give one.** The shipped
 * rows get theirs from `keyTrigger`, so a rebind that stored `to` verbatim
 * would leave a letter codeless and lose D7's position dispatch for exactly
 * the command the player just chose to move. A `to` that *does* carry a code
 * keeps it, which is the capture modal's case rather than an oversight: it
 * records the physical key it saw, and on a layout where that key does not
 * type its US character — which is the whole point of D7 — the pair is
 * legitimately mismatched and only the capture knows the truth. The cost is
 * that a caller passing an inconsistent pair gets exactly what it asked for.
 */
function movedTrigger(from: Trigger, to: Trigger): Trigger {
	if (from.kind !== to.kind)
		throw new Error(`cannot move a ${from.kind} onto a ${to.kind}`);
	// **Only a key is rebindable here, and refusing the rest is the point.**
	// The first version returned a same-kind non-key `to` verbatim, which let a
	// `mouse-button` hold be moved onto a click — stored, satisfying no reader,
	// which is the defect the key branch exists to refuse. Every non-key kind
	// has its own qualifiers (`action`, `half`, `intent`, `hold`), and a table
	// of which part of each is movable is the capture modal's to write, since
	// it is the thing that will admit a stick or a trigger for one capture.
	// Until then a refusal is the honest answer, and S4 lifts it.
	if (from.kind !== "key" || to.kind !== "key")
		throw new Error(`only a key may be rebound here, not a ${from.kind}`);
	if (!matchesQualifiers(to, from))
		throw new Error(
			`a rebind may move a key, not its qualifiers: ${triggerKey(from)} -> ${triggerKey(to)}`,
		);
	const { kind: _kind, ...rest } = to;
	return keyTrigger(rest);
}

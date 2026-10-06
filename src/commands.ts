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
 *   in `keyTrigger` rather than authored fifty times; the three Alt chords are
 *   authored *on* a code, which is what a chord is. **Two groups do not,
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
 * no edit here. **The pad's *table* is not derived — it is
 * `PAD_FLIGHT_COMMANDS`, here, naming ids** (#381 S4). It named keys until the
 * capture slice and lived in `pad-bindings.ts`, resolved against the shipped
 * layout, which pinned every pad button to the default keyboard by
 * construction and left a pad rebind with nowhere to be stored. `ALT_CHORDS`
 * was the same shape and is gone the same way: a chord is an authored row and
 * `keyDispatch` decides only *that* a press is one. So `main.ts` has a single
 * resolver pair over the layout in force — `resolveKey` and `resolvePad` — and
 * no `commandKey` beside them. The keyboard's half cannot be derived: its bindings live in `main.ts`'s
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
import { VENT_SLOTS, type VentSlot } from "./hull";
import { type PadButtonName, type PadFrame, STANDARD_BUTTONS } from "./gamepad";
import {
	ANALOG_TRIGGERS,
	isAnalogTrigger,
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

/**
 * Every context the pad model knows, in the order a note prints them.
 *
 * **The count is not stated here**, because it said four while the union held
 * five for the length of one edit (#381 S4): `capture` joined `PadContext` and
 * this list went on being typed `readonly PadContext[]`, which checks that
 * each entry *is* a context and says nothing about whether all of them are.
 * Every derivation in this module probes over this list — `padPresses`,
 * `stickFor`, `triggerFor`, `fireButtons` — so a context missing from it is a
 * context nothing is ever asked about, in silence.
 *
 * The order is the printed one and not alphabetical, which is why this is a
 * written list rather than the keys of a record.
 */
export const PAD_CONTEXTS = [
	"flight",
	"instrument",
	"console",
	"modal",
	"capture",
] as const satisfies readonly PadContext[];

/**
 * A compile error naming any context the list above forgot.
 *
 * `satisfies` checks the entries and not the coverage, so it is this that
 * closes the hole. The error reads
 * `Type 'true' is not assignable to type ['missing from PAD_CONTEXTS', "…"]`,
 * with the missing member spelled in it.
 */
type MissingContext = Exclude<PadContext, (typeof PAD_CONTEXTS)[number]>;
const _everyContextListed: [MissingContext] extends [never]
	? true
	: ["missing from PAD_CONTEXTS", MissingContext] = true;
void _everyContextListed;

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
 * comparing two of these and `key-names.ts` prints them: with prose
 * in the field, two bindings on one screen worded differently could never be
 * reported as a collision, and rewording a label would silently move a scope.
 * The printed phrase is `SURFACE_WORDS` there.
 */
/**
 * The screens that claim the keyboard, and the set a stored layout is checked
 * against.
 *
 * Exported since the storage slice: `binding-store.ts`'s validator has to ask
 * whether a surface in a blob is one this build has, and a second list written
 * there is the third copy this repo's history is about.
 */
export const SURFACES = ["requests", "station-console"] as const;
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
			/**
			 * The views this movement is live in, when narrower than its
			 * command's (node #691). The pointer steers the ship in the cockpit // glossary-ignore: Command
			 * and orbits the camera in chase, so the `fly.*` rows' movement is
			 * the cockpit's while their keys fly in both — the one trigger kind
			 * whose meaning changes with the view while the command's does not. // glossary-ignore: Command
			 */
			readonly views?: readonly ViewMode[];
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
	  }
	| {
			/**
			 * **A place for a trigger, with none in it** (#620). §3.5 gives each
			 * vent slot a command with no default key, and a rebind *moves* a
			 * trigger: `layoutMoves` pairs a layout with the shipped one row by
			 * row, and the store saves the moves. A command with no row could
			 * never be bound at all, so it ships this one, which nothing
			 * resolves and the capture modal moves onto a key like any other.
			 * Held, because a vent fires while its key is down.
			 */
			readonly kind: "unbound";
			readonly hold?: true;
	  };

/** `fore-port-lateral` as `forePortLateral`: a command id is namespaced and
 *  camel-cased (#369 D1), and the slot's hyphens would be the one exception. */
type Camel<S extends string> = S extends `${infer A}-${infer B}`
	? `${A}${Capitalize<Camel<B>>}`
	: S;

/** A vent slot's own command: `vent.main`, `vent.forePortLateral`, … */
export type VentCommandId = `vent.${Camel<VentSlot>}`;

export const ventCommand = (slot: VentSlot): VentCommandId =>
	`vent.${slot.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}` as VentCommandId;

/**
 * One command per vent slot (§3.5), in `VENT_SLOTS`' order. The registry
 * authors its rows from this list below, so a slot added to the leaf gains a command
 * with no edit there.
 *
 * Named by the slot, because the slot vocabulary is the one name a vent has on
 * every hull (§3.4.1).
 */
export const VENT_COMMANDS: readonly {
	readonly slot: VentSlot;
	readonly id: VentCommandId;
	readonly name: string;
}[] = VENT_SLOTS.map((slot) => ({
	slot,
	id: ventCommand(slot),
	name: `Fire one vent: ${slot.replaceAll("-", " ")}`,
}));

/** The one placeholder a command with no default key ships (#620). */
const UNBOUND_HELD: Trigger = { kind: "unbound", hold: true };

/**
 * Whether a trigger is that placeholder rather than something to press.
 *
 * One owner, because three readers ask it — `collisions`, `boundNames` and
 * the tab's row — and a fourth that forgot would print `unbound` as a key or
 * report every slot command colliding with every other (sage round 1).
 */
export const isPlaceholder = (t: Trigger): boolean => t.kind === "unbound";

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

/**
 * What one pressed button does in each context: whether it falls through to
 * the ship, and which signed intents it produces.
 *
 * `flight` is the *fall-through* half and no longer says what a button means —
 * `padIntents` reports which presses a surface left unclaimed, and
 * `PAD_FLIGHT_COMMANDS` says what the ship does with one (#381 S4). Derived by
 * asking the same function the game calls, in every context, so a console that
 * claims a seventh button moves its row here with no edit.
 */
function padPresses() {
	const flight = new Map<PadButtonName, PadContext[]>();
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
			if (out.buttons.includes(button))
				flight.set(button, [...(flight.get(button) ?? []), context]);
			for (const intent of PANEL_INTENTS) {
				const value = out[intent];
				if (value === 0 || value === false) continue;
				// A boolean intent has no sign and no pair; a numeric one is one
				// half of a pair, and which half is what the pad says it is.
				const half = typeof value === "number" ? halfOf(value) : "+";
				note(intents, `${intent}${half}` as IntentKey, button, context);
			}
		}
	return { flight, intents };
}

const PRESSES = padPresses();

/** The contexts in which `live` answers yes. */
const liveIn = (live: (context: PadContext) => boolean) =>
	PAD_CONTEXTS.filter(live);

type Axis = "yaw" | "pitch" | "roll" | "heave";

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
	/**
	 * Physical keys (`KeyboardEvent.code`) that reach this command under Alt.
	 *
	 * Alt is the only chord prefix the throttle law leaves free (#369 D6), and
	 * a chord is authored rather than derived since #381 S4 — `chordsFor`'s
	 * doc gives the reason, which is the same one that moved the pad's table.
	 */
	readonly chords?: readonly string[];
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
		keys: [{ key: "s", hold: true }],
		// `pitch` is negated off `mouseDy` in `main.ts`, so the nose comes up as
		// the mouse comes back — and `tests/commands.test.ts` reads that
		// negation out of the source rather than trusting this sentence.
		more: [
			{ kind: "mouse-move", axis: "y", half: "+", views: COCKPIT },
			...stickFor("pitch", -1),
		],
	},
	{
		id: "fly.pitchDown",
		name: "Pitch: nose down",
		group: "fly",
		keys: [{ key: "w", hold: true }],
		more: [
			{ kind: "mouse-move", axis: "y", half: "-", views: COCKPIT },
			...stickFor("pitch", 1),
		],
	},
	{
		id: "fly.yawPort",
		name: "Yaw: nose to port",
		group: "fly",
		keys: [{ key: "a", hold: true }],
		more: [
			{ kind: "mouse-move", axis: "x", half: "-", views: COCKPIT },
			...stickFor("yaw", 1),
		],
	},
	{
		id: "fly.yawStarboard",
		name: "Yaw: nose to starboard",
		group: "fly",
		keys: [{ key: "d", hold: true }],
		more: [
			{ kind: "mouse-move", axis: "x", half: "+", views: COCKPIT },
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
	// The arrows strafe (#620, `flight-model.md` §3.5): they stopped repeating
	// pitch and yaw, which the letters and the mouse keep. Assist on, a held
	// strafe is a lateral velocity demand; off, a force (§3.6). The pad has
	// one free axis, the left stick's vertical, so the vertical strafe is
	// derived onto it and the lateral one has none (`PadFlightAxes.heave`).
	{
		id: "fly.strafePort",
		name: "Strafe to port",
		group: "fly",
		keys: [{ key: "arrowleft", hold: true }],
	},
	{
		id: "fly.strafeStarboard",
		name: "Strafe to starboard",
		group: "fly",
		keys: [{ key: "arrowright", hold: true }],
	},
	{
		id: "fly.strafeDorsal",
		name: "Strafe up",
		group: "fly",
		keys: [{ key: "arrowup", hold: true }],
		more: stickFor("heave", 1),
	},
	{
		id: "fly.strafeVentral",
		name: "Strafe down",
		group: "fly",
		keys: [{ key: "arrowdown", hold: true }],
		more: stickFor("heave", -1),
	},
	{
		// §3.6's two meanings across the assist, in the name the tab prints:
		// a speed lever with the assist on, the main drive held with it off.
		id: "fly.throttleUp",
		name: "Throttle up; assist off, fire the main drive",
		group: "fly",
		keys: [{ key: "shift", hold: true }],
		more: triggerFor(1),
	},
	{
		id: "fly.throttleDown",
		name: "Throttle down; assist off, fire the retro vents",
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
	// One command per vent slot, with no default key (#620, §3.5): reachable
	// for a pilot who binds one, absent from the shipped layout.
	...VENT_COMMANDS.map(({ id, name }) => ({
		id,
		name,
		group: "fly" as const,
		more: [UNBOUND_HELD],
	})),
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
		// `fly.pitchUp` — the row above is the authority, and the comment this
		// replaced in `combat-rig.ts` said "pitch-down", which was the sentence
		// being wrong rather than the key. Either way a beam bound to it meant
		// every held shot also pushed the nose off the thing being shot at,
		// invisible against a scripted target and the whole difficulty against
		// a flown one. `probe-live-cockpit.mjs` held the old key for fifteen
		// seconds and timed out rather than saying so.
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
		chords: ["ArrowLeft"],
	},
	{
		id: "view.headForward",
		name: "Head forward",
		group: "view",
		views: COCKPIT,
		keys: ["2"],
		chords: ["ArrowUp"],
	},
	{
		id: "view.headStarboard",
		name: "Head to starboard console",
		group: "view",
		views: COCKPIT,
		keys: ["3"],
		chords: ["ArrowRight"],
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
		// Node #691: in chase the pointer orbits, and the view goes where it
		// goes — right swings the camera to port, looking to starboard. These
		// movement rows *describe* `chase-orbit.ts`'s `orbitByPointer`, which
		// `main.ts`'s `orbitChase` hands the raw delta without consulting a
		// binding, as `pointerImpulse` is for the `fly.*` rows. A movement
		// cannot be rebound (`no-capture-surface`), and
		// `tests/chase-orbit.test.ts` holds each row's half to the way
		// `orbitByPointer` actually turns.
		more: [{ kind: "mouse-move", axis: "x", half: "+" }],
	},
	{
		id: "view.orbitStarboard",
		name: "Orbit the chase camera to starboard",
		group: "view",
		views: CHASE,
		keys: [{ key: "3", hold: true }],
		more: [{ kind: "mouse-move", axis: "x", half: "-" }],
	},
	{
		// Node #691's vertical half, the pointer's alone: pushed away the
		// camera rises over the hull, pulled back it sinks beneath and looks
		// up, as pulling back brings the nose up in the cockpit.
		id: "view.orbitUp",
		name: "Orbit the chase camera up, over the ship",
		group: "view",
		views: CHASE,
		// A pointer row: movement is its only trigger, and nothing moves it.
		fixed: "pointer",
		more: [{ kind: "mouse-move", axis: "y", half: "-" }],
	},
	{
		id: "view.orbitDown",
		name: "Orbit the chase camera down, beneath the ship",
		group: "view",
		views: CHASE,
		fixed: "pointer",
		more: [{ kind: "mouse-move", axis: "y", half: "+" }],
	},
	{
		id: "view.orbitCentre",
		name: "Centre the chase camera",
		group: "view",
		views: CHASE,
		keys: ["2"],
	},
	// system: the player screens ----------------------------------------
	{ id: "system.settings", name: "Settings", group: "system", keys: ["z"] },
	{
		id: "system.commander",
		name: "Commanders: save, load, switch",
		group: "system",
		keys: [COMMANDER_KEY],
	},
	{
		// #406. A digit because every letter already carries a command, and `6`
		// because `4`-`8` were the free pool the rebind rows move commands onto
		// and it was the one the fewest of them used.
		id: "system.postcard",
		name: "Postcard: save this view as an image or a link",
		group: "system",
		keys: ["6"],
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
 * The flight table: what the ship does with a pad press a surface left alone.
 *
 * **It names commands, and that is the whole of #381 S4's first step.** It was
 * `PAD_FLIGHT_KEYS` in `pad-bindings.ts` and it named *keys*, resolved by
 * `main.ts` against `DEFAULT_BINDINGS` rather than against the layout in
 * force. That bought one property — a keyboard rebind could not move a pad
 * button — and paid for it with the property this slice needs: a pad rebind
 * could not be expressed at all, because the button's meaning lived in a table
 * the player's layout is not. Naming a `CommandId` here makes the pad's half a
 * row of `DEFAULT_BINDINGS` like any other, and `resolvePad` reads the layout.
 * The first property survives without the table, because a `key` trigger and a
 * `pad-button` trigger are now two rows and a rebind moves one of them.
 *
 * DualSense labels in brackets; an Xbox pad reads `a`/`b`/`x`/`y` literally.
 *
 * | button | does |
 * | --- | --- |
 * | `a` (Cross) | launch, or skip the dock traversal |
 * | `b` (Circle) | request docking clearance |
 * | `y` (Triangle) | engage or drop cruise |
 * | `l1` / `r1` | previous and next target |
 * | `l3` | face the target |
 * | `r3` | cockpit or chase |
 * | `start` (Options) | docking computer |
 * | `select` (Create) | charge the Jump |
 * | d-pad ←/↑/→ | head-look port, forward, starboard |
 *
 * **A list per button, because `up` genuinely reaches two commands.** `2` is
 * head-forward in the cockpit and the orbit reset in chase, which #369 D3
 * settles as two commands with disjoint view scopes rather than one with two
 * meanings — so the d-pad's ↑ carries both rows and `resolvePad` picks by
 * view. A button that reached two commands in *one* view would be a collision,
 * and `defaultCollisions()` is red in CI for exactly that.
 *
 * D-pad ↓ is not in the table because what it does is not a command: it hands
 * the pad to the frame instrument and takes it back (`PadIntents.instrument`).
 * `x` (Square) is not either: it is the pulse laser's trigger, *held*, by the
 * principal's ruling (#324), and `fireButtons` derives that row. Flight assist
 * stays on the keyboard's `x`. **`home` is bound to nothing at all**, which is
 * the one free standard button and is said here rather than discovered in
 * flight.
 */
export const PAD_FLIGHT_COMMANDS: Partial<
	Record<PadButtonName, readonly CommandId[]>
> = {
	a: ["dock.launch"],
	b: ["dock.clearance"],
	y: ["fly.cruise"],
	l1: ["fight.targetPrevious"],
	r1: ["fight.targetNext"],
	l3: ["fight.faceTarget"],
	r3: ["view.toggle"],
	start: ["dock.computer"],
	select: ["fly.jump"],
	left: ["view.headPort"],
	up: ["view.headForward", "view.orbitCentre"],
	right: ["view.headStarboard"],
};

/**
 * The pad buttons that press this command.
 *
 * The contexts are the *button's*, asked of `pad-bindings.ts` rather than
 * stated here: a console claims six presses and the rest fall through, so
 * `a` is flight-only while `y` also reaches the ship from a console. That is
 * why this is derived at load and not a third column in the table above.
 */
function padButtonsFor(id: CommandId): Trigger[] {
	const out: Trigger[] = [];
	for (const button of STANDARD_BUTTONS) {
		if (!(PAD_FLIGHT_COMMANDS[button] ?? []).includes(id)) continue;
		const contexts = buttonContexts(button);
		if (contexts === null) continue;
		out.push({ kind: "pad-button", button, contexts });
	}
	return out;
}

/**
 * Where a button falls through to the ship, or `null` when it never does.
 *
 * One owner, because the rule was written three times — here, in
 * `capturedTrigger` and in `movedTrigger` — and "a button live nowhere is not
 * a binding" is one rule (sage rounds 1 and 2 on #497). The three readers do
 * different things with the `null`: a default row is skipped, a capture
 * records the button anyway so the registry can *say* why, and a rebind
 * refuses it.
 */
const buttonContexts = (
	button: PadButtonName,
): readonly PadContext[] | null => {
	const contexts = PRESSES.flight.get(button);
	return contexts !== undefined && contexts.length > 0 ? contexts : null;
};

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
	// **The modifiers are here because the game binds two of them.** `shift`
	// is `fly.throttleUp` and `control` is `fly.throttleDown`, and a browser
	// reports those as `ShiftLeft`/`ShiftRight` and `ControlLeft`/`ControlRight`
	// — which the prefix strip lowercases to `shiftleft`, one physical key with
	// two identities against the shipped `key: "shift"`. That is the same hole
	// this table was built to close for punctuation, left open for the two keys
	// a pilot holds most (sage round 5). `alt` and `meta` are here for the same
	// reason even though nothing binds them yet: the capture modal will hand
	// this a `KeyboardEvent.code` off the page, and a key it cannot name is a
	// key it cannot refuse.
	AltLeft: "alt",
	AltRight: "alt",
	ControlLeft: "control",
	ControlRight: "control",
	MetaLeft: "meta",
	MetaRight: "meta",
	ShiftLeft: "shift",
	ShiftRight: "shift",
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
 * What each digit and punctuation key types **under Shift** on the layout the
 * defaults were authored on — `PUNCTUATION_CODES`' other half, for one reader.
 *
 * `offAuthoredLayout` needs it because the capture records the character the
 * event sent, and Shift is held whenever a pilot throttles up: a US player who
 * binds `?` stores `{ key: "?", code: "Slash" }`, and against the unshifted
 * table alone that reads as a key from another keyboard.
 */
const AUTHORED_SHIFTED: Readonly<Record<string, string>> = {
	Digit1: "!",
	Digit2: "@",
	Digit3: "#",
	Digit4: "$",
	Digit5: "%",
	Digit6: "^",
	Digit7: "&",
	Digit8: "*",
	Digit9: "(",
	Digit0: ")",
	Backquote: "~",
	Backslash: "|",
	BracketLeft: "{",
	BracketRight: "}",
	Comma: "<",
	Equal: "+",
	Minus: "_",
	Period: ">",
	Quote: '"',
	Semicolon: ":",
	Slash: "?",
};

/**
 * What each number-pad key types with Num Lock on, on the layout the defaults // glossary-ignore: pad
 * were authored on (node #382).
 *
 * The pad is **not** the same on every keyboard: `NumpadDecimal` types `.` on // glossary-ignore: pad
 * a US keyboard and `,` on a Brazilian or German one (UI Events `code`,
 * §3.4), so a captured `{ key: ",", code: "NumpadDecimal" }` is another
 * keyboard's character and is marked like any other. A pad key the US layout // glossary-ignore: pad
 * does not have — `NumpadComma` — types nothing there, as `IntlBackslash`
 * does. With Num Lock off the pad sends named keys (`arrowup`, `delete`), // glossary-ignore: pad
 * which `offAuthoredLayout` never marks.
 */
const AUTHORED_NUMPAD: Readonly<Record<string, string>> = {
	Numpad0: "0",
	Numpad1: "1",
	Numpad2: "2",
	Numpad3: "3",
	Numpad4: "4",
	Numpad5: "5",
	Numpad6: "6",
	Numpad7: "7",
	Numpad8: "8",
	Numpad9: "9",
	NumpadDecimal: ".",
	NumpadAdd: "+",
	NumpadSubtract: "-",
	NumpadMultiply: "*",
	NumpadDivide: "/",
	NumpadEqual: "=",
};

/** The characters the authored layout types at a position, either shift. */
const authoredCharacters = (code: string): readonly string[] => {
	if (/^Key[A-Z]$/.test(code)) return [code.slice(3).toLowerCase()];
	if (/^Digit[0-9]$/.test(code))
		return [code.slice(5), AUTHORED_SHIFTED[code] as string];
	if (Object.hasOwn(PUNCTUATION_CODES, code))
		return [
			PUNCTUATION_CODES[code] as string,
			...(Object.hasOwn(AUTHORED_SHIFTED, code)
				? [AUTHORED_SHIFTED[code] as string]
				: []),
		];
	if (Object.hasOwn(AUTHORED_NUMPAD, code))
		return [AUTHORED_NUMPAD[code] as string];
	// A key the authored layout does not have — `IntlBackslash` — types
	// nothing there, so any character recorded on it is another keyboard's.
	return [];
};

/**
 * Every character the authored layout types at any position, either shift —
 * what a codeless key is compared against, since it names no position.
 */
const AUTHORED_ANYWHERE: ReadonlySet<string> = new Set([
	..."abcdefghijklmnopqrstuvwxyz0123456789",
	...Object.values(AUTHORED_SHIFTED),
	...Object.values(AUTHORED_NUMPAD),
	...Object.entries(PUNCTUATION_CODES)
		.filter(([code]) => !/^(Alt|Control|Meta|Shift)/.test(code))
		.map(([, key]) => key),
]);

/**
 * Whether a stored key is a UI Events named key (`arrowup`, `f6`, `enter`)
 * rather than a key string (node #382).
 *
 * Names are ASCII words of two or more characters, stored lowercased — the
 * capture modal's offer in `main.ts` lowercases `e.key` as `keyDispatch` does.
 * A key string is anything else — including one character built from several
 * code points, such as `ḍ̇`
 * (https://www.w3.org/TR/uievents-key/#key-string), which counting code
 * points would have read as a name.
 */
const namedKey = (key: string): boolean => /^[a-z][a-z0-9]+$/.test(key);

/**
 * Whether a key trigger prints a character the layout the defaults were
 * authored on does **not** type at its position (node #382).
 *
 * D7 prints the character a binding was recorded with, so a printed key is
 * evidence about the keyboard it was bound on. The `Controls` tab's header
 * says the keys print as a US keyboard types them, and this is the row-level // glossary-ignore: level
 * question that sentence owes: **does this key's character disagree with it.**
 * It is not "which keyboard was attached" — a QWERTZ capture on `KeyQ` types
 * `q`, is not marked, and prints exactly what the sentence says.
 *
 * **A function of the stored trigger alone**, so no change of the attached
 * keyboard can falsify it or the header that counts it. Knowing the attached
 * layout takes a keypress or Chromium's `getLayoutMap`, and telling a player
 * it changed under a saved layout is the capture modal's half of D7 — not
 * this predicate's, and not the tab's.
 *
 * Never true of:
 *
 * - a key with no code whose character the authored layout types somewhere —
 *   the shipped punctuation and digits, whose character is all the row
 *   states (`codeFor`). A codeless key the US layout types **nowhere** — a
 *   stored `{ key: "ü" }` — is marked, because the header would otherwise
 *   attribute it to a US keyboard (sage round 2);
 * - a chord — `movedTrigger` stores the character its position types here,
 *   because Option makes the event's character untrustworthy, so a chord is
 *   the authored layout's by construction and is D7's one printed exception;
 * - a named key — `arrowup`, `enter`, `f6` are spelled alike on every layout.
 *
 * A named key is told from a printable one by its **shape**, not its length:
 * UI Events names are ASCII words (`namedKey`), while a key string may be one
 * character built from several code points — `ḍ̇` is three — and is still a
 * character some keyboard types.
 *
 * The number-pad keys are not exempt: they are compared against // glossary-ignore: pad
 * `AUTHORED_NUMPAD`, because a pad's decimal key types `,` on many layouts. // glossary-ignore: pad
 */
export function offAuthoredLayout(t: Trigger): boolean {
	if (t.kind !== "key" || t.alt === true) return false;
	if (namedKey(t.key)) return false;
	if (t.code === undefined) return !AUTHORED_ANYWHERE.has(t.key);
	return !authoredCharacters(t.code).includes(t.key);
}

/**
 * The Alt chords authored on a command, as key triggers.
 *
 * **Authored here since #381 S4, and derived from `ALT_CHORDS` before it.**
 * That table mapped a physical key to the key it *stood for*, so a chord was
 * resolved against the shipped keyboard exactly as the pad's flight table was
 * — a chord moved in the registry was expressible and dead, because
 * `keyDispatch` swallowed every Alt press whose code the table did not carry.
 * The law now decides only *that* an Alt press is a chord and the layout
 * decides what it reaches, so there is nothing left for a second table to say
 * and these are three rows like any other.
 *
 * The character is `codeKey`'s, not the event's: on macOS Option changes it
 * (`Alt+D` arrives as `∂`), and what a row *prints* is the key at that
 * position on the layout the defaults were authored on — #369 D7's two halves,
 * which is also why the code is what `resolveKey` matches.
 */
const chordsFor = (codes: readonly string[]): Trigger[] =>
	codes.map((code) => ({
		kind: "key",
		key: codeKey(code),
		alt: true,
		code,
	}));

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

/** Every context but the one that exists to swallow input; see `scopeOf`. */
const NOT_WHILE_CAPTURING: readonly PadContext[] = PAD_CONTEXTS.filter(
	(c) => c !== "capture",
);

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
 *
 * **And `capture` is subtracted from every one of them** (#381 S4). The other
 * four contexts differ in what they *claim*; that one exists to claim
 * everything — D9's "swallow every input except its own cancel" — because a
 * key pressed while the rebind modal is listening is the thing being recorded,
 * not a command being run. A key live there would print a context note saying
 * the ship answers `w` while the modal is capturing `w`.
 *
 * It is subtracted rather than left out of `EVERY_CONTEXT`, because a *pad*
 * trigger can be live in `capture` and one is: `capturedTrigger` records a
 * stick and a trigger with that context and nothing else. So the rule is
 * about the kinds whose liveness this function invents, and not about the
 * context.
 *
 * **What this does not fix**, and it is older: `modal` is still in the list
 * for a key, while the settings panel's `releaseHeldKeys` exists precisely
 * because a held throttle key went on flying the ship behind a screen the
 * player was reading. That inaccuracy predates this slice and moving it is a
 * change to what a note *prints* for every keyboard row, which is #370's
 * screen rather than this node's.
 */
const scopeOf = (trigger: Trigger, views: readonly ViewMode[]): Scope => {
	const pad =
		"contexts" in trigger
			? trigger.contexts
			: trigger.kind === "mouse-move"
				? (["flight"] as const)
				: NOT_WHILE_CAPTURING;
	const surface =
		(trigger.kind === "key" || trigger.kind === "mouse-button") &&
		trigger.surface !== undefined
			? trigger.surface
			: undefined;
	// A movement narrower than its command is live where both are (node #691). // glossary-ignore: Command
	const only = trigger.kind === "mouse-move" ? trigger.views : undefined;
	const live = only ? views.filter((v) => only.includes(v)) : views;
	return makeScope(pad, live, surface); // glossary-ignore: pad
};

function triggersOf(a: Authored): Trigger[] {
	const keys = (a.keys ?? []).map(keyTrigger);
	// Head-look is a cockpit mechanism and the three chords are authored on
	// cockpit-only commands, so the view guard that used to stand here is the
	// scope those rows already carry — `tests/commands.test.ts` holds that a
	// chase `Alt+↑` reaches nothing, which is what licensed removing it and
	// `main.ts`'s copy of it with it (#381 S4).
	const chords = chordsFor(a.chords ?? []);
	return [
		...keys,
		...chords,
		...padButtonsFor(a.id as CommandId),
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
/**
 * A table of bindings that came from `layoutOf`, and from nowhere else.
 *
 * **The brand is the point** (#381 S4). `holdRows` keys its index on the array
 * *identity*, so a layout written into rather than rebuilt is answered out of
 * a stale index — and the freeze that makes that throw is a runtime backstop
 * discovered by whoever trips it. A nominal type moves the precondition into
 * the signature: a module that assembles its own rows cannot hand them to
 * `isHeld`, `resolveKey`, `resolvePad` or `rebind` at all, and the storage
 * slice was the obvious candidate to break it before the capture modal became
 * the next one.
 *
 * `tests/layout.types.ts` is where that is checked, because "this does not
 * compile" is not a thing `bun test` can see.
 *
 * **What the brand guarantees is the freeze, not provenance** (sage round 1
 * on #497 read the paragraph above as claiming more). `layoutOf` is exported
 * and takes any rows: `binding-store.ts` folds a stored diff into one, and
 * the tests build colliding tables with it. So a `Layout` is "a table that
 * went through the freeze", which is exactly what the hold index needs, and
 * not "the shipped table with moves applied" — `layoutMoves` is the function
 * that answers *that*, and it throws when the answer is no.
 */
declare const LAYOUT: unique symbol;
export type Layout = readonly Binding[] & {
	readonly [LAYOUT]: true;
	/**
	 * The shipped table this one is a move away from (#639).
	 *
	 * **On the table rather than beside it**, because every question that
	 * needs it is asked of a table: `layoutMoves` pairs a layout with the
	 * shipped one it came from, and a `rebind` that dropped the name would
	 * hand the next save a diff against the wrong table. `rebound` carries
	 * it across, so a move cannot lose it.
	 */
	readonly base: LayoutName;
};

/**
 * The layouts that ship, by name (#639).
 *
 * `default` is `flight-model.md` §3.5's. `mouse-flight` is for a pilot who
 * flies pitch and yaw on the mouse with the assist off: every translation key
 * under the left hand, so fore/aft, strafe and the vertical hold together.
 */
export const LAYOUT_NAMES = ["default", "mouse-flight"] as const;
export type LayoutName = (typeof LAYOUT_NAMES)[number];

/**
 * The one constructor, which freezes **through** rather than at the surface.
 *
 * `Object.freeze` on the array alone was round 4's answer and it is not one:
 * the freeze is shallow, so `layout[0].command = …` and
 * `layout[0].trigger.hold = true` both succeed silently — and a merge is far
 * likelier to write a row than to replace a slot. The row that was supposed to
 * hold this asserted a slot assignment and could not see either (sage round
 * 5). Each binding, its trigger and its scope are frozen here, which is what
 * the hold index's precondition actually needs.
 *
 * The trigger and scope objects are shared with `COMMANDS` and with the
 * context constants, so this freezes those too. That is intended: they are
 * read-only by contract everywhere already.
 *
 * **This is the only cast to `Layout` in `src/`**, which is what makes the
 * brand mean anything; a second one there is a second producer and the type is
 * back to being a comment. It said "in the repo" for three rounds and that was
 * false (sage round 3 on #497): two tests cast deliberately — one stands in
 * for a JavaScript caller the brand cannot reach, one builds a truncated table
 * on purpose — and `tests/commands.test.ts`'s guard row has always scanned
 * `src/` and said so.
 */
export const layoutOf = (
	rows: readonly Binding[],
	// The rows' own name when they carry one, so a caller that rebuilds a
	// named table cannot relabel it by omission (sage round 2); a plain array
	// is the default layout's.
	base: LayoutName = (rows as Partial<Layout>).base ?? "default",
): Layout => {
	// Non-enumerable, so a spread or a `JSON.stringify` of the rows sees rows
	// only. A frozen table cannot take a name, so it must already carry this
	// one: `holdRows` re-freezes a table this function made and passes its own
	// name back. Anything else — a frozen array that never came through here,
	// or a table asked to change its name — throws rather than returning a
	// `Layout` whose `base` is not what the call said (sage round 1).
	if (!Object.isFrozen(rows))
		Object.defineProperty(rows, "base", { value: base, enumerable: false });
	else if ((rows as Partial<Layout>).base !== base)
		throw new Error(
			`a frozen table is ${String((rows as Partial<Layout>).base)}, not ${base}`,
		);
	for (const b of rows) {
		Object.freeze(b.trigger);
		if ("contexts" in b.trigger) Object.freeze(b.trigger.contexts);
		if (b.trigger.kind === "mouse-move" && b.trigger.views)
			Object.freeze(b.trigger.views);
		Object.freeze(b.scope.pad);
		Object.freeze(b.scope.views);
		Object.freeze(b.scope);
		Object.freeze(b);
	}
	return Object.freeze(rows) as Layout;
};

export const DEFAULT_BINDINGS: Layout = layoutOf(
	COMMANDS.flatMap((c) =>
		c.defaultTriggers.map((trigger) => ({
			command: c.id,
			trigger,
			scope: scopeOf(trigger, c.views),
		})),
	),
);

/**
 * The mouse-flight layout's keys, as moves off the default table (#639).
 *
 * The source is CMDR Mechan's "Fixing Your M&K Controls" keyboard overlay,
 * and #639 holds the table. **A key keeps its axis in both regimes**: `w`/`s`
 * carry §3.6's two meanings exactly as `shift`/`control` do on the default
 * layout, and the strafe keys are a velocity demand with the assist on and a
 * force with it off. The arrows take pitch and yaw in the sense they had
 * before #620 gave them to the strafe.
 *
 * `shift` is free here and stays unbound, and the pulse laser keeps the mouse
 * and loses `space` to the vertical strafe. Both become the placeholder, so
 * the table stays row for row the default one — which is what `layoutMoves`
 * pairs on — and a player can still bind a key to the pulse laser.
 *
 * **`control` holds strafe up, and a key pressed under it runs no command**
 * (`key-dispatch.ts`): a held key still flies, so the three-axis burn holds,
 * but `x`, `j` and the jump key do nothing while the pilot climbs.
 */
const MOUSE_FLIGHT_KEYS: readonly {
	readonly command: CommandId;
	readonly from: string;
	readonly to: string | null;
}[] = [
	{ command: "fly.pitchUp", from: "s", to: "arrowdown" },
	{ command: "fly.pitchDown", from: "w", to: "arrowup" },
	{ command: "fly.yawPort", from: "a", to: "arrowleft" },
	{ command: "fly.yawStarboard", from: "d", to: "arrowright" },
	{ command: "fly.strafePort", from: "arrowleft", to: "a" },
	{ command: "fly.strafeStarboard", from: "arrowright", to: "d" },
	{ command: "fly.strafeDorsal", from: "arrowup", to: "control" },
	{ command: "fly.strafeVentral", from: "arrowdown", to: " " },
	{ command: "fly.throttleUp", from: "shift", to: "w" },
	{ command: "fly.throttleDown", from: "control", to: "s" },
	{ command: "fight.firePulse", from: " ", to: null },
];

/** One default row, moved if the mouse-flight table names it. */
const mouseFlightRow = (b: Binding): Binding => {
	if (b.trigger.kind !== "key" || b.trigger.surface !== undefined) return b;
	const { key } = b.trigger;
	const move = MOUSE_FLIGHT_KEYS.find(
		(m) => m.command === b.command && m.from === key,
	);
	if (move === undefined) return b;
	// Every row this table moves is a held flight key with no chord, so the
	// qualifier it keeps is `hold` and nothing else.
	const trigger =
		move.to === null ? UNBOUND_HELD : keyTrigger({ key: move.to, hold: true });
	return {
		command: b.command,
		trigger,
		scope: scopeOf(trigger, commandById(b.command).views),
	};
};

export const MOUSE_FLIGHT_BINDINGS: Layout = layoutOf(
	DEFAULT_BINDINGS.map(mouseFlightRow),
	"mouse-flight",
);

/** Every shipped table, by the name a stored layout records. */
export const SHIPPED_LAYOUTS: Readonly<Record<LayoutName, Layout>> = {
	default: DEFAULT_BINDINGS,
	"mouse-flight": MOUSE_FLIGHT_BINDINGS,
};

/**
 * The shipped table a name stands for, or a throw.
 *
 * One lookup for every caller (sage round 1): the store validates a stored
 * name before it asks, so a throw here is a name that reached the registry
 * without passing through `LAYOUT_NAMES` — a programming error, said loudly.
 */
export const shippedOf = (name: LayoutName): Layout => {
	const shipped = SHIPPED_LAYOUTS[name];
	if (shipped === undefined)
		throw new Error(`no layout ships as ${String(name)}`);
	return shipped;
};

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
		case "unbound":
			// Every placeholder hashes alike, and `collisions` skips the kind:
			// two commands with nothing bound do not share a trigger.
			return `unbound:${t.hold ? "hold" : "press"}`;
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
 *
 * **Rows, and deliberately not a `Layout`** (#381 S4). Every other reader of a
 * table took the brand, because each of them either keys an index on the
 * array's identity or pairs the rows against the shipped ones. This one is a
 * pure predicate over whatever it is given, and it has to stay that way: the
 * rows that prove it can *fail* are a filtered subset with one scope widened,
 * which is not a layout and must not be made to look like one by passing it
 * through the constructor. A `Layout` is assignable here, so both D5 callers
 * reach it unchanged.
 */
export function collisions(bindings: readonly Binding[]): Collision[] {
	const byTrigger = new Map<string, Binding[]>();
	for (const b of bindings) {
		if (isPlaceholder(b.trigger)) continue;
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
 * imports the other at all**, which is a stronger boundary than a direction
 * and is why this shape is restated here rather than shared: a shared facts
 * type would couple the law to the table it is asked about. The one import
 * that did cross — `ALT_CHORDS` — went in #381 S4, because a chord standing
 * for a key was the second half of the defect that pinned the pad.
 *
 * `view` is required for the reason #369 D4 gives — `2` is head-forward in the
 * cockpit and the orbit reset in chase, and a resolver that defaulted it would
 * answer one of those silently.
 */
export interface KeyFacts {
	/** `KeyboardEvent.key`, lowercased, as `keyDispatch` hands it over. */
	readonly key: string;
	/** `KeyboardEvent.code`. Absent only on a hand-built
	 *  `new KeyboardEvent({ key })` — Playwright's keyboard supplies one, so
	 *  the browser tier exercises the code arm rather than the fallback. */
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
export function resolveKey(bindings: Layout, facts: KeyFacts): CommandId[] {
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
 * How far a stick or a trigger must be pushed to count as a capture.
 *
 * Well above `applyRadialDeadzone`'s 0.18, because this is a deliberate shove
 * and not a drift: a worn stick resting at 0.3 would otherwise bind itself the
 * moment the modal opened, which is the failure D10 gives for leaving the
 * deadzone unexposed in the first place.
 */
export const CAPTURE_DEFLECTION = 0.5;

/**
 * What the pad just offered the rebind modal, as a trigger — or nothing.
 *
 * #369 D9's `capture` context exists so this can read the sticks and the
 * triggers while nothing flies. `pad-bindings.ts` owns whether an input is
 * *claimed*; this owns what it *is*, because what it produces is a `Trigger`
 * and that is the registry's word.
 *
 * **An edge, never a level, and the difference is the whole of C10.** A player
 * flying with the right stick over, who turns their head and presses the
 * shoulder to open this modal, has not let go of the stick. A level reading
 * records it on the first frame — and passes a row named "reads a stick on the
 * frame after the modal suspended it" while recording the stick the player
 * never chose. So `previous` is the frame before, and an axis already outside
 * the band there is not a push; with no previous frame at all nothing analog
 * is captured, because the opening frame has nothing to be an edge against.
 * A **press** needs none of this: `readPad` computes that edge itself, against
 * the previous poll.
 *
 * **Every button is capturable, including Circle.** The first version
 * reserved Circle as the modal's way out, which made it the one button a pad
 * could never bind. The principal's ruling removes the cost rather than
 * accepting it: the cancel is a *click*, which #370's standing premise
 * guarantees is always available and which no binding table can hold. So this
 * records whatever the pad offers and the modal's own control is what closes
 * it.
 *
 * **The contexts on a captured button are the button's.** #369 D4 gives the
 * player the trigger and the command the context set; a pad button's set is
 * neither — it is where `pad-bindings.ts` lets that button through, which is
 * why `a` comes back flight-only and `y` with all three. A button that falls
 * through **nowhere** comes back with an empty set rather than as `null`, so
 * `rebind` refuses it as `live-nowhere` and the modal prints a sentence — a
 * press that recorded nothing at all left the player looking at a modal that
 * had not reacted.
 */
export interface PadAnalog {
	readonly axes: PadFrame["axes"];
	readonly values: PadFrame["values"];
}

export function capturedTrigger(
	frame: PadFrame | null,
	previous: PadAnalog | null,
): Trigger | null {
	if (!frame?.connected) return null;

	for (const button of frame.pressed) {
		// The same law `padIntents` applies, asked of the module that owns it:
		// a full pull reports `pressed`, and a trigger read as a switch is a
		// key with extra steps.
		if (isAnalogTrigger(button)) continue;
		// **Recorded even when it falls through nowhere, so the modal can say
		// so** (sage round 2 on #497). This used to `continue`, which left the
		// doc claiming such a button was "refused" while the player pressing
		// d-pad ↓ got a modal that went on listening with no feedback — and
		// made `movedTrigger`'s `live-nowhere` refusal and its sentence
		// unreachable from a pad. An empty context set is what `rebind` reads
		// to raise it.
		return {
			kind: "pad-button",
			button,
			contexts: buttonContexts(button) ?? [],
		};
	}

	// Analog from here down, and all of it needs the frame before.
	if (previous === null) return null;

	for (const trigger of ANALOG_TRIGGERS)
		if (
			frame.values[trigger] >= CAPTURE_DEFLECTION &&
			previous.values[trigger] < CAPTURE_DEFLECTION
		)
			return { kind: "pad-trigger", trigger, contexts: CAPTURE_ONLY };

	for (const [name, stick, axis] of [
		["leftX", "left", "x"],
		["leftY", "left", "y"],
		["rightX", "right", "x"],
		["rightY", "right", "y"],
	] as const) {
		const now = frame.axes[name];
		if (Math.abs(now) < CAPTURE_DEFLECTION) continue;
		if (Math.abs(previous.axes[name]) >= CAPTURE_DEFLECTION) continue;
		return {
			kind: "pad-stick",
			stick,
			axis,
			half: halfOf(now),
			contexts: CAPTURE_ONLY,
		};
	}
	return null;
}

/**
 * The context set a captured stick or trigger carries.
 *
 * `capture` and nothing else, which is the honest answer rather than a
 * placeholder: the only place this game reads a stick off a *layout* is the
 * modal that just recorded it. `rebind` refuses to store either kind for that
 * exact reason, and names the reader — `padFlightAxes` — that would have to
 * start asking the layout first.
 */
const CAPTURE_ONLY: readonly PadContext[] = ["capture"];

/**
 * What this pad press reaches, in `bindings`.
 *
 * `resolveKey`'s sibling, and new in #381 S4. Before it, `main.ts` turned a
 * button into a *key* through `PAD_FLIGHT_KEYS` and resolved that key against
 * `DEFAULT_BINDINGS` — so the pad answered the shipped layout whatever the
 * player had done, and a pad rebind had nowhere to be stored. A pad button is
 * a row now, and this reads the row.
 *
 * **Three axes and all three are asked.** The button, the pad context — a
 * console claims Circle, so pressing it there must not request docking
 * clearance under the panel — and the view, because the d-pad's ↑ is
 * head-forward in the cockpit and the orbit reset in chase (#369 D4).
 *
 * **A press and not a hold.** `fight.firePulse` is Square *held* and
 * `padFireHeld` reads it, exactly as the keyboard's held set is read by
 * `isHeld` rather than by `resolveKey`. A capture that records a button hold
 * is a trigger kind this resolver does not answer, and `rebind` says so.
 *
 * A list rather than one id, for `resolveKey`'s reason: D5 is warn and allow,
 * so a player layout may put two commands on one button in one context and
 * the dispatch has to be able to run both.
 */
export interface PadFacts {
	readonly button: PadButtonName;
	readonly context: PadContext;
	readonly view: ViewMode;
}

export function resolvePad(bindings: Layout, facts: PadFacts): CommandId[] {
	const hits = bindings.filter((b) => {
		const t = b.trigger;
		return (
			t.kind === "pad-button" &&
			t.hold !== true &&
			t.button === facts.button &&
			// `scope.pad` rather than `trigger.contexts`: they are the same
			// object for a pad trigger, and the scope is the one place liveness
			// is published — `liveFor` reads `scope.views` next door for it.
			b.scope.pad.includes(facts.context) &&
			b.scope.views.includes(facts.view)
		);
	});
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
 * **That was a precondition before it was a property.** The storage slice is
 * the obvious candidate to break it — a layout merged *in place* keeps its
 * array identity and would be answered out of a stale index — so
 * `DEFAULT_BINDINGS` and everything `rebind` returns are frozen, and the
 * attempt throws in strict mode rather than going quietly wrong.
 *
 * **The view is not indexed**, because it changes between frames while the
 * layout does not; it is checked on the way out, over a list that is one or
 * two rows long.
 */
type HeldBinding = Binding & { trigger: Extract<Trigger, { kind: "key" }> };

const HOLD_INDEX = new WeakMap<Layout, Map<CommandId, HeldBinding[]>>();

const holdRows = (bindings: Layout): Map<CommandId, HeldBinding[]> => {
	const found = HOLD_INDEX.get(bindings);
	if (found !== undefined) return found;
	// **Belt as well as braces, and the braces are new.** This freeze was the
	// whole guarantee when `isHeld` took any array (sage round 5): freezing at
	// the producer left the precondition on callers with no type to carry it.
	// `Layout` carries it now, so every argument here has already been through
	// `layoutOf` — and this stays, because the brand is a compile-time claim
	// and the probe tier calls into this module from JavaScript.
	layoutOf(bindings);
	const index = new Map<CommandId, HeldBinding[]>();
	for (const b of bindings) {
		const keyed = keyBinding(b);
		if (keyed === null || !matchesQualifiers(keyed.trigger, { hold: true }))
			continue;
		index.set(b.command, [...(index.get(b.command) ?? []), keyed]);
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
	bindings: Layout,
	command: CommandId,
	keys: ReadonlySet<string>,
	view: ViewMode,
): boolean {
	// The index stores rows already narrowed to a key trigger and already
	// filtered on every qualifier, so the view is the only thing left to ask —
	// the null re-check this replaced was a condition `holdRows` guarantees,
	// and a reader had to prove that to know the branch was dead.
	for (const b of holdRows(bindings).get(command) ?? [])
		if (b.scope.views.includes(view) && keys.has(b.trigger.key)) return true;
	return false;
}

/** One row a player moved: which command, off what, onto what. */
export interface LayoutMove {
	readonly command: CommandId;
	readonly from: Trigger;
	readonly to: Trigger;
}

/**
 * Every row of a layout whose trigger is not the one it shipped on.
 *
 * **A question about the registry and not about storage**, which is why it
 * lives here beside `rebind` rather than in `binding-store.ts`: the `Controls`
 * tab asks it to decide whether it is printing the player's layout or the
 * shipped one, and routing that through the module that owns `localStorage`
 * put the presentation tier downstream of the persistence tier for a pure
 * comparison (sage round 2).
 *
 * Paired by position, because `rebind` writes `next[at]` and returns a new
 * array of the same length — so row *i* of any layout this game can produce is
 * row *i* of the shipped one with, at most, a different trigger. The pairing
 * is asserted rather than assumed: a layout that is not the shipped table with
 * triggers moved is a programming error, and one that silently produced the
 * wrong diff would be saved as a blob that loads as a different layout.
 */
export function layoutMoves(layout: Layout): LayoutMove[] {
	const shipped = shippedOf(layout.base);
	if (layout.length !== shipped.length)
		throw new Error(
			`a layout has ${shipped.length} rows, not ${layout.length}`,
		);
	const out: LayoutMove[] = [];
	for (let i = 0; i < layout.length; i++) {
		const live = layout[i] as Binding;
		const base = shipped[i] as Binding;
		if (live.command !== base.command)
			throw new Error(
				`layout row ${i} is ${live.command}, not ${base.command}`,
			);
		if (triggerKey(live.trigger) === triggerKey(base.trigger)) continue;
		out.push({ command: base.command, from: base.trigger, to: live.trigger });
	}
	return out;
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
	bindings: Layout,
	command: CommandId,
	from: Trigger,
	to: Trigger,
): Layout {
	return rebound(bindings, command, from, to).layout;
}

/**
 * The same move, with the trigger it stored.
 *
 * **The registry hands the stored trigger back rather than letting a caller
 * work it out** (sage round 5 on #497). `movedTrigger` completes a captured
 * trigger — it derives a missing code, and takes a chord's character from its
 * position — so a screen that shows what it will bind needs the *completed*
 * one. `proposedRebind` inferred it twice, first from slot identity and then
 * by repeating this function's own `findIndex`; both were this function's
 * internals read from outside it.
 */
export function rebound(
	bindings: Layout,
	command: CommandId,
	from: Trigger,
	to: Trigger,
): { readonly layout: Layout; readonly stored: Trigger } {
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
	return { layout: layoutOf(next, bindings.base), stored: moved };
}

/**
 * The trigger a rebind actually stores — `to`, checked and completed.
 *
 * **A per-kind table of which part of a trigger is the player's** (#381 S4).
 * The first version returned a same-kind non-key `to` verbatim, which let a
 * `mouse-button` hold be moved onto a click: stored, satisfying no reader. The
 * version after it refused every non-key kind outright and said "S4 lifts it".
 * This is the lift, and what it lifts is narrower than #369 D12 asks for —
 * the table is *which kinds the layout has a reader for*, not which kinds
 * exist.
 *
 * **What a move may change, by kind:**
 *
 * | kind | the player moves | the command keeps |
 * | --- | --- | --- |
 * | `key` | which key, and its code | `hold`, `alt`, `surface` |
 * | `pad-button` | which button | `hold`, and the contexts are the button's |
 * | `key` ↔ `pad-button` | the whole device | `hold` on neither side |
 *
 * **And what it refuses, each naming the reader that would have to exist.**
 * A stored move for a kind nothing reads off the layout is the defect this
 * function's first version shipped, so the refusals are the honest answer and
 * not a gap:
 *
 * - a `pad-stick` or a `pad-trigger`, because `padFlightAxes` reads fixed
 *   positions and not the layout. #369 D10's invert and sensitivity route
 *   through that same function, so the two are one change and not this slice's
 *   — [#496](https://github.com/jcfischer/seelite/issues/496) owns both.
 * - a `pad-button` **held**, because `padFireHeld` reads a fixed position too,
 *   and `resolvePad` answers a press. #496's third question is whether that
 *   and `isHeld` are one predicate over both devices or two.
 * - a `mouse-button`, `mouse-move` or `pad-intent`, which have no capture
 *   surface at all — the modal does not record them.
 *
 * **A qualifier is the command's, not the player's.** `fly.pitchUp` is flown
 * by *holding* a key; a `to` that dropped `hold` would be stored, would
 * satisfy no `isHeld`, and the command would be silently unflyable while the
 * call returned successfully. That is #369 D4's "the player edits the trigger;
 * the context set is the command's" applied to the half of a trigger that is
 * not the key — and on a pad button the contexts are that half, so they are
 * taken from `pad-bindings.ts` and never from the caller.
 *
 * **A code is derived when the caller does not give one.** The shipped rows
 * get theirs from `keyTrigger`, so a rebind that stored `to` verbatim would
 * leave a letter codeless and lose D7's position dispatch for exactly the
 * command the player just chose to move. A `to` that *does* carry a code keeps
 * it, which is the capture modal's case rather than an oversight: it records
 * the physical key it saw, and on a layout where that key does not type its US
 * character — which is the whole point of D7 — the pair is legitimately
 * mismatched and only the capture knows the truth. The cost is that a caller
 * passing an inconsistent pair gets exactly what it asked for.
 */
function movedTrigger(from: Trigger, to: Trigger): Trigger {
	if (!movable(from))
		throw new RebindRefused(
			"not-offered",
			`a ${from.kind} is not a trigger this game offers for rebinding`,
		);
	// **One switch, so the table is one construct.** A pair of them — a
	// refusal list beside an acceptance list — is two places to add a kind to
	// and one of them is the place a reader looks.
	switch (to.kind) {
		case "key": {
			// `matchesQualifiers` is the one owner of everything about a key
			// trigger except which key it is. A cross-device move has no `alt`
			// or `surface` on the far side, so what a pad button carries is
			// `hold` alone and that is what is compared.
			if (from.kind === "key") {
				if (!matchesQualifiers(to, from)) throw keptQualifiers(from, to);
			} else if (!sameHold(from, to)) throw keptQualifiers(from, to);
			// **A key's character is its position's, not the event's** — the
			// rule `chordsFor` states and, until sage round 2 on #497, the rule
			// only `chordsFor` obeyed. On macOS Option changes the character,
			// so a captured `Alt+D` arrives as `∂` and was stored and printed
			// as `Alt + ∂`. Normalising here rather than in the capture means
			// every producer gets it, which a rule living in one producer did
			// not.
			//
			// **Under `alt`, and round 4 widened this too far.** Normalising
			// every coded key turned a captured `?` into `/` — `codeKey` gives
			// the character a position types *unshifted*, and `Slash` is `/`.
			// #377 ruled `?` is the character the keyboard types, so that
			// regression renamed a shipped binding the moment a player
			// recaptured it. The condition that was right is the narrow one:
			// a *chord* prints its position, because Option is the only thing
			// in this game that makes the event's character untrustworthy
			// (sage rounds 2, 4 and 5).
			//
			// The other half of round 4's finding — an *ordinary* row
			// capturing `Alt+Q` on macOS — is answered where the fact lives:
			// `main.ts` knows Option was held and sends the position's
			// character. Two places, two different facts, and neither is the
			// other's copy.
			const { kind: _kind, ...rest } = to;
			return keyTrigger(
				rest.alt === true && rest.code !== undefined
					? { ...rest, key: codeKey(rest.code) }
					: rest,
			);
		}
		case "pad-button": {
			if (to.hold === true)
				throw unstorable(
					"no-reader-held",
					to,
					"a held button is read by padFireHeld, which reads a fixed position and not the layout",
				);
			if (!sameHold(from, to)) throw keptQualifiers(from, to);
			// The contexts are the **button's**, asked of `pad-bindings.ts`
			// through the derivation the shipped rows came from — so a caller
			// that hands over a set of its own gets the button's anyway.
			const contexts = buttonContexts(to.button);
			if (contexts === null)
				throw new RebindRefused(
					"live-nowhere",
					`${to.button} is claimed in every context, so a binding on it is live nowhere`,
				);
			return { kind: "pad-button", button: to.button, contexts };
		}
		case "pad-stick":
		case "pad-trigger":
			throw unstorable(
				"no-reader-axes",
				to,
				"a stick and a trigger are read by padFlightAxes, which reads fixed positions and not the layout",
			);
		case "mouse-button":
		case "mouse-move":
			throw unstorable(
				"no-capture-surface",
				to,
				"the mouse has no capture surface, so nothing can record a move onto it",
			);
		case "pad-intent":
			throw unstorable(
				"not-offered",
				to,
				"a panel intent is the console's grammar and is not offered for rebinding",
			);
		case "unbound":
			throw unstorable(
				"not-offered",
				to,
				"an unbound placeholder is where a control starts, not a trigger to move onto",
			);
	}
}

/**
 * Why a rebind was refused, as a code rather than as the sentence.
 *
 * **The sentence is not enough, and keying one off `to.kind` was wrong**
 * (sage round 1 on #497). `movedTrigger` refuses for several reasons and two
 * of them can land on the same kind: a `pad-button` is refused when it
 * is held *and* when it is claimed in every context, and a `key` — which the
 * registry normally takes — is refused when the trigger being *moved* is one
 * the game does not offer. A capture modal keying its sentence on the kind
 * therefore printed the hold sentence for a button that was claimed
 * everywhere, and an empty string for a refused key.
 *
 * A code and not prose, for `RejectReason`'s reason next door in
 * `layout-notice.ts`: a sentence a player reads is `controls-reference.ts`'s,
 * with its key spelled by `key-names.ts` (#369 D11, as #499 D2 reads it), and
 * a sentence thrown from here is a developer's.
 *
 * **The count is not stated here.** It was written as five beside a union of
 * six inside one round, which is what a count of a list directly below it is
 * worth — `RejectReason`'s doc next door already refuses to state its own for
 * the same reason (sage round 2 on #497).
 */
export type RebindRefusal =
	/** The trigger being moved is not one this game offers (`fixed`, a hold). */
	| "not-offered"
	/** The `to` changes `hold`, `alt` or `surface`, which are the command's. */
	| "qualifiers"
	/** A held pad button: `padFireHeld` reads a fixed position (#496). */
	| "no-reader-held"
	/** A stick or trigger: `padFlightAxes` reads fixed positions (#496). */
	| "no-reader-axes"
	/** The mouse, which nothing can record a move onto. */
	| "no-capture-surface"
	/** A button every surface claims, so a binding on it is live nowhere. */
	| "live-nowhere";

/**
 * What `rebind` throws, carrying the code beside the developer's sentence.
 *
 * An `Error` subclass rather than a returned union, because `rebind` is called
 * from `binding-store.ts`'s load path too — where the sentence becomes a
 * `refused-by-registry` notice — and a second return shape there would be a
 * second thing every caller has to unpack.
 */
export class RebindRefused extends Error {
	constructor(
		readonly refusal: RebindRefusal,
		message: string,
	) {
		super(message);
		this.name = "RebindRefused";
	}
}

/**
 * The refusal for a kind the layout has no reader for.
 *
 * It names the **reader**, because that is what has to change before the
 * refusal can be lifted; a message saying only "not supported" would leave the
 * next slice guessing which function to go and look at.
 */
const unstorable = (refusal: RebindRefusal, to: Trigger, why: string) =>
	new RebindRefused(refusal, `a rebind cannot store a ${to.kind}: ${why}`);

const keptQualifiers = (from: Trigger, to: Trigger) =>
	new RebindRefused(
		"qualifiers",
		`a rebind may move a trigger, not its qualifiers: ${triggerKey(from)} -> ${triggerKey(to)}`,
	);

/**
 * Whether two triggers agree about being held.
 *
 * One owner, because `movedTrigger` asked it in both the cross-device key arm
 * and the pad-button arm, and "hold is the command's" is one rule (sage round
 * 4 on #497).
 */
const sameHold = (from: Trigger, to: Trigger) =>
	(heldRather(to) ?? false) === (heldRather(from) ?? false);

/**
 * Whether this trigger is held rather than pressed, on the kinds that say.
 *
 * Exported because the capture modal completes a captured trigger with the
 * command's qualifiers and needs the same answer — `movedTrigger` *enforces*
 * the rule and `qualifiedLike` supplies it, so a second copy of "which kinds
 * carry hold" would let the two disagree about one qualifier (sage round 3
 * on #497).
 */
export const heldRather = (t: Trigger): true | undefined =>
	t.kind === "key" || t.kind === "pad-button" || t.kind === "unbound"
		? t.hold
		: undefined;

/** Whether a command's existing trigger is one a player may move at all. */
const movable = (t: Trigger): boolean =>
	t.kind === "key" ||
	t.kind === "unbound" ||
	(t.kind === "pad-button" && t.hold !== true);

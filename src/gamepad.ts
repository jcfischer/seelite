/**
 * What the pad is doing this frame — and nothing about what any of it means.
 *
 * This module is **copied, not imported**: seelite gets its own copy, and a
 * rule that lives only in Seekolous's head does not survive the copy. So the
 * four rules that make it portable are written here rather than in the ticket
 * that added it.
 *
 * ## 1. Poll-only
 *
 * `navigator.getGamepads()` once per frame, and no `gamepadconnected` listener
 * anywhere.
 *
 * A listener can be made to work — registered early enough, and paired with a
 * query for the pad that was already there — so this is a choice rather than
 * the only option, and an earlier version of this paragraph claimed otherwise.
 * What it buys is that there is no announcement to have missed. A browser hides
 * a paired pad until the player presses a button on it, and hides it again from
 * a page reloaded while the pad sat idle; an event-driven reader has to reason
 * about which of those it saw. A poll finds the pad on the frame after the
 * first press and asks nothing about how it got there. A non-null entry **is**
 * a connected pad, and that is the whole test.
 *
 * ## 2. `navigator` is touched inside `poll()` and nowhere else
 *
 * Guarded, and inside a `try`. Import and construction reach for nothing, so
 * the module loads under bun and sits on `tests/headless.test.ts`'s list with
 * the rest of the rules tier. That is the step this project keeps forgetting
 * (see that file's header), so it is stated at the top of the module it applies
 * to rather than only in the list it belongs on.
 *
 * The reason it is a `try` and not only a guard: a method that is present and
 * *refuses* is a different shape from a method that is absent, and an input
 * layer that dies on the second one takes the game with it. That is the whole
 * argument, and it does not need a cause to be worth defending against.
 *
 * **No claim is made here about when that happens.** An earlier version of this
 * paragraph said the API requires a secure context and that an `http://` LAN
 * origin therefore throws; review could not find that in the WebIDL, and
 * nothing here has observed a browser doing it. What is checked is narrower and
 * true: the test installs a `getGamepads` that throws and proves the catch runs
 * and warns once.
 *
 * ## 3. Triggers report their analog `value`, not only `held`
 *
 * Seekolous has no use for that. Seelite's throttle is why the field exists,
 * and a field the first consumer does not need is exactly the field a copied
 * module loses if nobody says why it is there.
 *
 * ## 4. A pad off the standard mapping is refused, not guessed at
 *
 * Every name here is a *position*, so off that mapping the indices mean
 * whatever the firmware wanted and reading them anyway invents a button press.
 * The argument is at the check in `readPad`. This rule was a comment claiming
 * the behaviour before it was code doing it — review caught the gap.
 *
 * ## What is deliberately absent
 *
 * **A binding table.** This module says `r1` is down; it does not know that r1
 * widens a brush. The mapping from button to action lives in the game, because
 * one consumer cannot tell you what a binding abstraction needs and seelite
 * will say so when it copies this file. If both games end up writing the same
 * table, *that* is the moment to lift it — not this one.
 *
 * **Rumble, adaptive triggers, the touchpad, motion.** All DualSense extras
 * behind vendor-specific surfaces. None of them are the standard mapping, and
 * none of them are needed to play.
 *
 * ## Edges belong here
 *
 * `pressed` and `released` are computed against the previous frame, because
 * every consumer wants them and every consumer would otherwise keep its own
 * copy of the previous frame. The Gamepad API has no button events at all, so
 * this is not a convenience — without it, "cast once per press" is unwritable.
 */

/**
 * The buttons of the W3C **standard mapping**, named by position rather than by
 * the labels printed on any one pad.
 *
 * A DualSense reads `a` = Cross, `b` = Circle, `x` = Square, `y` = Triangle;
 * `select` = Create, `start` = Options, `home` = the PS button. An Xbox pad
 * reads `a`/`b`/`x`/`y` literally. Naming by position is the only choice that
 * is not a lie on one of the two, and the game's own comments can say Cross
 * where a player would.
 *
 * The order is the index order of `Gamepad.buttons`, and it is exported because
 * the probe builds its fake pad from it: a test that hard-codes `buttons[0]`
 * and a module that reads index 0 agree by luck, and this makes them agree by
 * construction.
 */
export const STANDARD_BUTTONS = [
	"a",
	"b",
	"x",
	"y",
	"l1",
	"r1",
	"l2",
	"r2",
	"select",
	"start",
	"l3",
	"r3",
	"up",
	"down",
	"left",
	"right",
	"home",
] as const;

/**
 * One name per button, derived from the order above rather than written twice.
 *
 * The two were separate declarations of the same seventeen names until review
 * pointed out that nothing made them agree: adding a button meant two edits,
 * and TypeScript could not see the second one missing.
 */
export type PadButtonName = (typeof STANDARD_BUTTONS)[number];

/** Stick axes of the standard mapping. Y is negative *up*, as the API reports it. */
export type PadAxisName = "leftX" | "leftY" | "rightX" | "rightY";

/**
 * The parts of `Gamepad` this module reads.
 *
 * Structural rather than `Gamepad` itself so the pure half can be called with a
 * literal in a unit test, and so the module does not need lib.dom in its types.
 */
export interface RawPad {
	readonly id?: string;
	/**
	 * The browser's own verdict on whether this device fits the standard
	 * mapping.
	 *
	 * `Gamepad.mapping` is **required** in the API — a `GamepadMappingType` whose
	 * empty string means "no mapping recognised", not "not reported". It is
	 * optional *here* only so a test fixture can leave it out and land on the
	 * same refusal an unrecognised pad gets. Anything but `"standard"` is refused
	 * by `readPad`, which is where the argument is.
	 */
	readonly mapping?: string;
	readonly axes: readonly number[];
	readonly buttons: readonly {
		readonly pressed: boolean;
		readonly value: number;
	}[];
}

/** One frame of pad state, ready for a game to read bindings out of. */
export interface PadFrame {
	/** A pad was present this frame. Everything below is zero/empty when false. */
	readonly connected: boolean;
	/** The pad's own id string, for a HUD line or a log. Empty when disconnected. */
	readonly id: string;
	/** Deadzoned, rescaled, clamped to the unit disc. Y is negative up. */
	readonly axes: Readonly<Record<PadAxisName, number>>;
	/**
	 * 0..1 per button. A digital button is 0 or 1; `l2`/`r2` are continuous on a
	 * pad that reports pressure, which is rule 3 above.
	 */
	readonly values: Readonly<Record<PadButtonName, number>>;
	/** Down this frame. Derived from `values` against `pressThreshold`. */
	readonly held: ReadonlySet<PadButtonName>;
	/**
	 * Down this frame and not the last.
	 *
	 * **`GamepadSource.poll` never reports one on the first frame of a given
	 * pad** — the suppression is that method's, not this type's, and `readPad`
	 * called directly will happily report a press against an empty baseline
	 * (`tests/gamepad.test.ts` pins both). A browser hides a pad until a button
	 * on it is pressed, so a pad's first visible frame nearly always has a
	 * button down; treating that as a press means the keystroke that *woke the
	 * controller* also acts. The player presses again, which is what waking a
	 * device feels like anyway.
	 */
	readonly pressed: ReadonlySet<PadButtonName>;
	/** Down last frame and not this one. */
	readonly released: ReadonlySet<PadButtonName>;
}

export interface PadOptions {
	/**
	 * Radial deadzone, 0..1. Applied to each stick as a pair and rescaled, so
	 * the first millimetre of real deflection reads as a small number rather
	 * than jumping to the deadzone's own value.
	 *
	 * 0.18 is a convention, not a measurement. A deadzone has to exceed a
	 * resting stick's drift or an untouched pad walks the camera, and the usual
	 * range for that is 0.10–0.20; this sits near the top of it because a worn
	 * stick drifts further than a new one and a camera that creeps is worse than
	 * one that ignores the first millimetre. **No controller has been measured
	 * for this number** — it is the caller's to change, which is why it is an
	 * option rather than a constant.
	 */
	readonly deadzone?: number;
	/**
	 * Where an analog trigger counts as held.
	 *
	 * `l2` and `r2` only. A digital button is decided by the pad's own `pressed`
	 * bit, which is the better answer there and cannot be tightened by a number.
	 * Raising this above the browser's own ~0.5 really does raise the trigger's
	 * bite point, which is the direction the option exists for.
	 *
	 * A resting trigger is never held, whatever this is set to. `0` would
	 * otherwise mean "always", since a trigger at rest reports exactly 0 and
	 * `0 >= 0` — so both triggers would read as held for ever and never produce
	 * an edge. Review found that; the useful range is above 0 and up to 1.
	 */
	readonly pressThreshold?: number;
	/**
	 * Which connected pad to read. Index into `navigator.getGamepads()`, or
	 * `undefined` for "the first one that is there", which is what a
	 * single-player game wants.
	 */
	readonly index?: number;
}

const DEFAULT_DEADZONE = 0.18;
const DEFAULT_PRESS = 0.5;

/**
 * The two buttons of the standard mapping that are not buttons.
 *
 * `l2` and `r2` report a continuous pull, so `pressThreshold` decides whether
 * they are held. Everything else is a switch, and the pad's own `pressed` bit
 * is the better answer for those — see the branch in `readPad`.
 */
const ANALOG_BUTTONS: ReadonlySet<PadButtonName> = new Set<PadButtonName>([
	"l2",
	"r2",
]);

const ZERO_AXES: Readonly<Record<PadAxisName, number>> = Object.freeze({
	leftX: 0,
	leftY: 0,
	rightX: 0,
	rightY: 0,
});

function zeroValues(): Record<PadButtonName, number> {
	const out = {} as Record<PadButtonName, number>;
	for (const name of STANDARD_BUTTONS) out[name] = 0;
	return out;
}

/**
 * A `Set` that refuses to be written to.
 *
 * `Object.freeze` does nothing to a `Set` — the entries live in an internal
 * slot that freezing does not reach, so a frozen `Set` still accepts `add`.
 * That mattered here rather than being a curiosity: the empty edge sets below
 * are *shared* by every frame that has no edges to report, so one consumer
 * calling `frame.pressed.add("a")` would have made every later frame report a
 * press nobody made. Review found the header claiming this was frozen while it
 * was not, which is the worse half of the bug.
 *
 * The type says `ReadonlySet`, so TypeScript already refuses; this is for the
 * probe, the console, and anything else reaching the module as plain JS.
 */
class ImmutableSet<T> extends Set<T> {
	/**
	 * Put a value in, from the module that owns the set.
	 *
	 * The escape hatch, and deliberately an awkward one: a static reaching past
	 * the instance's own `add`, so building a frame is possible and doing it from
	 * outside this file is obviously not the intended path. `readPad` fills a
	 * set once, before the frame it belongs to exists; nothing mutates one after.
	 *
	 * It exists rather than a constructor taking an iterable because `Set`'s
	 * constructor fills itself by calling `add` — the method this class refuses.
	 */
	static fill<T>(set: ImmutableSet<T>, value: T): void {
		Set.prototype.add.call(set, value);
	}

	add(): never {
		throw new TypeError("gamepad: this set is shared between frames");
	}
	delete(): never {
		throw new TypeError("gamepad: this set is shared between frames");
	}
	clear(): never {
		throw new TypeError("gamepad: this set is shared between frames");
	}
}

const EMPTY: ReadonlySet<PadButtonName> = new ImmutableSet<PadButtonName>();

/** Every button at zero — the reading for a pad nobody is touching. */
const ZERO_VALUES: Readonly<Record<PadButtonName, number>> = Object.freeze(
	zeroValues(),
);

/**
 * The steady state of having no pad: one object, shared, never mutated.
 *
 * It exists because the no-pad case is the *common* one — `poll()` runs every
 * frame of every game whether or not anybody owns a controller, and building
 * four objects and rewriting seventeen button slots per frame to say "nothing
 * happened" is work nobody asked for.
 *
 * Shared means a write to it would poison every frame after, so every part is
 * genuinely immutable: `Object.freeze` for the plain objects, and for the sets
 * an `ImmutableSet`, because freezing a `Set` does not stop `add`. The freeze
 * here is shallow and that is fine — what it holds is either frozen or an
 * `ImmutableSet` already.
 */
const NO_PAD: PadFrame = Object.freeze({
	connected: false,
	id: "",
	axes: ZERO_AXES,
	values: ZERO_VALUES,
	held: EMPTY,
	pressed: EMPTY,
	released: EMPTY,
});

/**
 * A frame with no pad in it, carrying the previous frame's `held` set out as
 * releases so a pad unplugged mid-press does not leave a button down forever.
 *
 * Allocates only when there is something to say. With nothing held — every
 * frame of a keyboard-only session — it hands back the shared `NO_PAD`.
 */
function disconnectedFrame(previousHeld: ReadonlySet<PadButtonName>): PadFrame {
	if (previousHeld.size === 0) return NO_PAD;
	// Frozen like the rest. This branch was the exception, and the comment at
	// the swap in `poll` said every frame was frozen while this one was not —
	// so a consumer could edit the evidence of a disconnect.
	const released = new ImmutableSet<PadButtonName>();
	for (const name of previousHeld) ImmutableSet.fill(released, name);
	return Object.freeze({
		connected: false,
		id: "",
		axes: ZERO_AXES,
		values: ZERO_VALUES,
		held: EMPTY,
		pressed: EMPTY,
		released,
	});
}

/**
 * Radial deadzone on a stick **pair**, rescaled to the full range.
 *
 * Per-axis deadzoning is the common mistake and it is visible in play: a stick
 * pushed diagonally has each axis at ~0.7, so a per-axis cut of 0.18 leaves
 * both alive but a stick pushed *straight up* to 0.17 leaves nothing — the dead
 * region is a square, and its corners reach 1.41× further than its sides. The
 * player feels that as a camera that will not pan diagonally at low speed.
 *
 * Rescaling matters for the same reason a deadzone does: without it the first
 * input the game sees is `deadzone` itself, so the camera starts at a speed
 * rather than from rest.
 */
export function applyRadialDeadzone(
	x: number,
	y: number,
	deadzone: number,
): [number, number] {
	const s = deadzoneScale(x, y, deadzone);
	return [scaleAxis(x, s), scaleAxis(y, s)];
}

/**
 * One axis times the deadzone's scale — and plain `0` when that scale is zero.
 *
 * The guard is there for the sign. A rested stick reading `-0.06` multiplied by
 * a scale of zero is **negative** zero, which compares equal to zero and prints
 * as `-0`, so it passes every `=== 0` check in the game and fails a test that
 * says a discarded axis reads exactly zero. Rather than teach the test to
 * accept two spellings of nothing, the arithmetic produces one.
 */
function scaleAxis(value: number, scale: number): number {
	return scale === 0 ? 0 : value * scale;
}

/**
 * The same arithmetic, as a factor to multiply both axes by.
 *
 * A number rather than a pair, so the frame path can write straight into its
 * axes object instead of allocating two throwaway arrays per poll — which at
 * sixty frames a second is the kind of garbage nobody notices until a profile
 * says so. `applyRadialDeadzone` above is the readable form of the same thing
 * and is what the tests read; this is what `readPad` calls.
 *
 * Zero inside the deadzone, so the multiplication does the discarding.
 */
function deadzoneScale(x: number, y: number, deadzone: number): number {
	// A deadzone of 1 discards everything, and says so here rather than dividing
	// by zero below. The option documents `0..1`, and at the top of that range
	// `(mag - 1) / (1 - 1)` is `Infinity` or `NaN` depending on the numerator —
	// so a cardinal full push was thrown away while a diagonal reading past 1
	// sailed through. A boundary that behaves differently by direction is not a
	// boundary. Review caught it; nothing was passing 1, which is why it took a
	// reader rather than a test.
	if (deadzone >= 1) return 0;
	const mag = Math.hypot(x, y);
	if (mag <= deadzone) return 0;
	// Clamp to the unit disc: a stick's raw corners can read past 1.0, and a
	// magnitude above 1 is a camera that moves faster on the diagonal.
	return Math.min(1, (mag - deadzone) / (1 - deadzone)) / mag;
}

/**
 * The pure half: raw pad plus what was held last frame, in; a frame, out.
 *
 * Everything this module decides happens here, so everything this module
 * decides is a unit test. `poll()` below is the part that cannot be one.
 *
 * `previousHeld` is the caller's, not remembered here, for the same reason
 * `advanceWork` in `work.ts` returns progress rather than storing it: the owner
 * of the state is the thing that survives across frames, and that is the
 * source, not this function.
 */
export function readPad(
	raw: RawPad | null | undefined,
	previousHeld: ReadonlySet<PadButtonName>,
	options: PadOptions = {},
): PadFrame {
	// A pad that is not in the standard mapping is a pad this module cannot
	// read, and saying so is the only honest answer.
	//
	// Every name below is a *position*: `buttons[0]` is `a` because the standard
	// mapping says so. On a device the browser could not fit to that mapping the
	// indices mean whatever its firmware wanted, so assigning them these names
	// is not a best effort — it is an invention, and one that can start a match
	// or sculpt the ground from a button the player thinks is something else.
	// Review found this claiming the opposite in a comment while doing exactly
	// that, which is why the rule is code now.
	//
	// The cost is a real one and it is the right way round: an exotic pad reads
	// as no pad, the game stays on the keyboard, and nothing happens that the
	// player did not ask for.
	if (!raw || raw.mapping !== "standard")
		return disconnectedFrame(previousHeld);

	const deadzone = options.deadzone ?? DEFAULT_DEADZONE;
	const threshold = options.pressThreshold ?? DEFAULT_PRESS;

	const rawLeftX = raw.axes[0] ?? 0;
	const rawLeftY = raw.axes[1] ?? 0;
	const rawRightX = raw.axes[2] ?? 0;
	const rawRightY = raw.axes[3] ?? 0;
	const leftScale = deadzoneScale(rawLeftX, rawLeftY, deadzone);
	const rightScale = deadzoneScale(rawRightX, rawRightY, deadzone);
	const leftX = scaleAxis(rawLeftX, leftScale);
	const leftY = scaleAxis(rawLeftY, leftScale);
	const rightX = scaleAxis(rawRightX, rightScale);
	const rightY = scaleAxis(rawRightY, rightScale);

	// Allocated on demand rather than up front.
	//
	// Review counted what a connected pad costs per frame and it was four sets,
	// a values record and two tuples — several hundred short-lived objects a
	// second while somebody is holding a stick. The obvious cure is a mutable
	// frame the source hands out and overwrites next frame, and that is the one
	// thing this module must not do: a consumer that keeps a frame for a
	// comparison would silently be comparing it with itself, which is the class
	// of bug nothing catches. No frame here is a view onto another frame's
	// storage, and the one below is frozen on the way out.
	//
	// What is left is the observation that most of it is *empty*. A player
	// panning the camera presses nothing, so `pressed` and `released` are empty
	// on nearly every frame, and a pad at rest has seventeen zero values. Those
	// share a frozen constant instead of being rebuilt, and only the parts with
	// something in them are allocated — which is the same trick `disconnectedFrame`
	// already used, applied one level in.
	let values: Record<PadButtonName, number> | null = null;
	let held: ImmutableSet<PadButtonName> | null = null;
	let pressed: ImmutableSet<PadButtonName> | null = null;
	let released: ImmutableSet<PadButtonName> | null = null;

	for (let i = 0; i < STANDARD_BUTTONS.length; i++) {
		const name = STANDARD_BUTTONS[i];
		const button = raw.buttons[i];
		// A short `buttons` array still happens inside the standard mapping — a
		// pad without the `home` button reports sixteen. Missing reads as zero
		// rather than throwing, so the buttons it does have keep working.
		//
		// This is *not* the fallback for an unmappable device. That is handled
		// above, by refusing the pad outright, and the difference matters: here
		// the indices mean what they say and some are absent; there they mean
		// nothing at all.
		const value = button ? button.value : 0;
		// Two different questions, and they were one until review separated them —
		// twice, in opposite directions.
		//
		// A **digital** button is down when the pad says it is down, and only
		// then. `pressed` is the answer to trust: some drivers report a held face
		// button with `value: 0`, so a threshold alone would drop the press — and
		// or-ing a threshold *in* went the other way, letting a lowered
		// `pressThreshold` turn a face button's stray 0.3 into a Cross press. A
		// switch has no bite point to configure.
		//
		// An **analog trigger** is down when it is pulled past where the caller
		// said. Here the pad's own `pressed` bit is the one to ignore: it fires at
		// the browser's fixed ~0.5, so or-ing it in made `pressThreshold`
		// unenforceable in the one direction it exists for — asking for 0.9 still
		// got a press at 0.6. Seelite's throttle is why the option is there, and
		// an option that can only loosen is not an option.
		const down = button
			? ANALOG_BUTTONS.has(name)
				? value > 0 && value >= threshold
				: button.pressed
			: false;
		if (value !== 0) {
			values ??= zeroValues();
			values[name] = value;
		}
		// Filled through `ImmutableSet.fill`, which is `Set.prototype.add` reached
		// past the override. Building a mutable set and copying it into an
		// immutable one was two sets per frame for every frame a button is held;
		// this is one, and it is write-proof from the moment it exists.
		if (down) {
			ImmutableSet.fill((held ??= new ImmutableSet()), name);
			if (!previousHeld.has(name)) {
				ImmutableSet.fill((pressed ??= new ImmutableSet()), name);
			}
		} else if (previousHeld.has(name)) {
			ImmutableSet.fill((released ??= new ImmutableSet()), name);
		}
	}

	// Frozen, and the sets write-proof, because **`held` outlives this frame**:
	// `GamepadSource` keeps it as next frame's history, so a consumer that added
	// a name to it would be editing the past. Review found the header claiming
	// immutability that only the no-pad frame had.
	//
	// The cost is two `Object.freeze` calls and a class swap on sets that were
	// being allocated anyway. It is not a copy — nothing here is duplicated —
	// which is why this is affordable per frame and a reusable frame is not
	// (see `GamepadSource.poll`).
	return Object.freeze({
		connected: true,
		id: raw.id ?? "",
		axes: Object.freeze({ leftX, leftY, rightX, rightY }),
		values: values ? Object.freeze(values) : ZERO_VALUES,
		held: held ?? EMPTY,
		pressed: pressed ?? EMPTY,
		released: released ?? EMPTY,
	});
}

/**
 * The impure half: one object per game, `poll()` once per frame.
 *
 * It owns exactly one piece of state — the previous frame's `held` set — and
 * that is what makes `readPad` above pure rather than this class being a
 * formality.
 */
export class GamepadSource {
	private previousHeld: ReadonlySet<PadButtonName> = EMPTY;
	/** Said once, not per frame: `getGamepads` threw and the pad reads as absent. */
	private warnedAboutThrow = false;
	/** Slot and id of the pad the previous frame was read from; `-1`/`null` for none. */
	private previousSlot = -1;
	private previousId: string | null = null;

	constructor(private readonly options: PadOptions = {}) {}

	/**
	 * Read the pad. Call once per frame; calling twice in one frame makes the
	 * second call's `pressed` set empty, which is the correct behaviour for a
	 * frame in which nothing new went down but is rarely what the second caller
	 * meant.
	 *
	 * `pads` is for tests and probes: given a list, no browser API is touched at
	 * all. Given nothing, it reads `navigator.getGamepads()` — which is the only
	 * place in this module that does, per rule 2 in the header.
	 */
	poll(pads?: readonly (RawPad | null)[]): PadFrame {
		const list = pads ?? this.readNavigator();
		// "The first pad that is there" has to mean the first *usable* one.
		//
		// `find(p => p != null)` took the first occupied slot and handed it to a
		// `readPad` that then refused it for not being in the standard mapping —
		// so an exotic device in slot 0 made a real controller in slot 1 invisible
		// and the game silently reported no pad. Review found it; nothing in the
		// unit tests could, because they all pass one pad.
		//
		// An explicit `index` still means that slot and no other, refusal
		// included: a caller who names a slot has said which device they mean.
		let slot = this.options.index ?? -1;
		if (this.options.index === undefined) {
			// A plain loop rather than `findIndex`: this runs on every rendered
			// frame of every game, pad or no pad, and a closure per frame for a
			// list that is nearly always length 0 or 1 is the sort of thing that
			// only shows up in a profile.
			for (let i = 0; i < list.length; i++) {
				const p = list[i];
				if (p != null && p.mapping === "standard") {
					slot = i;
					break;
				}
			}
		}
		const raw = (slot >= 0 ? list[slot] : null) ?? null;

		// A pad this source has not seen before has no history with it, and a set
		// of button names with no device attached is not history.
		//
		// **A device we have not seen is not evidence that anything was just
		// pressed.** One rule, three situations it covers:
		//
		//   - *Swapping controllers.* `previousHeld` carried the old pad's
		//     buttons into the new pad's frame, so a second pad already holding
		//     Cross produced a press nobody caused — and Cross casts. Review
		//     found this one.
		//   - *Waking a controller.* The browser hides a pad until a button on it
		//     is pressed, so the first visible frame nearly always has one down.
		//     Reading that as a press means the keystroke that woke the pad also
		//     acts.
		//   - *A game that replaced itself.* Seekolous's `reboot` disposes the
		//     Game and constructs another, whose source starts empty. Cross on
		//     the title screen therefore started a run whose first frame started
		//     it again, counting two attempts against one.
		//
		// Identity is the slot plus the pad's own id, and **it is not a real
		// identity** — the API offers nothing better. `id` is a model string, not
		// a serial: two DualSense pads report the same one. So a hot-swap of two
		// identical controllers into the same slot, with no frame in between where
		// the browser reported the slot empty, still inherits the old history and
		// can fabricate a press. Review named that; it is a real hole and it is
		// left open because closing it would need a device identity the platform
		// does not expose. Every other swap — a different model, a different slot,
		// or any gap at all — is caught.
		//
		// On a first sighting the frame is read twice: once to learn what the pad
		// is holding, then again with that as its own baseline, so it reports no
		// presses. One extra pass on the one frame a controller appears.
		// Compared field by field rather than through a joined string: this runs
		// every rendered frame a pad is connected, and a fresh string per frame
		// to say "the same pad as last time" is steady garbage for no reason.
		const id = raw ? (raw.id ?? "") : null;
		let frame = readPad(raw, this.previousHeld, this.options);
		if (
			raw !== null &&
			(slot !== this.previousSlot || id !== this.previousId)
		) {
			// The new pad's presses are suppressed; the old pad's **releases are
			// not**. Dropping them was the first version of this and it left the
			// worst case of all: swap controllers while Cross is held and the game
			// never sees the release, so the sculpt stroke runs on with nothing
			// holding it. The first read carries what the departing pad let go of,
			// and the second establishes the arriving one's baseline.
			const settled = readPad(raw, frame.held, this.options);
			// Frozen like every other frame: `readPad` hands out frozen objects,
			// and a spread of one is not.
			frame = Object.freeze({ ...settled, released: frame.released });
		}
		this.previousSlot = raw ? slot : -1;
		this.previousId = id;
		this.previousHeld = frame.held;
		return frame;
	}

	/**
	 * Empty on anything unexpected — and **loud once** when that was a throw.
	 *
	 * A missing `navigator` and a browser without the API are ordinary: nothing
	 * is wrong, there is simply no pad, and the game carries on with the
	 * keyboard. A `getGamepads` that *throws* is not ordinary, and returning an
	 * empty list for it makes a fault indistinguishable from an absence — review
	 * pointed out that a real bug would arrive as "no controller is plugged in",
	 * which is the worst way to be told.
	 *
	 * So the frame is still empty, because a game must not die in its input
	 * layer for this. But it says so, once, and the once matters: this runs on
	 * every frame, and a per-frame `console.warn` would be its own denial of
	 * service.
	 */
	private readNavigator(): readonly (RawPad | null)[] {
		if (typeof navigator === "undefined") return [];
		const nav = navigator as unknown as {
			getGamepads?: () => (RawPad | null)[];
		};
		if (typeof nav.getGamepads !== "function") return [];
		try {
			return nav.getGamepads() ?? [];
		} catch (err) {
			if (!this.warnedAboutThrow) {
				this.warnedAboutThrow = true;
				console.warn(
					"gamepad: navigator.getGamepads() threw; treating the pad as absent.",
					err,
				);
			}
			return [];
		}
	}
}

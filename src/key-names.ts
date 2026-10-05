/**
 * How a key is spelled: every printed control name, from a binding's trigger.
 *
 * Split out of `controls-reference.ts` as #499 ruled (built in #501), and
 * #369 D11 reads through it: the registry (`commands.ts`) owns the bindings,
 * this module and no other spells a key, and every surface that names a
 * control — the `Controls` tab, the capture modal, the prompt line, the
 * footers, the pad hint, the combat rig — is a format over both.
 *
 * **Types only from the registry**, and `tests/headless.test.ts` holds it.
 * `commands.ts` value-imports the Commander overlay for its default key, and
 * the overlay imports `OwnKey` from here — a type today. Holding this half
 * type-only is what leaves the overlay free to take a *value* from here as
 * well without closing a runtime loop through the registry (#499 D4). Nothing
 * here re-exports, and no module in `src/` re-exports this with
 * `export … from "./key-names"` — one module, one import path. That second
 * half is checked in that form only: an `import` followed by a bare
 * `export { … }` of the same name would pass the scan.
 */
import type { CommandId, Layout, Surface, Trigger } from "./commands";

const KEY_WORDS: Readonly<Record<string, string>> = {
	" ": "Space",
	enter: "Enter",
	shift: "Shift",
	control: "Ctrl",
	f1: "F1",
	arrowup: "↑",
	arrowdown: "↓",
	arrowleft: "←",
	arrowright: "→",
};

const PAD_WORDS: Readonly<Record<string, string>> = {
	up: "d-pad ↑",
	down: "d-pad ↓",
	left: "d-pad ←",
	right: "d-pad →",
	start: "Start",
	select: "Select",
	home: "Home",
};

/** A pad button in the player's words. The tab's context note spells one too. */
export const padButton = (button: string): string =>
	PAD_WORDS[button] ?? button.toUpperCase();

/**
 * The player's word for a surface that claims a trigger.
 *
 * The registry holds a closed identifier because it compares two of them to
 * decide whether a collision is one; the prose lives here, because a key
 * printed with the surface that claims it is still a key being spelled.
 * `CONTEXT_WORDS` does the same for a pad context and stayed with the tab
 * (#499): only its context note prints one.
 */
const SURFACE_WORDS: Readonly<Record<Surface, string>> = {
	requests: "Requests",
	"station-console": "a station console",
};

/** The four ways a signed input is pushed, as a table rather than a tree. */
const WAY = {
	"x+": "right",
	"x-": "left",
	"y+": "down",
	"y-": "up",
} as const;

/**
 * Which way a signed input is pushed, in the player's words.
 *
 * #369 D2 splits a pair into two commands, so the stick and the mouse axis
 * appear on two rows each — and a row that printed only the axis would print
 * the same string on both, which reads as the reference not knowing.
 */
const way = (axis: "x" | "y", half: "+" | "-") => WAY[`${axis}${half}`];

/**
 * D7 and D8: a key prints as its character, a chord spelled out, and a control
 * with no character gets words.
 *
 * **A held key says `hold`, and did not until #381 S4.** The pad's branch
 * below has said it since #372 — `hold Y` — so the inconsistency was inside
 * this one function: `x` printed identically for `fly.assist`, which is a
 * press, and `fight.fireBeam`, which is the same key held. That is #369 D3's
 * split on `x`, which the tab could not show. It was found by looking at the
 * capture modal, where a player about to move `fly.pitchUp` onto a new key
 * needed to know the new key is one they hold — and the fix belongs here
 * rather than in the modal, because this is the one module that spells a key
 * (#369 D11, as #499 D2 reads it) and a second phrasing over there is the
 * drift that ruling refuses. It changes what the `Controls` tab prints on every
 * held row, which is the point.
 */
export function triggerLabel(t: Trigger): string {
	switch (t.kind) {
		case "key": {
			const base = KEY_WORDS[t.key] ?? t.key;
			const chord = t.alt ? `Alt + ${base}` : base;
			const held = t.hold ? `hold ${chord}` : chord;
			return t.surface ? `${held} (${SURFACE_WORDS[t.surface]})` : held;
		}
		case "mouse-button": {
			const press = t.action === "hold" ? "hold left mouse button" : "click";
			return t.surface ? `${press} ${SURFACE_WORDS[t.surface]}` : press;
		}
		case "mouse-move":
			// Node #691: a movement narrower than its command says where.
			return t.views
				? `move the mouse ${way(t.axis, t.half)} (${t.views.join(" or ")} view)`
				: `move the mouse ${way(t.axis, t.half)}`;
		case "pad-button":
			return t.hold ? `hold ${padButton(t.button)}` : padButton(t.button);
		case "pad-stick":
			return `${t.stick} stick ${way(t.axis, t.half)}`;
		case "pad-trigger":
			return t.trigger.toUpperCase();
		case "pad-intent":
			return padButton(t.button);
		case "unbound":
			return "unbound";
	}
}

/**
 * What reaches `id` in `layout`, printed — the one question every surface
 * that names a control asks (#369 D11).
 *
 * **Over a layout, and never over the shipped table.** The tab has printed the
 * player's layout since the storage slice; every other surface that named a
 * key typed it in, so a rebind moved the tab and left the prompt, the footers
 * and the pad hint naming a key that no longer did anything. Each of them asks
 * this now, and `triggerLabel` is still the only thing that spells a key.
 *
 * `keep` narrows it to the triggers a surface can name — a keyboard footer
 * has no use for a pad button, and the pad hint only for what a console
 * reads. Repeats are dropped, in the layout's order.
 *
 * **An unbound placeholder is not a name** (#620): a vent slot's command ships
 * one so it can be bound, and a surface that printed it would offer
 * `unbound` as a key to press. Spelled out rather than through
 * `isPlaceholder`, because this module imports nothing but types from the
 * registry (#499 D3's reason, in `OwnKey`'s doc).
 */
export function boundNames(
	layout: Layout,
	id: CommandId,
	keep: (t: Trigger) => boolean = () => true,
): string[] {
	const names = layout
		.filter(
			(b) =>
				b.command === id && b.trigger.kind !== "unbound" && keep(b.trigger),
		)
		.map((b) => triggerLabel(b.trigger));
	return [...new Set(names)];
}

/**
 * Several names for one command, as a player reads them: `j or k`.
 *
 * A `hold` every name shares is said once — `hold x or left mouse button` —
 * because the qualifier is the command's (`movedTrigger`'s table) and a list
 * that repeated it reads as a list of different gestures. Only when every
 * name carries it: a press beside a hold keeps both words, since they are.
 */
export function anyOf(names: readonly string[]): string {
	const HOLD = "hold ";
	return names.length > 1 && names.every((n) => n.startsWith(HOLD))
		? `${HOLD}${names.map((n) => n.slice(HOLD.length)).join(" or ")}`
		: names.join(" or ");
}

/**
 * Two commands that are a pair, as one segment: `d-pad ↑/↓`, `L1/R1`.
 *
 * A shared first word is said once, so a pair reads as one control pushed two
 * ways rather than two controls. Everything before it is `triggerLabel`'s.
 */
function pairOf(a: readonly string[], b: readonly string[]): string {
	const [first, second] = [anyOf(a), anyOf(b)];
	const space = first.lastIndexOf(" ");
	const shared = space === -1 ? "" : first.slice(0, space + 1);
	return shared && second.startsWith(shared)
		? `${first}/${second.slice(shared.length)}`
		: `${first}/${second}`;
}

/** A key trigger: what a keyboard footer can name. */
export const onKeyboard = (t: Trigger): boolean => t.kind === "key";

/**
 * A screen's own command, as the layout in force has it (#381 S5).
 *
 * The settings screen and the Commander overlay each open on a command and
 * close on the same key, and each prints that key in its footer. Both halves
 * read the layout through this rather than a constant: a footer derived from
 * the layout beside a close arm comparing `SETTINGS_KEY` would name a key that
 * does not close the screen, which is the lie the derivation exists to end.
 *
 * `main.ts` supplies it, because it holds the layout and the resolver the open
 * goes through — so the key that opens a screen and the key that closes it are
 * one answer. A type, so neither panel imports the resolver. It sits beside
 * the `names` it carries (#499 D3): it lived in the tab's module only to keep
 * the Commander overlay — which `commands.ts` value-imports for its default
 * key — off a module that value-imports the registry, and this one does not.
 */
export interface OwnKey {
	/** Its keyboard triggers, printed. Empty when every one moved to the pad. */
	readonly names: () => readonly string[];
	/** Whether this keydown reaches the command in the layout in force. */
	readonly reaches: (e: KeyboardEvent) => boolean;
}

/** A pad press a console reads: its grammar, or a button that falls through. */
const readInConsole = (t: Trigger): boolean =>
	(t.kind === "pad-intent" || t.kind === "pad-button") &&
	t.contexts.includes("console");

/**
 * The line a console shows a pad player, built from what that surface has.
 *
 * **Derived since #381 S5, and here since #501.** It lived in
 * `pad-bindings.ts`, "beside the bindings it names" — it had been written into
 * `live-cockpit.ts` first, as a third copy of a table that module and
 * `docs/gamepad.md` already owned, so a rebind moved two of the three. S4
 * moved the bindings to the registry and the reason went with them; and it
 * could not ask the registry from there, because `commands.ts` already reads
 * `pad-bindings.ts` to derive the pad's rows. So each segment's button is the
 * layout's answer and the verb is the only word authored here.
 *
 * **Assembled rather than picked from near-copies.** It began as one constant,
 * gained a station variant that was the first minus one segment, and would
 * have gained a third and fourth for the empty walk — three of them left dead
 * the moment the function replaced them, which sage then found. A surface with
 * nothing focusable must not promise a walk, and the station console must not
 * promise a back: it is reached with the head already forward, so `back`
 * would turn a forward head forward. It still gets a marker either way,
 * because the *marker* answers a different question from the *hint*.
 *
 * **"CONTROLLER", not "PAD".** On a *station* console the shorter word meets
 * `CONTEXT.md`'s berth sense, which is the one surface in this game where that
 * reading is live. The buttons are named by standard-mapping position rather
 * than drawn as DualSense glyphs, because an Xbox pad reads `a`/`b` literally.
 *
 * A segment whose command reaches no console button is left out rather than
 * printed with a blank where the button goes. No shipped or player layout can
 * produce that — a panel intent is not offered for rebinding — so it is the
 * derivation refusing to print a blank, not a case anyone meets.
 */
export function padHintFor(
	layout: Layout,
	surface: { station: boolean; walkable: boolean },
): string {
	const on = (id: CommandId) => boundNames(layout, id, readInConsole);
	const segment = (names: readonly string[], verb: string) =>
		names.length > 0 ? [`${anyOf(names)} ${verb}`] : [];
	const pair = (a: CommandId, b: CommandId, verb: string) =>
		on(a).length > 0 && on(b).length > 0
			? [`${pairOf(on(a), on(b))} ${verb}`]
			: [];
	return [
		"CONTROLLER",
		...(surface.walkable
			? [
					...pair("panel.cursorUp", "panel.cursorDown", "WALK"),
					...segment(on("panel.activate"), "SELECT"),
				]
			: []),
		...(surface.station ? [] : segment(on("panel.back"), "BACK")),
		...pair("panel.tabPrevious", "panel.tabNext", "TAB"),
	].join(" · ");
}

/**
 * A command as a prompt names it: its keyboard triggers, or — when a player
 * moved every one of them to the pad — wherever they went.
 *
 * The keyboard first because the prompt line has always spoken to it, and a
 * line naming `Y` beside `j` for a keyboard player is noise on every frame.
 * The fallback is not decoration: `rebind` moves a trigger and never removes
 * one, so a command with no key left still has a button, and a prompt that
 * printed nothing would read `press  to cruise`.
 */
export function spoken(layout: Layout, id: CommandId): string {
	return anyOf(keyboardFirst(layout, id));
}

/** `spoken`'s names before they are joined, for a line that pairs two. */
function keyboardFirst(layout: Layout, id: CommandId): string[] {
	const keys = boundNames(layout, id, onKeyboard);
	return keys.length > 0 ? keys : boundNames(layout, id);
}

/**
 * The prompt line's three sentences that name a control (#381 S5).
 *
 * `main.ts`'s `cruisePrompt` picks which one shows; these say it. They were
 * authored there — `press \` to jump`, `T selects a target`, `press J to
 * cruise` — and in capitals the tab never printed, which is #370 D7's
 * "every other key prints as the character you type" and the principal's
 * ruling that the glass follows it rather than the tab following the glass.
 */
export const jumpPrompt = (layout: Layout, hop: string): string =>
	`press ${spoken(layout, "fly.jump")} to jump to ${hop}`;
export const targetPrompt = (layout: Layout): string =>
	`${spoken(layout, "fight.targetNext")} selects a target`;
export const cruisePrompt = (layout: Layout): string =>
	`press ${spoken(layout, "fly.cruise")} to cruise`;

/**
 * A cruise dial's two keys, for the legacy HUD's dial line: `(-/=)`.
 *
 * In parentheses rather than the brackets the line used, because two of the
 * dials *are* the bracket keys and `[[/]]` reads as punctuation rather than
 * as two keys. The keyboard first, and the prompt line's fallback after it:
 * a dial is a press, which a player may move to a pad button, and a side
 * with no key printed `(-/)` for a round (sage round 1 on #498).
 *
 * **Named by the dial, not by its two commands**, and the stem is read off
 * `CommandId`: six call sites each typing both ids was six chances to pair the
 * wrong two, and a stem the registry has no `Down` row for does not compile.
 */
export const dialKeys = (layout: Layout, dial: DialStem): string =>
	`(${pairOf(keyboardFirst(layout, `tune.${dial}Down`), keyboardFirst(layout, `tune.${dial}Up`))})`;

/** The cruise dials, as the registry names their pairs: `vMax`, `exponent`, … */
export type DialStem = CommandId extends infer C
	? C extends `tune.${infer S}Down`
		? S
		: never
	: never;

/** A pad trigger: a button, a stick or a trigger on the controller. */
const onPad = (t: Trigger): boolean => t.kind.startsWith("pad");

/**
 * The four flight controls — throttle, pitch, yaw, roll — as two lines, one
 * for the keyboard and one for the controller (#408, the principal's playtest:
 * a first flight should say how to fly and steer).
 *
 * From the layout in force, like every other surface that names a control:
 * the first keyboard key of each direction, and every pad trigger. A hold is
 * the controls' nature and not news, so the keyboard line drops the word. A
 * control with nothing bound on one side is left out of that line rather than
 * printed with a blank.
 */
export function flightControls(layout: Layout): {
	keyboard: string;
	controller: string;
} {
	const PAIRS: readonly [string, CommandId, CommandId][] = [
		["THROTTLE", "fly.throttleUp", "fly.throttleDown"],
		["PITCH", "fly.pitchDown", "fly.pitchUp"],
		["YAW", "fly.yawPort", "fly.yawStarboard"],
		["ROLL", "fly.rollPort", "fly.rollStarboard"],
	];
	const firstKey = (id: CommandId) =>
		boundNames(layout, id, onKeyboard)
			.slice(0, 1)
			.map((name) => name.replace(/^hold /, ""));
	const line = (names: (id: CommandId) => string[]) =>
		PAIRS.flatMap(([label, a, b]) => {
			const [one, two] = [names(a), names(b)];
			return one.length > 0 && two.length > 0
				? [`${label} ${pairOf(one, two)}`]
				: [];
		}).join(" · ");
	return {
		keyboard: line(firstKey),
		controller: line((id) => boundNames(layout, id, onPad)),
	};
}

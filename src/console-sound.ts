/**
 * The consoles, by ear (#546): which cue a console press, a cursor move and an
 * arriving message owe, and how often a message may sound.
 *
 * **Before this node the consoles were silent.** `AudioFX.ui()` — the 520 Hz
 * square tick #546's text names as every button's sound — had no caller, so
 * every button, tab and market row made no sound. The only console sounds were
 * `alert`, played for a carrier's hail and a refused scoop, which is the ship's
 * *something is wrong* voice speaking for a message.
 *
 * A pure step that imports only the cue vocabulary, like `flight-sound.ts`
 * (#542 D3). The seam is where the **outcome** is known — the `Game` side of a
 * console callback — and not at the DOM click: a refusal exists only after the
 * handler has run, so a click cued at the DOM would sound "done" first.
 *
 * ## The arms, from `?consolesound=`
 *
 * Comma-separated tokens, unique across arms. The first of each is the default;
 * a default is needed to play at all and is not a ruling.
 *
 * - **notes** — `pernote`: a message sounds by its tone (news, done, wrong).
 *   `onenote`: every message has one sound.
 * - **refusal** — `refuse`: a refused press has a low buzz of its own.
 *   `norefuse`: it clicks like an accepted one, and the glass says why.
 * - **hover** — `nohover` or `hover`: whether the pointer landing on a row
 *   ticks.
 * - **focus** — `focus` or `nofocus`: whether a pad or keyboard cursor move
 *   ticks.
 * - **press** — `soft`: a short high click. `square`: the 520 Hz square tick
 *   the engine already had.
 * - **rate** — `gap`: a second message of one tone inside `NOTIFY_GAP_S` is
 *   silent. `every`: each message sounds.
 *
 * `?consolesound=legacy` is the build before #546, so the two can be played
 * one after the other.
 */
import type { Cue, NotifyTone } from "./audio-cue";
import type { Clearance } from "./docking";

export const CONSOLE_SOUND_ARMS = {
	notes: ["pernote", "onenote"],
	refusal: ["refuse", "norefuse"],
	hover: ["nohover", "hover"],
	focus: ["focus", "nofocus"],
	press: ["soft", "square"],
	rate: ["gap", "every"],
} as const satisfies Record<string, readonly string[]>;

export type ConsoleSoundArms = {
	-readonly [K in keyof typeof CONSOLE_SOUND_ARMS]: (typeof CONSOLE_SOUND_ARMS)[K][number];
};

/** The first of each arm. */
export const DEFAULT_CONSOLE_ARMS: ConsoleSoundArms = {
	notes: "pernote",
	refusal: "refuse",
	hover: "nohover",
	focus: "focus",
	press: "soft",
	rate: "gap",
};

export type ConsoleArms = ConsoleSoundArms | "legacy";

/**
 * The arms a `?consolesound=` value names, or `legacy`. Unknown tokens are
 * handed back so the caller can say so rather than play a silent default.
 */
export function consoleSoundArms(value: string | null): {
	arms: ConsoleArms;
	unknown: string[];
} {
	const tokens = (value ?? "")
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	if (tokens.includes("legacy")) return { arms: "legacy", unknown: [] };
	const arms: ConsoleSoundArms = { ...DEFAULT_CONSOLE_ARMS };
	const unknown: string[] = [];
	for (const token of tokens) {
		const arm = (
			Object.keys(CONSOLE_SOUND_ARMS) as (keyof ConsoleSoundArms)[]
		).find((k) => (CONSOLE_SOUND_ARMS[k] as readonly string[]).includes(token));
		if (arm) (arms as Record<string, string>)[arm] = token;
		else unknown.push(token);
	}
	return { arms, unknown };
}

/** A console press whose outcome is known: accepted, or refused. */
export function pressCue(arms: ConsoleArms, accepted: boolean): Cue | null {
	if (arms === "legacy") return null;
	if (!accepted && arms.refusal === "refuse") return { kind: "refuse" };
	return arms.press === "square" ? { kind: "ui" } : { kind: "press" };
}

/** The cursor landed on another row: a pad or key move, or the pointer. */
export function focusCue(
	arms: ConsoleArms,
	source: "pad" | "hover",
): Cue | null {
	if (arms === "legacy") return null;
	const on =
		source === "hover" ? arms.hover === "hover" : arms.focus === "focus";
	return on ? { kind: "focus" } : null;
}

/**
 * How long a second message of one tone is silent after one sounded, s, on
 * `gap`. **A placeholder the listen sets**: long enough that a burst — a
 * clearance answer beside a station line — is one sound, short enough that
 * two separate events a breath apart are both heard.
 */
export const NOTIFY_GAP_S = 1.5;

/** When each tone last sounded, s. */
export type NotifyGate = Readonly<Record<NotifyTone, number>>;

export const QUIET_NOTIFY: NotifyGate = {
	message: Number.NEGATIVE_INFINITY,
	good: Number.NEGATIVE_INFINITY,
	bad: Number.NEGATIVE_INFINITY,
};

/**
 * The cue a message owes at `now`, s, and the gate after it.
 *
 * `source` matters only on `legacy`, which reproduces the build before #546:
 * a hail played `alert`, and no other message played anything.
 */
export function notifyCue(
	gate: NotifyGate,
	arms: ConsoleArms,
	tone: NotifyTone,
	now: number,
	source?: "hail",
): { gate: NotifyGate; cue: Cue | null } {
	if (arms === "legacy")
		return { gate, cue: source === "hail" ? { kind: "alert" } : null };
	// On `onenote` there is one sound, so there is one gap.
	const heard: NotifyTone = arms.notes === "onenote" ? "message" : tone;
	if (arms.rate === "gap" && now - gate[heard] < NOTIFY_GAP_S)
		return { gate, cue: null };
	return {
		gate: { ...gate, [heard]: now },
		cue: { kind: "notify", tone: heard },
	};
}

/**
 * What a clearance answer means to the ear, or `null` when it is not news.
 *
 * The docking computer asks again and again, so the sound follows a **change**
 * of answer: a grant after none or a queue, a queue after none, a denial or a
 * denial for another reason. A grant renewed, a queue moving up, and a
 * clearance spent or lapsed to `none` are not.
 */
export function clearanceTone(
	prev: Clearance,
	next: Clearance,
): NotifyTone | null {
	if (next.kind === "denied" && prev.kind === "denied")
		return next.reason !== prev.reason ? "bad" : null;
	if (next.kind === "none" || next.kind === prev.kind) return null;
	if (next.kind === "granted") return "good";
	if (next.kind === "queued") return "message";
	return "bad";
}

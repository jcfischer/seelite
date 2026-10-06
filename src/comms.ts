/**
 * What the game says aloud (#600). **Approach control** is a station's radio
 * voice in flight (CONTEXT.md); it is not **Station control**, the first
 * day's voice on the docked console, whose place first-useful-day D3 owns.
 *
 * Also: the lines, which event says which, the
 * music's numbers, and the `?voices=` arm. Text only, so the director and the
 * tests read it with no synthesiser behind it; `comms-voice.ts` renders a
 * line, and `AudioFX.speak` plays it.
 *
 * The lines voice what the console already says, and no more: a clearance
 * answer on a **change** of answer, as `clearanceTone` sounds it (#546); a
 * struck carrier's hail (`hailText`, which the rail prints with its
 * callsign); and approach control's welcome as the arrival begins. Every word
 * is the lexicon's (`speech-lexicon.ts`), and `tests/comms.test.ts` holds each
 * line to it, because a word the lexicon lacks is skipped, not said.
 */
import { clearanceTone } from "./console-sound";
import type { Clearance } from "./docking";
import { mix, seededRand } from "./rng";

/** Who is speaking: a voice of `speech.ts`'s `VOICES`. */
export type CommsVoice = "approach" | "pilot" | "pirate" | "machine";

export interface CommsLine {
	readonly text: string;
	readonly voice: CommsVoice;
}

export const COMMS_LINES = {
	granted: {
		text: "Clearance granted. Proceed to your berth.",
		voice: "approach",
	},
	queued: { text: "Docking request queued. Hold position.", voice: "approach" },
	deniedHostile: {
		text: "Docking request denied. You are hostile.",
		voice: "approach",
	},
	deniedContraband: {
		text: "Docking request denied. Contraband on board.",
		voice: "approach",
	},
	deniedNoBerth: {
		text: "Docking request denied. No berth for your ship.",
		voice: "approach",
	},
	// A station whose berths admit nobody (node #491's raider outpost, until it
	// trades): not hostility, and not this hull's size.
	deniedClosed: {
		text: "Docking request denied. No berth is free to you.",
		voice: "approach",
	},
	ceaseFire: { text: "Cease fire! Cease fire!", voice: "pilot" },
	welcome: { text: "Welcome aboard, commander.", voice: "approach" },
	// #660 D12 (node #704): the ship's own warning, once per crossing. The
	// key is part of the line, so there is one line per default binding and
	// one that names none, for a control rebound to a key the lexicon cannot
	// say — the glass names that one (`ejectWarningLine`).
	ejectWarningBackspace: {
		text: "Warning. Hull failing. Hold backspace to eject.",
		voice: "machine",
	},
	ejectWarningHome: {
		text: "Warning. Hull failing. Hold home to eject.",
		voice: "machine",
	},
	ejectWarning: {
		text: "Warning. Hull failing. Eject.",
		voice: "machine",
	},
} as const satisfies Record<string, CommsLine>;

export type CommsLineId = keyof typeof COMMS_LINES;

/** Approach control's answer, on a change of answer only — read from
 *  `clearanceTone` (#546), so the voice and the console tone cannot disagree
 *  about what is news — or `null` when it is not. */
export function clearanceLine(
	prev: Clearance,
	next: Clearance,
): CommsLineId | null {
	if (clearanceTone(prev, next) === null) return null;
	if (next.kind === "denied") {
		if (next.reason === "hostile") return "deniedHostile";
		if (next.reason === "contraband") return "deniedContraband";
		if (next.reason === "closed") return "deniedClosed";
		return "deniedNoBerth";
	}
	return next.kind === "granted" ? "granted" : "queued";
}

/** A stream of its own for the music's numbers. */
const NUMBERS_STREAM = 0x6e756d73;

/**
 * The `n`th numbers-station phrase of a system: three groups of four digits,
 * read one by one. The system's own, so a system's calm always carries the
 * same transmissions in the same order.
 */
export function numbersPhrase(systemSeed: number, n: number): string {
	const rand = seededRand(mix(mix(systemSeed >>> 0, NUMBERS_STREAM), n + 1));
	const group = () =>
		Array.from({ length: 4 }, () => Math.floor(rand() * 10) % 10).join(" ");
	return `${group()}. ${group()}. ${group()}.`;
}

/**
 * Which voices speak: `?voices=off`, `nocomms` or `nomusic`; and which
 * engine, over the player's setting (#604): `neural` or `formant`, for
 * probes and listening; `ask` puts the Commander screen's question even on
 * a direct boot.
 *
 * **`neural` is honoured only on a dev server** (`dev`). On the site it
 * would let a shared link start a 110–190 MB download the player never
 * agreed to, which is the one thing the Trust page says is the player's
 * choice (sage round 1 on #606). `formant` stays: it downloads nothing.
 */
export interface VoiceArms {
	readonly comms: boolean;
	readonly music: boolean;
	readonly engine: "setting" | "neural" | "formant";
	readonly ask: boolean;
}

export function voiceArms(value: string | null, dev: boolean): VoiceArms {
	const tokens = (value ?? "").split(",").map((t) => t.trim());
	const engine = tokens.includes("formant")
		? "formant"
		: dev && tokens.includes("neural")
			? "neural"
			: "setting";
	const ask = tokens.includes("ask");
	if (tokens.includes("off"))
		return { comms: false, music: false, engine, ask };
	return {
		comms: !tokens.includes("nocomms"),
		music: !tokens.includes("nomusic"),
		engine,
		ask,
	};
}

/**
 * The eject warning's voice line (#660 D12, node #704), from the control as
 * the glass names it (`spoken(layout, "fly.eject")`), so the voice and the
 * sentence name the same key. A line is static text the lexicon can say, so a
 * key the lexicon has no word for gets the line that names none.
 */
export function ejectWarningLine(control: string): CommsLineId {
	if (control === "hold Backspace") return "ejectWarningBackspace";
	if (control === "hold Home") return "ejectWarningHome";
	return "ejectWarning";
}

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
	ceaseFire: { text: "Cease fire! Cease fire!", voice: "pilot" },
	welcome: { text: "Welcome aboard, commander.", voice: "approach" },
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

/** Which voices speak: `?voices=off`, `nocomms` or `nomusic`. */
export interface VoiceArms {
	readonly comms: boolean;
	readonly music: boolean;
}

export function voiceArms(value: string | null): VoiceArms {
	const tokens = (value ?? "").split(",").map((t) => t.trim());
	if (tokens.includes("off")) return { comms: false, music: false };
	return {
		comms: !tokens.includes("nocomms"),
		music: !tokens.includes("nomusic"),
	};
}

/**
 * What the game says aloud (#600): the lines, which event says which, the
 * music's numbers, and the `?voices=` arm. Text only, so the director and the
 * tests read it with no synthesiser behind it; `comms-voice.ts` renders a
 * line, and `AudioFX.speak` plays it.
 *
 * The lines voice what the console already says, and no more: a clearance
 * answer on a **change** of answer, as `clearanceTone` sounds it (#546); a
 * struck carrier's hail (`hailText`, which the rail prints with its
 * callsign); and station control's welcome as the arrival begins. Every word
 * is the lexicon's (`speech-lexicon.ts`), and `tests/comms.test.ts` holds each
 * line to it, because a word the lexicon lacks is skipped, not said.
 */
import type { Clearance } from "./docking";
import { mix, seededRand } from "./rng";

/** Who is speaking: a voice of `speech.ts`'s `VOICES`. */
export type CommsVoice = "control" | "pilot" | "pirate" | "machine";

export interface CommsLine {
	readonly text: string;
	readonly voice: CommsVoice;
}

export const COMMS_LINES = {
	granted: {
		text: "Clearance granted. Proceed to your berth.",
		voice: "control",
	},
	queued: { text: "Docking request queued. Hold position.", voice: "control" },
	deniedHostile: {
		text: "Docking request denied. You are hostile.",
		voice: "control",
	},
	deniedContraband: {
		text: "Docking request denied. Contraband on board.",
		voice: "control",
	},
	deniedNoBerth: {
		text: "Docking request denied. No berth for your ship.",
		voice: "control",
	},
	ceaseFire: { text: "Cease fire! Cease fire!", voice: "pilot" },
	welcome: { text: "Welcome aboard, commander.", voice: "control" },
} as const satisfies Record<string, CommsLine>;

export type CommsLineId = keyof typeof COMMS_LINES;

/** Station control's answer, on a change of answer only — the same changes
 *  `clearanceTone` sounds — or `null` when it is not news. */
export function clearanceLine(
	prev: Clearance,
	next: Clearance,
): CommsLineId | null {
	if (next.kind === "denied") {
		if (prev.kind === "denied" && prev.reason === next.reason) return null;
		if (next.reason === "hostile") return "deniedHostile";
		if (next.reason === "contraband") return "deniedContraband";
		return "deniedNoBerth";
	}
	if (next.kind === "none" || next.kind === prev.kind) return null;
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

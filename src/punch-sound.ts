/**
 * Weight in the effects, by ear (#577): the arm the principal listens to.
 *
 * The one-shots were feeble beside the trailer's score: an explosion was one
 * noise burst over one sine and peaked at 0.19 of full scale. `heavy` gives
 * every impact a body — a punch, a sub with a floor, saturation on the low
 * layers, a snap on the transient and a wash of noise closing down — and `thin` is the
 * sound before this node, kept so the two can be flown one after the other.
 * What each voice sounds like is `AudioFX`'s.
 *
 * **Pure, and it imports only a type from the cue vocabulary**, for
 * `weapon-sound.ts`'s reason: the arm is parsed where the URL is read and
 * handed to the engine, and neither side reads the other.
 */
import type { PunchVoice } from "./audio-cue";

export const PUNCH_ARMS = [
	"heavy",
	"thin",
] as const satisfies readonly PunchVoice[];

/** The first of the arm: what plays until the principal rules otherwise. */
export const DEFAULT_PUNCH: PunchVoice = PUNCH_ARMS[0];

/**
 * The arm a `?punch=` value names. An unknown token is handed back so the
 * caller can say so rather than fly a silent default.
 */
export function punchArm(value: string | null): {
	arm: PunchVoice;
	unknown: string[];
} {
	const tokens = (value ?? "")
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
	let arm = DEFAULT_PUNCH;
	const unknown: string[] = [];
	for (const token of tokens) {
		const known = PUNCH_ARMS.find((a) => a === token);
		if (known) arm = known;
		else unknown.push(token);
	}
	return { arm, unknown };
}

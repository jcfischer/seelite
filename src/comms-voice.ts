/**
 * A line of `comms.ts`, said and put through the radio (#600): rendered once
 * per line and kept, because the same few lines are said again and again and
 * a render is tens of milliseconds. The music's numbers are rendered each
 * time, since each is new.
 */
import type { SpeechSpace } from "./audio";
import { COMMS_LINES, type CommsLineId } from "./comms";
import { RADIO, radio } from "./radio";
import { SPEECH_RATE, speak, VOICES } from "./speech";
import { textToTokens } from "./speech-lexicon";

export { SPEECH_RATE };

const rendered = new Map<CommsLineId, Float32Array>();

/** A comms line through the radio, squelch and roger beep included. */
export function renderLine(id: CommsLineId): Float32Array {
	const hit = rendered.get(id);
	if (hit) return hit;
	const line = COMMS_LINES[id];
	const out = radio(speak(textToTokens(line.text).tokens, VOICES[line.voice]));
	rendered.set(id, out);
	return out;
}

/** A numbers phrase in the machine's voice, through the radio with no beep:
 *  a transmission overheard, not addressed to the pilot. */
export function renderNumbers(text: string): Float32Array {
	return radio(speak(textToTokens(text).tokens, VOICES.machine), {
		...RADIO,
		beepHz: 0,
	});
}

/** The numbers station's room in the music: quiet, and mostly its own echo.
 *  By ear, and a placeholder until it is heard. */
export const MUSIC_VOICE_SPACE: SpeechSpace = {
	level: 0.22,
	echoS: 0.42,
	feedback: 0.5,
};

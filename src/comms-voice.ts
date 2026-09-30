/**
 * A line of `comms.ts`, said and put through the radio (#600): rendered once
 * per line and kept, because the same few lines are said again and again and
 * a render is tens of milliseconds. The music's numbers are rendered each
 * time, since each is new.
 */
import type { AudioFX, SpeechSpace } from "./audio";
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

/** Run `fn` when the page is idle: never inside a frame. Headless, a timer. */
const whenIdle = (fn: () => void) => {
	const idle = (
		globalThis as {
			requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void;
		}
	).requestIdleCallback;
	if (idle) idle(fn, { timeout: 2000 });
	else setTimeout(fn, 0);
};

/** Numbers phrases rendered ahead of being asked for, by text, and the ones
 *  waiting for an idle moment. A few at most: a system's next phrase. */
const ahead = new Map<string, Float32Array>();
const pending = new Set<string>();
const AHEAD_KEEP = 4;

/**
 * Render `text` when the page is idle, so the phrase the director asks for
 * next is ready (sage round 1 on #600: a render inside the frame step was a
 * ~40 ms stall every phrase). The host knows the next phrase: it is
 * `numbersPhrase(seed, state.voiceN)`.
 */
export function renderNumbersAhead(text: string) {
	if (ahead.has(text) || pending.has(text)) return;
	pending.add(text);
	whenIdle(() => {
		pending.delete(text);
		if (ahead.has(text)) return;
		// The oldest goes first: a system left before its phrase was heard.
		if (ahead.size >= AHEAD_KEEP)
			ahead.delete(ahead.keys().next().value as string);
		ahead.set(text, renderNumbers(text));
	});
}

/** The phrase for `text`: the one rendered ahead, or rendered now. */
export function takeNumbers(text: string): Float32Array {
	const hit = ahead.get(text);
	if (!hit) return renderNumbers(text);
	ahead.delete(text);
	return hit;
}

/** Render every comms line when the page is idle, one per callback, so the
 *  first time a line is said it is not rendered mid-event. */
export function prewarmComms() {
	const ids = Object.keys(COMMS_LINES) as CommsLineId[];
	const next = () => {
		const id = ids.shift();
		if (!id) return;
		renderLine(id);
		whenIdle(next);
	};
	whenIdle(next);
}

/** The numbers station, far off in the music: the game's and the lab's one
 *  way of saying it. */
export function sayNumbers(fx: AudioFX, text: string) {
	fx.speak(takeNumbers(text), SPEECH_RATE, "music", MUSIC_VOICE_SPACE);
}

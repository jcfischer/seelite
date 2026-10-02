/**
 * A line of `comms.ts`, said and put through the radio (#600): rendered once
 * per line and kept, because the same few lines are said again and again and
 * a render is tens of milliseconds. The music's numbers are rendered each
 * time, since each is new.
 *
 * **The neural voice speaks when it is ready (#604)** — Kokoro, in the
 * browser, on the player's consent (`neural-voice.ts`) — and the formant
 * voice in every other state, so there is always a voice. A neural line comes
 * from the browser's line cache when an earlier session said it.
 */
import type { AudioFX, SpeechSpace } from "./audio";
import { COMMS_LINES, type CommsLineId } from "./comms";
import {
	NEURAL_ROLE,
	type NeuralVoice,
	type NeuralVoiceId,
	SPEAKER_VOICES,
	type Speaker,
	speakerVoice,
} from "./neural-voice";
import { RADIO, RADIO_NEURAL, radio } from "./radio";
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
			requestIdleCallback?: (f: () => void) => void;
		}
	).requestIdleCallback;
	// No deadline: forced after one, the render ran as an ordinary long task
	// and dropped frames on a page that is rarely idle (sage round 3). A
	// phrase not ready when it is asked is rendered then (`takeNumbers`).
	if (idle) idle(fn);
	else setTimeout(fn, 0);
};

/** Numbers phrases rendered ahead of being asked for, by text, and the ones
 *  waiting for an idle moment. A few at most: a system's next phrase. */
const ahead = new Map<string, Float32Array>();
const pending = new Set<string>();
const AHEAD_KEEP = 4;
/** The same phrases in the neural voice, once generated. */
const aheadNeural = new Map<string, Float32Array>();

/**
 * Render `text` when the page is idle, so the phrase the director asks for
 * next is ready (sage round 1 on #600: a render inside the frame step was a
 * ~40 ms stall every phrase). The host knows the next phrase: it is
 * `numbersPhrase(seed, state.voiceN)`.
 */
export function renderNumbersAhead(text: string) {
	// In the neural voice too, behind anything urgent — held here and not
	// in the line cache: each phrase is said once, and kept it would age the
	// comms lines out of the store (sage round 6 on #606).
	const voice = readyVoice();
	if (voice && !aheadNeural.has(text))
		void voice
			.line(text, NEURAL_ROLE.machine, 1, false, false)
			.then((n) => {
				if (!n) return;
				if (aheadNeural.size >= AHEAD_KEEP)
					aheadNeural.delete(aheadNeural.keys().next().value as string);
				aheadNeural.set(text, n);
			})
			.catch(() => null);
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

/** Whether `text` has been rendered ahead and not yet taken. */
export const aheadReady = (text: string) => ahead.has(text);

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

/** The neural voice the game speaks with when it is ready; `null` keeps
 *  every line on the formant voice. */
let neural: NeuralVoice | null = null;
export function useNeuralVoice(nv: NeuralVoice | null) {
	neural = nv;
}
/** The voice, while it is ready; `null` otherwise. */
const readyVoice = () =>
	neural !== null && neural.state.kind === "ready" ? neural : null;

/**
 * A comms line on the console bus: the neural voice's when the line cache
 * has it, else the formant voice's **at once** — an answer is not held for a
 * generation, which runs about three times slower than speech on WASM (sage
 * round 1 on #606). A miss is generated, urgent, for the next time.
 */
export async function sayLine(fx: AudioFX, id: CommsLineId, speaker?: Speaker) {
	const line = COMMS_LINES[id];
	const voice = readyVoice();
	const who = speakerVoice(line.voice, speaker);
	const n = voice ? await voice.kept(line.text, who).catch(() => null) : null;
	fx.speak(n ? radio(n, RADIO_NEURAL) : renderLine(id), SPEECH_RATE);
	if (voice && !n) void voice.line(line.text, who, 1, true).catch(() => null);
}

/** The voices a system's stations answer in: what `sayLine` draws for an
 *  approach line from each, so the preparation and the speaking cannot
 *  disagree about who a station is (sage round 1 on #616). */
export const stationVoices = (
	system: number,
	stationIds: readonly string[],
): NeuralVoiceId[] =>
	stationIds.map((id) => speakerVoice("approach", { system, id }));

/** The voices to prepare first: the current system's stations' (O1,
 *  2026-10-02). Asked again before every line, so a jump reorders a
 *  preparation already running. */
let firstVoices: () => readonly NeuralVoiceId[] = () => [];
export function prewarmFirst(voices: () => readonly NeuralVoiceId[]) {
	firstVoices = voices;
}

/**
 * Every comms line in every voice its speakers may have, into the line
 * cache, one after another behind anything urgent: run when the voice
 * becomes ready. Voices rotate by speaker (#604), so a line is prepared once
 * per voice rather than once — a few dozen lines, a few megabytes kept. On
 * WASM that is minutes, and a line not yet kept is said by the formant
 * voice, so the voices of the system the ship is in go first.
 */
export async function prewarmNeural() {
	const ids = Object.keys(COMMS_LINES) as CommsLineId[];
	const done = new Set<string>();
	for (;;) {
		const voice = readyVoice();
		if (!voice) return;
		const order = [
			...firstVoices().filter((v) => SPEAKER_VOICES.includes(v)),
			...SPEAKER_VOICES,
		];
		let next: { who: NeuralVoiceId; id: CommsLineId } | null = null;
		for (const who of order) {
			const id = ids.find((i) => !done.has(`${who}|${i}`));
			if (id) {
				next = { who, id };
				break;
			}
		}
		if (!next) return;
		done.add(`${next.who}|${next.id}`);
		await voice.prepare(COMMS_LINES[next.id].text, next.who).catch(() => {});
	}
}

/** The numbers station, far off in the music: the game's and the lab's one
 *  way of saying it. In the neural voice from the line cache when it was
 *  rendered ahead, else the formant voice's. */
export async function sayNumbers(fx: AudioFX, text: string) {
	// Rendered ahead only: a phrase still generating is said by the formant
	// voice now rather than seconds after its step (sage round 1 on #606).
	const n = readyVoice() ? (aheadNeural.get(text) ?? null) : null;
	aheadNeural.delete(text);
	const out = n ? radio(n, { ...RADIO_NEURAL, beepHz: 0 }) : takeNumbers(text);
	fx.speak(out, SPEECH_RATE, "music", MUSIC_VOICE_SPACE);
}

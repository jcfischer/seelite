/**
 * The music worklet (#560, after #543's D1, D4 and D6): one
 * `AudioWorkletNode` that sums every music voice, with the sequencer inside
 * it counting frames.
 *
 * **A shell.** It moves `port` messages into `MusicEngine.command` and render
 * quanta into `MusicEngine.render`, and holds nothing else; everything worth
 * testing is in `music-engine.ts` and below, which bun runs headless.
 *
 * **Emitted as its own file (D6).** `music.ts` imports this module as
 * `?worker&url`, so vite bundles it and everything it imports into one
 * hashed, self-contained script and hands back its same-origin URL, which
 * `addModule` loads. `new URL("./music-worklet.ts", import.meta.url)` was
 * the other form, and it is wrong here: built in a scratch project, vite
 * inlined the file as a base64 `data:video/mp2t` URL of its raw TypeScript —
 * untranspiled, not a file of the bundle, and typed as an MPEG stream.
 *
 * **`sampleRate` is read once**, here, in the constructor (#541: 6.3x per
 * sample), and handed to the engine.
 */
import { MusicEngine } from "./music-engine";
import {
	MUSIC_PROCESSOR,
	MUSIC_VOICE_CAP,
	type MusicCommand,
	type MusicReport,
} from "./music-score";

// `AudioWorkletGlobalScope`'s names. The DOM library does not declare them,
// because they exist only in this scope.
declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
}
declare function registerProcessor(
	name: string,
	ctor: new (options: {
		processorOptions?: { cap?: number };
	}) => AudioWorkletProcessor,
): void;

class MusicProcessor extends AudioWorkletProcessor {
	private readonly engine: MusicEngine;

	constructor(options: { processorOptions?: { cap?: number } }) {
		super();
		this.engine = new MusicEngine(
			sampleRate,
			options.processorOptions?.cap ?? MUSIC_VOICE_CAP,
		);
		this.port.onmessage = (e: MessageEvent<MusicCommand>) => {
			if (e.data.type === "sync") {
				const synced: MusicReport = { type: "synced", token: e.data.token };
				this.port.postMessage(synced);
				return;
			}
			try {
				this.engine.command(e.data, currentFrame);
			} catch (err) {
				const report: MusicReport = {
					type: "error",
					message: err instanceof Error ? err.message : String(err),
				};
				this.port.postMessage(report);
			}
		};
	}

	process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		// Two channels: the space is stereo (`music-space.ts`). A one-channel
		// output still gets the fold-down.
		const out = outputs[0]?.[0];
		if (out) this.engine.render(out, currentFrame, outputs[0]?.[1]);
		return true;
	}
}

registerProcessor(MUSIC_PROCESSOR, MusicProcessor);

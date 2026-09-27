/**
 * What a sound probe can read off a rendered buffer (#541).
 *
 * `measure-audio.mjs` renders a cue in an `OfflineAudioContext` and hands the
 * samples to this; `tests/audio-stats.test.ts` holds its arithmetic headless,
 * because bun has no WebAudio and this is the one part of the instrument that
 * does not need it.
 *
 * **Self-contained on purpose.** The page receives this function as its
 * source text, so it may reference nothing outside its own body — no import,
 * no module constant. The test revives it from `toString()` to hold that.
 *
 * - `rms`, `peak` — over the whole buffer.
 * - `onsetSample`, `onsetMs` — the first sample whose magnitude exceeds
 *   `onsetThreshold`; -1 for a silent buffer. An envelope ramping up from
 *   0.0001, as `audio.ts`'s `tone` does, crosses it a few ms after its start.
 * - `centroidHz` — the magnitude-weighted mean frequency of a Hann-windowed
 *   naive DFT over `windowS` seconds from the onset, at `bins` frequencies up to
 *   `maxHz`; 0 for a silent buffer. Both limits are chosen so the figure does
 *   not move with the sample rate, which the first harness's did — one cue read
 *   4861 Hz at 48 kHz against 4482 Hz at 44.1 kHz. The window is a
 *   **duration**, because a fixed sample count covers a different stretch of a
 *   sweep at each rate. And the spectrum stops at `maxHz`, below both
 *   Nyquists, because a band-limited oscillator carries harmonics up to
 *   Nyquist and a sum to Nyquist has more of them at the higher rate.
 * - `fnv` — FNV-1a over the float32 bytes. Equal only for bit-identical
 *   buffers, which #541 measured to hold for a noise-free cue within one
 *   engine and not across engines, so a probe asserts bands and never this.
 */
export function cueStats(
	samples,
	sampleRate,
	{
		onsetThreshold = 1e-3,
		windowS = 4096 / 48000,
		bins = 512,
		maxHz = 16000,
	} = {},
) {
	let sum = 0;
	let peak = 0;
	let onset = -1;
	for (let i = 0; i < samples.length; i++) {
		const a = Math.abs(samples[i]);
		sum += samples[i] * samples[i];
		if (a > peak) peak = a;
		if (onset < 0 && a > onsetThreshold) onset = i;
	}
	let centroidHz = 0;
	if (onset >= 0) {
		const n = Math.min(
			Math.round(windowS * sampleRate),
			samples.length - onset,
		);
		let num = 0;
		let den = 0;
		for (let k = 1; k < bins; k++) {
			const f = (k / bins) * Math.min(maxHz, sampleRate / 2);
			let re = 0;
			let im = 0;
			for (let j = 0; j < n; j++) {
				const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / n);
				const ph = (2 * Math.PI * f * j) / sampleRate;
				re += samples[onset + j] * w * Math.cos(ph);
				im -= samples[onset + j] * w * Math.sin(ph);
			}
			const m = Math.hypot(re, im);
			num += m * f;
			den += m;
		}
		centroidHz = den > 0 ? num / den : 0;
	}
	const f32 = Float32Array.from(samples);
	const bytes = new Uint8Array(f32.buffer);
	let h = 2166136261 >>> 0;
	for (let i = 0; i < bytes.length; i++) {
		h ^= bytes[i];
		h = Math.imul(h, 16777619) >>> 0;
	}
	return {
		rms: samples.length ? Math.sqrt(sum / samples.length) : 0,
		peak,
		onsetSample: onset,
		onsetMs: onset >= 0 ? (onset * 1000) / sampleRate : -1,
		centroidHz,
		fnv: h.toString(16).padStart(8, "0"),
	};
}

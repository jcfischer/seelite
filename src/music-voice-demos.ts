/**
 * A demo per Danube voice (`pulse`, `epiano`, `harpsi`, `softsaw`), for the
 * principal's ear: `npm run sounds -- --set voices`. Each is a two-octave
 * scale up and down, then one chord at three velocities, soft to hard — so a
 * voice's range and its answer to how hard it is played are heard in one
 * render. Listening material, not a game score.
 */
import type { NoteEvent, PartSpec, Song } from "./music-score";

/** C major from C3, two octaves. */
const SCALE = [0, 2, 4, 5, 7, 9, 11].flatMap((d) => [48 + d, 60 + d]);
const UP = [...SCALE].sort((a, b) => a - b).concat(72);
const RUN = [...UP, ...[...UP].reverse().slice(1)];
/** A ninth chord on C, spread across the middle of the keyboard. */
const CHORD = [48, 55, 64, 67, 74];

/** The scale in eighths, then the chord at three velocities, two beats each,
 *  for each named part in turn. */
function demo(parts: readonly string[]): NoteEvent[] {
	const out: NoteEvent[] = [];
	let beat = 0;
	const at = (part: string, dur: number, pitch: number, vel: number) =>
		out.push({
			part,
			bar: Math.floor(beat / 4),
			beat: beat % 4,
			dur,
			pitch,
			vel,
		});
	for (const part of parts) {
		for (const pitch of RUN) {
			at(part, 0.45, pitch, 0.7);
			beat += 0.5;
		}
		beat = Math.ceil(beat / 4) * 4;
		for (const vel of [0.3, 0.6, 1]) {
			for (const pitch of CHORD) at(part, 1.8, pitch, vel);
			beat += 2;
		}
		beat = Math.ceil(beat / 4) * 4 + 4;
	}
	return out;
}

/** How many bars `demo` writes for `n` parts. */
const barsOf = (n: number) => {
	const events = demo(Array.from({ length: n }, (_, i) => `p${i}`));
	return Math.max(...events.map((e) => e.bar)) + 2;
};

const song = (
	name: string,
	parts: Readonly<Record<string, PartSpec>>,
): Song => {
	const names = Object.keys(parts);
	return {
		name,
		beatsPerBar: 4,
		parts,
		sections: [
			{ name: "demo", bars: barsOf(names.length), events: demo(names) },
		],
		tempo: [{ bar: 0, bpm: 100 }],
		space: { reverbS: 1.6 },
	};
};

/** Every demo, by the id `renderInPage` loads it under. */
export const VOICE_DEMOS: Readonly<Record<string, Song>> = {
	"voice-pulse": song("pulse", {
		square: { voice: "pulse", level: 0.3, reverb: 0.15 },
		narrow: { voice: "pulse", level: 0.3, width: 0.125, reverb: 0.15 },
		swept: {
			voice: "pulse",
			level: 0.3,
			width: 0.3,
			pwmHz: 3,
			pwmDepth: 0.18,
			vibrato: 0.15,
			vibratoHz: 6,
			reverb: 0.15,
		},
	}),
	"voice-epiano": song("epiano", {
		epiano: { voice: "epiano", level: 0.4, reverb: 0.25 },
	}),
	"voice-harpsi": song("harpsi", {
		harpsi: { voice: "harpsi", level: 0.4, reverb: 0.25 },
	}),
	"voice-softsaw": song("softsaw", {
		softsaw: { voice: "softsaw", level: 0.3, reverb: 0.3 },
	}),
};

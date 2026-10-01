/**
 * The strings lab's pure half (#547 D15): the sliders as HTML, the desks a
 * voicing offers, what the lab plays, and the source it copies. No DOM, no
 * synth, so `tests/strings-lab.test.ts` reads it headless; `strings-lab.ts`
 * mounts it.
 */
import {
	DANUBE_VOICINGS,
	type DanubePart,
	type DanubeVoicing,
	danubeSong,
} from "./music-danube";
import type { NoteEvent, PartSpec, Song } from "./music-score";
import {
	STRINGS_GROUPS,
	STRINGS_PARAMS,
	type StringsParam,
} from "./strings-params";

const NOTE = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const noteName = (m: number) =>
	`${NOTE[m % 12]}${Math.floor(m / 12) - 1}`;

/** The desks of a voicing that play `strings`: the ones the sliders edit. */
export function stringsDesks(voicing: DanubeVoicing): DanubePart[] {
	return (Object.keys(DANUBE_VOICINGS[voicing]) as DanubePart[]).filter(
		(p) => DANUBE_VOICINGS[voicing][p].voice === "strings",
	);
}

/** A knob's value in a spec: its own, or the table's default. */
export const valueOf = (spec: PartSpec, p: StringsParam): number =>
	(spec[p.key] as number | undefined) ?? p.def;

export const fmt = (p: StringsParam, v: number) => {
	const d = p.step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(p.step)));
	return `${v.toFixed(d)}${p.unit ? ` ${p.unit}` : ""}`;
};

/**
 * Every slider, as HTML, grouped as the table groups them: one
 * `input[type=range][data-param]` per entry. Pure, so a test can read that
 * every knob has one.
 */
export function slidersHtml(spec: PartSpec): string {
	return STRINGS_GROUPS.map((g) => {
		const rows = STRINGS_PARAMS.filter((p) => p.group === g)
			.map((p) => {
				const v = valueOf(spec, p);
				return `<label title="${p.help}" style="display:grid;grid-template-columns:13em 1fr 6em;gap:8px;align-items:center;margin:2px 0">
  <span>${p.label}</span>
  <input type="range" data-param="${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}">
  <output data-out="${p.key}" style="font:12px ui-monospace,monospace;color:#8a96a3">${fmt(p, v)}</output>
</label>`;
			})
			.join("\n");
		return `<fieldset style="border:1px solid #2a323c;margin:0 0 10px"><legend>${g}</legend>
${rows}
</fieldset>`;
	}).join("\n");
}

/**
 * The spec as a `PartSpec` literal to paste into `music-danube.ts`: the voice,
 * the level, and every knob that is not the table's default.
 */
export function sourceLiteral(spec: PartSpec): string {
	const fields = [`voice: "strings"`, `level: ${spec.level}`];
	for (const p of STRINGS_PARAMS) {
		if (p.key === "level") continue;
		const v = valueOf(spec, p);
		if (v !== p.def) fields.push(`${p.key}: ${v}`);
	}
	return `{\n\t${fields.join(",\n\t")},\n}`;
}

export type LabPhrase = "note" | "chord" | "phrase";

/** A short song that plays the desk alone: a held note, a held chord, or a
 *  legato phrase up a major scale and back, at `pitch`. */
export function labSong(spec: PartSpec, kind: LabPhrase, pitch: number): Song {
	const at = (
		bar: number,
		beat: number,
		p: number,
		dur: number,
	): NoteEvent => ({
		part: "desk",
		bar,
		beat,
		dur,
		pitch: p,
		vel: 0.75,
	});
	const scale = [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0];
	const events =
		kind === "note"
			? [at(0, 0, pitch, 8)]
			: kind === "chord"
				? [0, 4, 7, 12].map((d) => at(0, 0, pitch + d, 8))
				: scale.map((d, k) =>
						at(
							Math.floor(k / 4),
							k % 4,
							pitch + d,
							k === scale.length - 1 ? 4 : 1,
						),
					);
	return {
		name: `strings lab ${kind}`,
		beatsPerBar: 4,
		parts: { desk: spec },
		sections: [{ name: "a", bars: kind === "phrase" ? 5 : 3, events }],
		tempo: [{ bar: 0, bpm: kind === "phrase" ? 120 : 60 }],
		space: { reverbS: 3 },
	};
}

/** The waltz in `voicing`, with `desk` played by `spec`. */
export function labWaltz(
	voicing: DanubeVoicing,
	desk: DanubePart,
	spec: PartSpec,
): Song {
	const song = danubeSong(voicing);
	return { ...song, parts: { ...song.parts, [desk]: spec } };
}

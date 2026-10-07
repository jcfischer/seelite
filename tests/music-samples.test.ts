/**
 * The sample sets' loader (`music-samples.ts`, O27): a song's sample sets
 * decode only the recordings its notes play, a later song adds only what it
 * lacks, the worklet merges what arrives into what it holds, decoding is
 * bounded, and a set that cannot be had plays the fallback and says so.
 *
 * Headless: the fetch and the decoder are fakes, and the manifests are
 * written here in the shape `scripts/fetch-music-samples.mjs` writes — the
 * sets themselves are not in the repository.
 */
import { describe, expect, test } from "bun:test";
import { GYMNOPEDIE_PIANO } from "../src/music-classical/satie-gymnopedie-1-piano";
import { VARIANT as JAZZ_TRIO } from "../src/music-danube-variants/jazz-trio";
import { MusicEngine } from "../src/music-engine";
import { pickLayer, pickZone } from "../src/music-sample-pick";
import {
	DECODE_AT_ONCE,
	type Decoder,
	type Fetched,
	manifestLayers,
	SampleLoader,
	type SampleManifest,
	setsOf,
	zonesPlayed,
} from "../src/music-samples";
import type {
	MusicCommand,
	SampleBank,
	SampleZone,
	Song,
} from "../src/music-score";
import { resolvePart, VoiceBank } from "../src/music-voices";
import { rms } from "./lib/audio-measure";

const SR = 48000;

/** A manifest as the fetch script writes one: `layers` soft to loud, a
 *  recording per root of each. */
const manifest = (
	layers: readonly (readonly [string, number])[],
	roots: readonly number[],
): SampleManifest => ({
	gainDb: 0,
	layers: layers.map(([name, maxVelocity]) => ({ name, maxVelocity })),
	samples: layers.flatMap(([name]) =>
		roots.map((root) => ({ root, layer: name, file: `${root}-${name}.ogg` })),
	),
});

/** `piano-grand-rich`'s shape: six layers, a root every minor third. */
const RICH = manifest(
	[
		["pp", 0.2],
		["p", 0.38],
		["mp", 0.55],
		["mf", 0.7],
		["f", 0.85],
		["ff", 1],
	],
	Array.from({ length: 30 }, (_, i) => 21 + 3 * i),
);
/** `bass-pizz`'s: two layers, a root every major third. */
const PIZZ = manifest(
	[
		["soft", 0.6],
		["loud", 1],
	],
	Array.from({ length: 10 }, (_, i) => 28 + 4 * i),
);

/** A recording standing in for a decoded one. */
const REC = Int16Array.from({ length: 64 }, (_, i) => (i % 7) * 100);

/** The set as the worklet holds it: every root, and `data` for `has` (all
 *  when it is omitted). */
const bankOf = (m: SampleManifest, has?: Set<string>): SampleBank => ({
	rate: SR,
	gain: 1,
	layers: manifestLayers(m).map((l) => ({
		maxVelocity: l.maxVelocity,
		zones: l.zones.map(
			(z): SampleZone => ({
				root: z.root,
				scale: 1 / 32767,
				data: !has || has.has(`${l.name}:${z.root}`) ? REC : null,
			}),
		),
	})),
});

/** Every sampler note of `set` in `song`. */
const notesOf = (song: Song, set: string) => {
	const parts = new Set(
		Object.entries(song.parts)
			.filter(([, p]) => p.voice === "sampler" && p.samples === set)
			.map(([n]) => n),
	);
	return song.sections.flatMap((s) =>
		s.events.filter((e) => parts.has(e.part)),
	);
};

/** Which (layer, root) a note picks from `bank`, and whether it has data. */
const pick = (bank: SampleBank, pitch: number, vel: number) => {
	const layer = pickLayer(bank.layers, vel);
	const zone = layer && pickZone(layer.zones, pitch);
	return {
		layer: layer ? bank.layers.indexOf(layer) : -1,
		root: zone?.root,
		has: !!zone?.data,
	};
};

describe("the recordings a song plays", () => {
	const cases: [string, Song, string, SampleManifest][] = [
		["jazz-trio's piano", JAZZ_TRIO, "piano-grand-rich", RICH],
		["jazz-trio's bass", JAZZ_TRIO, "bass-pizz", PIZZ],
		["the Gymnopédie on the piano", GYMNOPEDIE_PIANO, "piano-grand-rich", RICH],
	];
	for (const [what, song, set, m] of cases)
		test(`${what}: every note picks the same recording from the partial set, and it is there`, () => {
			const played = zonesPlayed(song, set, m);
			const full = bankOf(m);
			const partial = bankOf(m, played);
			// The partial set without its empty roots: what the rule alone sees.
			const pruned: SampleBank = {
				...partial,
				layers: partial.layers.map((l) => ({
					...l,
					zones: l.zones.filter((z) => z.data),
				})),
			};
			const notes = notesOf(song, set);
			expect(notes.length).toBeGreaterThan(20);
			// Fewer recordings than the set holds, or the plan saves nothing.
			expect(played.size).toBeLessThan(m.samples.length);
			for (const e of notes) {
				const want = pick(full, e.pitch, e.vel);
				expect([e.pitch, e.vel, pick(partial, e.pitch, e.vel)]).toEqual([
					e.pitch,
					e.vel,
					want,
				]);
				const p = pick(pruned, e.pitch, e.vel);
				expect([e.pitch, e.vel, p.layer, p.root]).toEqual([
					e.pitch,
					e.vel,
					want.layer,
					want.root,
				]);
			}
		});

	test("ties and boundaries: the lower root, and a velocity on a layer's edge", () => {
		const m = manifest(
			[
				["soft", 0.5],
				["loud", 1],
			],
			[60, 62, 64],
		);
		const song: Song = {
			name: "edges",
			beatsPerBar: 4,
			parts: { k: { voice: "sampler", samples: "edge", level: 1 } },
			sections: [
				{
					name: "a",
					bars: 1,
					events: [
						// 61 is as near 60 as 62; 63 as near 62 as 64.
						{ part: "k", bar: 0, beat: 0, dur: 1, pitch: 61, vel: 0.5 },
						{ part: "k", bar: 0, beat: 1, dur: 1, pitch: 63, vel: 0.5001 },
						// Above every layer's velocity, and below every root.
						{ part: "k", bar: 0, beat: 2, dur: 1, pitch: 40, vel: 1.2 },
					],
				},
			],
			tempo: [{ bar: 0, bpm: 120 }],
		};
		expect([...zonesPlayed(song, "edge", m)].sort()).toEqual([
			"loud:60",
			"loud:62",
			"soft:60",
		]);
		const partial = bankOf(m, zonesPlayed(song, "edge", m));
		for (const e of song.sections[0].events)
			expect(pick(partial, e.pitch, e.vel)).toEqual(
				pick(bankOf(m), e.pitch, e.vel),
			);
	});

	test("a song's sample sets, each once", () => {
		expect(setsOf(JAZZ_TRIO).sort()).toEqual(["bass-pizz", "piano-grand-rich"]);
	});
});

describe("the worklet merges what arrives", () => {
	const m = manifest([["only", 1]], [45, 57, 69]);
	const skeleton = bankOf(m, new Set());
	/** One recording, in its layer's place. */
	const one = (root: number): SampleBank => ({
		...skeleton,
		layers: [
			{
				maxVelocity: 1,
				zones: [{ root, scale: 1 / 32767, data: REC.slice() }],
			},
		],
	});
	const part = resolvePart({ voice: "sampler", samples: "m", level: 1 }, SR);
	/** Whether a note on `pitch` takes a slot: a recording is there for it
	 *  (the part has no fallback). */
	const sounds = (b: VoiceBank, pitch: number) => {
		const before = b.sounding;
		b.noteOn(0, part, 0, 0, pitch, 1, SR);
		return b.sounding > before;
	};

	test("a later recording fills in its root and keeps the earlier one", () => {
		const b = new VoiceBank(8, SR);
		b.addSamples("m", skeleton);
		expect(sounds(b, 57)).toBe(false);
		b.addSamples("m", one(57));
		b.addSamples("m", one(69));
		expect(sounds(b, 57)).toBe(true);
		expect(sounds(b, 69)).toBe(true);
		// 45 never came: it is not read from a neighbour that did.
		expect(sounds(b, 45)).toBe(false);
	});

	test("a merge that carries no recording for a root leaves it as it was", () => {
		const b = new VoiceBank(8, SR);
		b.addSamples("m", skeleton);
		b.addSamples("m", one(57));
		b.addSamples("m", skeleton);
		expect(sounds(b, 57)).toBe(true);
	});
});

/** A fake site: every manifest and recording `sets` names, each fetch
 *  counted. A recording's bytes are its own path, so the decoder knows it. */
function site(sets: Readonly<Record<string, SampleManifest | null>>) {
	const fetched: string[] = [];
	const fetch = async (path: string): Promise<Fetched> => {
		fetched.push(path);
		const [, set, file] = path.match(/^\/samples\/([^/]+)\/(.+)$/) ?? [];
		const m = sets[set];
		const ok =
			!!m &&
			(file === "manifest.json" || m.samples.some((s) => s.file === file));
		return {
			ok,
			status: ok ? 200 : 404,
			json: async () => m,
			arrayBuffer: async () =>
				new TextEncoder().encode(path).buffer as ArrayBuffer,
		};
	};
	return { fetch, fetched };
}

/** A decoder that hands back a sine at the recording's root, in stereo at
 *  half and quarter scale, counting how many it decodes at once. `fail`
 *  refuses every recording, or those whose root it names. */
function decoder(fail: boolean | ((root: number) => boolean) = false) {
	const d = {
		atOnce: 0,
		most: 0,
		decoded: 0,
		sampleRate: SR,
		async decodeAudioData(data: ArrayBuffer) {
			d.atOnce++;
			d.most = Math.max(d.most, d.atOnce);
			await new Promise((r) => setTimeout(r, 2));
			d.atOnce--;
			const root = Number(new TextDecoder().decode(data).match(/(\d+)-/)?.[1]);
			if (fail === true || (typeof fail === "function" && fail(root)))
				throw new Error("EncodingError: unable to decode audio data");
			d.decoded++;
			const hz = 440 * 2 ** ((root - 69) / 12);
			const ch = (amp: number) =>
				Float32Array.from(
					{ length: SR / 4 },
					(_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR),
				);
			const L = ch(0.5);
			const R = ch(0.25);
			return {
				numberOfChannels: 2,
				getChannelData: (c: number) => (c ? R : L),
			};
		},
	};
	return d as typeof d & Decoder;
}

/** A loader feeding an engine, as `Music` feeds the worklet. */
function rig(
	sets: Readonly<Record<string, SampleManifest | null>>,
	fail: boolean | ((root: number) => boolean) = false,
) {
	const { fetch, fetched } = site(sets);
	const engine = new MusicEngine(SR, 24);
	const errors: string[] = [];
	const sent: MusicCommand[] = [];
	const loader = new SampleLoader({
		base: "/samples/",
		fetchFile: fetch,
		send: (cmd) => {
			sent.push(cmd);
			engine.command(cmd, 0);
		},
		errors,
	});
	const dec = decoder(fail);
	return { loader, engine, errors, sent, fetched, dec };
}

/** A song of one sampler part on `set`, `notes` as (pitch, vel). */
const songOn = (
	set: string,
	notes: readonly (readonly [number, number])[],
	fallback?: "keys",
): Song => ({
	name: `on ${set}`,
	beatsPerBar: 4,
	parts: { k: { voice: "sampler", samples: set, level: 1, fallback } },
	sections: [
		{
			name: "a",
			bars: 2,
			events: notes.map(([pitch, vel], i) => ({
				part: "k",
				bar: Math.floor(i / 4),
				beat: i % 4,
				dur: 0.5,
				pitch,
				vel,
			})),
		},
	],
	tempo: [{ bar: 0, bpm: 120 }],
});

/** Play `song` on `engine` and read its level over a second. */
const play = (engine: MusicEngine, song: Song) => {
	engine.command({ type: "load", id: song.name, song }, 0);
	engine.command({ type: "play", id: song.name, at: "bar" }, 0);
	const out = new Float32Array(SR);
	for (let f = 0; f < out.length; f += 128)
		engine.render(out.subarray(f, f + 128), f);
	return rms(out);
};

describe("the loader", () => {
	test("fetches only what the song plays, the manifest once, a few at a time", async () => {
		const r = rig({ rich: RICH });
		const song = songOn("rich", [
			[60, 0.3],
			[61, 0.3],
			[72, 0.9],
			[40, 0.5],
			[100, 0.1],
			[64, 0.6],
			[66, 0.75],
			[48, 0.9],
		]);
		r.loader.attach(r.dec);
		r.loader.load(song);
		await r.loader.ready();
		const files = r.fetched.filter((p) => p.endsWith(".ogg"));
		expect(r.fetched.filter((p) => p.endsWith("manifest.json"))).toHaveLength(
			1,
		);
		expect(files.sort()).toEqual(
			[...zonesPlayed(song, "rich", RICH)]
				.map((k) => {
					const [layer, root] = k.split(":");
					return `/samples/rich/${root}-${layer}.ogg`;
				})
				.sort(),
		);
		expect(r.dec.most).toBeLessThanOrEqual(DECODE_AT_ONCE);
		expect(r.errors).toEqual([]);
		// A skeleton first, then one recording to a message.
		expect(r.sent[0]).toMatchObject({ type: "samples", set: "rich" });
		expect(r.sent).toHaveLength(1 + files.length);
		expect(play(r.engine, song)).toBeGreaterThan(0.01);
	});

	test("decodes at most a handful at once, however many a song plays", async () => {
		const r = rig({ rich: RICH });
		const song = songOn(
			"rich",
			RICH.samples.map((s) => [s.root, 0.1] as const),
		);
		r.loader.attach(r.dec);
		r.loader.load(song);
		await r.loader.ready();
		expect(r.dec.decoded).toBeGreaterThan(DECODE_AT_ONCE * 3);
		expect(r.dec.most).toBe(DECODE_AT_ONCE);
	});

	test("a later song on the same set fetches only what it lacks", async () => {
		const r = rig({ rich: RICH });
		const a = songOn("rich", [
			[60, 0.3],
			[72, 0.3],
		]);
		const b = songOn("rich", [
			[60, 0.3],
			[72, 0.3],
			[84, 0.3],
		]);
		r.loader.attach(r.dec);
		r.loader.load(a);
		await r.loader.ready();
		const first = r.fetched.length;
		r.loader.load(b);
		await r.loader.ready();
		expect(r.fetched.slice(first)).toEqual(["/samples/rich/84-p.ogg"]);
		// And the worklet still holds the first song's: it plays without them
		// being sent again.
		expect(play(r.engine, a)).toBeGreaterThan(0.01);
	});

	test("a song loaded before there is a context waits for one", async () => {
		const r = rig({ rich: RICH });
		r.loader.load(songOn("rich", [[60, 0.3]]));
		expect(r.fetched).toEqual([]);
		r.loader.attach(r.dec);
		await r.loader.ready();
		expect(r.fetched).toHaveLength(2);
	});

	test("recordings are held as 16-bit steps at their own peak", async () => {
		const r = rig({ rich: RICH });
		r.loader.attach(r.dec);
		r.loader.load(songOn("rich", [[69, 0.3]]));
		await r.loader.ready();
		const msg = r.sent[1] as Extract<MusicCommand, { type: "samples" }>;
		const zone = msg.bank.layers.flatMap((l) => l.zones)[0];
		expect(zone.data).toBeInstanceOf(Int16Array);
		expect(zone.right).toBeInstanceOf(Int16Array);
		expect(zone.scale).toBeCloseTo(0.5 / 32767, 8);
		// The left side reaches full scale; the right, at half its level, half.
		const peak = (x: Int16Array) =>
			x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
		expect(peak(zone.data as Int16Array)).toBe(32767);
		expect(Math.abs(peak(zone.right as Int16Array) - 16384)).toBeLessThan(2);
	});

	test("a recording the browser cannot decode plays the fallback, and the set is named", async () => {
		const r = rig({ rich: RICH }, true);
		r.loader.attach(r.dec);
		const backed = songOn("rich", [[60, 0.3]], "keys");
		r.loader.load(backed);
		await r.loader.ready();
		expect(r.errors).toHaveLength(1);
		// The recording is named, not the whole set (sage, #738 round 2).
		expect(r.errors[0]).toContain("sample set rich: 60-p.ogg did not load");
		expect(r.errors[0]).toContain("unable to decode");
		expect(play(r.engine, backed)).toBeGreaterThan(0.01);
		// The control: the same song with no fallback is silence.
		expect(
			play(r.engine, { ...songOn("rich", [[60, 0.3]]), name: "bare" }),
		).toBe(0);
	});

	test("one recording that fails leaves the rest of its set playing", async () => {
		const r = rig({ rich: RICH }, (root) => root === 60);
		r.loader.attach(r.dec);
		r.loader.load(
			songOn("rich", [
				[60, 0.3],
				[72, 0.3],
			]),
		);
		await r.loader.ready();
		// Only the failed recording is named, and by its file.
		expect(r.errors).toHaveLength(1);
		expect(r.errors[0]).toContain("sample set rich: 60-p.ogg did not load");
		// The other recording arrived and plays; the failed one is silence.
		expect(
			play(r.engine, { ...songOn("rich", [[72, 0.3]]), name: "rest" }),
		).toBeGreaterThan(0.01);
		expect(
			play(r.engine, { ...songOn("rich", [[60, 0.3]]), name: "lost" }),
		).toBe(0);
	});

	test("a set that is not there plays the fallback, and is named", async () => {
		const r = rig({ rich: null });
		r.loader.attach(r.dec);
		const backed = songOn("rich", [[60, 0.3]], "keys");
		r.loader.load(backed);
		await r.loader.ready();
		expect(r.errors).toEqual([
			"sample set rich did not load: manifest: HTTP 404",
		]);
		expect(play(r.engine, backed)).toBeGreaterThan(0.01);
	});

	test("a set name that could leave its folder is refused, and fetched never", async () => {
		const r = rig({});
		r.loader.attach(r.dec);
		r.loader.load(songOn("../x", [[60, 0.3]], "keys"));
		await r.loader.ready();
		expect(r.fetched).toEqual([]);
		expect(r.errors[0]).toContain('"../x" is not a set name');
	});
});

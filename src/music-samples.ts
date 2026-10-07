/**
 * The sample sets' loader (map #1's ruling on open-licensed music samples,
 * 2026-10-06; O27, 2026-10-07): it fetches a set's recordings from this
 * site, decodes them and sends them to the worklet — **only the recordings a
 * loaded song plays**.
 *
 * Why only those: `piano-grand-rich` decodes to 742 MiB of Float32 at
 * 48 kHz (180 recordings, 2026 s, stereo), and a song plays a few dozen of
 * them. So when a song is loaded its notes are run through the voice's own
 * pick rule (`music-sample-pick.ts`) against the set's manifest, and the
 * (layer, root) pairs they land on are what is fetched. A later song that
 * plays the same set adds the pairs it lacks and nothing it already has.
 *
 * What reaches the worklet (`samples`, `music-score.ts`): first the set's
 * skeleton — every layer, every root, no recordings — then one merge per
 * recording as it is decoded. Every recording is held as 16-bit integers
 * with its own peak as the scale, half of Float32. A note whose recording
 * has not arrived plays its part's `fallback`, and so does every note of a
 * set that failed; the reason is in `errors`, naming the set.
 *
 * **Decoding is bounded**: at most `DECODE_AT_ONCE` recordings are fetched
 * and decoded at a time across every set, and each decoded `AudioBuffer` is
 * dropped as soon as its channels are copied out, so the main thread never
 * holds a set's worth of Float32.
 *
 * Headless: the fetch and the decoder are passed in (`Music` passes
 * `fetchBundled` and its context), so bun runs all of it.
 */
import { pickLayer, pickZone } from "./music-sample-pick";
import type {
	MusicCommand,
	SampleBank,
	SampleLayer,
	SampleZone,
	Song,
} from "./music-score";

/** Recordings fetched and decoded at once, across every set. */
export const DECODE_AT_ONCE = 4;

/** A set's name is a folder of this site's `music-samples/`: nothing that
 *  could leave it. */
const SET_NAME = /^[a-z0-9][a-z0-9-]*$/;
/** A recording's file name, inside its set's folder. */
const FILE_NAME = /^[\w.-]+$/;

/** What `scripts/fetch-music-samples.mjs` writes beside a set. */
export interface SampleManifest {
	readonly gainDb: number;
	readonly layers: readonly {
		readonly name: string;
		readonly maxVelocity: number;
	}[];
	readonly samples: readonly {
		readonly root: number;
		readonly layer: string;
		readonly file: string;
		readonly durationS?: number;
	}[];
}

/** The set's layers as the voice orders them: soft to loud, as the manifest
 *  lists them, each with its recordings low to high. */
export function manifestLayers(m: SampleManifest) {
	return m.layers.map((l) => ({
		name: l.name,
		maxVelocity: l.maxVelocity,
		zones: m.samples
			.filter((s) => s.layer === l.name)
			.slice()
			.sort((a, b) => a.root - b.root),
	}));
}

/** One recording's key: its layer's name and its root. */
const keyOf = (layer: string, root: number) => `${layer}:${root}`;

/**
 * Every recording of `set` that `song` plays: each note of each sampler part
 * on that set, picked by the voice's own rule. Keys are `layer:root`.
 */
export function zonesPlayed(
	song: Song,
	set: string,
	m: SampleManifest,
): Set<string> {
	const parts = new Set(
		Object.entries(song.parts)
			.filter(([, p]) => p.voice === "sampler" && p.samples === set)
			.map(([name]) => name),
	);
	const layers = manifestLayers(m);
	const out = new Set<string>();
	for (const section of song.sections)
		for (const e of section.events) {
			if (!parts.has(e.part)) continue;
			const layer = pickLayer(layers, e.vel);
			const zone = layer && pickZone(layer.zones, e.pitch);
			if (layer && zone) out.add(keyOf(layer.name, zone.root));
		}
	return out;
}

/** The sets a song's sampler parts play. */
export const setsOf = (song: Song): string[] => [
	...new Set(
		Object.values(song.parts).flatMap((p) =>
			p.voice === "sampler" && p.samples ? [p.samples] : [],
		),
	),
];

/** Float32 into 16-bit steps at `scale`, which is the peak over 32767. */
const toInt16 = (x: Float32Array, scale: number): Int16Array => {
	const out = new Int16Array(x.length);
	if (scale > 0)
		for (let i = 0; i < x.length; i++) out[i] = Math.round(x[i] / scale);
	return out;
};

/** The peak of one or two channels. */
const peakOf = (a: Float32Array, b?: Float32Array): number => {
	let p = 0;
	for (let i = 0; i < a.length; i++) p = Math.max(p, Math.abs(a[i]));
	if (b) for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i]));
	return p;
};

/** What the loader needs of a `Response`. */
export interface Fetched {
	readonly ok: boolean;
	readonly status: number;
	json(): Promise<unknown>;
	arrayBuffer(): Promise<ArrayBuffer>;
}

/** What the loader needs of an `AudioContext`. */
export interface Decoder {
	readonly sampleRate: number;
	decodeAudioData(data: ArrayBuffer): Promise<{
		readonly numberOfChannels: number;
		getChannelData(channel: number): Float32Array;
	}>;
}

interface SetState {
	/** The manifest, or `null` where it could not be had. */
	readonly manifest: Promise<SampleManifest | null>;
	/** Recordings sent, or on their way. */
	readonly asked: Set<string>;
}

export class SampleLoader {
	private ctx: Decoder | null = null;
	private readonly sets = new Map<string, SetState>();
	/** Songs loaded before there was a context to decode on. */
	private readonly waiting: Song[] = [];
	/** The loads still running; each leaves as it settles. */
	private readonly jobs = new Set<Promise<void>>();
	private running = 0;
	private readonly queue: (() => void)[] = [];

	constructor(
		private readonly o: {
			/** The sets' folder on this site, ending in `/`. */
			readonly base: string;
			/** A file of this site: `Music` passes `fetchBundled`, the one way
			 *  `src/` reaches the network for the bundle. */
			readonly fetchFile: (path: string) => Promise<Fetched>;
			readonly send: (cmd: MusicCommand, transfer: Transferable[]) => void;
			/** Where a failure is named: `Music.errors`. */
			readonly errors: string[];
			readonly warn?: (message: string) => void;
			readonly atOnce?: number;
		},
	) {}

	/** The context to decode on; songs loaded before it start now. */
	attach(ctx: Decoder) {
		if (this.ctx) return;
		this.ctx = ctx;
		for (const song of this.waiting.splice(0)) this.load(song);
	}

	/** Fetch, decode and send what `song` plays of every set it names. */
	load(song: Song) {
		if (!this.ctx) {
			this.waiting.push(song);
			return;
		}
		for (const set of setsOf(song)) {
			const job = this.loadSet(set, song);
			this.jobs.add(job);
			job.finally(() => this.jobs.delete(job));
		}
	}

	/**
	 * Resolves once every recording asked for so far has been sent or has
	 * failed. It never rejects: a failure plays the fallback, and its reason
	 * is in `errors`.
	 */
	ready(): Promise<void> {
		return Promise.all([...this.jobs]).then(() => undefined);
	}

	/** A set that did not load, or one `file` of it that did not: the other
	 *  recordings of the set still play. */
	private fail(set: string, err: unknown, file?: string) {
		const why = err instanceof Error ? err.message : String(err);
		const message = file
			? `sample set ${set}: ${file} did not load: ${why}`
			: `sample set ${set} did not load: ${why}`;
		this.o.errors.push(message);
		this.o.warn?.(message);
	}

	private stateOf(set: string): SetState {
		const held = this.sets.get(set);
		if (held) return held;
		const ctx = this.ctx as Decoder;
		const dir = `${this.o.base}${set}/`;
		const manifest = (async () => {
			if (!SET_NAME.test(set)) throw new Error(`"${set}" is not a set name`);
			const res = await this.o.fetchFile(`${dir}manifest.json`);
			if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
			const m = (await res.json()) as SampleManifest;
			if (!Array.isArray(m?.layers) || !Array.isArray(m?.samples))
				throw new Error("manifest: no layers or samples");
			// The skeleton: every layer and root, no recording yet.
			const skeleton: SampleBank = {
				rate: ctx.sampleRate,
				gain: 10 ** (m.gainDb / 20),
				layers: manifestLayers(m).map((l) => ({
					maxVelocity: l.maxVelocity,
					zones: l.zones.map((z) => ({ root: z.root, scale: 0, data: null })),
				})),
			};
			this.o.send({ type: "samples", set, bank: skeleton }, []);
			return m;
		})().catch((err: unknown) => {
			this.fail(set, err);
			return null;
		});
		const state = { manifest, asked: new Set<string>() };
		this.sets.set(set, state);
		return state;
	}

	private async loadSet(set: string, song: Song): Promise<void> {
		const state = this.stateOf(set);
		const m = await state.manifest;
		if (!m) return;
		const layers = manifestLayers(m);
		const wanted = [...zonesPlayed(song, set, m)].filter(
			(k) => !state.asked.has(k),
		);
		for (const k of wanted) state.asked.add(k);
		const rate = (this.ctx as Decoder).sampleRate;
		const gain = 10 ** (m.gainDb / 20);
		// Each played key's layer and recording, found once rather than by a
		// search per key.
		const byKey = new Map(
			layers.flatMap((l, li) =>
				l.zones.map((z) => [keyOf(l.name, z.root), { li, s: z }] as const),
			),
		);
		await Promise.all(
			wanted.map((k) =>
				this.bounded(async () => {
					const found = byKey.get(k);
					if (!found) throw new Error(`${set}: no recording for ${k}`);
					const { li, s } = found;
					const zone = await this.decode(
						`${this.o.base}${set}/`,
						s.file,
						s.root,
					).catch((err: unknown) => {
						this.fail(set, err, s.file);
						return null;
					});
					if (!zone) return;
					// One zone, in its layer's place; the other layers empty.
					const bank: SampleBank = {
						rate,
						gain,
						layers: layers.map(
							(l, i): SampleLayer => ({
								maxVelocity: l.maxVelocity,
								zones: i === li ? [zone] : [],
							}),
						),
					};
					this.o.send(
						{ type: "samples", set, bank },
						[zone.data, zone.right].flatMap((c) =>
							c ? [c.buffer as ArrayBuffer] : [],
						),
					);
				}),
			),
		).catch((err: unknown) => this.fail(set, err));
	}

	/** Fetch and decode one recording into 16-bit steps; its `AudioBuffer`
	 *  goes out of scope here, as soon as its channels are copied. */
	private async decode(
		dir: string,
		file: string,
		root: number,
	): Promise<SampleZone> {
		if (!FILE_NAME.test(file))
			throw new Error(`manifest: "${file}" is not a file name`);
		const res = await this.o.fetchFile(`${dir}${file}`);
		if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
		const audio = await (this.ctx as Decoder).decodeAudioData(
			await res.arrayBuffer(),
		);
		// A task of its own: a load in flight then costs a frame a recording's
		// conversion at most, rather than a batch's.
		await new Promise<void>((go) => setTimeout(go, 0));
		const left = audio.getChannelData(0);
		const right =
			audio.numberOfChannels > 1 ? audio.getChannelData(1) : undefined;
		const scale = peakOf(left, right) / 32767;
		return {
			root,
			scale,
			data: toInt16(left, scale),
			right: right ? toInt16(right, scale) : undefined,
		};
	}

	/** Run `job` once fewer than `atOnce` are running. */
	private async bounded<T>(job: () => Promise<T>): Promise<T> {
		const limit = this.o.atOnce ?? DECODE_AT_ONCE;
		// A finished job hands its place straight to the next in the queue, so
		// a caller arriving between the two cannot take it as well.
		if (this.running >= limit)
			await new Promise<void>((go) => this.queue.push(go));
		else this.running++;
		try {
			return await job();
		} finally {
			const next = this.queue.shift();
			if (next) next();
			else this.running--;
		}
	}
}

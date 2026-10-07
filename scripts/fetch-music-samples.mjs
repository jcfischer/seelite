/**
 * Fetch the music's instrument samples into `public/music-samples/`: the
 * pianos and the harpsichord a sampler voice plays, by the principal's ruling
 * on map #1's Constraints (2026-10-06) — open-licensed instrument samples are
 * allowed for the music, same-origin, loaded on demand; CC0 or CC BY, never
 * NC or SA.
 *
 *   node scripts/fetch-music-samples.mjs            # every set
 *   node scripts/fetch-music-samples.mjs piano-grand harpsi-vcsl
 *
 * Each set is a subset of its source: the source's own roots (about every
 * three semitones), the velocity layers the set names (two for most pianos,
 * six for `piano-grand-rich`, one for the harpsichord), each sample started
 * at its attack, cut to a few seconds with a fade, kept in stereo where the
 * set asks for it (`channels: 2`) and summed to mono otherwise, given **one
 * gain for the whole set** (so a soft layer
 * stays softer than its loud one), and encoded as Ogg Opus. Opus because every
 * browser the game targets decodes it — caniuse lists it as supported in
 * Chrome, Edge and Firefox and in Safari from 18.4 (https://caniuse.com/opus)
 * — and because Ogg Opus carries its decoder delay as `pre-skip`, which a
 * decoder must remove, so a sample's attack stays at its first frame. MP3 and
 * AAC both prime their decoders, and browsers disagree about removing it.
 *
 * Sources are pinned by **commit**, not by checksum: a raw file at a commit
 * cannot change, and the checksum of what was fetched is written beside each
 * sample in the manifest. What arrives is then checked: it must decode, and
 * its pitch must be the root the set names it — measured by autocorrelation,
 * within 60 cents — so a file named in another octave convention (VCSL names
 * middle C `C3` for its harpsichord and `C4` for its grand) stops the run
 * instead of shipping a sample an octave off. **The check is one-sided**: the
 * search reaches periods from 1/2.8 to 1.4 of the root's, so a file that
 * sounds an octave *above* its name is refused, while one that sounds an
 * octave *below* it can pass, read at its second harmonic (sage, #738).
 *
 * Downloads are cached outside the repository (`SEELITE_SAMPLE_CACHE`, or the
 * OS cache directory), so a second run fetches nothing. They are data: decoded
 * by ffmpeg, never run. A VCSL file is a 24-bit WAV of up to 11 MB, so only
 * the head of it that the cut keeps is fetched, with an HTTP range.
 *
 * The sets the principal chose are **tracked in Git LFS** (`.gitattributes`,
 * map #1's Constraints); the others and `index.json` are git-ignored. Each
 * set gets a `LICENSES.txt` naming its source, licence and credit.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const OUT = "public/music-samples";
const RATE = 48000;
const BITRATE = 64000;
/** The loudest sample of a set lands here, in dBFS. */
const SET_PEAK_DB = -1;
/** A root may be this far from its measured pitch, in cents, where the
 *  measurement holds: from MIDI 27 to 96 it read the upright's samples within
 *  16 cents. Outside it the reading drifts — a piano's lowest strings are
 *  inharmonic enough to read A0 more than three semitones sharp, and its top
 *  octave is tuned sharp and sits on a coarse lag grid — so there the check
 *  only refuses a sample a third or more off, which still catches a name in
 *  the wrong octave, and the manifest records no cents for it. */
const PITCH_TOLERANCE_CENTS = 60;
const PITCH_RELIABLE = [27, 96];
const PITCH_OUTER_CENTS = 450;

const CACHE =
	process.env.SEELITE_SAMPLE_CACHE ??
	join(
		process.env.XDG_CACHE_HOME ??
			(platform() === "darwin"
				? join(homedir(), "Library", "Caches")
				: join(homedir(), ".cache")),
		"seelite-music-samples",
	);

const NOTE = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7 };
Object.assign(NOTE, { "G#": 8, A: 9, "A#": 10, B: 11 });
/** A note name to MIDI, with the octave that holds middle C (60) given. */
const midi = (name, middleCOctave = 4) => {
	const m = /^([A-G]#?)(-?\d)$/.exec(name);
	if (!m || NOTE[m[1]] === undefined) throw new Error(`no note "${name}"`);
	return 12 * (Number(m[2]) + 5 - middleCOctave) + NOTE[m[1]];
};
const NAMES = Object.keys(NOTE);
const nameOf = (root, middleCOctave = 4) =>
	`${NAMES[root % 12]}${Math.floor(root / 12) - 5 + middleCOctave}`;

/** How long a sample is kept: 8 s at C3 and below, falling to 4.5 s at C6. */
const pianoSeconds = (root) =>
	Math.min(8, Math.max(4.5, 8 - ((root - 48) * 3.5) / 36));
/** The rich grand keeps more of each tail: 16 s at C3 and below, falling to
 *  8 s at C6. */
const richSeconds = (root) =>
	Math.min(16, Math.max(8, 16 - ((root - 48) * 8) / 36));
const harpsiSeconds = (root) =>
	Math.min(5, Math.max(3, 5 - ((root - 48) * 2) / 36));

const raw = (repo, revision, path) =>
	`https://raw.githubusercontent.com/${repo}/${revision}/${path
		.split("/")
		.map(encodeURIComponent)
		.join("/")}`;

/** The Salamander grand's source, shared by its two sets: minor thirds
 *  from the lowest A to the top C, in whichever layers a set names. */
const SALAMANDER = {
	instrument:
		"Salamander Grand Piano V3 — a Yamaha C5, recorded by Alexander Holm",
	license: "CC-BY-3.0",
	licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
	credit:
		"Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/)",
	repo: "sfzinstruments/SalamanderGrandPiano",
	revision: "3382bf9496bba2486f5ab0de55a264d1dfc38404",
	async samples(set) {
		const out = [];
		for (let root = 21; root <= 108; root += 3)
			for (const l of set.layers)
				out.push({
					root,
					layer: l.name,
					path: `Samples/${nameOf(root)}${l.source}.flac`,
				});
		return out;
	},
};

/**
 * The sets. `samples()` lists `{ root, layer, path }` from the source's own
 * naming; `range` fetches only the head of a large uncompressed file.
 */
const SETS = [
	{
		id: "piano-upright",
		instrument: "Upright Piano KW — a Kawai upright, recorded by FreePats",
		license: "CC0-1.0",
		licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
		credit:
			"Upright Piano KW by Gonzalo and Roberto (FreePats project), CC0 1.0",
		repo: "freepats/upright-piano-KW",
		revision: "570f6c60ed2eff67accad3b85d5b452e57a3ad28",
		seconds: pianoSeconds,
		// The bank's two layers split at velocity 80 of 127.
		layers: [
			{ name: "soft", maxVelocity: 80 / 127 },
			{ name: "loud", maxVelocity: 1 },
		],
		// The roots are the SFZ's own: its loud layer fills two gaps with B.
		async samples(set) {
			const sfz = (
				await fetchCached(
					set,
					"UprightPianoKW-20220221.sfz",
					raw(set.repo, set.revision, "UprightPianoKW-20220221.sfz"),
				)
			).toString("utf8");
			const out = [];
			let layer = null;
			for (const block of sfz.split(/(?=<(?:group|region)>)/)) {
				if (block.startsWith("<group>"))
					layer = /lovel=8[1-9]/.test(block) ? "loud" : "soft";
				if (!block.startsWith("<region>")) continue;
				const sample = /sample=(\S+)/.exec(block)?.[1];
				const named = sample && /samples\/([A-G]#?\d)v[HL]\.flac/.exec(sample);
				if (!named) continue;
				out.push({ root: midi(named[1]), layer, path: sample });
			}
			return out;
		},
	},
	{
		id: "piano-grand",
		...SALAMANDER,
		seconds: pianoSeconds,
		// Sixteen layers in the source; the 6th and the 14th.
		layers: [
			{ name: "soft", maxVelocity: 0.55, source: "v6" },
			{ name: "loud", maxVelocity: 1, source: "v14" },
		],
	},
	// The same grand with more of it kept, for the principal's second blind
	// round: six of the sixteen layers, stereo, longer tails. About seven
	// times the size of `piano-grand`.
	{
		id: "piano-grand-rich",
		...SALAMANDER,
		seconds: richSeconds,
		channels: 2,
		bitrate: 96000,
		layers: [
			{ name: "pp", maxVelocity: 0.2, source: "v3" },
			{ name: "p", maxVelocity: 0.38, source: "v6" },
			{ name: "mp", maxVelocity: 0.55, source: "v9" },
			{ name: "mf", maxVelocity: 0.7, source: "v11" },
			{ name: "f", maxVelocity: 0.85, source: "v14" },
			{ name: "ff", maxVelocity: 1, source: "v16" },
		],
	},
	// A jazz bass for the piano trio: pizzicato, three dynamics, the first
	// of each note's round robins. The SFZ's own split: p to 74, m to 120.
	{
		id: "bass-pizz",
		instrument:
			"A 1958 Otto Rubner double bass, pizzicato, played and mapped by D. Smolken",
		license: "CC0-1.0",
		licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
		credit: "Double bass (1958 Otto Rubner), pizzicato, by D. Smolken, CC0 1.0",
		repo: "sfzinstruments/dsmolken.double-bass",
		revision: "c2985eb647109d2a8f30a70071e3e163339d7396",
		seconds: () => 4,
		layers: [
			{ name: "p", maxVelocity: 74 / 127, source: "p" },
			{ name: "m", maxVelocity: 120 / 127, source: "m" },
			{ name: "f", maxVelocity: 1, source: "f" },
		],
		async samples(set) {
			// The file names spell flats, which `midi` does not read.
			const roots = {
				c1: 24,
				eb1: 27,
				g1: 31,
				bb1: 34,
				d2: 38,
				f2: 41,
				a2: 45,
				c3: 48,
				e3: 52,
				g3: 55,
				a3: 57,
			};
			return Object.entries(roots).flatMap(([name, root]) =>
				set.layers.map((l) => ({
					root,
					layer: l.name,
					path: `pizz/pizz_${name}_${l.source}a.wav`,
				})),
			);
		},
	},
	{
		id: "piano-vcsl",
		instrument:
			'"Grand Piano, Steinway B" from the Versilian Community Sample Library',
		license: "CC0-1.0",
		licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
		credit:
			"Grand Piano, Steinway B, Versilian Community Sample Library (Versilian Studios), CC0 1.0",
		repo: "sgossner/VCSL",
		revision: "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e",
		seconds: pianoSeconds,
		range: true,
		layers: [
			{ name: "soft", maxVelocity: 0.55, source: "vl2" },
			{ name: "loud", maxVelocity: 1, source: "vl4" },
		],
		// Sampled in whole tones; every other one, major thirds, is enough
		// for a sampler and halves the fetch. The bottom is A#0.
		async samples(set) {
			const roots = [22];
			for (let root = 24; root <= 104; root += 4) roots.push(root);
			return roots.flatMap((root) =>
				set.layers.map((l) => ({
					root,
					layer: l.name,
					path: `Chordophones/Zithers/Grand Piano, Steinway B/Sus/JHPiano_Sus_Close_${nameOf(root)}_${l.source}_rr1.wav`,
				})),
			);
		},
	},
	{
		id: "harpsi-vcsl",
		instrument:
			'"Harpsichord, French" from the Versilian Community Sample Library',
		license: "CC0-1.0",
		licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
		credit:
			"Harpsichord, French, Versilian Community Sample Library (Versilian Studios), CC0 1.0",
		repo: "sgossner/VCSL",
		revision: "c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e",
		seconds: harpsiSeconds,
		range: true,
		layers: [{ name: "normal", maxVelocity: 1 }],
		// Every root the source has, one round-robin. These files name middle
		// C `C3`, which the pitch check confirms.
		async samples() {
			const names = ["D0", "G#0", "A#0"];
			for (let o = 1; o <= 4; o++)
				names.push(...["C", "D", "E", "F#", "G#", "A#"].map((n) => n + o));
			names.push("C5");
			return names.map((n) => ({
				root: midi(n, 3),
				layer: "normal",
				path: `Chordophones/Zithers/Harpsichord, French/Sustains/Harpsi2_Normal_${n}_rr1_Main.wav`,
			}));
		},
	},
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** A source file, from the cache or the network; `bytes` asks for its head. */
async function fetchCached(set, path, url, bytes) {
	const key = sha256(`${set.repo}@${set.revision}/${path}#${bytes ?? "all"}`);
	const cached = join(CACHE, key);
	if (existsSync(cached)) return readFileSync(cached);
	const res = await fetch(
		url,
		bytes ? { headers: { Range: `bytes=0-${bytes - 1}` } } : {},
	);
	if (!(res.ok || res.status === 206))
		throw new Error(`music samples: ${path}: HTTP ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.length < 1024)
		throw new Error(`music samples: ${path}: only ${buf.length} bytes`);
	mkdirSync(CACHE, { recursive: true });
	writeFileSync(cached, buf);
	return buf;
}

const ffmpeg = (args) =>
	execFileSync("ffmpeg", ["-v", "error", "-y", "-nostdin", ...args], {
		stdio: ["ignore", "pipe", "inherit"],
		maxBuffer: 1 << 30,
	});

/** A sample's audio from its attack at `RATE`, as float32 — interleaved
 *  when `channels` is 2. Read
 *  from a file rather than a pipe: ffmpeg stops reading once the cut is
 *  complete, and a pipe it has closed fails the write with EPIPE. */
function decode(buf, seconds, channels = 1) {
	const tmp = join(CACHE, `decode-${process.pid}`);
	writeFileSync(tmp, buf);
	const out = ffmpeg([
		"-i",
		tmp,
		"-af",
		// From 4 ms before the attack, `seconds` long.
		`silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.004,atrim=0:${seconds}`,
		"-ac",
		String(channels),
		"-ar",
		String(RATE),
		"-f",
		"f32le",
		"pipe:1",
	]);
	rmSync(tmp);
	return new Float32Array(out.buffer, out.byteOffset, out.length / 4);
}

/** Interleaved frames summed to one channel, for measuring pitch. */
const mono = (x, channels) => {
	if (channels === 1) return x;
	const y = new Float32Array(x.length / channels);
	for (let i = 0; i < y.length; i++) {
		let v = 0;
		for (let c = 0; c < channels; c++) v += x[i * channels + c];
		y[i] = v / channels;
	}
	return y;
};

/** The fundamental, in MIDI, by normalised autocorrelation after the
 *  attack, searched within an octave and a half of `root`. */
function measurePitch(x, root) {
	const f0 = 440 * 2 ** ((root - 69) / 12);
	const lo = Math.floor(RATE / (f0 * 2.8));
	const hi = Math.ceil(RATE / (f0 / 1.4));
	const a = Math.round(0.08 * RATE);
	const n = Math.min(Math.round(0.3 * RATE), x.length - a - hi - 2);
	if (n < 2 * hi) return null;
	const r = (lag) => {
		let s = 0;
		let e1 = 0;
		let e2 = 0;
		for (let i = 0; i < n; i++) {
			const p = x[a + i];
			const q = x[a + i + lag];
			s += p * q;
			e1 += p * p;
			e2 += q * q;
		}
		return s / Math.sqrt(e1 * e2 + 1e-20);
	};
	const rs = [];
	for (let lag = lo; lag <= hi + 1; lag++) rs[lag] = r(lag);
	// The first lag whose correlation is within 7% of the best: the period,
	// not a multiple of it.
	let best = 0;
	for (let lag = lo + 1; lag <= hi; lag++) best = Math.max(best, rs[lag]);
	for (let lag = lo + 1; lag <= hi; lag++) {
		if (rs[lag] < best * 0.93 || rs[lag] < rs[lag - 1] || rs[lag] < rs[lag + 1])
			continue;
		const [p, q, s] = [rs[lag - 1], rs[lag], rs[lag + 1]];
		const shift = (p - s) / (2 * (p - 2 * q + s) || 1);
		return 69 + 12 * Math.log2(RATE / (lag + shift) / 440);
	}
	return null;
}

const peakDb = (x) => {
	let m = 0;
	for (const v of x) m = Math.max(m, Math.abs(v));
	return 20 * Math.log10(m || 1e-9);
};

/** Float32 at `RATE`, `channels` interleaved, to Ogg Opus at `bitrate`,
 *  faded out over its last `fadeS`.
 *  Through files, as `decode` is: an encode fed through a pipe once sat
 *  waiting on its input after node had written all of it. */
function encode(x, gainDb, fadeS, channels = 1, bitrate = BITRATE) {
	const g = 10 ** (gainDb / 20);
	const y = new Float32Array(x.length);
	const frames = x.length / channels;
	const fade = Math.min(frames, Math.round(fadeS * RATE));
	for (let i = 0; i < x.length; i++) {
		const t = frames - Math.floor(i / channels);
		y[i] = x[i] * g * (t < fade ? t / fade : 1);
	}
	const input = join(CACHE, `encode-${process.pid}.f32`);
	const output = join(CACHE, `encode-${process.pid}.ogg`);
	writeFileSync(input, Buffer.from(y.buffer));
	ffmpeg([
		"-f",
		"f32le",
		"-ar",
		String(RATE),
		"-ac",
		String(channels),
		"-i",
		input,
		"-c:a",
		"libopus",
		"-b:a",
		String(bitrate),
		"-application",
		"audio",
		// Without it the Ogg muxer draws a random stream serial per file, so a
		// rebuild of the same audio changes every byte and every LFS object.
		"-fflags",
		"+bitexact",
		"-f",
		"ogg",
		output,
	]);
	const ogg = readFileSync(output);
	rmSync(input);
	rmSync(output);
	return ogg;
}

/** How many bytes of a 44.1 kHz stereo 24-bit WAV hold `seconds` of audio,
 *  with room for its header and a silent lead-in. */
const wavHead = (seconds) => 65536 + Math.ceil((seconds + 1) * 44100 * 6);

/** A WAV's head cut back to whole frames: a range ends wherever the byte
 *  count does, and a partial last frame is a decoding error. */
function wholeFrames(buf) {
	let at = 12;
	let align = 0;
	while (at + 8 <= buf.length) {
		const id = buf.toString("latin1", at, at + 4);
		const size = buf.readUInt32LE(at + 4);
		if (id === "fmt ") align = buf.readUInt16LE(at + 20);
		if (id === "data") {
			if (!align) break;
			const body = buf.length - (at + 8);
			return buf.subarray(0, at + 8 + body - (body % align));
		}
		at += 8 + size + (size & 1);
	}
	throw new Error("music samples: a WAV head with no fmt and data chunk");
}

async function build(set) {
	const channels = set.channels ?? 1;
	const bitrate = set.bitrate ?? BITRATE;
	const list = await set.samples(set);
	if (!list.length) throw new Error(`music samples: ${set.id}: no samples`);
	const keys = list.map((s) => `${s.root}-${s.layer}`);
	if (new Set(keys).size !== keys.length)
		throw new Error(`music samples: ${set.id}: two samples share a root`);
	const decoded = [];
	const unread = [];
	// Fetched a few at a time: GitHub serves raw files one request each.
	for (let i = 0; i < list.length; i += 6) {
		const batch = list.slice(i, i + 6);
		const bufs = await Promise.all(
			batch.map((s) =>
				fetchCached(
					set,
					s.path,
					raw(set.repo, set.revision, s.path),
					set.range ? wavHead(set.seconds(s.root)) : undefined,
				),
			),
		);
		batch.forEach((s, j) => {
			const x = decode(
				set.range ? wholeFrames(bufs[j]) : bufs[j],
				set.seconds(s.root),
				channels,
			);
			if (x.length / channels < 0.2 * RATE)
				throw new Error(`music samples: ${s.path}: under 0.2 s`);
			const pitch = measurePitch(mono(x, channels), s.root);
			const cents = pitch === null ? null : Math.round((pitch - s.root) * 100);
			const reliable =
				s.root >= PITCH_RELIABLE[0] && s.root <= PITCH_RELIABLE[1];
			const tolerance = reliable ? PITCH_TOLERANCE_CENTS : PITCH_OUTER_CENTS;
			// Where the reading does not hold, a top note too short to read is
			// taken on its name, and counted.
			if (cents === null && !reliable) unread.push(s.path);
			else if (cents === null || Math.abs(cents) > tolerance)
				throw new Error(
					`music samples: ${s.path} is named ${s.root} and measures ${pitch?.toFixed(2) ?? "no pitch"} — refusing to ship it`,
				);
			decoded.push({
				...s,
				x,
				cents: reliable ? cents : null,
				sourceSha256: sha256(bufs[j]),
			});
		});
		process.stdout.write(`\r${set.id}: ${decoded.length}/${list.length}`);
	}
	const gainDb = SET_PEAK_DB - Math.max(...decoded.map((d) => peakDb(d.x)));
	const dir = join(OUT, set.id);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const samples = decoded.map((d) => {
		const file = `${String(d.root).padStart(3, "0")}-${d.layer}.ogg`;
		const seconds = d.x.length / channels / RATE;
		const ogg = encode(
			d.x,
			gainDb,
			Math.min(0.25, seconds / 4),
			channels,
			bitrate,
		);
		writeFileSync(join(dir, file), ogg);
		return {
			root: d.root,
			layer: d.layer,
			file,
			durationS: Number(seconds.toFixed(3)),
			bytes: ogg.length,
			sha256: sha256(ogg),
			measuredCents: d.cents,
			source: d.path,
			sourceSha256: d.sourceSha256,
		};
	});
	const bytes = samples.reduce((n, s) => n + s.bytes, 0);
	const manifest = {
		set: set.id,
		instrument: set.instrument,
		license: set.license,
		licenseUrl: set.licenseUrl,
		credit: set.credit,
		source: `https://github.com/${set.repo}/tree/${set.revision}`,
		format: { container: "ogg", codec: "opus", sampleRate: RATE, channels },
		bitrate,
		gainDb: Number(gainDb.toFixed(2)),
		layers: set.layers.map(({ name, maxVelocity }) => ({ name, maxVelocity })),
		bytes,
		version: sha256(samples.map((s) => s.sha256).join("")).slice(0, 16),
		samples,
	};
	writeFileSync(
		join(dir, "manifest.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);
	writeFileSync(
		join(dir, "LICENSES.txt"),
		`${set.instrument}

${set.credit}
Licence: ${set.license} — ${set.licenseUrl}
Source: ${manifest.source}

The files here are excerpts of that work: each sample cut from its attack to
a few seconds, faded, ${channels === 1 ? "summed to mono" : "kept in stereo"}, scaled by ${manifest.gainDb} dB for
the whole set, and encoded as Ogg Opus at ${bitrate / 1000} kbit/s.
`,
	);
	console.log(
		`\r${set.id}: ${samples.length} samples, ${(bytes / 1048576).toFixed(2)} MiB, gain ${manifest.gainDb} dB, pitch within ${Math.max(...samples.map((s) => Math.abs(s.measuredCents ?? 0)))} cents where measured${unread.length ? `; no pitch read from ${unread.join(", ")}` : ""}`,
	);
	return manifest;
}

const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => !SETS.some((s) => s.id === id));
if (unknown.length) {
	console.error(
		`no set ${unknown.join(", ")}; sets: ${SETS.map((s) => s.id).join(", ")}`,
	);
	process.exit(2);
}
for (const set of SETS.filter((s) => !wanted.length || wanted.includes(s.id)))
	await build(set);
writeFileSync(
	join(OUT, "index.json"),
	`${JSON.stringify(
		SETS.filter((s) => existsSync(join(OUT, s.id, "manifest.json"))).map(
			(s) => s.id,
		),
		null,
		"\t",
	)}\n`,
);

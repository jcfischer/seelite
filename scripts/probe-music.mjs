/**
 * The music synth, rendered offline through the engine's music bus (#560,
 * after #543's D1–D8 and #542's D7).
 *
 *   npm run probe:one probe-music
 *   PRINT=1 node scripts/probe-music.mjs <origin>   # print, assert too
 *
 * A probe can prove the synth loaded, played the score on the frames the
 * score and the transport put its notes on, and rendered at about the right
 * level and brightness. It cannot prove the music *sounds right*: that is
 * `npm run sounds` and the principal's ear.
 *
 * **Bands, never a hash** (#541). The worklet draws its noise from its own
 * stream, so one engine renders one waveform, but a hash would hold only
 * within one engine. The onsets below are read on the **sample index**,
 * measured against the first note of the same render: the render's own start
 * moves with where the offline suspend lands, and the difference does not.
 * They are exact frames, not bands: nothing noisy stands between the line and
 * the first sample a voice writes.
 *
 * What each check is evidence for:
 *
 * - **every music render is in its band** — the worklet loads from the
 *   bundle (#543 D6), the test score plays through the bus at the level,
 *   onset and centroid this branch rendered for the ear. Centred on this
 *   branch's own render, as #544's loops are, so the bands hold the synth to
 *   what the principal listened to and move when the ear moves it.
 * - **a start and a crossfade land on the bar line, to the sample** — D5.
 *   Two probe songs written here: a low pulse on the first beat of every
 *   second bar, and a noise burst on every bar. The second is asked for in
 *   the pulse's first bar and must first sound on its second bar line: on
 *   the line's frame for a start, one frame after it for a crossfade.
 *   **Each has a control that can fail it**: the same request with nothing
 *   playing starts when it arrives, a second earlier, and the row shows that
 *   start is on neither frame.
 * - **after a crossfade the tail has the new song's colour** — the band row
 *   for that render reads the waltz intro's centroid, so the handover is read
 *   on a window long after the fade, beside each song alone.
 * - **a worklet that fails to load names its reason** — D8's promise when it
 *   rejects: the reason reaches `errors`, a waiting `sync` is released, a
 *   `sync` sent after it is refused rather than left to hang, and a second
 *   `attach` loads. `addModule` is refused on purpose to reach it.
 * - **a request made before the worklet is ready is held and played from its
 *   top** — D8.
 * - **a stop now fades, then is silence** — D5's pilot taking the stick back.
 * - **a stem swap changes the colour, and the same render without it does
 *   not** — D5's crossfade between parts, against its own control.
 * - **the music bus is the only level** — #542 D1: music Off is silence,
 *   music at 50% is a quarter of the level, and the ship bus Off leaves music
 *   alone. That is also what shows the worklet's output goes into
 *   `AudioFX.musicInput` and nowhere else.
 * - **the limiter leaves the music alone** — as for every cue.
 *
 * Live unlock, audible beds and docking-waltz integration are checked separately
 * by probe-music-game.mjs (#891). The split changes no offline render window.
 */
import { cueStats, roundStats } from "./lib/audio-stats.mjs";
import { renderInPage, SOUND_SET } from "./lib/sound-set.mjs";
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.argv[2] ?? process.env.PROBE_ORIGIN ?? "http://127.0.0.1:5173",
);
const PRINT = process.env.PRINT === "1";
/** How much of each music render the bands are read off, s. */
const PROBE_RENDER_S = 20;
/** The renders a row reads past that, and so rendered whole. */
const FULL_LENGTH = new Set(["music-adaptive-ladder"]);
const SR = 48000;
/** 120 bpm in 4/4: a bar is two seconds. The probe songs below say so. */
const BAR = 2 * SR;

/**
 * Each music render's figures on this branch (`PRINT=1`), seed-free: the
 * worklet's noise is its own stream. The band is ±10% on rms, peak and
 * centroid, and the onset may be no later than the limiter's 6 ms and a
 * render quantum and a half beside it.
 */
const RENDERED = {
	"music-waltz": { rms: 0.01246, peak: 0.10398, hz: 3970 },
	"music-march": { rms: 0.01469, peak: 0.10292, hz: 1777 },
	"music-crossfade": { rms: 0.01371, peak: 0.10148, hz: 3970 },
	"music-stems": { rms: 0.01124, peak: 0.08342, hz: 542 },
	"music-stop-fade": { rms: 0.01094, peak: 0.10148, hz: 3970 },
	"music-tempo": { rms: 0.01566, peak: 0.10292, hz: 1777 },
	// The second voices open on the drone's three-second swell, so this one
	// carries its own onset, in the band like the rest, rather than the
	// limiter's 10 ms.
	"music-voices": { rms: 0.03047, peak: 0.1775, hz: 700, onset: 51.48 },
	// #548's director renders fade in by design — a crossfade from silence,
	// and a drone's or station pad's slow attack — so each carries its own
	// onset, in the band like the rest, rather than the limiter's 10 ms.
	// Measured on the sequence school, the default bed since PR #1079, over
	// each render's opening `PROBE_RENDER_S`, the ladder whole; the principal
	// has not heard these renders. `-berlin` is the Berlin bed (#600), approved
	// by ear on 2026-09-30, `-second` the second bed (D12) and the `-legacy`
	// rows the first, kept to compare against.
	"music-adaptive-run-a": {
		rms: 0.0119,
		peak: 0.05974,
		hz: 1252,
		onset: 486.1,
	},
	"music-adaptive-run-b": {
		rms: 0.01047,
		peak: 0.04852,
		hz: 1419,
		onset: 514.85,
	},
	"music-adaptive-ladder": {
		rms: 0.02041,
		peak: 0.14116,
		hz: 894,
		onset: 245.9,
	},
	"music-calm": { rms: 0.01377, peak: 0.08052, hz: 894, onset: 245.9 },
	"music-calm-berlin": { rms: 0.01749, peak: 0.11267, hz: 1220, onset: 422.08 },
	"music-calm-second": { rms: 0.02423, peak: 0.12964, hz: 694, onset: 387.94 },
	"music-calm-legacy": { rms: 0.01264, peak: 0.0644, hz: 1104, onset: 298.25 },
	"music-wary": { rms: 0.01083, peak: 0.05401, hz: 481, onset: 262.17 },
	"music-threat": { rms: 0.01374, peak: 0.08957, hz: 429, onset: 249.9 },
	"music-combat": { rms: 0.01775, peak: 0.11183, hz: 2688, onset: 229.08 },
	"music-station-trade-legacy": {
		rms: 0.01045,
		peak: 0.05091,
		hz: 894,
		onset: 494.46,
	},
	"music-station-trade": {
		rms: 0.01241,
		peak: 0.06322,
		hz: 1252,
		onset: 486.1,
	},
	"music-station-refinery": {
		rms: 0.01429,
		peak: 0.07425,
		hz: 1252,
		onset: 486.1,
	},
	"music-station-shipyard": {
		rms: 0.01228,
		peak: 0.0592,
		hz: 1252,
		onset: 486.1,
	},
	"music-station-outpost": {
		rms: 0.01378,
		peak: 0.07832,
		hz: 1252,
		onset: 486.1,
	},
	// #547's orchestral voices alone, and the waltz in its three voicings.
	// Every waltz row is read over its opening 20 s, which is the intro in
	// each, so the rows of one voicing read alike; the intro's strings come
	// in slowly and carry their own onset.
	"voice-strings": { rms: 0.03647, peak: 0.2311, hz: 1434 },
	"voice-brass": { rms: 0.03628, peak: 0.18322, hz: 370 },
	"voice-flute": { rms: 0.0312, peak: 0.1569, hz: 4018 },
	...Object.fromEntries(
		["", "-cancel", "-run-short", "-run-long"].map((s) => [
			`music-danube${s}`,
			{ rms: 0.02767, peak: 0.13663, hz: 2011, onset: 17.15 },
		]),
	),
	...Object.fromEntries(
		["", "-run-short"].flatMap((s) => [
			[
				`music-danube-oxygene${s}`,
				{ rms: 0.02578, peak: 0.12825, hz: 1970, onset: 15.48 },
			],
			[
				`music-danube-hybrid${s}`,
				{ rms: 0.02549, peak: 0.13305, hz: 1970, onset: 15.48 },
			],
		]),
	),
};
/** The limiter's 6 ms look-ahead and a render quantum and a half (4 ms at
 *  48 kHz): 10 ms, as the comment above says. It read 12 for a round, which
 *  let a render 2 ms later than the rule pass (sage round 3). */
const ONSET_MAX_MS = 6 + (1.5 * 128 * 1000) / SR;

/** The two probe songs. The pulse's one note is freed long before the next
 *  bar line, so the render is exact silence there until something starts. */
const PULSE = {
	name: "probe pulse",
	beatsPerBar: 4,
	parts: { p: { voice: "tone", level: 1 } },
	sections: [
		{
			name: "A",
			bars: 2,
			events: [{ part: "p", bar: 0, beat: 0, dur: 0.25, pitch: 45, vel: 1 }],
		},
	],
	tempo: [{ bar: 0, bpm: 120 }],
	loop: { from: "A", to: "A" },
};
const BURST = {
	name: "probe burst",
	beatsPerBar: 4,
	parts: { n: { voice: "noise", level: 1 } },
	sections: [
		{
			name: "A",
			bars: 1,
			events: [{ part: "n", bar: 0, beat: 0, dur: 0.25, pitch: 100, vel: 1 }],
		},
	],
	tempo: [{ bar: 0, bpm: 120 }],
	loop: { from: "A", to: "A" },
};

/** Where the second song is asked for: in the pulse's first bar. */
const ASK_S = 0.9;
/** How far past its line each note must first sound, in frames — exactly: 0
 *  for a start, 1 for a crossfade, whose gain is 0 on the line itself. One
 *  band for both let a start one frame late pass (sage round 1). */
const ONSET_AFTER_LINE = { play: 0, crossfade: 1 };

const browser = await launchChromium();
const { check, watch, exit } = tally();
try {
	const page = await browser.newPage();
	watch(page);
	await page.goto(`${origin}/__seelite/tree`);
	const renderRaw = (entry, opts = {}) =>
		page.evaluate(renderInPage, { entry, sampleRate: SR, ...opts });
	const probeEntry = (name, seconds, script) => ({
		name,
		seconds,
		music: { songs: { pulse: PULSE, burst: BURST }, script },
	});

	// ── Every render of the test score, in its band ─────────────────────────
	const MUSIC = SOUND_SET.filter((e) => e.music);
	check(
		"every music render has a band",
		MUSIC.every((e) => RENDERED[e.name]) &&
			Object.keys(RENDERED).length === MUSIC.length,
		MUSIC.map((e) => e.name).join(", "),
	);
	const rendered = new Map();
	// A scripted render cut to its opening drops the commands past the cut
	// (#547): the waltz resolves at 62 s and later, and an offline context
	// refuses a suspend at or past its end.
	const opening = (entry) => {
		const seconds = Math.min(entry.seconds, PROBE_RENDER_S);
		const script = entry.music.script?.filter(
			([t]) => t === "attach" || t < seconds,
		);
		return {
			...entry,
			seconds,
			music: script ? { ...entry.music, script } : entry.music,
		};
	};
	for (const entry of MUSIC) {
		// The band is read off the render's opening `PROBE_RENDER_S`: the sound
		// set's listening renders run to minutes, and all of them whole
		// outlasted probe-all's ten-minute limit (#548). The ladder keeps its
		// length, because a row below reads all four of its levels.
		const r = await renderRaw(
			FULL_LENGTH.has(entry.name) ? entry : opening(entry),
		);
		check(
			`${entry.name} renders through the synth`,
			!r.absent && r.errors?.length === 0,
			r.absent ? "absent: no music.ts served" : (r.errors ?? []).join("; "),
		);
		if (r.absent) continue;
		rendered.set(entry.name, r.samples);
		const s = cueStats(r.samples, SR);
		if (PRINT)
			console.log(JSON.stringify({ name: entry.name, ...roundStats(s) }));
		const m = RENDERED[entry.name];
		if (!m) continue;
		const within = (v, c) => v >= c * 0.9 && v <= c * 1.1;
		check(
			`${entry.name} renders in its band`,
			within(s.rms, m.rms) &&
				within(s.peak, m.peak) &&
				within(s.centroidHz, m.hz) &&
				(m.onset === undefined
					? s.onsetMs >= 0 && s.onsetMs <= ONSET_MAX_MS
					: within(s.onsetMs, m.onset)),
			`rms ${s.rms.toFixed(5)} peak ${s.peak.toFixed(5)} onset ${s.onsetMs.toFixed(2)} ms centroid ${Math.round(s.centroidHz)} Hz`,
		);
	}

	// ── Onsets on the line, to the sample ───────────────────────────────────
	/** Every sample index where sound begins after at least `gapS` of exact
	 *  silence: the renders below are silence between notes, so a note's
	 *  first non-zero sample is its onset, with no threshold to argue over. */
	const onsets = (x, gapS = 0.3) => {
		const out = [];
		let quiet = Number.POSITIVE_INFINITY;
		for (let i = 0; i < x.length; i++) {
			if (x[i] !== 0) {
				if (quiet >= gapS * SR) out.push(i);
				quiet = 0;
			} else quiet++;
		}
		return out;
	};
	/** Rms of the first difference over a window from `i`: a crude high-pass,
	 *  which a noise burst has and a 110 Hz pulse barely does. */
	const bright = (x, i, n = 960) => {
		let s = 0;
		let e = 0;
		for (let k = i + 1; k < i + n; k++) {
			const d = x[k] - x[k - 1];
			s += d * d;
			e += x[k] * x[k];
		}
		return e > 0 ? Math.sqrt(s / e) : 0;
	};
	const onLine = (d) => Object.values(ONSET_AFTER_LINE).includes(d);

	// ── #548: the ladder gets busier as the danger rises ────────────────────
	// The ladder rises calm, wary, threat, combat at 18 s each. The level does
	// not separate them — on the first bed the pad set both level and
	// brightness — so this counts transients: 10 ms frames of the first
	// difference's energy that jump past twice the mean of the four before.
	// Threat's hats and acid and combat's kit and sixteenths are what it
	// hears. On the second bed calm read 0.00/s — its slow attacks and long
	// reverb made no jumps — so a ratio to calm alone would pass anything:
	// each level also has a floor of its own, and combat must be busier than
	// the threat. The Berlin bed's calm reads about 0.7/s under its noise
	// wash (#600), and so does wary, so wary is still left to the ear.
	// **A held note outlives a jump**: the Berlin wash's first 32-bar notes
	// rang on into the threat and read it at 0.06/s here.
	const ladder = rendered.get("music-adaptive-ladder");
	if (ladder) {
		const perS = (a, b) => {
			const F = SR / 100;
			const e = [];
			for (let k = a * SR; k + F < b * SR; k += F) {
				let q = 0;
				for (let j = k + 1; j < k + F; j++) {
					const d = ladder[j] - ladder[j - 1];
					q += d * d;
				}
				e.push(q);
			}
			let n = 0;
			for (let i = 5; i < e.length; i++) {
				const jump = (j) =>
					e[j] > (e[j - 1] + e[j - 2] + e[j - 3] + e[j - 4]) / 2;
				if (jump(i) && !jump(i - 1)) n++;
			}
			return n / (b - a);
		};
		const calmRate = perS(6, 18);
		const threatRate = perS(38, 54);
		const fightRate = perS(56, 72);
		check(
			"the ladder's threat and combat are busier than its calm (#548)",
			threatRate >= Math.max(1, 2 * calmRate) &&
				fightRate >= Math.max(3, 4 * calmRate) &&
				fightRate > threatRate,
			`transients/s calm ${calmRate.toFixed(2)}, wary ${perS(20, 36).toFixed(2)}, threat ${threatRate.toFixed(2)}, combat ${fightRate.toFixed(2)}`,
		);
	}
	/** Rms over a window in seconds, or the whole buffer: one body for every
	 *  row that reads a level (sage round 4). */
	const rmsOf = (x, a = 0, b = x.length / SR) => {
		const i0 = Math.round(a * SR);
		const i1 = Math.round(b * SR);
		let s = 0;
		for (let i = i0; i < i1; i++) s += x[i] * x[i];
		return Math.sqrt(s / (i1 - i0));
	};

	for (const [row, ask] of [
		[
			"a start while a song plays sounds first on its next bar line",
			{ type: "play", id: "burst", at: "bar" },
		],
		[
			"a crossfade's new song sounds first on the playing song's next bar line",
			{ type: "crossfade", to: "burst", at: "bar", fadeS: 0.5 },
		],
	]) {
		const r = await renderRaw(
			probeEntry(row, 5, [
				[0, { type: "play", id: "pulse", at: "bar" }],
				[ASK_S, ask],
			]),
		);
		const o = onsets(r.samples);
		// The pulse's top, then the burst on every bar from the line on. The
		// pulse is a sine from phase 0, so its first frame is exactly 0 and its
		// first sound is one frame after its top; the burst's noise is not.
		const lineAt = o[0] - 1 + BAR;
		const d = o[1] - lineAt;
		const noise = o[1] !== undefined && bright(r.samples, o[1]) > 0.5;
		const pulse = bright(r.samples, o[0]) < 0.2;
		check(
			row,
			o.length >= 2 && d === ONSET_AFTER_LINE[ask.type] && noise && pulse,
			`onsets ${o.slice(0, 3).join(", ")}; the burst ${d} frames after the line (wanted ${ONSET_AFTER_LINE[ask.type]}); brightness ${bright(r.samples, o[0]).toFixed(3)} then ${bright(r.samples, o[1]).toFixed(3)}`,
		);
		if (ask.type === "crossfade") {
			// Two bars in, the pulse would sound again had it not been faded
			// out and let go: that onset must be the burst's alone.
			const two = o.find((i) => i >= o[0] + 2 * BAR - 4);
			check(
				"after the crossfade the old song is gone",
				two !== undefined && bright(r.samples, two) > 0.5,
				`onset at ${two}, brightness ${two === undefined ? "-" : bright(r.samples, two).toFixed(3)}`,
			);
		}
	}
	// The control: the same request with nothing playing is not quantised,
	// so it starts when it arrives — and the band above would refuse it.
	{
		const r = await renderRaw(
			probeEntry("control", 3, [
				[ASK_S, { type: "play", id: "burst", at: "bar" }],
			]),
		);
		const o = onsets(r.samples);
		const arrivedS = o[0] / SR;
		const d = o[0] - BAR;
		check(
			"control: with nothing playing the same start is heard when asked, on neither line frame",
			o.length >= 1 && Math.abs(arrivedS - ASK_S) < 0.02 && !onLine(d),
			`first onset ${arrivedS.toFixed(4)} s, ${d} frames from where a line would be`,
		);
	}

	// ── A worklet that fails to load says why, and can be tried again ──────
	{
		const r = await page.evaluate(async () => {
			const { Music } = await import("/src/music.ts");
			const music = new Music();
			const refused = new OfflineAudioContext(1, 128, 48000);
			refused.audioWorklet.addModule = () =>
				Promise.reject(new Error("probe refusal"));
			let syncError = null;
			const waiting = music.sync().catch((e) => {
				syncError = e.message;
			});
			await music.attach(refused, refused.destination).catch(() => {});
			await waiting;
			const failed = { errors: [...music.errors], ready: music.ready };
			// A sync after the failure, with no retry yet, is refused at once.
			const late = await music.sync().then(
				() => "answered",
				(e) => e.message,
			);
			const good = new OfflineAudioContext(1, 128, 48000);
			await music.attach(good, good.destination);
			return { failed, syncError, late, retried: music.ready };
		});
		check(
			"a worklet that fails to load names its reason, releases a waiting sync, refuses a later one, and loads on the next attach",
			r.failed.ready === false &&
				r.failed.errors.length === 1 &&
				r.failed.errors[0].includes("probe refusal") &&
				r.syncError === "probe refusal" &&
				r.late === "probe refusal" &&
				r.retried === true,
			JSON.stringify(r),
		);
	}

	// ── D8: a request before ready is held, and plays from the top ─────────
	{
		const r = await renderRaw(
			probeEntry("held", 1, [
				["attach", { type: "play", id: "pulse", at: "bar" }],
			]),
			// From the context's first frame, and past the limiter's look-ahead,
			// so the frame read is the worklet's own.
			{ leadS: 0, bypassLimiter: true },
		);
		const o = onsets(r.samples, 0);
		// On the first quantum; a sine's first frame is 0, so frame 1.
		check(
			"a start asked for before the worklet is ready is held and played from its top",
			o.length >= 1 && o[0] === 1 && r.errors.length === 0,
			`first onset at frame ${o[0]}`,
		);
	}

	// ── Stop now: a fade, then silence ──────────────────────────────────────
	{
		const x = rendered.get("music-stop-fade") ?? new Float32Array(0);
		const peakIn = (a, b) => {
			let p = 0;
			for (let i = Math.round(a * SR); i < Math.round(b * SR); i++)
				p = Math.max(p, Math.abs(x[i]));
			return p;
		};
		// Stopped at 3.2 s over 0.8 s; the limiter's 6 ms beside it. A
		// render that did not happen reads as empty and fails the row rather
		// than throwing past it (sage round 5).
		const before = rmsOf(x, 2.6, 3.2);
		const during = rmsOf(x, 3.6, 3.95);
		check(
			"a stop now fades rather than cuts, and is silence once the fade has run",
			x.length > 0 &&
				during > 0 &&
				during < before * 0.6 &&
				peakIn(4.05, 6) === 0,
			x.length === 0
				? "music-stop-fade did not render"
				: `rms ${before.toFixed(5)} before, ${during.toFixed(5)} in the fade's tail, peak ${peakIn(4.05, 6)} after`,
		);
	}

	/** `bright` over a window given in seconds: one body for the metric, so
	 *  the rows that read colour cannot diverge (sage round 1). It is a ratio
	 *  to the rms, so a level change does not move it and a change of colour
	 *  does. */
	const hi = (x, a, b) =>
		bright(x, Math.round(a * SR), Math.round(b * SR) - Math.round(a * SR));

	// ── After a crossfade, the new song's colour and not the old one's ──────
	{
		// The band row above reads the waltz intro's centroid for this render,
		// as for the waltz alone, so the handover is read here: the tail, long
		// after the fade, beside the march alone and the waltz alone.
		const tail = hi(rendered.get("music-crossfade"), 6.5, 9.9);
		const march = hi(rendered.get("music-march"), 1, 4.4);
		const waltz = hi(rendered.get("music-waltz"), 6.5, 9.9);
		check(
			"after a crossfade the tail has the new song's colour, not the old one's",
			Math.abs(tail / march - 1) < 0.15 && Math.abs(tail / waltz - 1) > 0.3,
			`brightness ${tail.toFixed(4)}; the march alone ${march.toFixed(4)}, the waltz alone ${waltz.toFixed(4)}`,
		);
	}

	// ── A stem swap, against the same render without one ────────────────────
	{
		const stems = rendered.get("music-stems");
		const march = rendered.get("music-march");
		// The swap is asked at 3.5 s and lands on the march's next line; the
		// lead alone before, the arpeggio alone after its 1.5 s fade.
		const swapped = hi(stems, 6, 7.9) / hi(stems, 1, 3.4);
		const control = hi(march, 6, 7.9) / hi(march, 1, 3.4);
		check(
			"a stem swap changes the colour, and the same render without one does not",
			swapped > 1.5 && Math.abs(control - 1) < 0.25,
			`brightness after/before x${swapped.toFixed(2)}, the march alone x${control.toFixed(2)}`,
		);
	}

	// ── The music bus is the only level ─────────────────────────────────────
	{
		const march = SOUND_SET.find((e) => e.name === "music-march");
		const full = rmsOf(rendered.get("music-march"));
		const off = rmsOf(
			(await renderRaw(march, { levels: { music: 0 } })).samples,
		);
		const half = rmsOf(
			(await renderRaw(march, { levels: { music: 0.5 } })).samples,
		);
		const ship = rmsOf(
			(await renderRaw(march, { levels: { ship: 0 } })).samples,
		);
		check(
			"music Off is silence, and 50% is a quarter of the level",
			off === 0 && Math.abs(half / full - 0.25) < 0.01,
			`off ${off}, half x${(half / full).toFixed(4)}`,
		);
		check(
			"the ship bus Off leaves the music alone",
			Math.abs(ship / full - 1) < 1e-6,
			`x${(ship / full).toFixed(6)}`,
		);
		const bypass = rmsOf(
			(
				await renderRaw(
					SOUND_SET.find((e) => e.name === "music-waltz"),
					{
						bypassLimiter: true,
					},
				)
			).samples,
		);
		const waltz = rmsOf(rendered.get("music-waltz"));
		check(
			"the limiter leaves the music alone",
			Math.abs(waltz / bypass - 1) <= 0.01,
			`rms x${(waltz / bypass).toFixed(4)}`,
		);
	}
} finally {
	await browser.close();
}
exit();

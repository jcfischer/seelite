/**
 * Every cue, rendered offline through the engine, held in bands (#552, after
 * #542's D7).
 *
 *   npm run probe:one probe-audio-cues
 *   PRINT=1 node scripts/probe-audio-cues.mjs <origin>   # print, assert too
 *
 * A probe can prove a cue fired and rendered to something of about the right
 * level, onset and brightness. It cannot prove the cue *sounds right*: that
 * is the before/after capture (`npm run sounds`) and the principal's ear.
 *
 * **Bands, never a hash** (#541, and the map's Constraints). Each cue is
 * rendered with a seeded `Math.random` (`renderInPage`'s `seed`), so one
 * engine gives one waveform; the bands are wide enough to hold across the seeds
 * a later sound node might pick. What that width lets through is stated
 * rather than implied: a tone-only cue (scoop, alert, ui, the hum) falls out
 * past ±10% in level; a noise one-shot only below ×0.8 or above ×1.25; the
 * bed only below ×0.7 or above ×1.4. A one-shot routed nowhere falls out of
 * every band. **A flight timeline does not**: its level is mostly the hum, so a
 * thruster loop that vanished leaves it inside the bed's band. Those loops are
 * held by the windowed rows below instead, each a window where the loop plays
 * against one where it does not, on the same seed. A smaller change of level is
 * the capture's to show, not this probe's.
 *
 * **A centroid is a poor ear for pitch.** A square wave's centroid is set by
 * its harmonics up to the 16 kHz cap more than by its fundamental: the laser
 * an octave up moved it 10%, from 4178 to 4590 Hz, which is why the noise
 * cues' centroid band is ±7% and not wider. A smaller change of pitch passes
 * here. The capture is what shows one: `npm run sounds` at two refs renders
 * the pair sample for sample.
 *
 * What each check is evidence for:
 *
 * - **every cue renders in its band** — the offline seam builds the whole
 *   graph (buses, master, limiter) and every cue reaches the speakers at the
 *   level, onset and centroid it had before #552. The bands are centred on
 *   what `origin/main`'s engine renders, read with `npm run sounds` at both refs.
 * - **the limiter leaves one cue alone** — the same seeded cue with and
 *   without the limiter, level and peak within 1%. #552 put a
 *   `DynamicsCompressorNode` on master, and a threshold below full scale
 *   lifts every cue by its makeup gain.
 * - **master Off is silence, a bus Off silences only its own cues** — D2.
 * - **a burst holds at the cap** — thirty explosions one render quantum apart
 *   leave no more voices sounding than the hits cap, and ring on after the
 *   last one well below the same burst with the caps lifted; D4 in a browser.
 *   The control arm and the leadless start are reached by patching the
 *   engine's private `pool` and `master` (`renderInPage`), which `tsc` does
 *   not see in a script, so `renderInPage` throws if either is missing.
 *
 * `window.__seelite` is not needed and the game is not booted: the page is
 * the dev server's tree declaration, which is enough of an origin for
 * `import("/src/audio.ts")` to be served.
 */
import { cueStats, roundStats } from "./lib/audio-stats.mjs";
import { renderInPage, SOUND_SET } from "./lib/sound-set.mjs";
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.argv[2] ?? process.env.PROBE_ORIGIN ?? "http://127.0.0.1:5173",
);
const PRINT = process.env.PRINT === "1";
const SR = 48000;
const SEED = Number(process.env.SEED ?? 552);

/**
 * What each cue rendered to on the engine before #552 — `origin/main` at
 * dafaaee, `npm run sounds -- --ref origin/main`, seed 552, half a second in.
 * The bands below are centred here, so a cue that moves from the sound it had
 * before the buses is a red run. This branch rendered every one of them to
 * within one 16-bit step of these, 6.00 ms later: the limiter's look-ahead.
 *
 * `noise` marks a cue with a noise part, whose figures move with the seed:
 * over seeds 1–3 and 552, rms moved up to 8%, peak up to 25% and the centroid
 * up to 4% on the one-shots, and the bed's centroid up to 24%.
 */
const MAIN = {
	laser: { rms: 0.00665, peak: 0.05579, onsetMs: 1.38, hz: 4178, noise: 1 },
	hit: { rms: 0.00751, peak: 0.09217, onsetMs: 1.42, hz: 964, noise: 1 },
	explosion: { rms: 0.02017, peak: 0.18945, onsetMs: 1.44, hz: 447, noise: 1 },
	dock: { rms: 0.01099, peak: 0.09732, onsetMs: 1.46, hz: 314, noise: 1 },
	scoop: { rms: 0.00578, peak: 0.08455, onsetMs: 5.71, hz: 970 },
	alert: { rms: 0.00957, peak: 0.11481, onsetMs: 5.15, hz: 3308 },
	ui: { rms: 0.00416, peak: 0.04357, onsetMs: 6.06, hz: 3333 },
	"witchspace-hum": { rms: 0.01163, peak: 0.10742, onsetMs: 358.83, hz: 160 },
	"witchspace-sweep": {
		rms: 0.00993,
		peak: 0.10481,
		onsetMs: 1.38,
		hz: 2865,
		noise: 1,
	},
	"bed-idle": { rms: 0.00193, peak: 0.00858, onsetMs: 87.54, hz: 181, bed: 1 },
	"bed-full": { rms: 0.0215, peak: 0.09143, onsetMs: 21.27, hz: 208, bed: 1 },
};

/**
 * #544's cues and loops, which `origin/main` does not have: centred on this
 * branch's render after the principal's first listen (`npm run sounds --
 * --label after3`, seed 552). So these bands hold the prototype to what the
 * principal listens to, and move when the ear moves it. Every flight timeline takes the bed's wide band:
 * each carries noise loops, and most carry clicks, whose count moves with the
 * seed.
 */
const SINCE_544 = {
	"cruise-engage": {
		rms: 0.01988,
		peak: 0.17615,
		onsetMs: 7.38,
		hz: 2698,
		noise: 1,
	},
	"cruise-drop": {
		rms: 0.01384,
		peak: 0.17882,
		onsetMs: 7.35,
		hz: 3424,
		noise: 1,
	},
	"flight-idle": {
		rms: 0.00581,
		peak: 0.02582,
		onsetMs: 50.23,
		hz: 250,
		bed: 1,
	},
	"flight-burn-thrust": {
		rms: 0.02198,
		peak: 0.12535,
		onsetMs: 50.23,
		hz: 250,
		bed: 1,
	},
	"flight-burn-lever": {
		rms: 0.03313,
		peak: 0.136,
		onsetMs: 50.23,
		hz: 250,
		bed: 1,
	},
	"flight-rcs": {
		rms: 0.0067,
		peak: 0.03753,
		onsetMs: 50.23,
		hz: 250,
		bed: 1,
	},
	"flight-rcs-norcs": {
		rms: 0.00596,
		peak: 0.02582,
		onsetMs: 50.23,
		hz: 250,
		bed: 1,
	},
	"flight-cruise-shimmer": {
		rms: 0.01739,
		peak: 0.21012,
		onsetMs: 50.23,
		hz: 250,
		bed: 1,
	},
	"flight-cruise-throb": {
		rms: 0.01832,
		peak: 0.20827,
		onsetMs: 50.23,
		hz: 250,
		bed: 1,
	},
	"flight-cooling-clicks": {
		rms: 0.02335,
		peak: 0.14381,
		onsetMs: 14.98,
		hz: 300,
		bed: 1,
	},
	"flight-damaged-clicks": {
		rms: 0.00543,
		peak: 0.05457,
		onsetMs: 50.23,
		hz: 250,
		bed: 1,
	},
	"flight-docked": {
		rms: 0.00268,
		peak: 0.01162,
		onsetMs: 76.27,
		hz: 371,
		bed: 1,
	},
	"flight-stack": {
		rms: 0.03692,
		peak: 0.23484,
		onsetMs: 8.92,
		hz: 4543,
		bed: 1,
	},
};

/**
 * Each cue's band: rms, peak and centroid as `[low, high]`, and the latest
 * onset in ms. A tone-only cue renders the same waveform on every seed, so
 * its band is ±10%; a noise cue's is wide enough for the seed's own spread
 * above, and the bed's wider again. The onset allows the limiter's 6 ms and
 * as much again, which is the order of a render quantum's rounding.
 */
const BANDS = Object.fromEntries(
	Object.entries({ ...MAIN, ...SINCE_544 }).map(([name, m]) => {
		const [lo, hi] = m.bed ? [0.7, 1.4] : m.noise ? [0.8, 1.25] : [0.9, 1.1];
		const [plo, phi] = m.bed || m.noise ? [0.6, 1.6] : [0.9, 1.1];
		const [clo, chi] = m.bed ? [0.6, 1.5] : m.noise ? [0.93, 1.07] : [0.9, 1.1];
		return [
			name,
			{
				rms: [m.rms * lo, m.rms * hi],
				peak: [m.peak * plo, m.peak * phi],
				onsetMs: m.onsetMs + (m.bed ? 60 : 12),
				centroidHz: [m.hz * clo, m.hz * chi],
			},
		];
	}),
);

/** The most of an uncapped burst's ring a capped one may reach. Read at
 *  0.52 on the build that made the pool. */
const BURST_MAX_OF_UNCAPPED = 0.7;

/** The least a loop's window may stand over its quiet window (#544). */
const LOOP_MIN_RATIO = 1.5;

const browser = await launchChromium();
const { check, watch, exit } = tally();
try {
	const page = await browser.newPage();
	watch(page);
	await page.goto(`${origin}/__seelite/tree`);
	const render = async (entry, opts = {}) => {
		const r = await page.evaluate(renderInPage, {
			entry,
			sampleRate: SR,
			seed: SEED,
			...opts,
		});
		return { modern: r.modern, ...cueStats(r.samples, SR) };
	};
	const first = await render(SOUND_SET[0]);
	check("the served engine has the offline seam", first.modern === true);

	const rendered = new Map();
	for (const entry of SOUND_SET) {
		const s = await render(entry);
		rendered.set(entry.name, s);
		if (PRINT)
			console.log(JSON.stringify({ name: entry.name, ...roundStats(s) }));
		const band = BANDS[entry.name];
		check(`${entry.name} has a band`, band !== undefined);
		if (!band) continue;
		const within = (v, [lo, hi]) => v >= lo && v <= hi;
		check(
			`${entry.name} renders in its band`,
			within(s.rms, band.rms) &&
				within(s.peak, band.peak) &&
				s.onsetMs >= 0 &&
				s.onsetMs <= band.onsetMs &&
				within(s.centroidHz, band.centroidHz),
			`rms ${s.rms.toFixed(4)} peak ${s.peak.toFixed(4)} onset ${s.onsetMs.toFixed(1)} ms centroid ${Math.round(s.centroidHz)} Hz`,
		);
	}

	for (const entry of SOUND_SET) {
		const on = rendered.get(entry.name);
		const off = await render(entry, { bypassLimiter: true });
		const ratio = (a, b) => (b > 0 ? a / b : Number.NaN);
		const rms = ratio(on.rms, off.rms);
		const peak = ratio(on.peak, off.peak);
		check(
			`the limiter leaves ${entry.name} alone`,
			Math.abs(rms - 1) <= 0.01 && Math.abs(peak - 1) <= 0.01,
			`rms x${rms.toFixed(4)} peak x${peak.toFixed(4)} onset ${on.onsetMs.toFixed(2)} against ${off.onsetMs.toFixed(2)} ms`,
		);
	}

	// #544's loops, each by a window where it plays against one where it does
	// not. Whole-timeline figures cannot see one vanish: the hum carries them.
	const raw = async (name, opts = {}) =>
		(
			await page.evaluate(renderInPage, {
				entry: SOUND_SET.find((e) => e.name === name),
				sampleRate: SR,
				seed: SEED,
				...opts,
			})
		).samples;
	// `high`: rms of the first difference, a crude high-pass. The thrusters
	// are a hiss near 2.6 kHz and the hum is under 300 Hz, so a plain rms of
	// that window is mostly hum and read the hiss at only x1.33.
	const windowRms = (samples, [a, b], high = false) => {
		let w = samples.slice(Math.round(a * SR), Math.round(b * SR));
		if (high) w = w.slice(1).map((v, i) => v - w[i]);
		return Math.sqrt(w.reduce((sum, v) => sum + v * v, 0) / w.length);
	};
	const loopRows = [
		// [row, loud timeline, window, quiet timeline, window, high-passed?]
		[
			"the thrusters are heard while they fire",
			"flight-rcs",
			[0.35, 0.8],
			"flight-rcs-norcs",
			[0.35, 0.8],
			true,
		],
		[
			"a burn is heard over the hum",
			"flight-burn-thrust",
			[1, 3],
			"flight-burn-thrust",
			[4.5, 6],
		],
		[
			"the wind-up is heard before cruise",
			"flight-cruise-shimmer",
			[2.5, 3.4],
			"flight-cruise-shimmer",
			[0, 0.45],
		],
		[
			"the shimmer bed is heard in cruise",
			"flight-cruise-shimmer",
			[5, 8],
			"flight-cruise-shimmer",
			[0, 0.45],
		],
		[
			"the throb bed is heard in cruise",
			"flight-cruise-throb",
			[5, 8],
			"flight-cruise-throb",
			[0, 0.45],
		],
		// The principal's first listen: the bed must follow the speed. At the
		// cap against just after the engage, high-passed, because what speed
		// moves is the pitch of the rush and the band, not only the level.
		[
			"the cruise bed rises with the speed",
			"flight-cruise-shimmer",
			[6.6, 7.4],
			"flight-cruise-shimmer",
			[4.4, 4.8],
			true,
		],
	];
	const renders = new Map();
	const samplesOf = async (name) => {
		if (!renders.has(name)) renders.set(name, await raw(name));
		return renders.get(name);
	};
	for (const [row, loud, lw, quiet, qw, high] of loopRows) {
		const ratio =
			windowRms(await samplesOf(loud), lw, high) /
			windowRms(await samplesOf(quiet), qw, high);
		check(row, ratio > LOOP_MIN_RATIO, `window rms x${ratio.toFixed(2)}`);
	}
	const idleMuted = await Promise.all(
		[{ master: 0 }, { ship: 0 }].map((levels) =>
			raw("flight-idle", { levels }),
		),
	);
	check(
		"master Off and ship Off each silence the flight loops",
		idleMuted.every((x) => x.every((v) => v === 0)),
	);

	const laser = SOUND_SET.find((e) => e.name === "laser");
	const alert = SOUND_SET.find((e) => e.name === "alert");
	const bed = SOUND_SET.find((e) => e.name === "bed-full");
	const muted = await Promise.all(
		[laser, alert, bed].map((e) => render(e, { levels: { master: 0 } })),
	);
	check(
		"master Off renders silence for a cue on every bus and for the bed",
		muted.every((s) => s.peak === 0),
		muted.map((s) => s.peak).join(", "),
	);
	const combatOff = { levels: { combat: 0 } };
	const laserOff = await render(laser, combatOff);
	const alertOn = await render(alert, combatOff);
	check(
		"combat Off silences the laser and leaves the alert",
		laserOff.peak === 0 && alertOn.peak > 0.01,
		`laser ${laserOff.peak}, alert ${alertOn.peak.toFixed(4)}`,
	);
	const half = await render(alert, { levels: { console: 0.5 } });
	const full = await render(alert);
	check(
		"a 50% bus is a quarter of the gain",
		Math.abs(half.rms / full.rms - 0.25) < 0.005,
		`x${(half.rms / full.rms).toFixed(4)}`,
	);

	// A burst of explosions, spread one render quantum apart — as fast as the
	// page can play cues, and faster than any path in the game fires one. The
	// explosion because it rings for most of a second: a laser's own envelope
	// has decayed before the next one lands, so thirty lasers and four sound
	// alike after the attack, and a level check on them passes whether the pool
	// works or not. At one instant thirty identical tones would sum in phase,
	// which tests arithmetic rather than the pool.
	const explosion = SOUND_SET.find((e) => e.name === "explosion");
	const caps = await page.evaluate(async () => {
		const cue = await import("/src/audio-cue.ts");
		return cue.VOICE_CAPS;
	});
	const burstOf = (uncapped) =>
		page.evaluate(renderInPage, {
			entry: explosion,
			sampleRate: SR,
			seed: SEED,
			repeat: 30,
			spacingS: 128 / SR,
			uncapped,
		});
	const burst = await burstOf(false);
	const open = await burstOf(true);
	check(
		"a burst of thirty explosions leaves no more voices sounding than the hits cap",
		burst.live !== null && burst.live <= caps.hits,
		`${burst.live} sounding, cap ${caps.hits}; ${open.live} with no caps`,
	);
	// From the last one on: what the pool removes is the pile of tails.
	const tail = (r) =>
		cueStats(r.samples.slice(Math.round(29 * 128 + 0.02 * SR)), SR).rms;
	const burstStats = cueStats(burst.samples, SR);
	check(
		"and after the last one it rings well below the same burst with no caps",
		tail(burst) < tail(open) * BURST_MAX_OF_UNCAPPED,
		`tail rms ${tail(burst).toFixed(4)} against ${tail(open).toFixed(4)} with no caps`,
	);
	check("and it does not clip", burstStats.peak < 1, `peak ${burstStats.peak}`);
} finally {
	await browser.close();
}
exit();

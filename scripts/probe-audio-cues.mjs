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
 * engine gives one waveform; the bands are wide enough to hold across engines
 * and across the seeds a later sound node might pick, and narrow enough that a
 * cue routed nowhere, doubled, or turned into a different sound falls out.
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
 * - **a burst holds at the cap** — thirty lasers at one instant render at
 *   about the level of the weapons cap's worth, not thirty; D4 in a browser.
 *
 * `window.__seelite` is not needed and the game is not booted: the page is
 * the dev server's tree declaration, which is enough of an origin for
 * `import("/src/audio.ts")` to be served.
 */
import { cueStats } from "./lib/audio-stats.mjs";
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
 * Each cue's band: rms, peak and centroid as `[low, high]`, and the latest
 * onset in ms. A tone-only cue renders the same waveform on every seed, so
 * its band is ±10%; a noise cue's is wide enough for the seed's own spread
 * above, and the bed's wider again. The onset allows the limiter's 6 ms and
 * as much again, which is the order of a render quantum's rounding.
 */
const BANDS = Object.fromEntries(
	Object.entries(MAIN).map(([name, m]) => {
		const [lo, hi] = m.bed ? [0.7, 1.4] : m.noise ? [0.8, 1.25] : [0.9, 1.1];
		const [plo, phi] = m.bed || m.noise ? [0.6, 1.6] : [0.9, 1.1];
		const [clo, chi] = m.bed ? [0.6, 1.5] : m.noise ? [0.85, 1.15] : [0.9, 1.1];
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

	for (const entry of SOUND_SET) {
		const s = await render(entry);
		if (PRINT)
			console.log(
				JSON.stringify({
					name: entry.name,
					rms: +s.rms.toFixed(5),
					peak: +s.peak.toFixed(5),
					onsetMs: +s.onsetMs.toFixed(2),
					centroidHz: Math.round(s.centroidHz),
				}),
			);
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
		const on = await render(entry);
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

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
 * - **the heavy arm carries weight, and thin is the sound it had** (#577) —
 *   every band above is read on `?punch=thin`, so a heavy voice that leaked
 *   into the thin arm is a red run on the cue it touched. The weighted cues
 *   render again on `heavy` in bands of their own, each must stand clear of
 *   its thin render under 250 Hz, and the order of the hits by level holds:
 *   an explosion over a hull hit over a shield hit over a hit landed.
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
 * branch's own render (`npm run sounds -- --label after6`, seed 552), taken
 * after the principal's third listen and sage round 1's write fix and round 2's shared
 * noise buffers. So these bands hold the prototype to what
 * the principal listens to, and move when the ear moves it. Every flight timeline takes the bed's wide band:
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
		rms: 0.00586,
		peak: 0.02802,
		onsetMs: 46.48,
		hz: 292,
		bed: 1,
	},
	"flight-burn-thrust": {
		rms: 0.02247,
		peak: 0.12011,
		onsetMs: 46.48,
		hz: 292,
		bed: 1,
	},
	"flight-burn-lever": {
		rms: 0.03367,
		peak: 0.13459,
		onsetMs: 46.48,
		hz: 292,
		bed: 1,
	},
	"flight-rcs": {
		rms: 0.00648,
		peak: 0.03308,
		onsetMs: 46.48,
		hz: 292,
		bed: 1,
	},
	"flight-rcs-norcs": {
		rms: 0.00573,
		peak: 0.02802,
		onsetMs: 46.48,
		hz: 292,
		bed: 1,
	},
	"flight-cruise-shimmer": {
		rms: 0.0189,
		peak: 0.19486,
		onsetMs: 46.48,
		hz: 292,
		bed: 1,
	},
	"flight-cruise-throb": {
		rms: 0.02231,
		peak: 0.19464,
		onsetMs: 46.48,
		hz: 292,
		bed: 1,
	},
	"flight-cruise-slow-climb": {
		rms: 0.01012,
		peak: 0.05475,
		onsetMs: 34.38,
		hz: 3009,
		bed: 1,
	},
	"flight-cruise-c-ladder": {
		rms: 0.00904,
		peak: 0.05464,
		onsetMs: 34.38,
		hz: 2887,
		bed: 1,
	},
	"flight-cooling-clicks": {
		rms: 0.02349,
		peak: 0.14649,
		onsetMs: 11.67,
		hz: 293,
		bed: 1,
	},
	"flight-damaged-clicks": {
		rms: 0.00531,
		peak: 0.04296,
		onsetMs: 46.48,
		hz: 292,
		bed: 1,
	},
	"flight-docked": {
		rms: 0.00259,
		peak: 0.01261,
		onsetMs: 64.35,
		hz: 370,
		bed: 1,
	},
	"flight-stack": {
		rms: 0.03747,
		peak: 0.20456,
		onsetMs: 9.19,
		hz: 4479,
		bed: 1,
	},
};

/**
 * #546's console voices, which `origin/main` does not have: centred on this
 * branch's own render (`PRINT=1`, seed 552), re-taken after the principal's
 * first listen (the shield hit became a sparkle), so they hold the prototype to what is offered and move when
 * the ear moves it. All tone-only: the ±10% band.
 */
const SINCE_546 = {
	"notify-message": { rms: 0.00593, peak: 0.04275, onsetMs: 12.08, hz: 888 },
	"notify-good": { rms: 0.00637, peak: 0.03951, onsetMs: 12.06, hz: 884 },
	"notify-bad": { rms: 0.00806, peak: 0.06284, onsetMs: 11.75, hz: 1098 },
	press: { rms: 0.00204, peak: 0.03691, onsetMs: 11.79, hz: 2162 },
	refuse: { rms: 0.00359, peak: 0.02322, onsetMs: 12.46, hz: 2822 },
	focus: { rms: 0.00062, peak: 0.01306, onsetMs: 13, hz: 2778 },
};

/**
 * #545's voices and duels, which `origin/main` does not have: centred on this
 * branch's own render (`PRINT=1`, seed 552), re-taken after the principal's
 * first listen made the shield hit a sparkle, so they hold the prototype to
 * what is offered and move when the ear moves it. Every duel takes the bed's wide band: each carries noise
 * loops and many cues.
 */
const SINCE_545 = {
	"laser-crack": {
		rms: 0.00934,
		peak: 0.16713,
		onsetMs: 7.33,
		hz: 5095,
		noise: 1,
	},
	"gun-locked": {
		rms: 0.00236,
		peak: 0.02239,
		onsetMs: 7.35,
		hz: 553,
		noise: 1,
	},
	"shield-fore": {
		rms: 0.00645,
		peak: 0.14594,
		onsetMs: 7.33,
		hz: 7313,
		noise: 1,
	},
	"shield-aft": {
		rms: 0.00545,
		peak: 0.13747,
		onsetMs: 7.33,
		hz: 5290,
		noise: 1,
	},
	"shield-onepool": {
		rms: 0.00598,
		peak: 0.1594,
		onsetMs: 7.33,
		hz: 6327,
		noise: 1,
	},
	"shield-fore-low": {
		rms: 0.00429,
		peak: 0.0934,
		onsetMs: 7.33,
		hz: 7303,
		noise: 1,
	},
	"hull-clang": {
		rms: 0.01368,
		peak: 0.14243,
		onsetMs: 7.4,
		hz: 660,
		noise: 1,
	},
	"landed-shield": {
		rms: 0.00195,
		peak: 0.02805,
		onsetMs: 7.35,
		hz: 4660,
		noise: 1,
	},
	"landed-hull": {
		rms: 0.00281,
		peak: 0.02422,
		onsetMs: 7.48,
		hz: 349,
		noise: 1,
	},
	"weapons-crack": {
		rms: 0.0137,
		peak: 0.19883,
		onsetMs: 306,
		hz: 5095,
		bed: 1,
	},
	"weapons-beam": {
		rms: 0.02044,
		peak: 0.11045,
		onsetMs: 306.02,
		hz: 2514,
		bed: 1,
	},
	"weapons-beam-heatflat": {
		rms: 0.02067,
		peak: 0.12625,
		onsetMs: 306.02,
		hz: 2514,
		bed: 1,
	},
	"weapons-pew": {
		rms: 0.01102,
		peak: 0.06297,
		onsetMs: 306.04,
		hz: 4178,
		bed: 1,
	},
	"weapons-taken-sizzle": {
		rms: 0.01199,
		peak: 0.17765,
		onsetMs: 327.33,
		hz: 6828,
		bed: 1,
	},
	"weapons-taken-rearm": {
		rms: 0.01271,
		peak: 0.18031,
		onsetMs: 327.33,
		hz: 7450,
		bed: 1,
	},
	"weapons-taken-plain": {
		rms: 0.00888,
		peak: 0.18089,
		onsetMs: 327.33,
		hz: 6327,
		bed: 1,
	},
	"weapons-given": {
		rms: 0.01583,
		peak: 0.20868,
		onsetMs: 306,
		hz: 4607,
		bed: 1,
	},
	"weapons-given-nogiven": {
		rms: 0.01549,
		peak: 0.19883,
		onsetMs: 306,
		hz: 5095,
		bed: 1,
	},
};

/**
 * #534's flash and jumps, which `origin/main` does not have: centred on this
 * branch's own render (`PRINT=1`, seed 552), so they hold the prototype to
 * what the principal listens to and move when the ear moves it. A jump takes
 * the bed's wide band: it carries noise loops, the flight bed and every cue of
 * the transition. Like a flight timeline, a jump whose ride vanished could
 * stay inside that band, so each voice after the cut also renders alone in
 * its own band, and the windowed rows below hold what only a timeline shows:
 * the rift over the returning bed, the sweep's two arms, and the duck.
 */
const SINCE_534 = {
	"witchspace-flash-boom": {
		rms: 0.02627,
		peak: 0.1912,
		onsetMs: 7.44,
		hz: 441,
		noise: 1,
	},
	"witchspace-flash-glass": {
		rms: 0.01139,
		peak: 0.13603,
		onsetMs: 7.33,
		hz: 7136,
		noise: 1,
	},
	"witchspace-ride-rings": {
		rms: 0.01739,
		peak: 0.05032,
		onsetMs: 311.77,
		hz: 2482,
		noise: 1,
	},
	"witchspace-ride-bed": {
		rms: 0.03115,
		peak: 0.13226,
		onsetMs: 259.27,
		hz: 180,
		noise: 1,
	},
	"witchspace-unfold": {
		rms: 0.00659,
		peak: 0.0675,
		onsetMs: 51,
		hz: 5235,
		noise: 1,
	},
	"witchspace-rift": { rms: 0.02007, peak: 0.09312, onsetMs: 281.23, hz: 279 },
	jump: { rms: 0.02492, peak: 0.20133, onsetMs: 13.21, hz: 281, bed: 1 },
	"jump-sweep": {
		rms: 0.02527,
		peak: 0.18743,
		onsetMs: 13.21,
		hz: 281,
		bed: 1,
	},
	"jump-rise": { rms: 0.02642, peak: 0.20136, onsetMs: 13.21, hz: 281, bed: 1 },
	"jump-glass": { rms: 0.0239, peak: 0.14895, onsetMs: 13.21, hz: 281, bed: 1 },
	"jump-rings": {
		rms: 0.02057,
		peak: 0.20132,
		onsetMs: 13.21,
		hz: 281,
		bed: 1,
	},
	"jump-duck": { rms: 0.02471, peak: 0.20144, onsetMs: 13.21, hz: 281, bed: 1 },
	arrival: { rms: 0.00551, peak: 0.02802, onsetMs: 46.48, hz: 292, bed: 1 },
	"arrival-sound": {
		rms: 0.02709,
		peak: 0.18325,
		onsetMs: 46.48,
		hz: 292,
		bed: 1,
	},
};

/**
 * #577's heavy voices, on `?punch=heavy` (the default), reverb included:
 * centred on this branch's own render (seed 552), so they hold the prototype
 * to what is offered and move when the ear moves it. Every one has a noise
 * part. Over seeds 1–3 and 552 rms moved up to 16% and peak up to 38% (the
 * shield hits', whose sparks are few), and the centroid under 7% save the
 * shield hits' and the dock's: a scatter of few sparks moves the first up to
 * 14%, and the dock's clamps ring into a reverb whose impulse is drawn per
 * render, which moves its centroid up to 21% — their centroid bands are
 * widened to match (`hzSpread`). The `-tail` entries are the same cues
 * rendered long enough to hear the reverb out.
 */
const HEAVY = {
	explosion: { rms: 0.0692, peak: 0.465, onsetMs: 8.3, hz: 3623, noise: 1 },
	"hull-clang": { rms: 0.0282, peak: 0.3027, onsetMs: 7.4, hz: 2229, noise: 1 },
	"shield-fore": {
		rms: 0.0086,
		peak: 0.2199,
		onsetMs: 7.3,
		hz: 7095,
		noise: 1,
		hzSpread: 0.15,
	},
	"shield-aft": {
		rms: 0.0079,
		peak: 0.1918,
		onsetMs: 7.3,
		hz: 4876,
		noise: 1,
		hzSpread: 0.15,
	},
	"shield-onepool": {
		rms: 0.0084,
		peak: 0.2077,
		onsetMs: 7.3,
		hz: 5855,
		noise: 1,
		hzSpread: 0.15,
	},
	"shield-fore-low": {
		rms: 0.0054,
		peak: 0.1114,
		onsetMs: 7.3,
		hz: 7388,
		noise: 1,
		hzSpread: 0.18,
	},
	"laser-crack": {
		rms: 0.0184,
		peak: 0.2669,
		onsetMs: 7.3,
		hz: 4192,
		noise: 1,
	},
	"landed-hull": { rms: 0.0049, peak: 0.0409, onsetMs: 7.5, hz: 350, noise: 1 },
	dock: {
		rms: 0.0285,
		peak: 0.1841,
		onsetMs: 7.5,
		hz: 1289,
		noise: 1,
		hzSpread: 0.25,
	},
	"witchspace-flash-boom": {
		rms: 0.0708,
		peak: 0.4414,
		onsetMs: 8.3,
		hz: 3774,
		noise: 1,
	},
	"cruise-engage": {
		rms: 0.0321,
		peak: 0.4042,
		onsetMs: 7.4,
		hz: 2786,
		noise: 1,
	},
	"cruise-drop": {
		rms: 0.0229,
		peak: 0.2657,
		onsetMs: 7.4,
		hz: 2684,
		noise: 1,
	},
	"explosion-tail": {
		rms: 0.038,
		peak: 0.465,
		onsetMs: 8.3,
		hz: 3623,
		noise: 1,
	},
	"hull-clang-tail": {
		rms: 0.0146,
		peak: 0.3027,
		onsetMs: 7.4,
		hz: 2229,
		noise: 1,
	},
	"witchspace-flash-boom-tail": {
		rms: 0.0419,
		peak: 0.4414,
		onsetMs: 8.3,
		hz: 3774,
		noise: 1,
	},
};

/**
 * The `-tail` entries on thin (#577): the sound before #577 in a longer
 * window, so each is its short entry's sound with more silence after it.
 * Centred on this branch's thin render (seed 552), which renders the short
 * entries to the `MAIN` and `SINCE_545` / `SINCE_534` figures.
 */
const SINCE_577 = {
	"explosion-tail": {
		rms: 0.011,
		peak: 0.1894,
		onsetMs: 7.4,
		hz: 447,
		noise: 1,
	},
	"hull-clang-tail": {
		rms: 0.0071,
		peak: 0.1424,
		onsetMs: 7.4,
		hz: 660,
		noise: 1,
	},
	"witchspace-flash-boom-tail": {
		rms: 0.0155,
		peak: 0.1912,
		onsetMs: 7.4,
		hz: 441,
		noise: 1,
	},
};

/**
 * Where each `-tail` entry's dry voices have all stopped (#577): after
 * `cueLengthS` on heavy for the pooled two, and after the flash's longest
 * wash for the flash. What is left in the window is the reverb alone, and it
 * must stand above `TAIL_MIN_OF_PEAK` of the cue's own peak. The first cut of
 * the reverb read about 2e-4 of its peak there — its impulse was normalised
 * by the node and dead by two seconds — and this row is the one that would
 * have said so.
 */
const TAIL_WINDOWS = {
	"explosion-tail": [1.85, 2.5],
	"hull-clang-tail": [0.6, 1.2],
	"witchspace-flash-boom-tail": [2.1, 2.7],
};
const TAIL_MIN_OF_PEAK = 1e-3;

/** The least a heavy render's rms under 250 Hz may stand over its thin
 *  render's (#577). The probe prints each lift; the smallest on the build
 *  that made it was the cruise engage's, near x1.4, and a build where heavy
 *  plays thin reads x1.00 on every cue. */
const HEAVY_MIN_LOW_LIFT = 1.3;

/**
 * Each cue's band: rms, peak and centroid as `[low, high]`, and the latest
 * onset in ms. A tone-only cue renders the same waveform on every seed, so
 * its band is ±10%; a noise cue's is wide enough for the seed's own spread
 * above, and the bed's wider again. The onset allows the limiter's 6 ms and
 * as much again, which is the order of a render quantum's rounding.
 */
const bandsOf = (table) =>
	Object.fromEntries(
		Object.entries(table).map(([name, m]) => {
			const [lo, hi] = m.bed ? [0.7, 1.4] : m.noise ? [0.8, 1.25] : [0.9, 1.1];
			const [plo, phi] = m.bed || m.noise ? [0.6, 1.6] : [0.9, 1.1];
			const [clo, chi] = m.hzSpread
				? [1 - m.hzSpread, 1 + m.hzSpread]
				: m.bed
					? [0.6, 1.5]
					: m.noise
						? [0.93, 1.07]
						: [0.9, 1.1];
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
/** Read on `?punch=thin`: the sound every cue had before #577. */
const BANDS = bandsOf({
	...MAIN,
	...SINCE_544,
	...SINCE_546,
	...SINCE_545,
	...SINCE_534,
	...SINCE_577,
});
const HEAVY_BANDS = bandsOf(HEAVY);

/** The most of an uncapped burst's ring a capped one may reach. Read at
 *  0.52 on the build that made the pool. */
const BURST_MAX_OF_UNCAPPED = 0.7;

/** The least a loop's window may stand over its quiet window (#544). */
const LOOP_MIN_RATIO = 1.5;

/** The least `heatrise`'s late-burst lift may stand over `heatflat`'s (#545):
 *  read at x1.21 against x1.00 on the build that made it. */
const HEAT_MIN_LIFT = 1.1;

/** The least each rung of the c ladder may stand over the one below (#544). */
const LADDER_MIN_STEP = 1.3;

// #560's music renders are `probe-music.mjs`'s: this probe bands cues and loops.
const CUES = SOUND_SET.filter((e) => !e.music);

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

	const within = (v, [lo, hi]) => v >= lo && v <= hi;
	const inBand = (name, s, band, arm) =>
		check(
			`${name} renders in its ${arm} band`,
			within(s.rms, band.rms) &&
				within(s.peak, band.peak) &&
				s.onsetMs >= 0 &&
				s.onsetMs <= band.onsetMs &&
				within(s.centroidHz, band.centroidHz),
			`rms ${s.rms.toFixed(4)} peak ${s.peak.toFixed(4)} onset ${s.onsetMs.toFixed(1)} ms centroid ${Math.round(s.centroidHz)} Hz`,
		);
	const thin = { punch: "thin" };
	const heavy = { punch: "heavy" };
	const entryOf = new Map(SOUND_SET.map((e) => [e.name, e]));
	const rendered = new Map();
	// The music renders are probe-music's (#560): this reads the cues.
	for (const entry of CUES) {
		const s = await render(entry, thin);
		rendered.set(entry.name, s);
		if (PRINT)
			console.log(JSON.stringify({ name: entry.name, ...roundStats(s) }));
		const band = BANDS[entry.name];
		check(`${entry.name} has a band`, band !== undefined);
		if (band) inBand(entry.name, s, band, "thin");
	}
	const renderedHeavy = new Map();
	for (const [name, band] of Object.entries(HEAVY_BANDS)) {
		const entry = entryOf.get(name);
		check(`${name} is in the sound set`, entry !== undefined);
		if (!entry) continue;
		const s = await render(entry, heavy);
		renderedHeavy.set(name, s);
		if (PRINT)
			console.log(JSON.stringify({ name, punch: "heavy", ...roundStats(s) }));
		inBand(name, s, band, "heavy");
	}

	for (const [entry, on, arm] of [
		...CUES.map((e) => [e, rendered.get(e.name), thin]),
		...[...renderedHeavy].map(([name, s]) => [entryOf.get(name), s, heavy]),
	]) {
		const off = await render(entry, { bypassLimiter: true, ...arm });
		const ratio = (a, b) => (b > 0 ? a / b : Number.NaN);
		const rms = ratio(on.rms, off.rms);
		const peak = ratio(on.peak, off.peak);
		check(
			`the limiter leaves ${entry.name} alone on ${arm.punch}`,
			Math.abs(rms - 1) <= 0.01 && Math.abs(peak - 1) <= 0.01,
			`rms x${rms.toFixed(4)} peak x${peak.toFixed(4)} onset ${on.onsetMs.toFixed(2)} against ${off.onsetMs.toFixed(2)} ms`,
		);
	}

	// #577: heavy against thin under 250 Hz, on the same seed. A crude band —
	// two one-pole low-passes — is enough: what it must see is the punch and
	// the sub, which thin does not have.
	{
		const lowRms = (x, hz = 250) => {
			const a = Math.exp((-2 * Math.PI * hz) / SR);
			let y1 = 0;
			let y2 = 0;
			let sum = 0;
			for (const v of x) {
				y1 = (1 - a) * v + a * y1;
				y2 = (1 - a) * y1 + a * y2;
				sum += y2 * y2;
			}
			return Math.sqrt(sum / x.length);
		};
		const samples = async (name, arm) =>
			(
				await page.evaluate(renderInPage, {
					entry: entryOf.get(name),
					sampleRate: SR,
					seed: SEED,
					...arm,
				})
			).samples;
		for (const name of Object.keys(HEAVY)) {
			const lift =
				lowRms(await samples(name, heavy)) / lowRms(await samples(name, thin));
			check(
				`${name} carries more weight under 250 Hz on heavy than on thin`,
				lift > HEAVY_MIN_LOW_LIFT,
				`x${lift.toFixed(2)}`,
			);
		}
		const windowOf = (x, [a, b]) => {
			const w = x.slice(Math.round(a * SR), Math.round(b * SR));
			return Math.sqrt(w.reduce((q, v) => q + v * v, 0) / w.length);
		};
		for (const [name, window] of Object.entries(TAIL_WINDOWS)) {
			const wet = await samples(name, heavy);
			const dry = await samples(name, thin);
			const peak = renderedHeavy.get(name)?.peak ?? Number.NaN;
			const tail = windowOf(wet, window);
			check(
				`${name} rings on in the reverb after every dry voice has stopped, on heavy only`,
				tail > peak * TAIL_MIN_OF_PEAK && windowOf(dry, window) < 1e-5,
				`${window.join("–")} s: rms ${tail.toExponential(2)} (${(20 * Math.log10(tail / peak)) | 0} dB under its peak); thin ${windowOf(dry, window).toExponential(2)}`,
			);
		}
		const rms = (name) => renderedHeavy.get(name)?.rms ?? Number.NaN;
		const order = ["explosion", "hull-clang", "shield-fore", "landed-hull"];
		check(
			"on heavy an explosion outweighs a hull hit, which outweighs a shield hit, which outweighs a hit landed",
			order.every((n, i) => i === 0 || rms(n) < rms(order[i - 1])),
			order.map((n) => `${n} ${rms(n).toFixed(4)}`).join(" > "),
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
		// #545: the beam is a loop while the gun fires, and it lets go between
		// bursts and when the gun locks. Windows are `weaponTimelines`' keys.
		[
			"the beam is heard while the gun fires",
			"weapons-beam",
			[0.5, 1],
			"weapons-beam",
			[1.4, 1.7],
		],
		[
			"the beam lets go when the gun locks",
			"weapons-beam",
			[3.9, 4.2],
			"weapons-beam",
			[4.5, 4.8],
		],
		[
			"a held enemy beam sizzles on the shield between impacts",
			"weapons-taken-sizzle",
			[0.8, 1.4],
			"weapons-taken-sizzle",
			[2.6, 3.1],
		],
		// #534's segments after the cut. The ride and the unfolding are held by
		// their lone renders' bands and not here: against a quiet arrival on the
		// `duck` arm they were read against the duck's exact silence, which any
		// tail at all stands over. The rift is read below against the quiet
		// arrival (the default since the principal's ruling) at the same phase —
		// the same flight bed and no cue. An arrival begins at 0.5 s, so its phase
		// is the render time less that.
		// The ride's close is a cue of its own (sage round 1 on #575): its lone
		// render plays the close at the tunnel's 2.4 s, gone by 3.1. A close that
		// did nothing leaves the ride sounding and each lone band still holds,
		// so its middle is read against what is left after the tunnel is gone.
		...["rings", "bed"].map((voice) => [
			`the ${voice} ride closes with the tunnel`,
			`witchspace-ride-${voice}`,
			[1, 2],
			`witchspace-ride-${voice}`,
			[3.15, 3.4],
		]),
		[
			"the rift is heard as it closes behind the ship",
			"arrival-sound",
			[6, 7],
			"arrival",
			[6, 7],
		],
		// The wind-up's last quarter second, cut at 3.5 s: the risen sweep
		// against the sweep as it was, and against itself swallowed.
		[
			"the risen sweep holds to the cut",
			"jump-rise",
			[3.2, 3.45],
			"jump-sweep",
			[3.2, 3.45],
		],
		[
			"the swallowed sweep is gone before the flash",
			"jump-rise",
			[3.3, 3.45],
			"jump",
			[3.3, 3.45],
		],
		// Phase 2.8–3.0: the ride has all but closed (2.4 to 3.1) and the new
		// light is not yet in, so what differs is the bed. At 2.55–2.95 it read
		// x3.64 under the `rings` ride and x1.72 under `bed`, which fills more
		// of the fade: that window measured the ride as much as the bed.
		[
			"the duck takes the engine away until the hands come back",
			"jump",
			[6.3, 6.5],
			"jump-duck",
			[6.3, 6.5],
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
	// #545's `heatrise`: the beam's whine climbs as the gun heats. Within one
	// burst, late against early and high-passed, the rise must stand clear of
	// the same windows on `heatflat`, where only the burst's own drift moves.
	{
		const lift = async (name) => {
			const x = await samplesOf(name);
			return windowRms(x, [3.9, 4.2], true) / windowRms(x, [2, 2.3], true);
		};
		const rise = await lift("weapons-beam");
		const flat = await lift("weapons-beam-heatflat");
		check(
			"heat lifts the beam's whine",
			rise > flat * HEAT_MIN_LIFT,
			`late/early x${rise.toFixed(2)} against x${flat.toFixed(2)} on heatflat`,
		);
	}
	// The principal's second listen heard no change from 1 to 30 c. The
	// ladder holds 1, 2, 5, 10 and 20 c for two seconds each; high-passed,
	// each step must stand clear of the one below.
	const ladder = await samplesOf("flight-cruise-c-ladder");
	const rungs = [
		[0.5, 2.3],
		[2.7, 4.3],
		[4.7, 6.3],
		[6.7, 8.3],
		[8.7, 10.3],
	].map((w) => windowRms(ladder, w, true));
	check(
		"every step from 1 to 20 c is heard above the one below",
		rungs.every((r, i) => i === 0 || r > rungs[i - 1] * LADDER_MIN_STEP),
		rungs.map((r) => r.toFixed(5)).join(" < "),
	);
	// A climb too slow for any one step to pass the write threshold must
	// still be followed (sage round 1's blocker): the end of the climb stands
	// well clear of its start, high-passed as the ladder is.
	const climb = await samplesOf("flight-cruise-slow-climb");
	const climbed =
		windowRms(climb, [10.5, 12], true) / windowRms(climb, [0.5, 2], true);
	check(
		"a slow climb through c is followed, not frozen at its start",
		climbed > 3,
		`high-passed rms x${climbed.toFixed(2)}`,
	);

	// Muted **while the loops play** (sage round 1): muted from the first
	// sample, the engine builds no graph at all, so a row reading silence
	// there passes whether or not a mute reaches a running loop. Each arm
	// plays two seconds, then goes Off; the loops must be heard before it and
	// be silent once the bus's fade has settled.
	const mutedLive = await Promise.all(
		[{ master: 0 }, { ship: 0 }].map((levels) =>
			raw("flight-idle", { levelsAt: [[2, levels]] }),
		),
	);
	check(
		"master Off and ship Off each silence flight loops already playing",
		mutedLive.every(
			(x) => windowRms(x, [1, 1.9]) > 1e-3 && windowRms(x, [2.5, 3.9]) < 1e-5,
		),
		mutedLive
			.map(
				(x) =>
					`${windowRms(x, [1, 1.9]).toExponential(2)} then ${windowRms(x, [2.5, 3.9]).toExponential(2)}`,
			)
			.join("; "),
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
	const burstOf = (uncapped, arm = heavy) =>
		page.evaluate(renderInPage, {
			entry: explosion,
			sampleRate: SR,
			seed: SEED,
			repeat: 30,
			spacingS: 128 / SR,
			uncapped,
			...arm,
		});
	const burst = await burstOf(false);
	const open = await burstOf(true);
	// Two tails since #577, and the heavy one is read high-passed. Heavy's tail
	// is mostly its sub, a pitched sine, and thirty copies 2.7 ms apart spread
	// over several of its periods and cancel one another: bypassing the
	// limiter, the uncapped burst stood at 0.164 against the capped 0.151 over
	// 0.1–0.3 s, where thin's noise tail scaled as its square root (x2.1). So a
	// plain tail ratio on heavy reads phase interference, not the pool — sage
	// round 1 on #578 asked for the control that shows it, and the limiter this
	// comment first blamed was not it (x0.90 with it bypassed). A first
	// difference drops the sub and keeps the noise wash, which sums as thin's
	// does.
	const burstThin = await burstOf(false, thin);
	const openThin = await burstOf(true, thin);

	check(
		"a burst of thirty explosions leaves no more voices sounding than the hits cap",
		burst.live !== null && burst.live <= caps.hits,
		`${burst.live} sounding, cap ${caps.hits}; ${open.live} with no caps`,
	);
	// From the last one on: what the pool removes is the pile of tails.
	const tailOf = (r) => r.samples.slice(Math.round(29 * 128 + 0.02 * SR));
	const tail = (r) => cueStats(tailOf(r), SR).rms;
	const tailHigh = (r) => {
		const x = tailOf(r);
		let sum = 0;
		for (let i = 1; i < x.length; i++) sum += (x[i] - x[i - 1]) ** 2;
		return Math.sqrt(sum / (x.length - 1));
	};
	const burstStats = cueStats(burst.samples, SR);
	check(
		"and after the last one it rings well below the same burst with no caps",
		tail(burstThin) < tail(openThin) * BURST_MAX_OF_UNCAPPED,
		`thin: tail rms ${tail(burstThin).toFixed(4)} against ${tail(openThin).toFixed(4)} with no caps`,
	);
	check(
		"and so it does on heavy, high-passed",
		tailHigh(burst) < tailHigh(open) * BURST_MAX_OF_UNCAPPED,
		`heavy: high-passed tail rms ${tailHigh(burst).toFixed(5)} against ${tailHigh(open).toFixed(5)} with no caps; unfiltered ${tail(burst).toFixed(4)} against ${tail(open).toFixed(4)}`,
	);
	check(
		"and it does not clip, on either arm",
		burstStats.peak < 1 && cueStats(burstThin.samples, SR).peak < 1,
		`peak ${burstStats.peak} heavy, ${cueStats(burstThin.samples, SR).peak} thin`,
	);
} finally {
	await browser.close();
}
exit();

/**
 * Every cue the engine plays, and how to render one offline in the page
 * (#552, after #542's D7). `probe-audio-cues.mjs` bands what these render to;
 * `capture-sounds.mjs` writes them to WAV at a labelled ref for the ear.
 *
 * One list, so the probe and the capture cannot disagree about what "every cue"
 * is. `tests/sound-set.test.ts` holds it against the cue union: a cue kind added
 * to `audio-cue.ts` with no entry here is a red run, because a sound nobody can
 * render is a sound nobody listened to.
 *
 * **Each entry says how to play it on either engine.** `cue` is the typed cue
 * `AudioFX.play` takes since #552; `legacy` is the method the engine before it
 * exposed. The capture renders `origin/main` as well as the branch, and the
 * engine there has no `play` and no offline seam, so `renderInPage` reaches it
 * the one way it can be reached (below).
 */

/** Seconds are render lengths: the cue's ring plus room for the tail. */
export const SOUND_SET = Object.freeze([
	{ name: "laser", seconds: 0.5, cue: { kind: "laser" }, legacy: ["laser"] },
	{ name: "hit", seconds: 0.6, cue: { kind: "hullHit" }, legacy: ["hit"] },
	{
		name: "explosion",
		seconds: 1.2,
		cue: { kind: "explosion" },
		legacy: ["explosion"],
	},
	{ name: "dock", seconds: 0.5, cue: { kind: "dock" }, legacy: ["dock"] },
	{ name: "scoop", seconds: 0.5, cue: { kind: "scoop" }, legacy: ["scoop"] },
	{ name: "alert", seconds: 0.5, cue: { kind: "alert" }, legacy: ["alert"] },
	{ name: "ui", seconds: 0.4, cue: { kind: "ui" }, legacy: ["ui"] },
	{
		// The hum's length is the schedule's, read off the page (`humS`).
		name: "witchspace-hum",
		seconds: "hum",
		cue: { kind: "witchspaceHum", seconds: "hum" },
		legacy: ["chargeHum", "hum"],
	},
	{
		name: "witchspace-sweep",
		seconds: 1.9,
		cue: { kind: "witchspaceSweep" },
		legacy: ["hyperspace"],
	},
	{ name: "bed-idle", seconds: 3, loop: 0.3 },
	{ name: "bed-full", seconds: 3, loop: 1 },
]);

/**
 * Render one entry in the page, offline, and hand back its samples.
 *
 * **Runs inside the page**, through `page.evaluate(renderInPage, args)`, so it
 * references nothing outside its own body.
 *
 * - `entry` — one of `SOUND_SET`.
 * - `sampleRate` — the render's rate.
 * - `seed` — when a number, `Math.random` is replaced for the render by a
 *   seeded stream and restored after. `audio.ts` draws `Math.random()` by
 *   design (#542 D6), so an unseeded noise cue differs every render; a probe
 *   comparing two renders of one cue brings its own stream, as D6 says.
 * - `bypassLimiter` — the engine's master is wired straight to the speakers,
 *   so a probe can read what the limiter did to a cue.
 * - `levels` — settings steps per bus, applied before the cue.
 * - `repeat`, `spacingS` — play the cue this many times, `spacingS` apart
 *   (0: at one instant). A burst.
 * - `uncapped` — the engine's voice pool is replaced by one with no caps: the
 *   control arm for a burst, so a probe can compare a capped burst with the
 *   same burst as it would sound without the pool.
 * - `leadS` — seconds of the engine running silent before the first cue;
 *   the samples returned start there. Not zero by default, because a live
 *   game's context has been running long before a cue, and an offline render
 *   is a context that starts at the cue: see `probe-audio-cues.mjs` on what the
 *   limiter does in its first milliseconds.
 *
 * **The engine before #552** has neither `attach` nor `play`. Its own
 * `ensure()` is called with `window.AudioContext` briefly pointing at the
 * offline context, which is marked `running` so `ensure` does not try to
 * resume it — so the graph it renders through is the one that build made,
 * not a copy of it written here. `bypassLimiter` and `levels` have nothing to
 * act on there and are refused.
 */
export async function renderInPage({
	entry,
	sampleRate,
	seed = null,
	bypassLimiter = false,
	levels = {},
	repeat = 1,
	spacingS = 0,
	leadS = 0.5,
	uncapped = false,
}) {
	const { AudioFX } = await import("/src/audio.ts");
	const { WITCHSPACE } = await import("/src/witchspace.ts");
	const resolve = (v) => (v === "hum" ? WITCHSPACE.humS : v);
	const seconds = resolve(entry.seconds) + (entry.seconds === "hum" ? 0.3 : 0);
	const ctx = new OfflineAudioContext(
		1,
		Math.round((leadS + seconds + (repeat - 1) * spacingS) * sampleRate),
		sampleRate,
	);
	const fx = new AudioFX();
	const modern = typeof fx.attach === "function";
	if (modern) {
		fx.attach(ctx);
		// The two control arms below patch `AudioFX`'s private `master` and
		// `pool`. `tsc` does not check this file, so a rename there would make
		// both arms silent no-ops; refuse loudly instead.
		if ((bypassLimiter && !fx.master) || (uncapped && !fx.pool))
			throw new Error("AudioFX no longer has the master or pool this reaches");
		for (const [bus, step] of Object.entries(levels)) fx.setLevel(bus, step);
		if (uncapped) {
			const { VOICE_PRIORITY } = await import("/src/audio-cue.ts");
			const none = Object.fromEntries(VOICE_PRIORITY.map((c) => [c, 1e9]));
			fx.pool = new fx.pool.constructor(none, VOICE_PRIORITY, 1e9);
		}
		if (bypassLimiter) {
			fx.master.disconnect();
			fx.master.connect(ctx.destination);
		}
	} else {
		if (bypassLimiter || uncapped || Object.keys(levels).length)
			throw new Error("the engine before #552 has no limiter and no buses");
		Object.defineProperty(ctx, "state", { value: "running" });
		const saved = window.AudioContext;
		window.AudioContext = function OfflineStandIn() {
			return ctx;
		};
		try {
			fx.ensure();
		} finally {
			window.AudioContext = saved;
		}
	}

	let state = (typeof seed === "number" ? seed : 1) >>> 0 || 1;
	const seeded = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
	const playOne = () => {
		const random = Math.random;
		if (typeof seed === "number") Math.random = seeded;
		try {
			if (entry.loop !== undefined) fx.ambient(entry.loop);
			else if (modern)
				fx.play({
					...entry.cue,
					...(entry.cue.seconds !== undefined
						? { seconds: resolve(entry.cue.seconds) }
						: {}),
				});
			else {
				const [method, ...args] = entry.legacy;
				fx[method](...args.map(resolve));
			}
		} finally {
			Math.random = random;
		}
	};
	// Each play at its time, by suspending the render there. A suspend is
	// quantised to a render quantum and two at one time are refused, so plays
	// that share a time share a suspend.
	const at = new Map();
	for (let i = 0; i < repeat; i++) {
		const t = leadS + i * spacingS;
		at.set(t, (at.get(t) ?? 0) + 1);
	}
	let live = null;
	for (const [t, n] of at)
		ctx.suspend(t).then(() => {
			for (let i = 0; i < n; i++) playOne();
			// The engine's own count of sounding voices, where it has one.
			live = fx.pool ? fx.pool.live(ctx.currentTime).length : null;
			ctx.resume();
		});
	const buffer = await ctx.startRendering();
	return {
		modern,
		sampleRate,
		live,
		samples: Array.from(
			buffer.getChannelData(0).subarray(Math.round(leadS * sampleRate)),
		),
	};
}

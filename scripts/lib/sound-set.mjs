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
	// #544's cues and loops. None has a `legacy` method: nothing like them
	// existed before #544, so a capture at an older ref renders them as absent.
	{ name: "cruise-engage", seconds: 1.8, cue: { kind: "cruiseEngage" } },
	{ name: "cruise-drop", seconds: 1.4, cue: { kind: "cruiseDrop" } },
	...flightTimelines(),
]);

/**
 * #544's loops, rendered by flying a scripted timeline through the real
 * `flight-sound.ts` step in the page, so what is heard is what the mapping
 * gives and not a mix written here.
 *
 * `keys` are `[seconds, reading]`: each reading is merged over the one before
 * it and held, or, with `ramp: true`, its numbers are reached linearly from
 * the key before. `arms` is a `?flightsound=` value. `cues` are
 * `[seconds, cue]` played beside the loops.
 */
function flightTimelines() {
	const burn = [
		[0, { lever: 0, drive: 0 }],
		[0.5, { lever: 1, drive: 1 }],
		[3, { drive: 0 }],
	];
	// Shared by the thruster row's two renders, which it compares: one copy,
	// so the two cannot drift apart.
	const rcs = [
		[0, {}],
		[0.3, { rcs: 1 }],
		[0.8, { rcs: 0 }],
		[1.5, { rcs: 0.5 }],
		[1.7, { rcs: 0 }],
	];
	const cruise = [
		[0, { lever: 0.3 }],
		[0.5, { regime: "spool", spool: 0 }],
		[3.5, { spool: 1, ramp: true }],
		// Engaged at the floor speed, up to the cap, then the approach slows it
		// before the drop: the bed follows the speed, not the lever.
		[3.5, { regime: "cruise", spool: 0, lever: 1, cruiseSpeed: 0 }],
		[6.5, { cruiseSpeed: 1, ramp: true }],
		[7.5, { cruiseSpeed: 1 }],
		[8.5, { cruiseSpeed: 0.1, ramp: true }],
		[8.5, { regime: "normal", lever: 0, cruiseSpeed: 0 }],
	];
	const line = (name, seconds, arms, keys, cues = []) => ({
		name,
		seconds,
		flight: { arms, keys, cues },
	});
	return [
		line("flight-idle", 4, "", [[0, {}]]),
		line("flight-burn-thrust", 6, "noclicks", burn),
		line("flight-burn-lever", 6, "lever,noclicks", burn),
		line("flight-rcs", 3, "noclicks", rcs),
		line("flight-rcs-norcs", 3, "norcs,noclicks", rcs),
		line("flight-cruise-shimmer", 10, "noclicks", cruise),
		line("flight-cruise-throb", 10, "throb,noclicks", cruise),
		// A slow climb, 1 to 20 c over twelve seconds: each step moves the
		// share by about 0.001, under `flight`'s write threshold. Sage round 1
		// found such a level never written — the bed froze at its first value.
		line("flight-cruise-slow-climb", 12.5, "noclicks", [
			[0, { regime: "cruise", lever: 1, cruiseC: 1 }],
			[12, { cruiseC: 20, ramp: true }],
		]),
		// The superluminal range in steps, 2 s each: 1, 2, 5, 10, 20 c.
		line("flight-cruise-c-ladder", 10.5, "noclicks", [
			[0, { regime: "cruise", lever: 1, cruiseC: 1 }],
			[2.5, { cruiseC: 2 }],
			[4.5, { cruiseC: 5 }],
			[6.5, { cruiseC: 10 }],
			[8.5, { cruiseC: 20 }],
		]),
		// A long burn, then idle: the hull ticks as it cools.
		line("flight-cooling-clicks", 14, "", [
			[0, { lever: 1, drive: 1 }],
			[6, { lever: 0, drive: 0 }],
		]),
		line("flight-damaged-clicks", 8, "", [[0, { hullShare: 0.15 }]]),
		line("flight-docked", 3, "", [[0, { docked: true }]]),
		// The headroom case: every ship loop at full under the loudest cue.
		line(
			"flight-stack",
			3,
			"lever,noclicks",
			[[0, { lever: 1, drive: 1, rcs: 1 }]],
			[[1, { kind: "explosion" }]],
		),
	];
}

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
 * - `levelsAt` — `[seconds, levels]` applied during a flight timeline, so a
 *   mute can be tested on loops that are already playing (#544).
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
	levelsAt = [],
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
	// An entry this engine has nothing to play: a capture at an older ref.
	if (
		(entry.flight && typeof fx.flight !== "function") ||
		(entry.cue && !entry.legacy && !modern)
	)
		return { modern, absent: true, sampleRate, live: null, samples: [] };
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
	if (entry.flight) {
		const { flightSound, flightSoundArms, QUIET_FLIGHT, cruiseSpeedShare } =
			await import("/src/flight-sound.ts");
		const { DEFAULT_CRUISE } = await import("/src/cruise.ts");
		const { C_KMS } = await import("/src/units.ts");
		// A key may name a cruise speed in c (`cruiseC`) rather than a share,
		// and the share is then the game's own mapping of it.
		const shareOf = (r) =>
			r.cruiseC === undefined
				? r
				: {
						...r,
						cruiseSpeed: cruiseSpeedShare(
							r.cruiseC * C_KMS,
							DEFAULT_CRUISE.vMinKms,
							C_KMS,
							DEFAULT_CRUISE.vMaxKms,
						),
					};
		const { arms, unknown } = flightSoundArms(entry.flight.arms);
		if (unknown.length || arms === "legacy")
			throw new Error(`${entry.name}: arms ${entry.flight.arms}`);
		let reading = {
			docked: false,
			regime: "normal",
			spool: 0,
			lever: 0,
			drive: 0,
			rcs: 0,
			hullShare: 1,
			cruiseSpeed: 0,
		};
		const readings = entry.flight.keys.map(([t, over]) => {
			reading = { ...reading, ...over };
			delete reading.ramp;
			return [t, reading, over.ramp === true];
		});
		const readingAt = (t) => {
			let i = 0;
			while (i + 1 < readings.length && readings[i + 1][0] <= t) i++;
			const next = readings[i + 1];
			if (!next || !next[2]) return readings[i][1];
			const [t0, a] = readings[i];
			const k = (t - t0) / (next[0] - t0);
			const out = { ...a };
			for (const key of Object.keys(a))
				if (typeof a[key] === "number")
					out[key] = a[key] + (next[1][key] - a[key]) * k;
			return out;
		};
		const dt = 1 / 50;
		const cues = [...entry.flight.cues];
		const setAt = [...levelsAt];
		let flight = QUIET_FLIGHT;
		const random = Math.random;
		for (let i = 0; i * dt < seconds; i++) {
			const t = i * dt;
			ctx.suspend(leadS + t).then(() => {
				if (typeof seed === "number") Math.random = seeded;
				try {
					const step = flightSound(flight, shareOf(readingAt(t)), arms, dt);
					flight = step.state;
					for (const cue of step.cues) fx.play(cue);
					while (cues.length && cues[0][0] <= t) fx.play(cues.shift()[1]);
					while (setAt.length && setAt[0][0] <= t)
						for (const [bus, level] of Object.entries(setAt.shift()[1]))
							fx.setLevel(bus, level);
					fx.flight(step.mix);
				} finally {
					Math.random = random;
				}
				ctx.resume();
			});
		}
		const buffer = await ctx.startRendering();
		return {
			modern,
			sampleRate,
			live: null,
			samples: Array.from(
				buffer.getChannelData(0).subarray(Math.round(leadS * sampleRate)),
			),
		};
	}
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

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
	// The `pew` and `thud` voices are the sounds before #545, under the names
	// they had, so their bands still hold them to the engine before #552.
	{
		name: "laser",
		seconds: 0.5,
		cue: { kind: "laser", voice: "pew" },
		legacy: ["laser"],
	},
	{
		name: "hit",
		seconds: 0.6,
		cue: { kind: "hullHit", voice: "thud" },
		legacy: ["hit"],
	},
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
	// #546's console voices. None has a `legacy` method: the consoles were
	// silent before #546, so an older ref renders them as absent.
	{
		name: "notify-message",
		seconds: 0.6,
		cue: { kind: "notify", tone: "message" },
	},
	{ name: "notify-good", seconds: 0.6, cue: { kind: "notify", tone: "good" } },
	{ name: "notify-bad", seconds: 0.6, cue: { kind: "notify", tone: "bad" } },
	{ name: "press", seconds: 0.3, cue: { kind: "press" } },
	{ name: "refuse", seconds: 0.4, cue: { kind: "refuse" } },
	{ name: "focus", seconds: 0.3, cue: { kind: "focus" } },
	...flightTimelines(),
	// #545's voices. None has a `legacy` method: a crack, a clang, a shield
	// and a landed hit did not exist before #545, so an older ref renders them
	// as absent.
	{
		name: "laser-crack",
		seconds: 0.4,
		cue: { kind: "laser", voice: "crack" },
	},
	{ name: "gun-locked", seconds: 0.3, cue: { kind: "gunLocked" } },
	{
		name: "shield-fore",
		seconds: 0.6,
		cue: { kind: "shieldHit", pool: "fore", share: 1, sided: true },
	},
	{
		name: "shield-aft",
		seconds: 0.6,
		cue: { kind: "shieldHit", pool: "aft", share: 1, sided: true },
	},
	{
		name: "shield-onepool",
		seconds: 0.6,
		cue: { kind: "shieldHit", pool: "fore", share: 1, sided: false },
	},
	{
		name: "shield-fore-low",
		seconds: 0.6,
		cue: { kind: "shieldHit", pool: "fore", share: 0.1, sided: true },
	},
	{
		name: "hull-clang",
		seconds: 0.8,
		cue: { kind: "hullHit", voice: "clang" },
	},
	{
		name: "landed-shield",
		seconds: 0.4,
		cue: { kind: "hitLanded", on: "shield" },
	},
	{ name: "landed-hull", seconds: 0.4, cue: { kind: "hitLanded", on: "hull" } },
	...weaponTimelines(),
]);

/**
 * #545's duels, flown by a scripted timeline through the real
 * `weapon-sound.ts` step, so what is heard is what the mapping gives.
 *
 * `keys` are `[seconds, reading]` as `flightTimelines`' are, over a flat
 * reading: `fired`, `trigger`, `heatLocked`, `heat` for the gun; `fore`,
 * `aft`, `hull` for the player's own condition; and `target`, `tFore`,
 * `tAft`, `tHull` for the selected target (`target: null` is none). The
 * shot pacing is `stepGunFeedback`'s, and a fall in the ship's own condition
 * is struck, as `applyDamage` would have it. `arms` is a `?weaponsound=`
 * value.
 */
function weaponTimelines() {
	// Two bursts of fire, the second running the gun into its lockout, a pull
	// on the locked gun, and a release.
	const bursts = [
		[0, { fired: false, trigger: false, heat: 0 }],
		[0.3, { fired: true, trigger: true }],
		[1.3, { fired: false, trigger: false, heat: 0.35 }],
		[1.8, { fired: true, trigger: true }],
		[4.3, { heat: 1, ramp: true }],
		[4.3, { fired: false, heatLocked: true }],
		[4.6, { trigger: false }],
		[4.9, { trigger: true }],
		[5.1, { trigger: false }],
	];
	// A raider's beam held on the fore shield for two seconds, draining it,
	// then a pause, then on the aft through to the hull.
	const taken = [
		[0, { fore: 106, aft: 106, hull: 100 }],
		[0.3, {}],
		[2.3, { fore: 60, ramp: true }],
		[3.3, {}],
		[3.4, { aft: 100 }],
		[5.4, { aft: 0, ramp: true }],
		[6.9, { hull: 70, ramp: true }],
	];
	// The player's fire landing on a selected target: shield, then hull.
	const given = [
		[0, { target: "r", tFore: 106, tAft: 106, tHull: 100, fired: false }],
		[0.3, { fired: true, trigger: true }],
		[2.3, { tFore: 0, ramp: true }],
		[3.8, { tHull: 60, ramp: true }],
		[3.8, { fired: false, trigger: false }],
	];
	const line = (name, seconds, arms, keys) => ({
		name,
		seconds,
		weapons: { arms, keys },
	});
	return [
		line("weapons-crack", 5.5, "nolock", bursts),
		line("weapons-beam", 5.5, "beam", bursts),
		line("weapons-beam-heatflat", 5.5, "beam,heatflat", bursts),
		line("weapons-pew", 5.5, "pew,nolock", bursts),
		line("weapons-taken-sizzle", 7.3, "", taken),
		line("weapons-taken-rearm", 7.3, "rearm", taken),
		line("weapons-taken-plain", 7.3, "rearm,onepool,flat,thud", taken),
		line("weapons-given", 4.3, "", given),
		line("weapons-given-nogiven", 4.3, "nogiven", given),
	];
}

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
	// **A modern engine can be older too** (sage round 3): `origin/main` has
	// #552's `play` but not #544's cruise cues, and `play` returns silently on
	// a kind with no bus — a silent WAV under the cue's name. So a cue is
	// absent unless the engine's own vocabulary lists its kind.
	const knownKinds = modern
		? Object.keys((await import("/src/audio-cue.ts")).CUE_BUS)
		: [];
	if (
		(entry.flight && typeof fx.flight !== "function") ||
		(entry.weapons && typeof fx.weapons !== "function") ||
		(entry.cue && !entry.legacy && !modern) ||
		(entry.cue && modern && !knownKinds.includes(entry.cue.kind))
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
	if (entry.weapons) {
		const { weaponSound, weaponSoundArms, QUIET_WEAPONS } = await import(
			"/src/weapon-sound.ts"
		);
		const { stepGunFeedback, QUIET_GUN } = await import("/src/gun-feedback.ts");
		const { arms, unknown } = weaponSoundArms(entry.weapons.arms);
		if (unknown.length || arms === "legacy")
			throw new Error(`${entry.name}: arms ${entry.weapons.arms}`);
		let reading = {
			fired: false,
			trigger: false,
			heatLocked: false,
			heat: 0,
			fore: 106,
			aft: 106,
			hull: 100,
			target: null,
			tFore: 0,
			tAft: 0,
			tHull: 0,
		};
		const readings = entry.weapons.keys.map(([t, over]) => {
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
		let state = QUIET_WEAPONS;
		let gun = QUIET_GUN;
		let prev = null;
		let sinceStruckS = 9;
		const random = Math.random;
		for (let i = 0; i * dt < seconds; i++) {
			const t = i * dt;
			ctx.suspend(leadS + t).then(() => {
				if (typeof seed === "number") Math.random = seeded;
				try {
					const r = readingAt(t);
					const feedback = stepGunFeedback(gun, r.fired, dt);
					gun = feedback.feedback;
					const fell =
						prev !== null &&
						(r.fore < prev.fore || r.aft < prev.aft || r.hull < prev.hull);
					sinceStruckS = fell ? 0 : sinceStruckS + dt;
					prev = r;
					const step = weaponSound(
						state,
						{
							fired: r.fired,
							shotSound: feedback.sound,
							trigger: r.trigger,
							heatLocked: r.heatLocked,
							heat: r.heat,
							own: {
								fore: r.fore,
								aft: r.aft,
								hull: r.hull,
								poolMax: 106,
								sinceStruckS,
							},
							target:
								r.target === null
									? null
									: { id: r.target, fore: r.tFore, aft: r.tAft, hull: r.tHull },
						},
						arms,
						dt,
					);
					state = step.state;
					for (const cue of step.cues) fx.play(cue);
					fx.weapons(step.mix);
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
			held: false,
			hushed: false,
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

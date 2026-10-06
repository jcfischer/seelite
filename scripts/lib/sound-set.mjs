import { readdirSync } from "node:fs";

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
	// #534's four voices after the cut, each alone. The flash's cue is whole
	// in itself; the others carry the schedule's timing, so they are taken
	// from it (`scheduled`: the first cue of each kind a jump plays on those
	// arms, each at its own phase from the first) rather than restated here.
	// The ride is heard with its close. The jumps below play them together.
	...["rings", "bed"].map((voice) => ({
		name: `witchspace-ride-${voice}`,
		seconds: 3.4,
		scheduled: {
			kinds: ["witchspaceRide", "witchspaceRideClose"],
			arms: voice,
		},
	})),
	{
		name: "witchspace-unfold",
		seconds: 1.9,
		scheduled: { kinds: ["witchspaceUnfold"], arms: "" },
	},
	{
		name: "witchspace-rift",
		seconds: 4.8,
		scheduled: { kinds: ["witchspaceRift"], arms: "" },
	},
	{
		name: "witchspace-flash-boom",
		seconds: 1.4,
		cue: { kind: "witchspaceFlash", voice: "boom" },
	},
	{
		name: "witchspace-flash-glass",
		seconds: 1.4,
		cue: { kind: "witchspaceFlash", voice: "glass" },
	},
	...witchspaceTimelines(),
	// #577's reverb, heard to its end. The renders above stop where the thin
	// voices did, which cuts a tail of more than two seconds; these are the
	// same cues, long enough to hear it ring out. Longer entries rather than
	// longer windows on the ones above, so every band there keeps its window.
	{
		name: "explosion-tail",
		seconds: 4,
		cue: { kind: "explosion" },
		legacy: ["explosion"],
	},
	{
		name: "hull-clang-tail",
		seconds: 3,
		cue: { kind: "hullHit", voice: "clang" },
	},
	{
		name: "witchspace-flash-boom-tail",
		seconds: 4,
		cue: { kind: "witchspaceFlash", voice: "boom" },
	},
	...musicTimelines(),
	...adaptiveTimelines(),
	...danubeTimelines(),
]);

/**
 * #534's jumps, flown through the real schedule (`witchspaceCues`) and the
 * real flight bed, so what is heard is what a jump plays: the wind-up from
 * half a second in, the cut, and the exit to the rift's close. `arms` is a
 * `?witchsound=` value.
 *
 * The first is the defaults. Each after it flips one arm, so a listen
 * compares one question at a time rather than a grid. The pilot burns at half
 * before the cut and is at rest after it, as `clearFlightSession` leaves a
 * ship that has jumped: so the bed after the cut is the hum, which is what
 * the `engine` arm ducks.
 */
function witchspaceTimelines() {
	const line = (name, seconds, arms, from = "jump") => ({
		name,
		seconds,
		witchspace: { arms, from },
	});
	return [
		// The defaults are the principal's ruling (2026-09-28); each render
		// after them flips one arm back to an answer that lost.
		line("jump", 12, ""),
		line("jump-sweep", 12, "sweep"),
		line("jump-rise", 12, "rise"),
		line("jump-glass", 12, "glass"),
		line("jump-rings", 12, "rings"),
		line("jump-duck", 12, "duck"),
		line("arrival", 9, "", "arrival"),
		line("arrival-sound", 9, "arrivalsound", "arrival"),
	];
}

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
		line("weapons-crack", 5.5, "crack,nolock", bursts),
		line("weapons-beam", 5.5, "beam", bursts),
		line("weapons-beam-heatflat", 5.5, "beam,heatflat", bursts),
		line("weapons-pew", 5.5, "pew,nolock", bursts),
		line("weapons-taken-sizzle", 7.3, "", taken),
		line("weapons-taken-rearm", 7.3, "rearm", taken),
		line("weapons-taken-plain", 7.3, "rearm,onepool,flat,thud", taken),
		line("weapons-given", 4.3, "crack,given", given),
		line("weapons-given-nogiven", 4.3, "crack", given),
	];
}

/**
 * #548's adaptive music, rendered by stepping the real director
 * (`music-director.ts`) through a scripted situation in the page: what is
 * heard is the commands the director sent, on the synth the game plays.
 *
 * `keys` are `[seconds, reading]`, each merged over the one before and
 * held. `arms` is a `?music=` value.
 */
function adaptiveTimelines() {
	const run = (seed) => [
		[0, { scene: "docked", stationRole: "trade", systemSeed: seed }],
		[10, { scene: "flight" }],
		[28, { cruise: true }],
		[44, { cruise: false, encounter: "inbound" }],
		[54, { encounter: "contest" }],
		[62, { encounter: "duel" }],
		[70, { raiderFiring: true, sinceStruckS: 0 }],
		[80, { raiderFiring: false, sinceStruckS: 99, shieldShare: 0.2 }],
		// The raider is gone and the shields come back: the fall, one level per
		// hold, back to calm.
		[90, { encounter: "none", shieldShare: 1, hullShare: 0.8 }],
		[128, { scene: "docked", stationRole: "refinery" }],
	];
	const tune = (name, seconds, keys, arms = "") => ({
		name,
		seconds,
		music: { director: { keys, arms } },
	});
	return [
		tune("music-adaptive-run-a", 140, run(1234)),
		tune("music-adaptive-run-b", 140, run(987654)),
		// Every level at once, rising: the four sections of one system.
		tune("music-adaptive-ladder", 72, [
			[0, { systemSeed: 1234 }],
			[18, { encounter: "inbound" }],
			[36, { encounter: "contest" }],
			[54, { raiderFiring: true }],
		]),
		// The Berlin bed (#600, the default) against the second and the first
		// (D12): the same system held at calm for 100 s, and the same station,
		// each way. `second` is the second bed, `legacy` the first.
		tune("music-calm", 100, [[0, { systemSeed: 1234 }]], "calm"),
		tune("music-calm-second", 100, [[0, { systemSeed: 1234 }]], "calm,second"),
		tune("music-calm-legacy", 100, [[0, { systemSeed: 1234 }]], "calm,legacy"),
		// Each danger section held for a minute: long enough to hear its form.
		...["wary", "threat", "combat"].map((level) =>
			tune(`music-${level}`, 60, [[0, { systemSeed: 1234 }]], level),
		),
		tune(
			"music-station-trade-legacy",
			60,
			[[0, { scene: "docked", stationRole: "trade", systemSeed: 1234 }]],
			"legacy",
		),
		...["trade", "refinery", "shipyard", "outpost"].map((role) =>
			tune(`music-station-${role}`, 60, [
				[0, { scene: "docked", stationRole: role, systemSeed: 1234 }],
			]),
		),
	];
}

/**
 * #560's test score, played through the worklet synth. `songs` maps each id
 * to a key of `TEST_SONGS` (`src/music-test-score.ts`), or to a song written
 * inline; `script` is `[seconds, command]`, each a `MusicCommand` sent then.
 * None has a `legacy` form: there was no synth before #560, so a capture at
 * an older ref renders these as absent.
 */
function musicTimelines() {
	const both = { waltz: "waltz", march: "march" };
	const play = (id) => ({ type: "play", id, at: "bar" });
	const tune = (name, seconds, script, songs = both) => ({
		name,
		seconds,
		music: { songs, script },
	});
	return [
		// Intro and the loop, then resolved into the coda's ritardando.
		tune("music-waltz", 16, [
			[0, play("waltz")],
			[9.5, { type: "resolve", at: "bar" }],
		]),
		tune("music-march", 8, [[0, play("march")]]),
		// The second voices in their room, section by section (#560 D10).
		tune("music-voices", 56, [[0, play("voices")]], { voices: "voices" }),
		// #547 D8's orchestral voices on their own: a held chord, a legato
		// phrase, the same detached, one note soft and one loud.
		tune("voice-strings", 30, [[0, play("strings")]], { strings: "strings" }),
		tune("voice-brass", 30, [[0, play("brass")]], { brass: "brass" }),
		tune("voice-flute", 30, [[0, play("flute")]], { flute: "flute" }),
		// Between songs: the march takes over on the waltz's next bar line.
		tune("music-crossfade", 10, [
			[0, play("waltz")],
			[3.5, { type: "crossfade", to: "march", at: "bar", fadeS: 2 }],
		]),
		// Between parts: the lead alone, then the arpeggio takes its place.
		tune("music-stems", 9, [
			[0, play("march")],
			[0, { type: "stem", part: "arp", level: 0, at: "now", fadeS: 0 }],
			[3.5, { type: "stem", part: "lead", level: 0, at: "bar", fadeS: 1.5 }],
			[3.5, { type: "stem", part: "arp", level: 1, at: "bar", fadeS: 1.5 }],
		]),
		// A pilot taking the stick back mid-waltz: faded out, not cut.
		tune("music-stop-fade", 6, [
			[0, play("waltz")],
			[3.2, { type: "stop", at: "now", fadeS: 0.8 }],
		]),
		// The march quickening by half over two bars.
		tune("music-tempo", 9, [
			[0, play("march")],
			[1, { type: "tempo", scale: 1.5, at: "bar", rampBars: 2 }],
		]),
	];
}

/**
 * #547's Blue Danube (`src/music-danube.ts`), the docking computer's waltz,
 * scripted as the director will send it: `play` when the computer engages,
 * `resolve` on the bar line after the plane (D1), or `stop` now over two bars
 * when the pilot takes the stick (D2). The run lengths are #547's measured
 * ones: 61–65 s from 4 km out, 90–92 s from 50 km. The intro is ~19.2 s and a
 * loop of the waltz 36 s, so a resolve at 91 s lands on the end of the second
 * loop. Each render runs on past its cadence for the arrival and the hall.
 */
function danubeTimelines() {
	const songs = { danube: "danube" };
	const play = [0, { type: "play", id: "danube", at: "bar" }];
	const resolve = (s) => [s, { type: "resolve", at: "bar" }];
	const tune = (name, seconds, script, over = songs) => ({
		name,
		seconds,
		music: { songs: over, script },
	});
	return [
		// The intro, two whole loops of the waltz, the cadence.
		tune("music-danube", 100, [play, resolve(91)]),
		// The pilot takes the stick 14 s into the first loop: two bars' fade.
		tune("music-danube-cancel", 40, [
			play,
			[33, { type: "stop", at: "now", fadeS: 2.25 }],
		]),
		// The shortest run and the longest, the cadence at the plane.
		tune("music-danube-run-short", 70, [play, resolve(62)]),
		tune("music-danube-run-long", 100, [play, resolve(92)]),
		// D12: the same two loops and the shortest run in the other two voicings.
		...["oxygene", "hybrid"].flatMap((v) => {
			const id = `danube-${v}`;
			const start = [0, { type: "play", id, at: "bar" }];
			return [
				tune(`music-danube-${v}`, 100, [start, resolve(91)], { [id]: id }),
				tune(`music-danube-${v}-run-short`, 70, [start, resolve(62)], {
					[id]: id,
				}),
			];
		}),
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
 * - `punch` — the engine's `?punch=` arm (#577), `heavy` or `thin`; null
 *   plays the engine's default. Named on an engine that has no such arm, it
 *   throws rather than render the one sound that engine has under either
 *   name.
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
	punch = null,
}) {
	/**
	 * #548: step the director through `keys` at a fixed step and return what it
	 * sent as a `[seconds, command]` script. Nested in `renderInPage` because
	 * `page.evaluate` sends only that function's source; it imports the served
	 * tree's director. The director is pure, so its commands can be worked out
	 * before the render starts.
	 */
	async function directorScript({ keys, arms: armsValue }, seconds) {
		const { initialMusicState, musicArms, QUIET_READING, stepMusic } =
			await import("/src/music-director.ts");
		const { arms, unknown } = musicArms(armsValue);
		if (unknown.length)
			throw new Error(`?music: unknown ${unknown.join(", ")}`);
		// Ready throughout: the script is worked out before the render starts,
		// and every command is sent once the worklet has loaded.
		let reading = QUIET_READING;
		const readings = keys.map(([t, over]) => {
			reading = { ...reading, ...over };
			return [t, reading];
		});
		const dt = 1 / 10;
		const script = [];
		let state = initialMusicState();
		for (let i = 0; i * dt < seconds; i++) {
			const t = i * dt;
			let k = 0;
			while (k + 1 < readings.length && readings[k + 1][0] <= t) k++;
			const r = readings[k][1];
			// A hit ages with the clock, as `sinceStruckS` does in the game.
			const struck = r.sinceStruckS + (t - readings[k][0]);
			const step = stepMusic(state, { ...r, sinceStruckS: struck }, dt, arms);
			state = step.state;
			for (const cmd of step.commands) script.push([t, cmd]);
		}
		return script;
	}

	const { AudioFX } = await import("/src/audio.ts");
	const { WITCHSPACE } = await import("/src/witchspace.ts");
	const resolve = (v) => (v === "hum" ? WITCHSPACE.humS : v);
	const seconds = resolve(entry.seconds) + (entry.seconds === "hum" ? 0.3 : 0);
	// Music renders in stereo (the synth's space is, since #548's first
	// listening); every cue stays mono, as it plays.
	const ctx = new OfflineAudioContext(
		entry.music ? 2 : 1,
		Math.round((leadS + seconds + (repeat - 1) * spacingS) * sampleRate),
		sampleRate,
	);
	const fx = new AudioFX();
	if (punch !== null) {
		if (!("punch" in fx))
			throw new Error(`punch=${punch}: this engine has no punch arm`);
		fx.punch = punch;
	}
	const modern = typeof fx.attach === "function";
	// An entry this engine has nothing to play: a capture at an older ref.
	// **A modern engine can be older too** (sage round 3): `origin/main` has
	// #552's `play` but not #544's cruise cues, and `play` returns silently on
	// a kind with no bus — a silent WAV under the cue's name. So a cue is
	// absent unless the engine's own vocabulary lists its kind.
	const knownKinds = modern
		? Object.keys((await import("/src/audio-cue.ts")).CUE_BUS)
		: [];
	// #560's synth, where the served tree has one: an older ref has no
	// `music.ts`, and the dynamic import of it rejects.
	const synth =
		entry.music && modern
			? await import("/src/music.ts")
					.then(async ({ Music }) => ({
						Music,
						songs: {
							...(await import("/src/music-test-score.ts")).TEST_SONGS,
							// #547's waltz, where the served tree has it.
							...(await import("/src/music-danube.ts")
								// One map in the module (sage round 1); an older tree has
								// only the waltz.
								.then((m) =>
									m.danubeSongs ? m.danubeSongs() : { danube: m.BLUE_DANUBE },
								)
								.catch(() => ({}))),
							// The waltz's alternative versions, where the served tree has them.
							...(await import("/src/music-danube-variants.ts")
								.then((m) => m.danubeVariants())
								.catch(() => ({}))),
							// #589's classical set-pieces, where the served tree has them.
							...(await import("/src/music-classical/index.ts")
								.then((m) => m.CLASSICAL_SONGS)
								.catch(() => ({}))),
						},
					}))
					.catch(() => null)
			: null;
	if (
		(entry.flight && typeof fx.flight !== "function") ||
		(entry.music && !synth) ||
		// A song the served tree does not have: #547's waltz at an older ref.
		(entry.music &&
			Object.values(entry.music.songs ?? {}).some(
				(s) => typeof s === "string" && !synth.songs[s],
			)) ||
		(entry.witchspace && !knownKinds.includes("witchspaceRide")) ||
		(entry.scheduled &&
			!entry.scheduled.kinds.every((k) => knownKinds.includes(k))) ||
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

	if (entry.music) {
		// The synth's own render (#560): loaded into this context and connected
		// to the engine's music bus, as the game will. A command scripted at
		// `"attach"` is sent before `attach` resolves, so the controller holds
		// it (#543 D8); every other is sent at its time, after the lead.
		const music = new synth.Music();
		const ready = music.attach(ctx, fx.musicInput);
		for (const [id, song] of Object.entries(entry.music.songs ?? {}))
			music.load(id, typeof song === "string" ? synth.songs[song] : song);
		const script = entry.music.director
			? await directorScript(entry.music.director, seconds)
			: [...entry.music.script];
		while (script.length && script[0][0] === "attach")
			music.send(script.shift()[1]);
		await ready;
		// And applied: an offline render starts without reading the port, so a
		// held command would otherwise wait for a suspend (`Music.sync`).
		await music.sync();
		const due = new Map();
		const schedule = (t, v) => {
			const key = leadS + t;
			if (!due.has(key)) due.set(key, []);
			due.get(key).push(v);
		};
		for (const [t, cmd] of script) schedule(t, cmd);
		for (const [t, levels] of levelsAt) schedule(t, { levels });
		for (const [at, cmds] of due)
			ctx.suspend(at).then(() => {
				for (const cmd of cmds)
					if (cmd.levels)
						for (const [bus, level] of Object.entries(cmd.levels))
							fx.setLevel(bus, level);
					else music.send(cmd);
				// Resumed only once the worklet has applied them: sent and resumed at
				// once, a command lands at the next suspend instead (`Music.sync`).
				// Resumed on a rejected sync too, so a worklet that failed shows up in
				// `errors` rather than as a render that never ends.
				const resume = () => ctx.resume();
				music.sync().then(resume, resume);
			});
		const buffer = await ctx.startRendering();
		const from = Math.round(leadS * sampleRate);
		const left = buffer.getChannelData(0).subarray(from);
		const right = buffer.getChannelData(1).subarray(from);
		// `samples` is the fold-down, (L + R) / 2 — what a mono destination
		// hears — so every band a probe reads keeps its meaning; the two sides
		// are for the ear.
		const fold = new Float32Array(left.length);
		for (let i = 0; i < fold.length; i++) fold[i] = 0.5 * (left[i] + right[i]);
		return {
			modern,
			sampleRate,
			live: null,
			errors: music.errors,
			samples: Array.from(fold),
			left: Array.from(left),
			right: Array.from(right),
		};
	}

	let state = (typeof seed === "number" ? seed : 1) >>> 0 || 1;
	const seeded = () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 4294967296;
	};
	if (entry.scheduled) {
		const W = await import("/src/witchspace.ts");
		const { witchspaceSoundArms } = await import("/src/witchspace-sound.ts");
		const { arms, unknown } = witchspaceSoundArms(entry.scheduled.arms);
		if (unknown.length)
			throw new Error(`${entry.name}: arms ${entry.scheduled.arms}`);
		const wanted = new Set(entry.scheduled.kinds);
		const found = [];
		let s = W.beginWitchspace();
		for (let i = 0; i < 2000 && wanted.size && s.kind !== "idle"; i++) {
			const next = W.stepJump(s, 1 / 50);
			for (const c of W.witchspaceCues(s, next, arms))
				if (wanted.delete(c.kind)) found.push([W.witchspacePhase(next), c]);
			s = next;
		}
		if (wanted.size)
			throw new Error(`${entry.name}: no ${[...wanted]} in a jump`);
		// Each at its phase from the first. A suspend is quantised to a render
		// quantum and two at one time are refused, so the times are rounded to
		// one and a time two cues share plays both.
		const quantum = 128 / sampleRate;
		const byTime = new Map();
		for (const [phase, cue] of found) {
			const at = Math.round((leadS + phase - found[0][0]) / quantum) * quantum;
			byTime.set(at, [...(byTime.get(at) ?? []), cue]);
		}
		for (const [at, cues] of byTime)
			ctx.suspend(at).then(() => {
				const random = Math.random;
				if (typeof seed === "number") Math.random = seeded;
				try {
					for (const cue of cues) fx.play(cue);
				} finally {
					Math.random = random;
				}
				ctx.resume();
			});
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
	/**
	 * A scripted timeline's reading at `t` (#544, #545). `keys` are
	 * `[seconds, reading]`, each merged over the one before and held, or with
	 * `ramp: true` its numbers reached linearly from the key before. One copy
	 * for both timelines (sage round 1 on #545).
	 */
	const timeline = (keys, initial) => {
		let reading = initial;
		const readings = keys.map(([t, over]) => {
			reading = { ...reading, ...over };
			delete reading.ramp;
			return [t, reading, over.ramp === true];
		});
		return (t) => {
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
	};
	/** Run `onStep(t, dt)` every `dt` of the render on the seeded stream, by
	 *  suspending the render there, and hand back the samples after the lead. */
	const renderSteps = async (dt, onStep) => {
		const random = Math.random;
		for (let i = 0; i * dt < seconds; i++) {
			const t = i * dt;
			ctx.suspend(leadS + t).then(() => {
				if (typeof seed === "number") Math.random = seeded;
				try {
					onStep(t, dt);
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
	};
	if (entry.weapons) {
		const { weaponSound, weaponSoundArms, QUIET_WEAPONS } = await import(
			"/src/weapon-sound.ts"
		);
		const { stepGunFeedback, QUIET_GUN } = await import("/src/gun-feedback.ts");
		const { arms, unknown } = weaponSoundArms(entry.weapons.arms);
		if (unknown.length || arms === "legacy")
			throw new Error(`${entry.name}: arms ${entry.weapons.arms}`);
		const readingAt = timeline(entry.weapons.keys, {
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
		});
		let state = QUIET_WEAPONS;
		let gun = QUIET_GUN;
		let prev = null;
		let sinceStruckS = 9;
		return renderSteps(1 / 50, (t, dt) => {
			const r = readingAt(t);
			const feedback = stepGunFeedback(gun, r.fired, dt);
			gun = feedback.feedback;
			// A fall in the ship's own condition is struck, as `applyDamage` has it.
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
							: {
									id: r.target,
									fore: r.tFore,
									aft: r.tAft,
									hull: r.tHull,
									// Every fall on the scripted target is the player's.
									sinceStruckS: 0,
								},
				},
				arms,
				dt,
			);
			state = step.state;
			for (const cue of step.cues) fx.play(cue);
			fx.weapons(step.mix);
		});
	}
	if (entry.witchspace) {
		const W = await import("/src/witchspace.ts");
		const { witchspaceSoundArms } = await import("/src/witchspace-sound.ts");
		const { flightSound, flightSoundArms, QUIET_FLIGHT } = await import(
			"/src/flight-sound.ts"
		);
		const { arms, unknown } = witchspaceSoundArms(entry.witchspace.arms);
		if (unknown.length)
			throw new Error(`${entry.name}: arms ${entry.witchspace.arms}`);
		const flightArms = flightSoundArms("noclicks").arms;
		const startS = 0.5;
		let ws = W.idleWitchspace();
		let started = false;
		let cut = false;
		let flight = QUIET_FLIGHT;
		return renderSteps(1 / 50, (t, dt) => {
			let next;
			if (!started && t >= startS) {
				started = true;
				next =
					entry.witchspace.from === "arrival"
						? W.arriveWitchspace()
						: W.beginWitchspace();
			} else next = W.stepJump(ws, dt);
			for (const cue of W.witchspaceCues(ws, next, arms)) fx.play(cue);
			if (next.kind === "exit") cut = true;
			ws = next;
			const burning = !cut && entry.witchspace.from === "jump";
			const step = flightSound(
				flight,
				{
					docked: false,
					regime: "normal",
					spool: 0,
					lever: burning ? 0.5 : 0,
					drive: burning ? 0.5 : 0,
					rcs: 0,
					hullShare: 1,
					cruiseSpeed: 0,
					held: false,
					hushed: W.witchspaceHushesBed(ws, arms),
				},
				flightArms,
				dt,
			);
			flight = step.state;
			for (const cue of step.cues) fx.play(cue);
			fx.flight(step.mix);
		});
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
		const readingAt = timeline(entry.flight.keys, {
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
		});
		const cues = [...entry.flight.cues];
		const setAt = [...levelsAt];
		let flight = QUIET_FLIGHT;
		return renderSteps(1 / 50, (t, dt) => {
			const step = flightSound(flight, shareOf(readingAt(t)), arms, dt);
			flight = step.state;
			for (const cue of step.cues) fx.play(cue);
			while (cues.length && cues[0][0] <= t) fx.play(cues.shift()[1]);
			while (setAt.length && setAt[0][0] <= t)
				for (const [bus, level] of Object.entries(setAt.shift()[1]))
					fx.setLevel(bus, level);
			fx.flight(step.mix);
		});
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

/**
 * #589's classical set-pieces (`src/music-classical/`), each played once from
 * its start, as `npm run sounds -- --set classical` renders them for the
 * principal's ear. `seconds` is the excerpt plus its hall, and
 * `tests/music-classical/registry.test.ts` holds it to the song's length.
 */
export const CLASSICAL_SET = Object.freeze(
	/** @type {[string, number][]} */ ([
		["holst-mars", 83],
		["holst-saturn", 81],
		["holst-neptune", 55],
		["strauss-zarathustra", 88],
		["bruckner-7-adagio", 68],
		["dvorak-largo", 95],
		["satie-gymnopedie-1", 70],
		["satie-gnossienne-1", 95],
		["bach-air", 70],
		["bach-wachet-auf", 93],
		["bach-jesu-joy", 71],
		["debussy-nuages", 57],
		["debussy-cathedrale", 70],
		["debussy-clair-de-lune", 66],
		["grieg-mountain-king", 68],
		["borodin-steppes", 63],
		["rachmaninoff-isle-of-the-dead", 60],
		["saint-saens-aquarium", 55],
	]).map(([id, seconds]) => ({
		name: `classical-${id}`,
		seconds,
		music: {
			songs: { [id]: id },
			script: [[0, { type: "play", id, at: "bar" }]],
		},
	})),
);

/**
 * The waltz's alternative versions (`src/music-danube-variants/`), a
 * listening set: `npm run sounds -- --set danube`, or one version with
 * `--only music-danube-<name>`. No probe bands them. Each is scripted as the
 * waltz's renders are: about two loops then the cadence, and the shortest
 * docking run, its cadence at 62 s.
 */
export const DANUBE_VARIANT_SET = Object.freeze(
	readdirSync(new URL("../../src/music-danube-variants/", import.meta.url))
		.filter((f) => f.endsWith(".ts"))
		.sort()
		.flatMap((f) => {
			const id = `danube-${f.slice(0, -3)}`;
			const tune = (name, seconds, resolveS) => ({
				name,
				seconds,
				music: {
					songs: { [id]: id },
					script: [
						[0, { type: "play", id, at: "bar" }],
						[resolveS, { type: "resolve", at: "bar" }],
					],
				},
			});
			return [
				tune(`music-${id}`, 116, 96),
				tune(`music-${id}-run-short`, 76, 62),
			];
		}),
);

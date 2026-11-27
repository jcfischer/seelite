/**
 * The music director (#548): a reading of the pilot's situation in, the
 * synth's transport commands out. Pure, so the danger ladder, the hysteresis
 * and every hand-over between beds are held headless; what they sound like is
 * the principal's ear.
 */
import { describe, expect, test } from "bun:test";
import { BRUCKNER_ADAGIO_SECONDS } from "../src/music-classical/bruckner-7-adagio";
import { DVORAK_LARGO_SECONDS } from "../src/music-classical/dvorak-largo";
import { MARS, MARS_SECONDS } from "../src/music-classical/holst-mars";
import {
	ZARATHUSTRA,
	ZARATHUSTRA_SECONDS,
} from "../src/music-classical/strauss-zarathustra";
import { DANUBE_CANCEL_FADE_S, danubeSong } from "../src/music-danube";
import { VARIANT as JAZZ_TRIO } from "../src/music-danube-variants/jazz-trio";
import {
	CHANCE_COOLDOWN_S,
	chanceCooldownOpen,
	DEFAULT_MUSIC_ARMS,
	dangerLevel,
	FALL_HOLD_S,
	initialMusicState,
	LOW_HULL_SHARE,
	LOW_SHIELD_SHARE,
	MUSIC_BED_NAMES,
	type MusicArms,
	type MusicReading,
	type MusicState,
	musicArms,
	QUIET_READING,
	REFRESH_S,
	SET_PIECES,
	type SetPieceId,
	setPieceCutFadeS,
	STRUCK_WINDOW_S,
	stepMusic,
	systemBed,
	TECHNO_SHARE,
	WALTZ_CADENCE_S,
	WALTZ_DUCK_DB,
	waltzCadenceS,
	waltzDuckDb,
} from "../src/music-director";
import { MusicEngine } from "../src/music-engine";
import { berlinFlightBed } from "../src/music-generate-berlin";
import type { MusicCommand } from "../src/music-score";
import { fullCondition } from "../src/ship-condition";

const calm: MusicReading = { ...QUIET_READING, systemSeed: 1234 };
const at = (over: Partial<MusicReading>): MusicReading => ({
	...calm,
	...over,
});

/** Step the director through `[seconds, reading]` holds at `dt`. */
const fly = (
	legs: readonly (readonly [number, MusicReading])[],
	dt = 0.1,
	state = initialMusicState(),
) => {
	const out: MusicCommand[][] = [];
	for (const [seconds, r] of legs)
		for (let t = 0; t < seconds - 1e-9; t += dt) {
			const s = stepMusic(state, r, dt);
			state = s.state;
			out.push(s.commands);
		}
	return { state, commands: out.flat(), steps: out };
};
const jumps = (cmds: readonly MusicCommand[]) =>
	cmds.flatMap((c) => (c.type === "jump" ? [c.section] : []));

describe("the danger ladder (D4)", () => {
	test("nothing near, clean: calm", () => {
		expect(dangerLevel(calm)).toBe("calm");
	});

	test("wanted, fugitive and an inbound raider are wary", () => {
		expect(dangerLevel(at({ standing: "wanted" }))).toBe("wary");
		expect(dangerLevel(at({ standing: "fugitive" }))).toBe("wary");
		expect(dangerLevel(at({ encounter: "inbound" }))).toBe("wary");
	});

	test("a contest and an unhurt duel are threat", () => {
		expect(dangerLevel(at({ encounter: "contest" }))).toBe("threat");
		expect(dangerLevel(at({ encounter: "duel" }))).toBe("threat");
	});

	test("taking fire is combat", () => {
		expect(dangerLevel(at({ encounter: "duel", raiderFiring: true }))).toBe(
			"combat",
		);
		expect(dangerLevel(at({ sinceStruckS: STRUCK_WINDOW_S - 0.1 }))).toBe(
			"combat",
		);
		expect(dangerLevel(at({ engaged: true }))).toBe("combat");
	});

	test("low condition is combat with a threat and wary without one", () => {
		const low = { shieldShare: LOW_SHIELD_SHARE - 0.01 };
		const hurt = { hullShare: LOW_HULL_SHARE - 0.01 };
		expect(dangerLevel(at({ ...low, encounter: "duel" }))).toBe("combat");
		expect(dangerLevel(at({ ...hurt, encounter: "inbound" }))).toBe("combat");
		expect(dangerLevel(at(hurt))).toBe("wary");
		expect(dangerLevel(at(low))).toBe("wary");
	});

	test("the highest signal wins", () => {
		expect(dangerLevel(at({ standing: "wanted", encounter: "contest" }))).toBe(
			"threat",
		);
	});
});

describe("beds and hand-overs (D2, D3)", () => {
	test("flight starts the system's bed, held at its level, faded in", () => {
		const { steps } = fly([[0.1, calm]]);
		const [load, enter] = steps[0];
		expect(load).toMatchObject({ type: "load", id: "flight-a" });
		expect(enter).toMatchObject({
			type: "crossfade",
			to: "flight-a",
			section: "calm",
			hold: true,
		});
	});

	test("a synth that is not ready is sent nothing, and the first ready frame starts the bed (sage round 1)", () => {
		// `Music.send` holds every command until its worklet loads, with no
		// limit, and for good if it never does: a whole `Song` a refresh.
		const waiting = fly([
			[5, at({ ready: false })],
			[5, at({ ready: false, scene: "docked", stationRole: "trade" })],
			[5, at({ ready: false, encounter: "duel" })],
		]);
		expect(waiting.commands).toEqual([]);
		expect(waiting.state).toEqual(initialMusicState());
		const { steps } = fly([[0.1, calm]], 0.1, waiting.state);
		expect(steps[0][0]).toMatchObject({ type: "load", id: "flight-a" });
		expect(steps[0][1]).toMatchObject({ type: "crossfade", to: "flight-a" });
	});

	test("an arrival in danger enters at that level", () => {
		const { steps } = fly([[0.1, at({ encounter: "duel" })]]);
		expect(steps[0][1]).toMatchObject({ section: "threat" });
	});

	test("docking hands over to the station bed, launching hands back", () => {
		const { commands } = fly([
			[1, calm],
			[1, at({ scene: "docked", stationRole: "refinery" })],
			[1, calm],
		]);
		const moves = commands.filter(
			(c) => c.type !== "stem" && c.type !== "tempo",
		);
		expect(moves.map((c) => c.type)).toEqual([
			"load",
			"crossfade",
			"load",
			"crossfade",
			"crossfade",
		]);
		expect(moves[2]).toMatchObject({ type: "load", id: "station" });
		expect(moves[3]).toMatchObject({ to: "station" });
		expect(moves[4]).toMatchObject({ to: "flight-a", section: "calm" });
	});

	test("witchspace and death fade the music out", () => {
		// The docking computer was a third scene here until #603: it plays
		// the waltz now (`the docking computer's waltz`, below).
		for (const scene of ["witchspace", "dead"] as const) {
			const { steps } = fly([
				[1, calm],
				[0.1, at({ scene })],
			]);
			expect(steps.at(-1)).toEqual([{ type: "stop", at: "now", fadeS: 2.5 }]);
		}
	});

	test("a new system loads a new theme after the jump", () => {
		const { commands } = fly([
			[1, calm],
			[2, at({ scene: "witchspace" })],
			[1, at({ systemSeed: 999 })],
		]);
		const loads = commands.filter((c) => c.type === "load");
		expect(loads).toHaveLength(2);
		expect(loads[1]).toMatchObject({ id: "flight-b" });
		const song = (loads[1] as { song: { name: string } }).song;
		expect(song.name).toContain("999");
	});

	test("a pause holds the music: no command, no clock", () => {
		const before = fly([[1, calm]]).state;
		const r = stepMusic(before, at({ held: true, encounter: "duel" }), 5);
		expect(r.commands).toEqual([]);
		expect(r.state).toEqual(before);
	});
});

describe("moving between levels (D5, D6)", () => {
	test("a rise jumps on the next bar at once", () => {
		const { steps } = fly([
			[1, calm],
			[0.1, at({ encounter: "contest" })],
		]);
		expect(steps.at(-1)).toContainEqual({
			type: "jump",
			section: "threat",
			at: "bar",
			hold: true,
		});
	});

	test("a fall waits for the hold, one level at a time", () => {
		const { commands } = fly([
			[1, at({ encounter: "duel", raiderFiring: true })],
			[FALL_HOLD_S - 0.5, calm],
		]);
		expect(jumps(commands)).toEqual([]);
		const after = fly(
			[[3 * FALL_HOLD_S + 1, calm]],
			0.1,
			fly([[1, at({ encounter: "duel", raiderFiring: true })]]).state,
		);
		expect(jumps(after.commands)).toEqual(["threat", "wary", "calm"]);
	});

	test("a raider at the edge does not flip the mood each second", () => {
		const legs: [number, MusicReading][] = [[1, calm]];
		for (let i = 0; i < 10; i++)
			legs.push([1, at({ encounter: "inbound" })], [1, calm]);
		expect(jumps(fly(legs).commands)).toEqual(["wary"]);
	});
});

describe("cruise and fresh material (D7, D8)", () => {
	test("cruise brings in the travel stem and a small lift, and takes them out", () => {
		const { commands } = fly([
			[1, calm],
			[1, at({ cruise: true })],
			[1, calm],
		]);
		const arp = commands.filter((c) => c.type === "stem" && c.part === "arp");
		expect(arp.map((c) => (c as { level: number }).level)).toEqual([0, 1, 0]);
		const lift = commands.filter((c) => c.type === "tempo");
		expect(lift.map((c) => (c as { scale: number }).scale)).toEqual([
			1, 1.06, 1,
		]);
	});

	test("a long calm brings in a new variant on the next bar", () => {
		const { commands } = fly([[REFRESH_S + 1, calm]], 0.5);
		const fresh = commands.slice(4);
		expect(fresh[0]).toMatchObject({ type: "load", id: "flight-b" });
		expect(fresh[1]).toMatchObject({
			type: "crossfade",
			to: "flight-b",
			at: "bar",
			section: "calm",
			hold: true,
		});
	});
});

describe("the prototype's arms, from ?music=", () => {
	test("no value is the rulings", () => {
		expect(musicArms(null)).toEqual({
			arms: DEFAULT_MUSIC_ARMS,
			unknown: [],
			waltzNamed: false,
		});
	});

	test("off, a forced level and the losing low-hull arm parse", () => {
		const { arms, unknown } = musicArms("threat, lowhull-always,bogus");
		expect(arms).toEqual({
			off: false,
			force: "threat",
			lowHull: "always",
			bed: "system",
			voice: true,
			waltz: "hybrid",
		});
		expect(musicArms("legacy").arms.bed).toBe("legacy");
		expect(musicArms("second").arms.bed).toBe("second");
		expect(unknown).toEqual(["bogus"]);
		expect(musicArms("off").arms.off).toBe(true);
	});

	test("a forced level wins over every signal", () => {
		const arms = { ...DEFAULT_MUSIC_ARMS, force: "wary" as const };
		expect(dangerLevel(at({ raiderFiring: true }), arms)).toBe("wary");
		expect(dangerLevel(calm, arms)).toBe("wary");
	});

	test("lowhull-always holds combat with no threat", () => {
		const arms = { ...DEFAULT_MUSIC_ARMS, lowHull: "always" as const };
		expect(dangerLevel(at({ hullShare: 0.1 }), arms)).toBe("combat");
	});

	test("each bed arm loads its bed, the default the system's draw", () => {
		const legacy = { ...DEFAULT_MUSIC_ARMS, bed: "legacy" as const };
		const song = (arms: MusicArms) => {
			const load = stepMusic(initialMusicState(), calm, 0.1, arms).commands[0];
			if (load.type !== "load") throw new Error(`first command ${load.type}`);
			return load.song;
		};
		expect(song(legacy).sections[0].bars).toBe(16);
		expect(song({ ...DEFAULT_MUSIC_ARMS, bed: "second" }).name).toMatch(
			/^flight /,
		);
		expect(systemBed(calm.systemSeed)).toBe("techno");
		expect(song(DEFAULT_MUSIC_ARMS).name).toMatch(/^techno /);
		expect(song({ ...DEFAULT_MUSIC_ARMS, bed: "school" }).name).toMatch(
			/^school /,
		);
		expect(song({ ...DEFAULT_MUSIC_ARMS, bed: "berlin" }).name).toMatch(
			/^berlin /,
		);
	});

	test("the default bed draws techno for 40 % of systems, the school for the rest", () => {
		const N = 4000;
		let techno = 0;
		for (let i = 0; i < N; i++)
			if (systemBed((i * 2654435761) >>> 0) === "techno") techno++;
		expect(Math.abs(techno / N - TECHNO_SHARE)).toBeLessThan(0.03);
		expect(systemBed(1234)).toBe(systemBed(1234));
	});

	test("every bed carries the cruise stem's part, so a cruise never throws", () => {
		expect(MUSIC_BED_NAMES.length).toBeGreaterThan(20);
		for (const bed of MUSIC_BED_NAMES)
			for (const systemSeed of [1234, 987654]) {
				const arms = musicArms(bed).arms;
				const load = stepMusic(
					initialMusicState(),
					{ ...calm, systemSeed },
					0.1,
					arms,
				).commands[0];
				if (load.type !== "load") throw new Error(`first command ${load.type}`);
				expect(Object.hasOwn(load.song.parts, "arp")).toBe(true);
			}
	});

	test("off plays nothing, and fades out what was playing", () => {
		const off = { ...DEFAULT_MUSIC_ARMS, off: true };
		expect(stepMusic(initialMusicState(), calm, 0.1, off).commands).toEqual([]);
		const playing = fly([[1, calm]]).state;
		expect(stepMusic(playing, calm, 0.1, off).commands).toEqual([
			{ type: "stop", at: "now", fadeS: 2.5 },
		]);
	});
});

test("a ship never struck is not taking fire: a fresh condition reads calm", () => {
	// `fullCondition` starts `sinceStruckS` at the recharge delay, which is
	// the condition's own "not struck lately". A struck window wider than that
	// made every boot and every repair start at combat and fall for 30 s.
	const c = fullCondition("courier");
	expect(dangerLevel(at({ sinceStruckS: c.sinceStruckS }))).toBe("calm");
});

test("death fades the music though it holds the clock", () => {
	// `takeDamage` holds the clock as the ship dies: a held step that returned
	// before reading the scene kept the fight's music looping through death.
	const playing = fly([
		[1, at({ encounter: "duel", raiderFiring: true })],
	]).state;
	const r = stepMusic(playing, at({ scene: "dead", held: true }), 0);
	expect(r.commands).toEqual([{ type: "stop", at: "now", fadeS: 2.5 }]);
	expect(r.state.bed).toBe("none");
});

test("a rise just after a fresh variant is asked for still lands on the next bar", () => {
	const BERLIN_ARMS = { ...DEFAULT_MUSIC_ARMS, bed: "berlin" as const };
	// Through the real engine: a refresh placed on a section line made the
	// incoming song the lead at once, and a rise sent then waited for that
	// line — up to a whole section of calm under a raider.
	const SR = 48000;
	const heard: { frame: number; part: string }[] = [];
	const engine = new MusicEngine(
		SR,
		undefined,
		(_, frame, part) => heard.push({ frame, part }),
		{ countOnly: true },
	);
	const out = new Float32Array(128);
	let frame = 0;
	let state = initialMusicState();
	let riseAt = -1;
	const steps = Math.round((REFRESH_S + 20) / 0.1);
	for (let i = 0; i < steps; i++) {
		const t = i * 0.1;
		// The rise comes 0.5 s after the refresh.
		const r = t >= REFRESH_S + 0.5 ? at({ encounter: "contest" }) : calm;
		if (riseAt < 0 && r !== calm) riseAt = Math.round(t * SR);
		const s = stepMusic(state, r, 0.1, BERLIN_ARMS);
		state = s.state;
		for (const cmd of s.commands) engine.command(cmd, frame);
		for (const end = Math.round((t + 0.1) * SR); frame < end; frame += 128)
			engine.render(out, frame);
	}
	const bpm = berlinFlightBed(calm.systemSeed, 0).tempo[0].bpm;
	const barFrames = (4 * 60 * SR) / bpm;
	// A part only threat and combat play: the second bed's calm can carry its
	// motif on `lead`, which would pass this without any rise. Threat's first
	// hat is half a beat after its line.
	const hat = heard.find((h) => h.part === "hat" && h.frame >= riseAt);
	expect(hat).toBeDefined();
	expect((hat?.frame ?? Infinity) - riseAt).toBeLessThanOrEqual(
		1.25 * barFrames + 128,
	);
}, 30000);

test("switching between two beds loads the other one", () => {
	const second = fly([[1, calm]]).state;
	const legacy = { ...DEFAULT_MUSIC_ARMS, bed: "legacy" as const };
	const r = stepMusic(second, calm, 0.1, legacy);
	const load = r.commands.find((c) => c.type === "load");
	expect(load).toBeDefined();
	if (load?.type !== "load") throw new Error("no load");
	expect(load.song.sections[0].bars).toBe(16);
	expect(r.commands.some((c) => c.type === "crossfade")).toBe(true);
});

describe("the docking computer's waltz (#603)", () => {
	const computer = at({ scene: "dockingComputer" });
	const arriving = at({ scene: "docked", stationRole: "trade" });
	const moves = (cmds: readonly MusicCommand[]) =>
		cmds.filter((c) => c.type !== "stem" && c.type !== "tempo");

	test("engaging loads the waltz in the ruled voicing and plays it on the bar", () => {
		const { steps } = fly([
			[1, calm],
			[0.1, computer],
		]);
		const engage = steps.at(-1) ?? [];
		expect(engage.map((c) => c.type)).toEqual(["load", "play"]);
		const [load, play] = engage;
		if (load.type !== "load") throw new Error(load.type);
		expect(load.id).toBe("danube");
		// The principal's ruling on #603: hybrid, D12's B.
		expect(load.song.name).toContain("(hybrid)");
		// `play`, not a stop: the bed's notes ring out under the intro.
		expect(play).toEqual({ type: "play", id: "danube", at: "bar" });
	});

	test("the run sends nothing more, and a second run does not load again", () => {
		const { steps, commands } = fly([
			[1, calm],
			[20, computer],
			[3, arriving],
			[2, at({ scene: "docked", stationRole: "trade" })],
			[1, calm],
			[5, computer],
		]);
		// One load for the whole session, one play for each engage.
		const danube = commands.filter(
			(c) =>
				(c.type === "load" && c.id === "danube") ||
				(c.type === "play" && c.id === "danube"),
		);
		expect(danube.map((c) => c.type)).toEqual(["load", "play", "play"]);
		// Nothing in the 199 frames between the engage and the plane.
		expect(steps.slice(11, 210).flat()).toEqual([]);
	});

	test("the plane resolves on the bar, and the station bed waits for the cadence (D1)", () => {
		const { steps } = fly([
			[1, calm],
			[20, computer],
			[WALTZ_CADENCE_S + 1, arriving],
		]);
		const plane = 10 + 200;
		expect(steps[plane]).toEqual([{ type: "resolve", at: "bar" }]);
		const after = steps.slice(plane + 1);
		const first = after.findIndex((cmds) => cmds.length > 0);
		// The station bed, from silence: the waltz ended on its own.
		expect(moves(after[first]).map((c) => c.type)).toEqual([
			"load",
			"crossfade",
		]);
		expect(after[first][1]).toMatchObject({ to: "station", fadeS: 3 });
		expect((first + 1) * 0.1).toBeGreaterThanOrEqual(WALTZ_CADENCE_S - 1e-9);
		expect((first + 1) * 0.1).toBeLessThan(WALTZ_CADENCE_S + 0.1 + 1e-9);
	});

	test("the cadence's hold is one waltz bar to reach the line, then the cadence", () => {
		// D1's figures off the score: the cadence is four bars of three beats
		// broadening from 160 to 120 a minute, so between 4 x 1.125 s and
		// 4 x 1.5 s, after at most one 1.125 s bar of the waltz to its line.
		expect(WALTZ_CADENCE_S).toBeGreaterThan(5 * 1.125);
		expect(WALTZ_CADENCE_S).toBeLessThan(1.125 + 4 * 1.5);
	});

	test("the cadence's hold is the playing voicing's, read off its own song (sage round 1)", () => {
		expect(WALTZ_CADENCE_S).toBe(waltzCadenceS("hybrid"));
		// The three share Strauss's tempo map today; each is still read off
		// its own song, so a voicing that changed it would move its own hold.
		for (const v of ["orchestra", "oxygene"] as const)
			expect(waltzCadenceS(v)).toBeCloseTo(WALTZ_CADENCE_S, 9);
		// The state keeps the voicing that was loaded, which is the key the
		// resolving branch reads. Which hold it reads cannot be told apart by
		// duration while the three share one tempo map (sage round 2).
		const oxygene = { ...DEFAULT_MUSIC_ARMS, waltz: "oxygene" as const };
		let state = fly([
			[1, calm],
			[20, computer],
		]).state;
		state = stepMusic(state, arriving, 0.1, oxygene).state;
		expect(state.waltz).toBe("resolving");
		expect(state.waltzKey).toBe("hybrid");
	});

	test("the pilot takes the stick: a two-bar fade, and the bed is back on the bar (D2)", () => {
		const { steps, state } = fly([
			[1, calm],
			[20, computer],
			[0.1, calm],
		]);
		const cancel = steps.at(-1) ?? [];
		expect(cancel[0]).toEqual({
			type: "stop",
			at: "now",
			fadeS: DANUBE_CANCEL_FADE_S,
		});
		// The same system's bed, already loaded, from silence: no load.
		expect(moves(cancel.slice(1))).toEqual([
			expect.objectContaining({
				type: "crossfade",
				to: "flight-a",
				section: "calm",
				at: "bar",
			}),
		]);
		expect(state.bed).toBe("flight");
		expect(state.waltz).toBe("none");
	});

	test("death and witchspace under the waltz fade it as a cancel does, once", () => {
		for (const scene of ["dead", "witchspace"] as const) {
			const { steps } = fly([
				[1, calm],
				[20, computer],
				[0.1, at({ scene, held: scene === "dead" })],
			]);
			expect(steps.at(-1)).toEqual([
				{ type: "stop", at: "now", fadeS: DANUBE_CANCEL_FADE_S },
			]);
		}
	});

	test("the ship bus ducks while the waltz plays, and returns at the plane or the cancel (D5)", () => {
		expect(WALTZ_DUCK_DB).toBe(6);
		const playing = fly([
			[1, calm],
			[5, computer],
		]).state;
		expect(waltzDuckDb(playing, true)).toBe(WALTZ_DUCK_DB);
		expect(waltzDuckDb(stepMusic(playing, arriving, 0.1).state, true)).toBe(0);
		expect(waltzDuckDb(stepMusic(playing, calm, 0.1).state, true)).toBe(0);
		expect(waltzDuckDb(fly([[1, calm]]).state, true)).toBe(0);
		// Music off in the Sound tab: no waltz is heard, so nothing ducks.
		expect(waltzDuckDb(playing, false)).toBe(0);
	});

	test("a synth that becomes ready mid-run starts the waltz then, and a pause holds it", () => {
		const waiting = fly([[5, at({ scene: "dockingComputer", ready: false })]]);
		expect(waiting.commands).toEqual([]);
		const r = stepMusic(waiting.state, computer, 0.1);
		expect(r.commands.map((c) => c.type)).toEqual(["load", "play"]);
		// A run that never started the waltz has nothing to resolve.
		const plane = stepMusic(waiting.state, arriving, 0.1);
		expect(plane.commands.some((c) => c.type === "resolve")).toBe(false);
		// Held: the opening, a menu. Nothing starts, and nothing ends.
		expect(
			stepMusic(waiting.state, at({ ...computer, held: true }), 0.1).commands,
		).toEqual([]);
		const held = stepMusic(r.state, at({ ...computer, held: true }), 0.1);
		expect(held.commands).toEqual([]);
	});

	test("off plays no waltz", () => {
		const off = { ...DEFAULT_MUSIC_ARMS, off: true };
		expect(stepMusic(initialMusicState(), computer, 0.1, off).commands).toEqual(
			[],
		);
	});

	test("?music= picks the voicing, and hybrid is the default", () => {
		expect(musicArms("oxygene").waltzNamed).toBe(true);
		expect(musicArms("techno,calm").waltzNamed).toBe(false);
		expect(DEFAULT_MUSIC_ARMS.waltz).toBe("hybrid");
		for (const v of ["orchestra", "oxygene", "hybrid"] as const) {
			const { arms } = musicArms(v);
			expect(arms.waltz).toBe(v);
			const load = stepMusic(initialMusicState(), computer, 0.1, arms)
				.commands[0];
			if (load.type !== "load") throw new Error(load.type);
			expect(load.song.name).toContain(`(${v})`);
		}
	});

	test("through the real engine: the cadence is heard after the plane, and the station bed only after it", () => {
		const SR = 48000;
		const heard: { id: string; frame: number; part: string }[] = [];
		const engine = new MusicEngine(
			SR,
			undefined,
			(id, frame, part) => heard.push({ id, frame, part }),
			{ countOnly: true },
		);
		const out = new Float32Array(128);
		let frame = 0;
		let state = initialMusicState();
		let planeAt = -1;
		let engageAt = -1;
		const legs: [number, MusicReading][] = [
			[3, calm],
			[40, computer],
			[WALTZ_CADENCE_S + 6, arriving],
		];
		let t = 0;
		for (const [seconds, r] of legs)
			for (let end = t + seconds; t < end - 1e-9; t += 0.1) {
				if (r === computer && engageAt < 0) engageAt = frame;
				if (r === arriving && planeAt < 0) planeAt = frame;
				const s = stepMusic(state, r, 0.1);
				state = s.state;
				for (const cmd of s.commands) engine.command(cmd, frame);
				for (
					const stop = Math.round((t + 0.1) * SR);
					frame < stop;
					frame += 128
				)
					engine.render(out, frame);
			}
		// `engine.command` throws on a move it cannot honour: a resolve with
		// nothing playing would have ended this test there.
		const danube = heard.filter((h) => h.id === "danube");
		// It started within a bar of the bed's line after the engage.
		expect(danube[0].frame - engageAt).toBeLessThan(4 * SR);
		// The cadence's held tonic, on the melody and the answer, after the plane.
		const lastDanube = danube.at(-1);
		expect(lastDanube && lastDanube.frame).toBeGreaterThan(planeAt);
		expect(
			danube.filter((h) => h.frame > planeAt && h.part === "answer").length,
		).toBeGreaterThan(0);
		const station = heard.filter((h) => h.id === "station");
		expect(station.length).toBeGreaterThan(0);
		// The station bed's first note comes after the waltz's last.
		expect(station[0].frame).toBeGreaterThan(lastDanube?.frame ?? Infinity);
		// And after the plane by at least the cadence's own length.
		expect(station[0].frame - planeAt).toBeGreaterThanOrEqual(
			Math.round((WALTZ_CADENCE_S - 1.125) * SR),
		);
	}, 30000);
});

describe("classical set-pieces (#589 D10, node #771)", () => {
	const fresh = at({ firsts: [] });
	const docked = at({ scene: "docked", stationRole: "trade", firsts: [] });
	const combat = at({ firsts: [], raiderFiring: true, encounter: "duel" });
	const threat = at({ firsts: [], encounter: "contest" });

	const run = (
		legs: readonly (readonly [number, MusicReading])[],
		opts: {
			dt?: number;
			gameDt?: number;
			state?: MusicState;
			onStep?: (commands: readonly MusicCommand[], endS: number) => void;
		} = {},
	) => {
		const dt = opts.dt ?? 0.1;
		const gameDt = opts.gameDt ?? dt;
		let state = opts.state ?? initialMusicState();
		const steps: { commands: MusicCommand[]; played?: string }[] = [];
		for (const [seconds, r] of legs) {
			let first = true;
			for (let t = 0; t < seconds - 1e-9; t += dt) {
				const s = stepMusic(
					state,
					{ ...r, wallDtS: dt, cue: first ? r.cue : null },
					gameDt,
				);
				first = false;
				state = s.state;
				steps.push({ commands: s.commands, played: s.played });
				opts.onStep?.(s.commands, steps.length * dt);
			}
		}
		return {
			state,
			steps,
			commands: steps.flatMap((s) => s.commands),
			played: steps.flatMap((s) => (s.played ? [s.played] : [])),
		};
	};

	const loads = (cmds: readonly MusicCommand[]) =>
		cmds.flatMap((c) => (c.type === "load" ? [c.song.name] : []));
	const pieceLoads = (cmds: readonly MusicCommand[]) =>
		cmds.flatMap((c) =>
			c.type === "load" && c.id.startsWith("piece-") ? [c.id] : [],
		);
	const seconds = (id: SetPieceId) => SET_PIECES[id].seconds;
	const cutFade = (cmds: readonly MusicCommand[]) =>
		cmds.flatMap((c) => (c.type === "stop" ? [c.fadeS] : []));

	test("each piece's length is its score's, read off the tempo map", () => {
		expect(seconds("strauss-zarathustra")).toBeCloseTo(ZARATHUSTRA_SECONDS, 3);
		expect(seconds("dvorak-largo")).toBeCloseTo(DVORAK_LARGO_SECONDS, 3);
		expect(seconds("bruckner-7-adagio")).toBeCloseTo(
			BRUCKNER_ADAGIO_SECONDS,
			3,
		);
		expect(seconds("holst-mars")).toBeCloseTo(MARS_SECONDS, 3);
	});

	test("the boot plays Zarathustra on the bar, with no duck, and starts the cooldown (D3, D4)", () => {
		const out = run([
			[1, { ...docked, gameTimeS: 500 }],
			[1, { ...docked, gameTimeS: 501, cue: "boot" }],
		]);
		const boot = out.steps[10].commands;
		expect(boot.map((c) => c.type)).toEqual(["load", "play"]);
		expect(loads(boot)).toEqual([ZARATHUSTRA.name]);
		expect(boot[1]).toMatchObject({ type: "play", at: "bar" });
		expect(out.state.piece).toBe("strauss-zarathustra");
		expect(out.state.bed).toBe("none");
		expect(waltzDuckDb(out.state, true)).toBe(0);
		expect(out.played).toEqual([]);
		expect(chanceCooldownOpen(out.state, 501 + CHANCE_COOLDOWN_S - 1)).toBe(
			false,
		);
		expect(chanceCooldownOpen(out.state, 501 + CHANCE_COOLDOWN_S)).toBe(true);
	});

	test("a boot asked for before the synth is ready plays on its first ready frame", () => {
		const out = run([
			[0.5, { ...docked, ready: false, cue: "boot" }],
			[0.1, docked],
		]);
		expect(out.steps.slice(0, 5).flatMap((s) => s.commands)).toEqual([]);
		expect(loads(out.steps[5].commands)).toEqual([ZARATHUSTRA.name]);
	});

	test("danger read while docked does not hold back a piece: the ladder is flight's", () => {
		const out = run([[1, { ...docked, sinceStruckS: 0, cue: "boot" }]]);
		expect(loads(out.commands)).toEqual([ZARATHUSTRA.name]);
	});

	test("the boot plays over the opening, which holds the clock (#771 Q3)", () => {
		const out = run([[1, { ...fresh, held: true, cue: "boot" }]]);
		expect(loads(out.commands)).toEqual([ZARATHUSTRA.name]);
	});

	test("a piece plays to its end on the wall clock, through a pause, and the bed is back on the bar", () => {
		const len = seconds("strauss-zarathustra");
		const out = run(
			[
				[0.1, { ...docked, cue: "boot" }],
				[len - 0.3, docked],
				[0.6, docked],
			],
			{ gameDt: 0 },
		);
		const during = out.steps.slice(1, Math.round(len / 0.1) - 2);
		expect(during.flatMap((s) => s.commands)).toEqual([]);
		const back = out.commands.find((c) => c.type === "crossfade");
		expect(back).toMatchObject({ to: "station", at: "bar" });
		expect(out.state.piece).toBeNull();
		expect(out.state.bed).toBe("station");
	});

	test("the boot is not a first: it plays on every boot and marks nothing", () => {
		const out = run([[0.1, { ...docked, cue: "boot" }]]);
		expect(out.played).toEqual([]);
	});

	for (const [cue, id] of [
		["newHull", "dvorak-largo"],
		["capitalShip", "bruckner-7-adagio"],
	] as const) {
		test(`${cue} plays ${id} once, and marks it heard (D5, D6)`, () => {
			const out = run([[1, { ...fresh, cue }]]);
			expect(loads(out.commands)).toEqual([SET_PIECES[id].song.name]);
			expect(out.played).toEqual([id]);
			const again = run([[1, { ...fresh, firsts: [id], cue }]]);
			expect(pieceLoads(again.commands)).toEqual([]);
		});
	}

	test("a first nobody can hear does not play and stays owed (#771 Q4)", () => {
		const out = run([[1, { ...fresh, heard: false, cue: "newHull" }]]);
		expect(pieceLoads(out.commands)).toEqual([]);
		expect(out.played).toEqual([]);
	});

	test("a first under a higher owner does not play and stays owed (D11)", () => {
		for (const scene of ["witchspace", "dockingComputer", "dead"] as const) {
			const out = run([[1, { ...fresh, scene, cue: "capitalShip" }]]);
			expect(pieceLoads(out.commands)).toEqual([]);
			expect(out.played).toEqual([]);
		}
		const tense = run([[1, { ...threat, cue: "capitalShip" }]]);
		expect(pieceLoads(tense.commands)).toEqual([]);
	});

	test("off plays no piece, the boot's included", () => {
		const arms = { ...DEFAULT_MUSIC_ARMS, off: true };
		const s = stepMusic(
			initialMusicState(),
			{ ...docked, wallDtS: 0.1, cue: "boot" },
			0.1,
			arms,
		);
		expect(pieceLoads(s.commands)).toEqual([]);
	});

	test("the cut order: death, witchspace and the docking computer fade a piece over two of its bars (D10)", () => {
		const fade = setPieceCutFadeS("dvorak-largo");
		expect(fade).toBeCloseTo(
			(2 * seconds("dvorak-largo")) / SET_PIECES["dvorak-largo"].bars,
			6,
		);
		for (const scene of ["dead", "witchspace", "dockingComputer"] as const) {
			const out = run([
				[1, { ...fresh, cue: "newHull" }],
				[0.1, { ...fresh, scene }],
			]);
			expect(cutFade(out.steps.at(-1)?.commands ?? [])).toEqual([fade]);
			expect(out.state.piece).toBeNull();
		}
		const waltz = run([
			[1, { ...fresh, cue: "newHull" }],
			[0.1, { ...fresh, scene: "dockingComputer" }],
		]);
		expect(waltz.state.waltz).toBe("playing");
	});

	test("a rise to threat cuts the piece, and the bed comes back at threat (D10)", () => {
		const out = run([
			[1, { ...fresh, cue: "capitalShip" }],
			[0.1, threat],
		]);
		const cut = out.steps.at(-1)?.commands ?? [];
		expect(cutFade(cut)).toEqual([setPieceCutFadeS("bruckner-7-adagio")]);
		expect(cut.find((c) => c.type === "crossfade")).toMatchObject({
			section: "threat",
			at: "bar",
		});
		expect(out.state.level).toBe("threat");
	});

	test("a cut piece does not replay: its first was marked as it started", () => {
		const out = run([
			[1, { ...fresh, cue: "capitalShip" }],
			[0.1, { ...fresh, scene: "witchspace" }],
		]);
		expect(out.played).toEqual(["bruckner-7-adagio"]);
	});

	test("the first combat plays Mars in place of the combat bed (D7)", () => {
		const out = run([
			[2, fresh],
			[0.1, combat],
		]);
		const rise = out.steps.at(-1)?.commands ?? [];
		expect(loads(rise)).toEqual([MARS.name]);
		expect(jumps(rise)).toEqual([]);
		expect(out.played).toEqual(["holst-mars"]);
		const later = run([
			[2, { ...fresh, firsts: ["holst-mars"] }],
			[0.1, { ...combat, firsts: ["holst-mars"] }],
		]);
		expect(jumps(later.commands)).toEqual(["combat"]);
		expect(pieceLoads(later.commands)).toEqual([]);
	});

	test("Mars plays on through threat, and fades over two bars once danger has held below it (D7)", () => {
		const fade = setPieceCutFadeS("holst-mars");
		const held = run([
			[2, fresh],
			[1, combat],
			[FALL_HOLD_S + 2, threat],
		]);
		expect(cutFade(held.commands)).toEqual([]);
		expect(held.state.piece).toBe("holst-mars");
		const calmed = run([
			[2, fresh],
			[1, combat],
			[FALL_HOLD_S - 0.5, fresh],
		]);
		expect(cutFade(calmed.commands)).toEqual([]);
		const gone = run([
			[2, fresh],
			[1, combat],
			[FALL_HOLD_S + 0.5, fresh],
		]);
		expect(cutFade(gone.commands)).toEqual([fade]);
		expect(gone.state.piece).toBeNull();
		expect(gone.state.bed).toBe("flight");
	});

	test("a piece cut by the first fight hands to Mars in the other slot", () => {
		const out = run([
			[1, { ...fresh, cue: "newHull" }],
			[0.1, combat],
		]);
		expect(pieceLoads(out.commands)).toEqual(["piece-a", "piece-b"]);
		expect(out.played).toEqual(["dvorak-largo", "holst-mars"]);
	});

	test("the bed holds its cruise lift and level jumps while a piece plays (#771 D3)", () => {
		const out = run([
			[1, { ...fresh, cue: "newHull" }],
			[2, { ...fresh, cruise: true }],
			[2, { ...fresh, encounter: "inbound" }],
		]);
		const after = out.steps.slice(10).flatMap((s) => s.commands);
		expect(
			after.filter((c) => c.type === "stem" || c.type === "tempo"),
		).toEqual([]);
		expect(jumps(after)).toEqual([]);
	});

	const one = (
		state: MusicState,
		r: MusicReading,
		wallDtS: number,
		arms: MusicArms = DEFAULT_MUSIC_ARMS,
	) => stepMusic(state, { ...r, wallDtS }, wallDtS, arms);

	test("the cooldown is open before any boot, and shut for 25 minutes after one (D4)", () => {
		expect(chanceCooldownOpen(initialMusicState(), 0)).toBe(true);
		const boot = one(
			initialMusicState(),
			{ ...docked, gameTimeS: 100, cue: "boot" },
			0.1,
		);
		expect(chanceCooldownOpen(boot.state, 100 + 24 * 60)).toBe(false);
		expect(chanceCooldownOpen(boot.state, 100 + 25 * 60)).toBe(true);
	});

	test("a cut fades every piece over a short tail, never backwards", () => {
		for (const id of Object.keys(SET_PIECES) as SetPieceId[]) {
			expect(setPieceCutFadeS(id)).toBeGreaterThan(0);
			expect(setPieceCutFadeS(id)).toBeLessThan(seconds(id) / 3);
		}
	});

	test("a cut is one stop now, faded over the piece's two bars", () => {
		const out = run([
			[0.1, { ...docked, cue: "boot" }],
			[0.1, { ...docked, scene: "witchspace" }],
		]);
		expect(out.steps[1].commands).toEqual([
			{
				type: "stop",
				at: "now",
				fadeS: setPieceCutFadeS("strauss-zarathustra"),
			},
		]);
	});

	test("a piece starts on the first frame, ends on the frame its length is reached with the bed in that frame, and the next goes to the other slot", () => {
		const start = one(initialMusicState(), { ...docked, cue: "boot" }, 0);
		expect(pieceLoads(start.commands)).toEqual(["piece-a"]);
		const end = one(start.state, docked, seconds("strauss-zarathustra"));
		expect(end.state.piece).toBeNull();
		expect(end.commands.map((c) => c.type)).toEqual(["load", "crossfade"]);
		const next = one(end.state, { ...docked, cue: "newHull" }, 0.1);
		expect(pieceLoads(next.commands)).toEqual(["piece-b"]);
	});

	test("Mars is cut on the frame its fall reaches the hold, not one later (D7)", () => {
		let state = one(initialMusicState(), combat, 0.5).state;
		expect(state.piece).toBe("holst-mars");
		let longest = 0;
		for (let i = 0; i < 200 && state.piece === "holst-mars"; i++) {
			longest = Math.max(longest, state.pieceFallS);
			state = one(state, fresh, 0.5).state;
		}
		expect(state.piece).toBeNull();
		expect(longest).toBe(FALL_HOLD_S - 0.5);
	});

	test("a boot asked for while the music is off is not owed once it is back on", () => {
		const off = { ...DEFAULT_MUSIC_ARMS, off: true };
		const asked = one(
			initialMusicState(),
			{ ...docked, cue: "boot" },
			0.1,
			off,
		);
		const on = run([[1, docked]], { state: asked.state });
		expect(pieceLoads(on.commands)).toEqual([]);
	});

	test("a boot in the berth waits for the waltz's cadence, then plays", () => {
		const waltz = { version: "hybrid", song: danubeSong("hybrid") };
		const out = run([
			[1, { ...fresh, scene: "dockingComputer", waltz }],
			[0.1, { ...docked, cue: "boot" }],
		]);
		expect(out.state.waltz).not.toBe("none");
		expect(pieceLoads(out.commands)).toEqual([]);
		const later = run([[120, docked]], { state: out.state });
		expect(loads(later.commands)).toContain(ZARATHUSTRA.name);
	});

	test("a slot still fading its cut is not loaded again: with both fading, nothing starts", () => {
		const out = run([
			[0.1, { ...docked, cue: "boot" }],
			[0.1, { ...docked, scene: "witchspace" }],
			[0.1, { ...docked, cue: "newHull" }],
			[0.1, { ...docked, scene: "witchspace" }],
			[0.1, { ...docked, cue: "capitalShip" }],
		]);
		expect(pieceLoads(out.commands)).toEqual(["piece-a", "piece-b"]);
		expect(out.state.piece).toBeNull();
	});

	test("from either slot, a piece goes back to its own when the other is still fading", () => {
		const out = run([
			[0.1, { ...docked, cue: "boot" }],
			[0.1, { ...docked, scene: "witchspace" }],
			[0.1, { ...docked, cue: "capitalShip" }],
			[0.1, { ...docked, scene: "witchspace" }],
			[8, fresh],
			[0.1, combat],
			[0.1, { ...combat, scene: "witchspace" }],
			[4, docked],
			[0.1, { ...docked, cue: "newHull" }],
		]);
		expect(pieceLoads(out.commands)).toEqual([
			"piece-a",
			"piece-b",
			"piece-a",
			"piece-a",
		]);
		expect(out.state.piece).toBe("dvorak-largo");
	});

	test("a piece goes back to its own slot when the other is still fading", () => {
		const out = run([
			[0.1, { ...fresh, cue: "boot" }],
			[0.1, combat],
			[0.1, { ...combat, scene: "witchspace" }],
			[5, docked],
			[0.1, { ...docked, cue: "capitalShip" }],
		]);
		expect(pieceLoads(out.commands)).toEqual(["piece-a", "piece-b", "piece-b"]);
		expect(out.state.piece).toBe("bruckner-7-adagio");
	});

	test("through the real engine: a boot, a first, a cut and Mars, with no command refused", () => {
		const SR = 48000;
		const heard: string[] = [];
		const refused: string[] = [];
		const engine = new MusicEngine(SR, undefined, (id) => heard.push(id), {
			countOnly: true,
		});
		const out = new Float32Array(128);
		let frame = 0;
		const { state } = run(
			[
				[0.1, { ...docked, cue: "boot" }],
				[seconds("strauss-zarathustra") + 2, docked],
				[3, fresh],
				[0.1, { ...fresh, cue: "newHull" }],
				[3, fresh],
				[0.1, { ...fresh, scene: "dockingComputer" }],
				[4, { ...fresh, scene: "dockingComputer" }],
				[3, fresh],
				[0.1, { ...fresh, cue: "capitalShip" }],
				[2, fresh],
				[6, combat],
			],
			{
				onStep: (commands, endS) => {
					for (const cmd of commands)
						try {
							engine.command(cmd, frame);
						} catch (error) {
							refused.push(`${cmd.type}: ${String(error)}`);
						}
					for (const stop = Math.round(endS * SR); frame < stop; frame += 128)
						engine.render(out, frame);
				},
			},
		);
		expect(refused).toEqual([]);
		expect(heard).toContain("piece-a");
		expect(heard).toContain("piece-b");
		expect(heard).toContain("station");
		expect(heard).toContain("danube");
		expect(state.piece).toBe("holst-mars");
	}, 60000);
});

describe("the sampled waltz's samples (node #1325)", () => {
	const song = JAZZ_TRIO;
	const jazz = { version: "jazz-trio", song };
	const armed = at({ scene: "dockingComputer", waltz: jazz });
	const docked = at({ scene: "docked", stationRole: "trade" });
	const kinds = (steps: ReturnType<typeof stepMusic>[]) =>
		steps.map((s) => {
			if (!s.samples) return "-";
			if ("load" in s.samples) return "load";
			return s.samples.release === true ? "release" : "?";
		});
	const run = (
		readings: MusicReading[],
		arms: MusicArms = DEFAULT_MUSIC_ARMS,
	) => {
		let state = initialMusicState();
		const out: ReturnType<typeof stepMusic>[] = [];
		for (const r of readings) {
			const s = stepMusic(state, r, 0.1, arms);
			state = s.state;
			out.push(s);
		}
		return out;
	};
	const calmFor = (seconds: number) =>
		Array.from({ length: Math.round(seconds / 0.1) }, () => calm);

	test("arming the computer loads the version once, in the step the waltz loads", () => {
		const out = run([calm, armed, armed, armed]);
		expect(kinds(out)).toEqual(["-", "load", "-", "-"]);
		const first = out[1].samples;
		expect(first && "load" in first && first.load).toBe(song);
		expect(out[1].commands.map((c) => c.type)).toContain("load");
	});

	test("a waltz in the reading loads nothing until the computer is armed", () => {
		expect(kinds(run([at({ waltz: jazz }), at({ waltz: jazz })]))).toEqual([
			"-",
			"-",
		]);
	});

	test("a held computer still loads; with the music off nothing loads", () => {
		expect(kinds(run([calm, at({ ...armed, held: true })]))).toEqual([
			"-",
			"load",
		]);
		expect(
			kinds(run([calm, armed], { ...DEFAULT_MUSIC_ARMS, off: true })),
		).toEqual(["-", "-"]);
	});

	test("a held computer keeps its samples while the waltz waits to start", () => {
		const held = at({ ...armed, held: true });
		const out = run([calm, held, held, held, armed]);
		expect(kinds(out)).toEqual(["-", "load", "-", "-", "-"]);
		expect(out[3].state.waltz).toBe("none");
		expect(out[3].state.samplesKey).toBe("jazz-trio");
	});

	test("a pilot who dies or jumps with a waltz in the reading loads nothing", () => {
		expect(
			kinds(
				run([
					at({ scene: "dead", waltz: jazz }),
					at({ scene: "witchspace", waltz: jazz }),
				]),
			),
		).toEqual(["-", "-"]);
	});

	test("disarming without docking releases once, when the waltz has stopped", () => {
		const out = run([armed, armed, ...calmFor(WALTZ_CADENCE_S + 10)]);
		const k = kinds(out);
		expect(k.filter((x) => x === "release")).toEqual(["release"]);
		const at_ = k.indexOf("release");
		expect(out[at_].state.waltz).toBe("none");
		expect(out[at_ - 1].state.waltz).not.toBe("none");
		expect(out.at(-1)?.state.samplesKey).toBeNull();
	});

	test("a berth holds the samples and undocking releases them", () => {
		const out = run([
			armed,
			armed,
			...Array.from(
				{ length: Math.round((WALTZ_CADENCE_S + 10) / 0.1) },
				() => docked,
			),
			calm,
			calm,
		]);
		const k = kinds(out);
		expect(k.slice(0, -2).filter((x) => x !== "-")).toEqual(["load"]);
		expect(k.slice(-2)).toEqual(["release", "-"]);
	});

	test("the next arming after a release loads again", () => {
		const out = run([armed, ...calmFor(WALTZ_CADENCE_S + 10), armed]);
		expect(kinds(out).filter((x) => x !== "-")).toEqual([
			"load",
			"release",
			"load",
		]);
	});

	test("a version with no sampled part loads nothing and releases nothing", () => {
		const synth = at({
			scene: "dockingComputer",
			waltz: { version: "hybrid", song: danubeSong("hybrid") },
		});
		const out = run([synth, synth, docked, ...calmFor(2)]);
		expect(kinds(out).filter((x) => x !== "-")).toEqual([]);
	});
});

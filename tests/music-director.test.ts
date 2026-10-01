/**
 * The music director (#548): a reading of the pilot's situation in, the
 * synth's transport commands out. Pure, so the danger ladder, the hysteresis
 * and every hand-over between beds are held headless; what they sound like is
 * the principal's ear.
 */
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_MUSIC_ARMS,
	dangerLevel,
	FALL_HOLD_S,
	initialMusicState,
	LOW_HULL_SHARE,
	LOW_SHIELD_SHARE,
	type MusicArms,
	musicArms,
	type MusicReading,
	QUIET_READING,
	REFRESH_S,
	STRUCK_WINDOW_S,
	stepMusic,
} from "../src/music-director";
import type { MusicCommand } from "../src/music-score";
import { fullCondition } from "../src/ship-condition";
import { MusicEngine } from "../src/music-engine";
import { berlinFlightBed } from "../src/music-generate-berlin";

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

	test("witchspace, the docking computer and death fade the music out", () => {
		for (const scene of ["witchspace", "dockingComputer", "dead"] as const) {
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
		expect(musicArms(null)).toEqual({ arms: DEFAULT_MUSIC_ARMS, unknown: [] });
	});

	test("off, a forced level and the losing low-hull arm parse", () => {
		const { arms, unknown } = musicArms("threat, lowhull-always,bogus");
		expect(arms).toEqual({
			off: false,
			force: "threat",
			lowHull: "always",
			bed: "berlin",
			voice: true,
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

	test("each bed arm loads its bed, the default the Berlin prototype", () => {
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
		expect(song(DEFAULT_MUSIC_ARMS).name).toMatch(/^berlin /);
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
	// Through the real engine: a refresh placed on a section line made the
	// incoming song the lead at once, and a rise sent then waited for that
	// line — up to a whole section of calm under a raider.
	const SR = 48000;
	const heard: { frame: number; part: string }[] = [];
	const engine = new MusicEngine(SR, undefined, (_, frame, part) =>
		heard.push({ frame, part }),
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
		const s = stepMusic(state, r, 0.1);
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
	// Three minutes of the full engine, the reverb and the drone included.
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

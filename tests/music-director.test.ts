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
	musicArms,
	type MusicReading,
	REFRESH_S,
	STRUCK_WINDOW_S,
	stepMusic,
} from "../src/music-director";
import type { MusicCommand } from "../src/music-score";

const calm: MusicReading = {
	scene: "flight",
	held: false,
	cruise: false,
	encounter: "none",
	sinceStruckS: 999,
	raiderFiring: false,
	engaged: false,
	standing: "clean",
	shieldShare: 1,
	hullShare: 1,
	systemSeed: 1234,
	stationRole: null,
};
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

	test("a long calm brings in a new variant on a section line", () => {
		const { commands } = fly([[REFRESH_S + 1, calm]], 0.5);
		const fresh = commands.slice(4);
		expect(fresh[0]).toMatchObject({ type: "load", id: "flight-b" });
		expect(fresh[1]).toMatchObject({
			type: "crossfade",
			to: "flight-b",
			at: "section",
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
		expect(arms).toEqual({ off: false, force: "threat", lowHull: "always" });
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

	test("off plays nothing, and fades out what was playing", () => {
		const off = { ...DEFAULT_MUSIC_ARMS, off: true };
		expect(stepMusic(initialMusicState(), calm, 0.1, off).commands).toEqual([]);
		const playing = fly([[1, calm]]).state;
		expect(stepMusic(playing, calm, 0.1, off).commands).toEqual([
			{ type: "stop", at: "now", fadeS: 2.5 },
		]);
	});
});

import { describe, expect, test } from "bun:test";
import {
	ECONOMY_NAMES,
	GOVERNMENT_NAMES,
	generateGalaxy,
	startSystem,
} from "../src/galaxy";
import {
	initialMusicState,
	QUIET_READING,
	stepMusic,
	songCadenceS,
} from "../src/music-director";
import { loadVersions } from "../src/music-danube-load";
import { readdirSync } from "node:fs";
import { generateContents } from "../src/system";
import {
	PINNED_WALTZ,
	WALTZ_TABLE,
	WALTZ_VERSIONS,
	type WaltzTags,
	stationWaltz,
	waltzDraw,
	waltzWeight,
} from "../src/station-waltz";

const WORLD = 0x5ee11e;
const galaxy = generateGalaxy(WORLD, 0);
const start = startSystem(galaxy);
const stations = galaxy.systems.flatMap((system) =>
	generateContents(system).stations.map((s) => ({ system, role: s.type })),
);
const pickAll = (table: readonly WaltzTags[] = WALTZ_TABLE) =>
	stations.map(({ system, role }) => stationWaltz(system, role, start, table));

describe("the weighted pick (#751 D1, D2, D9)", () => {
	test("it returns only a candidate, and the best -ln(u) / weight among them", () => {
		for (const { system, role } of stations.slice(0, 120)) {
			const pick = stationWaltz(system, role, start);
			if (role === "trade" && system.index === start.index) continue;
			const tags = WALTZ_TABLE.find((t) => t.version === pick);
			if (!tags) throw new Error(pick);
			const government = GOVERNMENT_NAMES[system.government];
			const economy = ECONOMY_NAMES[system.economy];
			expect(tags.roles).toContain(role);
			for (const t of [role, government, economy])
				expect(tags.never as readonly string[]).not.toContain(t);
			const score = (t: WaltzTags) => {
				const w = waltzWeight(t, system, role);
				return w === null
					? Number.POSITIVE_INFINITY
					: -Math.log(waltzDraw(system, role, t.version)) / w;
			};
			const best = Math.min(...WALTZ_TABLE.map(score));
			expect(score(tags)).toBe(best);
		}
	});

	test("a candidate weighs 1, plus 1 for the government, plus 1 for the economy", () => {
		const system = { ...galaxy.systems[0], government: 6, economy: 5 };
		const tags: WaltzTags = {
			version: "x",
			roles: ["trade"],
			governments: ["Democracy"],
			economies: ["Rich Agri"],
			never: [],
		};
		expect(waltzWeight(tags, system, "trade")).toBe(3);
		expect(waltzWeight({ ...tags, governments: [] }, system, "trade")).toBe(2);
		expect(
			waltzWeight({ ...tags, governments: [], economies: [] }, system, "trade"),
		).toBe(1);
		expect(waltzWeight(tags, system, "refinery")).toBeNull();
		expect(
			waltzWeight({ ...tags, never: ["Democracy"] }, system, "trade"),
		).toBeNull();
		expect(
			waltzWeight({ ...tags, never: ["trade"] }, system, "trade"),
		).toBeNull();
		expect(
			waltzWeight({ ...tags, never: ["Rich Agri"] }, system, "trade"),
		).toBeNull();
	});

	test("the same system and role pick the same version, run after run", () => {
		const again = generateGalaxy(WORLD, 0);
		expect(
			again.systems.flatMap((system) =>
				generateContents(system).stations.map((s) =>
					stationWaltz(system, s.type, startSystem(again)),
				),
			),
		).toEqual(pickAll());
	});

	test("the start system's trade station plays hybrid (#751 D3)", () => {
		expect(stationWaltz(start, "trade", start)).toBe(PINNED_WALTZ);
		expect(PINNED_WALTZ).toBe("hybrid");
	});

	test("over the whole galaxy every version wins a station, and no excluded version is picked", () => {
		const picks = pickAll();
		const wins = Object.fromEntries(WALTZ_VERSIONS.map((v) => [v, 0]));
		for (const p of picks) wins[p]++;
		expect(Object.entries(wins).filter(([, n]) => n === 0)).toEqual([]);
		stations.forEach(({ system, role }, i) => {
			const tags = WALTZ_TABLE.find((t) => t.version === picks[i]);
			if (!tags) throw new Error(picks[i]);
			expect(waltzWeight(tags, system, role)).not.toBeNull();
		});
	});

	test("a version added to the table moves only stations that now play it", () => {
		const before = pickAll();
		const added: WaltzTags = {
			version: "polka",
			roles: ["trade", "refinery", "shipyard", "outpost"],
			governments: [...GOVERNMENT_NAMES],
			economies: [...ECONOMY_NAMES],
			never: [],
		};
		const after = pickAll([...WALTZ_TABLE, added]);
		const changed = after.filter((p, i) => p !== before[i]);
		expect(changed.length).toBeGreaterThan(0);
		expect(new Set(changed)).toEqual(new Set(["polka"]));
	});

	test("the table names exactly the versions on disk, and hybrid", () => {
		const files = readdirSync("src/music-danube-variants")
			.filter((f) => f.endsWith(".ts"))
			.map((f) => f.replace(/\.ts$/, ""));
		expect([...WALTZ_VERSIONS].sort()).toEqual([PINNED_WALTZ, ...files].sort());
	});
});

describe("the director plays the station's version (node #1324)", () => {
	const computer = { ...QUIET_READING, scene: "dockingComputer" as const };

	test("it loads the reading's version and keeps its name and cadence", async () => {
		const versions = await loadVersions({
			"./music-danube-variants/jazz-trio.ts": () =>
				import("../src/music-danube-variants/jazz-trio"),
		});
		const song = versions["danube-jazz-trio"];
		const step = stepMusic(
			initialMusicState(),
			{ ...computer, waltz: { version: "jazz-trio", song } },
			0.1,
		);
		const load = step.commands[0];
		if (load.type !== "load") throw new Error(load.type);
		expect(load.song).toBe(song);
		expect(step.state.waltzKey).toBe("jazz-trio");
		expect(step.state.waltzHoldS).toBe(songCadenceS(song));
		const docked = stepMusic(
			step.state,
			{ ...QUIET_READING, scene: "docked", stationRole: "trade" },
			0.1,
		);
		expect(docked.state.waltz).toBe("resolving");
	});

	test("with no station version it plays the arms' voicing, as before", () => {
		const load = stepMusic(initialMusicState(), computer, 0.1).commands[0];
		if (load.type !== "load") throw new Error(load.type);
		expect(load.song.name).toContain("(hybrid)");
	});
});

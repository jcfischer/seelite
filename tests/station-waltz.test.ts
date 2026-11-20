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
	waltzSong,
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

	test.each([1, 42, WORLD])(
		"over the whole galaxy of world %p every version wins a station, and no excluded version is picked",
		(world) => {
			const g = generateGalaxy(world, 0);
			const first = startSystem(g);
			const all = g.systems.flatMap((system) =>
				generateContents(system).stations.map((s) => ({
					system,
					role: s.type,
					pick: stationWaltz(system, s.type, first),
				})),
			);
			const wins = Object.fromEntries(WALTZ_VERSIONS.map((v) => [v, 0]));
			for (const { pick } of all) wins[pick]++;
			expect(Object.entries(wins).filter(([, n]) => n === 0)).toEqual([]);
			for (const { system, role, pick } of all) {
				const tags = WALTZ_TABLE.find((t) => t.version === pick);
				if (!tags) throw new Error(pick);
				expect(waltzWeight(tags, system, role)).not.toBeNull();
			}
		},
	);

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
		const song = waltzSong("jazz-trio", versions);
		if (!song) throw new Error("jazz-trio did not load");
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

describe("the tag table is #751's resolution (D8)", () => {
	const ALL_ROLES = ["trade", "refinery", "shipyard", "outpost"];
	const IND = ["Rich Ind", "Average Ind", "Poor Ind", "Mainly Ind"];
	const AGRI = ["Mainly Agri", "Rich Agri", "Average Agri", "Poor Agri"];
	const T = (
		roles: string[],
		governments: string[],
		economies: string[],
		never: string[] = [],
	) => ({ roles, governments, economies, never });
	const D8: Record<string, ReturnType<typeof T>> = {
		hybrid: T(ALL_ROLES, [...GOVERNMENT_NAMES], [...ECONOMY_NAMES]),
		techno: T(
			["trade", "shipyard"],
			["Corporate State", "Democracy", "Confederacy"],
			["Rich Ind", "Average Ind", "Mainly Ind"],
		),
		synthwave: T(
			["trade", "shipyard"],
			["Corporate State", "Democracy"],
			["Rich Ind", "Average Ind", "Rich Agri"],
		),
		minimal: T(
			["trade", "shipyard"],
			["Corporate State", "Democracy", "Confederacy"],
			["Rich Ind", "Rich Agri"],
			["outpost"],
		),
		"minimal-piano": T(
			["trade", "shipyard"],
			["Corporate State", "Democracy", "Confederacy"],
			["Rich Ind", "Rich Agri"],
			["outpost"],
		),
		berlin: T(
			["refinery", "shipyard"],
			["Communist", "Dictatorship", "Confederacy"],
			IND,
		),
		industrial: T(
			["refinery", "outpost"],
			["Dictatorship", "Communist", "Anarchy"],
			["Poor Ind", "Mainly Ind"],
		),
		doom: T(
			["refinery", "outpost"],
			["Anarchy", "Feudal", "Dictatorship"],
			["Poor Ind", "Poor Agri"],
			["Corporate State", "Democracy"],
		),
		dnb: T(
			["trade", "outpost"],
			["Anarchy", "Feudal", "Multi-gov"],
			[...ECONOMY_NAMES],
		),
		dub: T(["trade", "outpost"], ["Anarchy", "Multi-gov", "Feudal"], AGRI),
		ambient: T(
			["trade", "refinery"],
			["Democracy", "Confederacy", "Multi-gov"],
			AGRI,
			["outpost"],
		),
		"ambient-piano": T(
			["trade", "refinery"],
			["Democracy", "Confederacy", "Multi-gov"],
			AGRI,
			["outpost"],
		),
		jazz: T(
			["trade"],
			["Democracy", "Corporate State", "Confederacy", "Multi-gov"],
			["Rich Ind", "Rich Agri"],
			["Anarchy"],
		),
		"jazz-trio": T(
			["trade"],
			["Democracy", "Corporate State", "Confederacy", "Multi-gov"],
			["Rich Ind", "Rich Agri"],
			["Anarchy"],
		),
		"jazz-upright": T(
			["trade"],
			["Democracy", "Corporate State", "Confederacy", "Multi-gov"],
			["Rich Ind", "Rich Agri"],
			["Anarchy"],
		),
		bossa: T(["trade"], ["Democracy", "Multi-gov", "Confederacy"], AGRI, [
			"Dictatorship",
		]),
		gamelan: T(
			["trade", "refinery"],
			["Feudal", "Multi-gov", "Communist"],
			AGRI,
		),
		baroque: T(
			["trade", "shipyard"],
			["Feudal", "Dictatorship", "Corporate State"],
			["Rich Ind", "Rich Agri"],
			["outpost"],
		),
		musicbox: T(
			["trade"],
			["Democracy", "Corporate State"],
			["Rich Agri", "Average Agri"],
			["outpost", "Anarchy"],
		),
	};
	const sorted = (xs: readonly string[]) => [...xs].sort();

	test("every row's roles, governments, economies and exclusions are the resolution's", () => {
		expect(WALTZ_VERSIONS).toEqual(Object.keys(D8));
		for (const row of WALTZ_TABLE) {
			const want = D8[row.version];
			expect(sorted(row.roles)).toEqual(sorted(want.roles));
			expect(sorted(row.governments)).toEqual(sorted(want.governments));
			expect(sorted(row.economies)).toEqual(sorted(want.economies));
			expect(sorted(row.never)).toEqual(sorted(want.never));
		}
	});
});

describe("the start pin is the start system's trade station and nothing else (#751 D3)", () => {
	const nowhere = { galaxy: -1, index: -1 };
	const free = (role: "trade" | "refinery") =>
		galaxy.systems.find((s) => stationWaltz(s, role, nowhere) !== PINNED_WALTZ);

	test("another role at the start system plays its own pick", () => {
		const s = free("refinery");
		if (!s) throw new Error("no refinery pick other than hybrid");
		expect(stationWaltz(s, "refinery", s)).toBe(
			stationWaltz(s, "refinery", nowhere),
		);
	});

	test("the same index in another galaxy, or another index in this one, is not pinned", () => {
		const s = free("trade");
		if (!s) throw new Error("no trade pick other than hybrid");
		const own = stationWaltz(s, "trade", nowhere);
		expect(
			stationWaltz(s, "trade", { galaxy: s.galaxy + 1, index: s.index }),
		).toBe(own);
		expect(
			stationWaltz(s, "trade", { galaxy: s.galaxy, index: s.index + 1 }),
		).toBe(own);
		expect(stationWaltz(s, "trade", s)).toBe(PINNED_WALTZ);
	});

	test("a table with no candidate for the role falls back to hybrid", () => {
		const outpostOnly: WaltzTags = {
			version: "polka",
			roles: ["outpost"],
			governments: [],
			economies: [],
			never: [],
		};
		expect(
			stationWaltz(galaxy.systems[3], "trade", nowhere, [outpostOnly]),
		).toBe(PINNED_WALTZ);
	});
});

describe("waltzSong", () => {
	test("hybrid is the waltz's own voicing, loaded or not", () => {
		expect(waltzSong(PINNED_WALTZ, null)?.name).toContain("(hybrid)");
	});

	test("another version is the loaded one, and none before the versions load", async () => {
		expect(waltzSong("jazz-trio", null)).toBeNull();
		expect(waltzSong("jazz-trio", {})).toBeNull();
		const versions = await loadVersions({
			"./music-danube-variants/jazz-trio.ts": () =>
				import("../src/music-danube-variants/jazz-trio"),
		});
		const song = waltzSong("jazz-trio", versions);
		expect(song).not.toBeNull();
		expect(song).toBe(Object.values(versions)[0]);
		expect(song?.name).not.toContain("(hybrid)");
	});
});

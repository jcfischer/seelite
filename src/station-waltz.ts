/**
 * https://github.com/jcfischer/seelite/issues/751
 *
 * Which version of the docking waltz a station plays: a weighted rendezvous
 * pick over the tag table #751 settled (D1–D3, D5, D8, D9). Pure, no Three.js
 * and no audio: the director plays what this names.
 */
import { DOMAIN } from "./domains";
import {
	ECONOMY_NAMES,
	GOVERNMENT_NAMES,
	type SystemRecord,
	stream,
} from "./galaxy";
import { fnv1a, mix } from "./rng";
import { danubeSong } from "./music-danube";
import { versionId } from "./music-danube-load";
import type { Song } from "./music-score";
import { STATION_TYPES, type StationType } from "./station";

type Government = (typeof GOVERNMENT_NAMES)[number];
type Economy = (typeof ECONOMY_NAMES)[number];

/** One row of the tag table: what a version fits, and what it never plays at. */
export interface WaltzTags {
	readonly version: string;
	readonly roles: readonly StationType[];
	readonly governments: readonly Government[];
	readonly economies: readonly Economy[];
	readonly never: readonly (StationType | Government | Economy)[];
}

const INDUSTRIAL: readonly Economy[] = [
	"Rich Ind",
	"Average Ind",
	"Poor Ind",
	"Mainly Ind",
];
const AGRICULTURAL: readonly Economy[] = [
	"Mainly Agri",
	"Rich Agri",
	"Average Agri",
	"Poor Agri",
];

const row = (
	version: string,
	roles: readonly StationType[],
	governments: readonly Government[],
	economies: readonly Economy[],
	never: WaltzTags["never"] = [],
): WaltzTags => ({ version, roles, governments, economies, never });

/** The version the start system's trade station plays (#751 D3). */
export const PINNED_WALTZ = "hybrid";

/** #751 D8's table, one row per version. A new version adds one row. */
export const WALTZ_TABLE: readonly WaltzTags[] = [
	row(PINNED_WALTZ, STATION_TYPES, GOVERNMENT_NAMES, ECONOMY_NAMES),
	row(
		"techno",
		["trade", "shipyard"],
		["Corporate State", "Democracy", "Confederacy"],
		["Rich Ind", "Average Ind", "Mainly Ind"],
	),
	row(
		"synthwave",
		["trade", "shipyard"],
		["Corporate State", "Democracy"],
		["Rich Ind", "Average Ind", "Rich Agri"],
	),
	...["minimal", "minimal-piano"].map((version) =>
		row(
			version,
			["trade", "shipyard"],
			["Corporate State", "Democracy", "Confederacy"],
			["Rich Ind", "Rich Agri"],
			["outpost"],
		),
	),
	row(
		"berlin",
		["refinery", "shipyard"],
		["Communist", "Dictatorship", "Confederacy"],
		INDUSTRIAL,
	),
	row(
		"industrial",
		["refinery", "outpost"],
		["Dictatorship", "Communist", "Anarchy"],
		["Poor Ind", "Mainly Ind"],
	),
	row(
		"doom",
		["refinery", "outpost"],
		["Anarchy", "Feudal", "Dictatorship"],
		["Poor Ind", "Poor Agri"],
		["Corporate State", "Democracy"],
	),
	row(
		"dnb",
		["trade", "outpost"],
		["Anarchy", "Feudal", "Multi-gov"],
		[...ECONOMY_NAMES],
	),
	row(
		"dub",
		["trade", "outpost"],
		["Anarchy", "Multi-gov", "Feudal"],
		AGRICULTURAL,
	),
	...["ambient", "ambient-piano"].map((version) =>
		row(
			version,
			["trade", "refinery"],
			["Democracy", "Confederacy", "Multi-gov"],
			AGRICULTURAL,
			["outpost"],
		),
	),
	...["jazz", "jazz-trio", "jazz-upright"].map((version) =>
		row(
			version,
			["trade"],
			["Democracy", "Corporate State", "Confederacy", "Multi-gov"],
			["Rich Ind", "Rich Agri"],
			["Anarchy"],
		),
	),
	row(
		"bossa",
		["trade"],
		["Democracy", "Multi-gov", "Confederacy"],
		AGRICULTURAL,
		["Dictatorship"],
	),
	row(
		"gamelan",
		["trade", "refinery"],
		["Feudal", "Multi-gov", "Communist"],
		AGRICULTURAL,
	),
	row(
		"baroque",
		["trade", "shipyard"],
		["Feudal", "Dictatorship", "Corporate State"],
		["Rich Ind", "Rich Agri"],
		["outpost"],
	),
	row(
		"musicbox",
		["trade"],
		["Democracy", "Corporate State"],
		["Rich Agri", "Average Agri"],
		["outpost", "Anarchy"],
	),
];

/** Every version the table names, in table order. */
export const WALTZ_VERSIONS: readonly string[] = WALTZ_TABLE.map(
	(t) => t.version,
);

/** The system a pick reads: its seed, government and economy. */
export type WaltzSystem = Pick<
	SystemRecord,
	"galaxy" | "index" | "seed" | "government" | "economy"
>;

/**
 * A candidate's weight at a station (#751 D1, D2): `null` when the version
 * does not fit the role or an exclusion names the role, government or economy;
 * otherwise 1, plus 1 for the government, plus 1 for the economy.
 */
export function waltzWeight(
	tags: WaltzTags,
	system: WaltzSystem,
	role: StationType,
): number | null {
	const government = GOVERNMENT_NAMES[system.government];
	const economy = ECONOMY_NAMES[system.economy];
	if (!tags.roles.includes(role)) return null;
	if ([role, government, economy].some((t) => tags.never.includes(t)))
		return null;
	return (
		1 +
		(tags.governments.includes(government) ? 1 : 0) +
		(tags.economies.includes(economy) ? 1 : 0)
	);
}

/** The uniform draw behind one candidate's score, from the system's seed, the
 *  role and the version's name (#751 D9). */
export const waltzDraw = (
	system: WaltzSystem,
	role: StationType,
	version: string,
): number =>
	stream(
		mix(mix(system.seed >>> 0, fnv1a(role)), fnv1a(version)),
		DOMAIN.STATION_WALTZ,
	)();

/**
 * The version a station plays: among the candidates, the best weighted
 * rendezvous score `-ln(u) / weight`. `start` is the game's start system,
 * whose trade station plays `PINNED_WALTZ` (#751 D3).
 */
export function stationWaltz(
	system: WaltzSystem,
	role: StationType,
	start: Pick<SystemRecord, "galaxy" | "index">,
	table: readonly WaltzTags[] = WALTZ_TABLE,
): string {
	if (
		role === "trade" &&
		system.galaxy === start.galaxy &&
		system.index === start.index
	)
		return PINNED_WALTZ;
	let best: { version: string; score: number } | null = null;
	for (const tags of table) {
		const weight = waltzWeight(tags, system, role);
		if (weight === null) continue;
		const score = -Math.log(waltzDraw(system, role, tags.version)) / weight;
		if (best === null || score < best.score)
			best = { version: tags.version, score };
	}
	return best?.version ?? PINNED_WALTZ;
}

/**
 * The song a version plays: `hybrid` from the waltz's own voicings, any other
 * version from the loaded `versions` under the loader's id for its file.
 * `null` while the versions have not loaded, or for a version none loaded.
 */
export function waltzSong(
	version: string,
	versions: Readonly<Record<string, Song>> | null,
): Song | null {
	if (version === PINNED_WALTZ) return danubeSong(PINNED_WALTZ);
	return versions?.[versionId(`${version}.ts`)] ?? null;
}

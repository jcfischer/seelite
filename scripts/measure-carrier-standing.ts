/**
 * The instrument `carrier-identity.md` §2 requires of standing, and
 * `civilian-combat.md` H12's figures are read off.
 *
 * H12's shares — 12 % Wanted, 3 % Fugitive, a 6 h rotation — are starting
 * forms, not measurements, and a spec figure with no instrument is later read
 * as a measured one. This walks every station's real Traffic roster across
 * worlds and all eight galaxies, reads each carrier's standing at several
 * clocks, and prints the shares overall and per galaxy with the spread, plus
 * how often a two-minute window from scan to kill spans a change (F7).
 *
 *   bun run scripts/measure-carrier-standing.ts [worldCount]
 */
import {
	carrierStanding,
	STANDING_ROTATION_S,
	STANDING_SHARES,
} from "../src/carrier-standing";
import { stationTrafficRoster } from "../src/station-traffic";
import {
	ALL_GALAXIES,
	forEachSystem,
	worldSeeds,
} from "../tests/helpers/station-rows";

const worlds = worldSeeds(Number(process.argv[2] ?? 4));
const CLOCKS = [0, 3_600, 17_000, 50_000, 123_456];
const WINDOW_S = 120;

const finite = (value: number): number => {
	if (!Number.isFinite(value))
		throw new Error(`instrument produced a non-finite figure: ${value}`);
	return value;
};

type Tally = { n: number; wanted: number; fugitive: number };
const empty = (): Tally => ({ n: 0, wanted: 0, fugitive: 0 });
const total = empty();
const byGalaxy = new Map<number, Tally>();
let windows = 0;
let flips = 0;
let carriers = 0;

for (const world of worlds)
	forEachSystem(world, ALL_GALAXIES, (record, contents) => {
		const galaxy = byGalaxy.get(record.galaxy) ?? empty();
		byGalaxy.set(record.galaxy, galaxy);
		for (const station of contents.stations)
			for (const actor of stationTrafficRoster(record.index, station)) {
				carriers++;
				for (const t of CLOCKS) {
					const s = carrierStanding(record.seed, actor.key, 0, t);
					for (const acc of [total, galaxy]) {
						acc.n++;
						if (s === "wanted") acc.wanted++;
						if (s === "fugitive") acc.fugitive++;
					}
					windows++;
					if (s !== carrierStanding(record.seed, actor.key, 0, t + WINDOW_S))
						flips++;
				}
			}
	});

const pct = (part: number, whole: number) =>
	`${finite((100 * part) / whole).toFixed(2)} %`;
const shares = [...byGalaxy.values()].map((g) => ({
	wanted: g.wanted / g.n,
	fugitive: g.fugitive / g.n,
}));
const spread = (key: "wanted" | "fugitive") => {
	const values = shares.map((s) => s[key]);
	return `${pct(Math.min(...values), 1)} – ${pct(Math.max(...values), 1)}`;
};

console.log(
	`worlds ${worlds.length}, galaxies ${byGalaxy.size}, carriers ${carriers}, readings ${total.n}`,
);
console.log(
	`declared: wanted ${STANDING_SHARES.wanted * 100} %, fugitive ${STANDING_SHARES.fugitive * 100} %, rotation ${STANDING_ROTATION_S / 3600} h`,
);
console.log(
	`wanted   ${pct(total.wanted, total.n)}  per galaxy ${spread("wanted")}`,
);
console.log(
	`fugitive ${pct(total.fugitive, total.n)}  per galaxy ${spread("fugitive")}`,
);
console.log(
	`a ${WINDOW_S} s scan-to-kill window changes standing in ${pct(flips, windows)} of ${windows} windows`,
);

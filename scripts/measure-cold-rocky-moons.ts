/**
 * Repeatable census for #64/#590's 24-galaxy generation policy.
 *
 *   bun run scripts/measure-cold-rocky-moons.ts
 *
 * Three independent world seeds, all eight galaxies each. The denominator for
 * the ice rate is outer planets; the moon rate's denominator is rocky planets.
 * Print every galaxy's bucket size as well as the pooled result, so a large
 * total cannot conceal a thin bucket (#28).
 */
import { GALAXY_COUNT, generateGalaxy } from "../src/galaxy";
import { generateContents, orbitWarmth } from "../src/system";

const SEEDS = [47, 6218014, 20260930] as const;

type Counts = {
	systems: number;
	planets: number;
	moons: number;
	outer: number;
	ice: number;
	rocky: number;
	rockyWithMoon: number;
	giantMoonCounts: [number, number, number, number];
};

function census(seed: number, galaxyIndex: number): Counts {
	const row: Counts = {
		systems: 0,
		planets: 0,
		moons: 0,
		outer: 0,
		ice: 0,
		rocky: 0,
		rockyWithMoon: 0,
		giantMoonCounts: [0, 0, 0, 0],
	};
	for (const record of generateGalaxy(seed, galaxyIndex).systems) {
		row.systems++;
		const contents = generateContents(record);
		for (const planet of contents.planets) {
			row.planets++;
			row.moons += planet.moons.length;
			if (orbitWarmth(planet.aAu, contents.star.luminosity) > 2) {
				row.outer++;
				if (!planet.isGasGiant) row.ice++;
			}
			if (planet.isGasGiant) row.giantMoonCounts[planet.moons.length]++;
			else {
				row.rocky++;
				if (planet.moons.length === 1) row.rockyWithMoon++;
			}
		}
	}
	return row;
}

const rows = SEEDS.flatMap((seed) =>
	Array.from({ length: GALAXY_COUNT }, (_, galaxyIndex) => ({
		seed,
		galaxyIndex,
		...census(seed, galaxyIndex),
	})),
);
const rate = (part: number, whole: number) =>
	`${((100 * part) / whole).toFixed(1)}%`;
console.log(
	"seed galaxy systems planets moons outer ice ice/outer rocky rocky+moon moon/rocky giant-moons[0,1,2,3]",
);
for (const row of rows)
	console.log(
		`${row.seed} ${row.galaxyIndex} ${row.systems} ${row.planets} ${row.moons} ${row.outer} ${row.ice} ${rate(row.ice, row.outer)} ${row.rocky} ${row.rockyWithMoon} ${rate(row.rockyWithMoon, row.rocky)} ${row.giantMoonCounts.join(",")}`,
	);
const total = rows.reduce(
	(acc, row) => ({
		systems: acc.systems + row.systems,
		planets: acc.planets + row.planets,
		moons: acc.moons + row.moons,
		outer: acc.outer + row.outer,
		ice: acc.ice + row.ice,
		rocky: acc.rocky + row.rocky,
		rockyWithMoon: acc.rockyWithMoon + row.rockyWithMoon,
		giantMoonCounts: acc.giantMoonCounts.map(
			(count, index) => count + row.giantMoonCounts[index],
		) as Counts["giantMoonCounts"],
	}),
	{
		systems: 0,
		planets: 0,
		moons: 0,
		outer: 0,
		ice: 0,
		rocky: 0,
		rockyWithMoon: 0,
		giantMoonCounts: [0, 0, 0, 0] as Counts["giantMoonCounts"],
	},
);
console.log(
	`TOTAL 24 ${total.systems} ${total.planets} ${total.moons} ${total.outer} ${total.ice} ${rate(total.ice, total.outer)} ${total.rocky} ${total.rockyWithMoon} ${rate(total.rockyWithMoon, total.rocky)} ${total.giantMoonCounts.join(",")}`,
);
console.log(
	`SMALLEST BUCKET outer=${Math.min(...rows.map((row) => row.outer))} rocky=${Math.min(...rows.map((row) => row.rocky))}`,
);

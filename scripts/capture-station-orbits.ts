/**
 * Captures the station-orbit baseline that `tests/station-orbits.test.ts`
 * compares against.
 *
 * It exists because of a regression that cannot otherwise be tested: the
 * station generator draws trade → refinery → shipyard from one
 * `DOMAIN.STATIONS` stream, so inserting a draw anywhere in that sequence
 * shifts every later station in every system. The test that catches it needs a
 * *before* state, and once the offending draw is added there is no before state
 * left to generate. So the baseline is captured here, on the generator as it
 * stands, and committed.
 *
 * Run it again only when a station-placement change was intended. It moving is
 * the alarm, exactly as `tests/galaxy.test.ts`'s digest is.
 *
 *   bun run scripts/capture-station-orbits.ts
 *   npx biome format --write tests/fixtures/station-orbits.json
 *
 * The second line is not optional: `npm run format:check` covers `tests/`, so a
 * fixture written straight from `JSON.stringify` fails the format gate on
 * whitespace biome would collapse.
 */

import { GALAXY_COUNT, generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";

const WORLD_SEED = 0x5ee11e;
/** Every system of two galaxies: enough that a shifted draw cannot hide in an
 *  unsampled corner, small enough to diff by eye when it does move. */
const GALAXIES = [0, 1];

const rows: string[] = [];
for (const g of GALAXIES) {
	if (g >= GALAXY_COUNT) throw new Error(`galaxy ${g} does not exist`);
	const galaxy = generateGalaxy(WORLD_SEED, g);
	for (const record of galaxy.systems) {
		for (const s of generateContents(record).stations) {
			rows.push(
				[
					g,
					record.index,
					s.id,
					s.type,
					s.parentId ?? "-",
					s.orbit.radiusKm.toExponential(12),
					s.orbit.periodS.toExponential(12),
					s.orbit.theta0.toExponential(12),
					s.orbit.inclination.toExponential(12),
					s.orbit.node.toExponential(12),
				].join("\t"),
			);
		}
	}
}

const payload = {
	note: "Baseline for tests/station-orbits.test.ts. Regenerate ONLY when a station-placement change is intended — see scripts/capture-station-orbits.ts.",
	worldSeed: WORLD_SEED,
	galaxies: GALAXIES,
	stationCount: rows.length,
	rows,
};

await Bun.write(
	"tests/fixtures/station-orbits.json",
	`${JSON.stringify(payload, null, "\t")}\n`,
);
console.log(`captured ${rows.length} stations`);

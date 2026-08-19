/**
 * Captures the baseline `tests/station.test.ts` compares `blackMarket` and
 * `spinRpm` against.
 *
 * **This one postdates the fields it pins, and that is a weaker claim than
 * `capture-station-orbits.ts` makes.** That fixture was captured before its
 * fields existed, so it can prove they moved nothing. This one cannot: it can
 * only prove the fields do not move from here. Both are worth having and they
 * are not the same evidence, which is why they are two files and two tests.
 *
 * Run it again only when a change to the fields was **intended**. It moving
 * otherwise is the alarm.
 *
 *   bun run scripts/capture-station-fields.ts
 *   npx biome format --write tests/fixtures/station-fields.json
 *
 * The second line is not optional: `npm run format:check` covers `tests/`, so a
 * fixture written straight from `JSON.stringify` fails the format gate.
 */

import { stationFieldRows } from "../tests/helpers/station-rows";

/** The same world and galaxies as the placement fixture, so a diff of the two
 *  covers the same stations and a row in one has a counterpart in the other. */
const WORLD_SEED = 0x5ee11e;
const GALAXIES = [0, 1];

const rows = stationFieldRows(WORLD_SEED, GALAXIES);

const payload = {
	note: "Baseline for tests/station.test.ts. Regenerate ONLY when a change to blackMarket or spinRpm is intended — see scripts/capture-station-fields.ts.",
	worldSeed: WORLD_SEED,
	galaxies: GALAXIES,
	stationCount: rows.length,
	rows,
};

/** Resolved against this file rather than `process.cwd()`, for the reason
 *  `capture-station-orbits.ts` gives: a relative path invoked from elsewhere
 *  writes a new fixture somewhere else and leaves the committed one untouched. */
const out = new URL("../tests/fixtures/station-fields.json", import.meta.url);
await Bun.write(out, `${JSON.stringify(payload, null, "\t")}\n`);
console.log(`captured ${rows.length} stations → ${out.pathname}`);

/**
 * Captures the station-placement baseline that `tests/station-orbits.test.ts`
 * compares against.
 *
 * It exists because of a regression that cannot otherwise be tested: the
 * station generator draws trade → refinery → shipyard from one
 * `DOMAIN.STATIONS` stream, so inserting a draw anywhere in that sequence
 * shifts every station after it, in every system. The test that catches it
 * needs a *before* state, and the baseline stops being cheap to obtain the
 * moment that draw lands. It stays *recoverable* — checking out this commit's
 * `src/` and re-running this script reproduces it — so the real argument for
 * committing it now is that nobody will remember to later, and a guard whose
 * baseline postdates the change it guards is worthless.
 *
 * Run it again only when a station-placement change was **intended** — the
 * dead-end fix of `station-types.md` §5.4 is one such change. It moving
 * otherwise is the alarm, exactly as `tests/galaxy.test.ts`'s digest is.
 *
 *   bun run scripts/capture-station-orbits.ts
 *   npx biome format --write tests/fixtures/station-orbits.json
 *
 * The second line is not optional: `npm run format:check` covers `tests/`, so a
 * fixture written straight from `JSON.stringify` fails the format gate on
 * whitespace biome would collapse.
 */

import { stationRows } from "./station-rows";

const WORLD_SEED = 0x5ee11e;
/** Every system of two galaxies: enough that a shifted draw cannot hide in an
 *  unsampled corner, small enough to diff by eye when it does move. */
const GALAXIES = [0, 1];

const rows = stationRows(WORLD_SEED, GALAXIES);

const payload = {
	note: "Baseline for tests/station-orbits.test.ts. Regenerate ONLY when a station-placement change is intended — see scripts/capture-station-orbits.ts.",
	worldSeed: WORLD_SEED,
	galaxies: GALAXIES,
	stationCount: rows.length,
	rows,
};

/**
 * Resolved against this file, not against `process.cwd()`.
 *
 * `Bun.write` creates missing parents, so a relative path invoked from anywhere
 * but the repo root would write a *new* fixture somewhere else, print its happy
 * "captured N stations", and leave the committed baseline untouched — the
 * operator believing they had regenerated it.
 */
const out = new URL("../tests/fixtures/station-orbits.json", import.meta.url);
await Bun.write(out, `${JSON.stringify(payload, null, "\t")}\n`);
console.log(`captured ${rows.length} stations → ${out.pathname}`);

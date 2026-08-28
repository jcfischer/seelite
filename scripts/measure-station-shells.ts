/**
 * The station-shell population at t0: how many placed stations sit inside a
 * cruise shell they should not, and how close placed bodies ever come.
 * Node #32's orbit floor retired probe-arrival's seed-118 block; this is the
 * instrument that claim points at — sweep claims in comments and probe
 * headers are only honest while some script re-runs them (§12.2's own
 * argument; `galaxy-generation.md` §7.3 carries the figures this sweep
 * produced, so they are not restated here).
 *
 *   bun run scripts/measure-station-shells.ts [seeds]   # default 8,000
 *
 * Walks `forEachPlacedStation` — the same placed-geometry walk
 * `tests/station-orbits.test.ts` asserts over, at the suite's 500-seed
 * budget or any budget asked for here — over every body the game moves
 * (`byId`: star, planets, moons, stations), not just `contents.planets`.
 * Own-host and foreign counts print separately; nothing asserts. The asserts
 * live in the test.
 *
 * The foreign count counts **violating pairs, not stations**: a co-orbiting
 * pair that entered a shell would be tallied from both ends. With a non-zero
 * count that framing matters; here it is zero either way.
 */
import {
	forEachPlacedStation,
	dist,
	shellViolation,
} from "../tests/helpers/station-rows";

const SEEDS_N = Number(process.argv[2] ?? 8000);
if (!Number.isInteger(SEEDS_N) || SEEDS_N < 1) {
	console.error("usage: measure-station-shells.ts [positive integer of seeds]");
	process.exit(2);
}

let stations = 0;
let ownShell = 0;
let foreignShell = 0;
let minOwn = Infinity;
let minOwnSeed = -1;
let minForeign = Infinity;
let minForeignSeed = -1;

forEachPlacedStation(
	(station, host, others, seed) => {
		stations++;
		const p = station.pos;
		const dOwn = dist(p, host.pos);
		const rOwn = dOwn / host.radiusKm;
		if (rOwn < minOwn) {
			minOwn = rOwn;
			minOwnSeed = seed;
		}
		if (shellViolation(station, host)) ownShell++;
		for (const b of others) {
			if (b.id === station.id || b.id === host.id || !b.pos) continue;
			// A non-positive radius is no shell to be inside; guarding the ratio
			// as well as the count keeps a degenerate body out of both.
			if (!(b.radiusKm > 0)) continue;
			const f = dist(p, b.pos) / b.radiusKm;
			if (f < minForeign) {
				minForeign = f;
				minForeignSeed = seed;
			}
			if (shellViolation(station, b)) foreignShell++;
		}
	},
	Array.from({ length: SEEDS_N }, (_, i) => i + 1),
);

console.log("placed stations inside a cruise shell at t0\n");
console.log(
	"  worlds: 1.." + SEEDS_N + "   host-orbiting stations: " + stations,
);
console.log("  inside own host's shell:   " + ownShell);
console.log("  inside any other body's:   " + foreignShell);
console.log(
	"  closest own-host approach: " +
		minOwn.toFixed(3) +
		" R (seed " +
		minOwnSeed +
		") \u2014 the floor is 1.500 R by construction\n",
);
console.log(
	"  closest foreign approach:  " +
		minForeign.toFixed(0) +
		" radii (seed " +
		minForeignSeed +
		")\n",
);

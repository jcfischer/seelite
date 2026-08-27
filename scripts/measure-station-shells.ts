/**
 * The station-shell population at t0 — the figures that retired probe-arrival's
 * seed-118 block, printed by an instrument that ships in the tree.
 *
 *   bun run scripts/measure-station-shells.ts [seeds]   # default 8000
 *
 * Node #32's orbit floor (STATION_ORBIT_R_OVER_R, src/system.ts) is a radius
 * rule; probe-arrival's deleted block checked the *placed* geometry — whether a
 * station at t0 sat inside its host's cruise shell, and could be cruised away
 * from. The floor removed that geometry, but the probe's replacement claims
 * ("swept across seeds 1..N, nothing inside; the closest foreign approach is
 * X radii") are sweep claims, and a spec comment citing a sweep no script
 * re-runs is a number nobody can check — which is what §12.2's own instrument
 * argument says, and why this one exists.
 *
 * Per station, measured at the t0 position the world build resolved:
 *
 * - **inside its own host's 1.05 shell** — the §12.2 population (49 of 337 at
 *   200 seeds before the floor; the same column `measure-cruise-arrival.ts`
 *   prints per leg, re-derived here over all stations, not just flown legs);
 * - **inside any foreign body's 1.05 shell** — the half the orbit-radius
 *   invariant cannot see: a shipyard can clear its own giant's shell by
 *   16,500 km and still sit inside a neighbour's. This is the case the deleted
 *   browser check covered and no orbit test can state;
 *   `tests/station-orbits.test.ts` now pins it over seeds 1..1500.
 * - the **closest own-host and foreign approaches**, in host radii — the
 *   figures the probe header cites (own-host: 1.500 = the floor, hit exactly;
 *   foreign: ~559 radii, seed 4634).
 *
 * A sweep, not a test: nothing here asserts. The asserts live in
 * `tests/station-orbits.test.ts`.
 */
import { SURFACE_MARGIN } from "../src/cruise";
import { makeWorld } from "../src/sim";

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

for (let seed = 1; seed <= SEEDS_N; seed++) {
	const world = makeWorld(seed);
	const S = world.system;
	for (const st of S.contents.stations) {
		if (!st.parentId) continue; // star-centric refinery: no host
		const pos = S.byId.get(st.id)?.pos;
		const host = S.byId.get(st.parentId);
		if (!pos || !host?.pos) continue;
		stations++;
		const dOwn = Math.hypot(
			pos.x - host.pos.x,
			pos.y - host.pos.y,
			pos.z - host.pos.z,
		);
		const rOwn = dOwn / host.radiusKm;
		if (rOwn < minOwn) {
			minOwn = rOwn;
			minOwnSeed = seed;
		}
		if (dOwn < host.radiusKm * SURFACE_MARGIN) ownShell++;
		for (const m of S.contents.planets) {
			if (m.id === st.parentId) continue;
			const mb = S.byId.get(m.id);
			if (!mb?.pos) continue;
			const d = Math.hypot(
				pos.x - mb.pos.x,
				pos.y - mb.pos.y,
				pos.z - mb.pos.z,
			);
			const f = d / mb.radiusKm;
			if (f < minForeign) {
				minForeign = f;
				minForeignSeed = seed;
			}
			if (d < mb.radiusKm * SURFACE_MARGIN) foreignShell++;
		}
	}
}

console.log("stations inside a cruise shell at t0\n");
console.log(`  worlds: 1..${SEEDS_N}   host-orbiting stations: ${stations}`);
console.log(`  inside own host's shell:   ${ownShell}`);
console.log(`  inside a foreign body's:   ${foreignShell}`);
console.log(
	`  closest own-host approach: ${minOwn.toFixed(3)} R (seed ${minOwnSeed}) ` +
		`— the floor is 1.500 R by construction\n`,
);
console.log(
	`  closest foreign approach:  ${minForeign.toFixed(0)} radii ` +
		`(seed ${minForeignSeed})\n`,
);

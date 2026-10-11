/**
 * Where every vent's throat is drawn, and how far it is from metal (#621).
 *
 *   bun scripts/measure-vent-throats.ts
 *
 * `ventThroats` slides each vent along its own line of action to where that
 * line leaves the hull, and where the line only passes the hull, to its
 * closest approach (`src/vent-plumes.ts`). This prints the gap that leaves for
 * every hull and slot. When #621 shipped, every attitude line missed every
 * hull; since #636 (`flight-model.md` §3.2.1) every line meets metal, and the
 * list of misses at the foot is empty. `tests/vent-placement.test.ts` holds
 * it so.
 */

import { HULL_IDS, HULL_SPECS } from "../src/hull";
import { buildShipMesh } from "../src/ship-mesh";
import { ventThroats } from "../src/vent-plumes";
import { installShippedLongwall } from "./lib/install-longwall";
import { installShippedTugHull } from "./lib/shipped-tug-hull";

// `miner/b` is the authored Longwall B, built only once it is installed.
await installShippedLongwall();
// The tug is the authored Bollard (node #814), drawn once installed.
await installShippedTugHull();

const metres = (km: number): string => {
	if (!Number.isFinite(km)) throw new Error(`non-finite gap: ${km}`);
	return (km * 1000).toFixed(1);
};

const missed = new Map<string, string[]>();
for (const id of HULL_IDS) {
	const root = buildShipMesh(id, HULL_SPECS[id].variant).root;
	const throats = ventThroats(root, id);
	const cells = throats
		.filter((t) => t.placed === "line")
		.map((t) => {
			if (t.gapKm > 0) {
				const hulls = missed.get(t.slot) ?? [];
				hulls.push(id);
				missed.set(t.slot, hulls);
			}
			return `${t.slot} ${t.gapKm > 0 ? metres(t.gapKm) : "on"}`;
		});
	const bells = throats.filter((t) => t.placed === "bell").length;
	console.log(
		`${id.padEnd(12)} ${metres(HULL_SPECS[id].env.lengthKm).padStart(6)} m long, ${bells} bells`,
	);
	console.log(`  ${cells.join(" · ")}`);
}

console.log("\nslots whose line of action meets no metal, by hull:");
for (const [slot, hulls] of missed)
	console.log(
		`  ${slot.padEnd(24)} ${hulls.length === HULL_IDS.length ? "every hull" : hulls.join(", ")}`,
	);

import assert from "node:assert/strict";
import { generateGalaxy } from "../../src/galaxy";
import {
	enumerateCarriers,
	WORLD_GENERATOR_VERSION,
	WORLD_SCHEMA_VERSION,
} from "../../src/world-state";
import {
	createAnchor,
	durationFor,
	validateAnchor,
} from "./capability-outages-937.mjs";

const rows = [];
for (const seed of [0, 42, 2026]) {
	let totalBytes = 0;
	let totalCapabilities = 0;
	let totalRefineries = 0;
	for (let galaxy = 0; galaxy < 8; galaxy++) {
		const generated = generateGalaxy(seed, galaxy);
		const types: Record<string, number> = {};
		const anchors: Record<string, unknown> = {};
		let refineries = 0;
		for (const station of enumerateCarriers(seed, galaxy)) {
			if (station.kind !== "station") continue;
			types[station.stationType] = (types[station.stationType] ?? 0) + 1;
			if (station.stationType === "outpost") continue;
			if (station.stationType === "refinery") refineries++;
			const slots =
				station.stationType === "trade"
					? ["market", "equipment"]
					: ["market", "equipment", "exclusive"];
			for (const slot of slots) {
				const key = JSON.stringify([
					galaxy,
					station.systemIndex,
					station.localCarrierId,
					slot,
				]);
				anchors[key] = validateAnchor({
					...createAnchor({
						seed: 0xffffffff,
						government: generated.systems[station.systemIndex].government,
						active: 4,
						total: 4,
					}),
					at: Number.MAX_SAFE_INTEGER,
					episode: Number.MAX_SAFE_INTEGER,
					phase: "down",
					left: durationFor(0xffffffff, Number.MAX_SAFE_INTEGER),
					repaired: true,
				});
			}
		}
		const capabilities = Object.keys(anchors).length;
		assert.equal(
			capabilities,
			2 * (types.trade ?? 0) +
				3 * ((types.refinery ?? 0) + (types.shipyard ?? 0)),
		);
		const bytes = Buffer.byteLength(JSON.stringify(anchors));
		rows.push({
			seed,
			galaxy,
			types,
			refineries,
			capabilities,
			candidateAnchorJsonBytes: bytes,
		});
		totalBytes += bytes;
		totalCapabilities += capabilities;
		totalRefineries += refineries;
	}
	rows.push({
		seed,
		allEightGalaxies: true,
		totalCapabilities,
		totalRefineries,
		candidateAnchorJsonBytes: totalBytes,
		maxQueueTimingRows: totalRefineries,
		maxJobWorkRows: 8 * totalRefineries,
	});
}
console.log(
	JSON.stringify(
		{
			generator: WORLD_GENERATOR_VERSION,
			schema: WORLD_SCHEMA_VERSION,
			measurement:
				"synthetic populated anchor records including redundant generated fields; not a production save envelope or storage quota proof",
			rows,
		},
		null,
		2,
	),
);

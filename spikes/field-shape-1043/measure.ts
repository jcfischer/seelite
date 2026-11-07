import {
	FIELD_PROFILE,
	fieldCells,
	systemFields,
} from "../../src/asteroid-field";
import { generateGalaxy } from "../../src/galaxy";
import { generateContents } from "../../src/system";
import {
	CANDIDATES,
	candidateProfile,
	candidateRocks,
	densityAt,
} from "./profiles";

const seeds = [47, 7, 0x5ee11e];
const buckets = new Map<string, number[]>();
const started = performance.now();
for (const seed of seeds)
	for (const record of generateGalaxy(seed, 0).systems)
		for (const plan of systemFields(record, generateContents(record)))
			for (const candidate of CANDIDATES) {
				const key = `${plan.profile}:${candidate}`;
				const counts = buckets.get(key) ?? [];
				counts.push(candidateRocks(record, plan, candidate).length);
				buckets.set(key, counts);
			}
const quantile = (values: number[], fraction: number): number => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor((sorted.length - 1) * fraction)];
};
const rows = [...buckets].map(([key, counts]) => {
	const [kind, candidate] = key.split(":") as [
		"charted" | "rare",
		(typeof CANDIDATES)[number],
	];
	const profile = candidateProfile(kind, candidate);
	const continuous = candidate === "organic" || candidate === "braided";
	const base = FIELD_PROFILE[kind];
	const bankProfile = {
		...base,
		occupancy: 1,
		semiKm: base.semiKm.map((n) => n * 1.6) as [number, number, number],
	};
	const cellCount = continuous ? null : fieldCells(profile).length;
	const row = {
		kind,
		candidate,
		fields: counts.length,
		min: Math.min(...counts),
		p50: quantile(counts, 0.5),
		p99: quantile(counts, 0.99),
		max: Math.max(...counts),
		layoutCells: cellCount,
		placement: continuous ? "continuous independent anchors" : "lattice slots",
		metadataBankSlots: continuous ? fieldCells(bankProfile).length : cellCount,
		semiKmRole: continuous
			? "conservative display bound only"
			: "layout ellipsoid",
		semiKm: profile.semiKm,
		cellKm: profile.cellKm,
	};
	if (
		!Object.values(row)
			.filter((v) => typeof v === "number")
			.every(Number.isFinite)
	)
		throw new Error("Non-finite measurement");
	return row;
});
const record = generateGalaxy(0x5ee11e, 0).systems[173];
const plan = systemFields(record, generateContents(record))[0];
const maps = CANDIDATES.map((candidate) => ({
	candidate,
	semiKm: candidateProfile(plan.profile, candidate).semiKm,
	rocks: candidateRocks(record, plan, candidate).map((r) => ({
		slot: r.slot,
		x: r.anchor.x,
		y: r.anchor.y,
		z: r.anchor.z,
		radiusKm: r.radiusKm,
	})),
}));
console.log(
	JSON.stringify(
		{
			seeds,
			galaxy: 0,
			rows,
			maps,
			density: {
				centre: densityAt(0, 0, 0),
				left: densityAt(-0.48, -0.18, 0.12),
				right: densityAt(0.42, 0.25, -0.2),
				edge: densityAt(1, 0, 0),
			},
			elapsedMs: performance.now() - started,
		},
		null,
		2,
	),
);

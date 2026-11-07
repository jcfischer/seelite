import { capabilitySaveCase } from "./lib/capability-save-case";
import {
	type SaveEnvelope,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import { sweepSources } from "../src/system-sweep";

function fillDiscovery(save: SaveEnvelope, includeFields = true): SaveEnvelope {
	const world = {
		...save.world,
		galaxies: save.world.galaxies.map((g) => ({
			...g,
			fieldDiscoveries: includeFields
				? Array.from({ length: 256 }, (_, i) => `${i}:field-01` as const)
				: [],
		})),
	};
	const sweepReadings = world.galaxies
		.flatMap((g) =>
			Array.from({ length: 256 }, (_, i) =>
				sweepSources(world, g.galaxyIndex, i),
			),
		)
		.flat()
		.filter((r) => includeFields || r.kind !== "field")
		.sort((a, b) => a.id.localeCompare(b.id));
	const filled = { world, commander: { ...save.commander, sweepReadings } };
	const loaded = parseSave(JSON.parse(JSON.stringify(serializeSave(filled))));
	if (
		loaded.world.galaxies.some(
			(g) => g.fieldDiscoveries.length !== (includeFields ? 256 : 0),
		) ||
		JSON.stringify(loaded.commander.sweepReadings) !==
			JSON.stringify(sweepReadings)
	)
		throw new Error(
			"discovery payload changed across complete-envelope round trip",
		);
	return filled;
}

for (const seed of [1, 47, 0x5ee11e]) {
	const baseline = capabilitySaveCase(seed, "all", (save) =>
		fillDiscovery(save, false),
	);
	const full = capabilitySaveCase(seed, "all", fillDiscovery);
	console.log(
		JSON.stringify({
			...full,
			stableDiscoveryIds: 8 * 256,
			additionalUtf8: full.completeEnvelopeUtf8 - baseline.completeEnvelopeUtf8,
			additionalUtf16:
				full.completeEnvelopeUtf16 - baseline.completeEnvelopeUtf16,
		}),
	);
}

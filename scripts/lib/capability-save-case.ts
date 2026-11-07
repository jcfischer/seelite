import {
	advanceTo,
	newWorld,
	enumerateCarriers,
	capabilityAvailability,
	GALAXY_COUNT,
} from "../../src/world-state";
import {
	serializeSave,
	parseSave,
	newCommanderRecord,
	type SaveEnvelope,
} from "../../src/save-envelope";

/** Measure actual timing anchors and round-trip a caller's complete-envelope payload. */
export function capabilitySaveCase(
	seed: number,
	coverage: "untouched" | "partly" | "all",
	fillPayload?: (save: SaveEnvelope) => SaveEnvelope,
) {
	const world = advanceTo(newWorld(seed), 5000);
	let generated = 0,
		anchors = 0;
	for (let galaxy = 0; galaxy < GALAXY_COUNT; galaxy++) {
		const slots = [...enumerateCarriers(seed, galaxy)].filter(
			(c) => c.kind === "capability",
		);
		generated += slots.length;
		const selected =
			coverage === "untouched"
				? []
				: coverage === "partly"
					? slots.slice(0, 5)
					: slots;
		for (const c of selected) {
			world.galaxies[galaxy].capabilityTime.anchors[c.key] =
				capabilityAvailability(world, galaxy, c.key).state;
			anchors++;
		}
	}
	const base = { world, commander: newCommanderRecord("courier") };
	const save = serializeSave(fillPayload ? fillPayload(base) : base);
	const json = JSON.stringify(save);
	const loaded = parseSave(JSON.parse(json));
	const restored = loaded.world.galaxies.reduce(
		(n, g) => n + Object.keys(g.capabilityTime.anchors).length,
		0,
	);
	if (restored !== anchors)
		throw new Error(
			"capability anchors changed across complete-envelope readback",
		);
	const domains = JSON.stringify(world.galaxies.map((g) => g.capabilityTime));
	return {
		seed,
		coverage,
		galaxies: GALAXY_COUNT,
		generated,
		anchors,
		timingPayloadUtf8: new TextEncoder().encode(domains).length,
		timingPayloadUtf16: domains.length * 2,
		completeEnvelopeUtf8: new TextEncoder().encode(json).length,
		completeEnvelopeUtf16: json.length * 2,
		additionalPayloadIncluded: !!fillPayload,
	};
}

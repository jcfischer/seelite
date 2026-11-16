import { expect, test } from "bun:test";
import { fnv1a } from "../src/rng";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import { newWorld } from "../src/world-state";
import { pairLegacyWorldFixture } from "./legacy-world-fixture";

test.each([18, 19, 20, 21])(
	"save %s migrates world 4 to 5 without changing source bytes",
	(version) => {
		const raw = serializeSave({
			world: newWorld(47),
			commander: newCommanderRecord("courier"),
		});
		const { integrity: _, ...body } = raw as Record<string, any>;
		body.saveSchemaVersion = version;
		pairLegacyWorldFixture(body);
		const legacy = { ...body, integrity: fnv1a(JSON.stringify(body)) };
		const original = JSON.stringify(legacy);
		const loaded = parseSave(legacy);
		expect(loaded.world.worldSchemaVersion).toBe(5);
		expect(loaded.world.galaxies.map((g) => g.refineries)).toEqual(
			Array.from({ length: 8 }, () => ({})),
		);
		expect(JSON.stringify(legacy)).toBe(original);
		expect(parseSave(serializeSave(loaded))).toEqual(loaded);
	},
);

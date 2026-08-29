import { describe, expect, test } from "bun:test";
import { moonName, planetName, starName } from "../src/body-name";
import { generateGalaxy } from "../src/galaxy";
import { generateContents, placeBodies } from "../src/system";
import baseline from "./fixtures/body-placement-pre-names.json";

describe("node #110 — derived body names", () => {
	test("star, planet, and moon labels draw nothing and follow the ratified form", () => {
		expect(starName("SOORATLE")).toBe("SOORATLE");
		expect(planetName("SOORATLE", 0)).toBe("SOORATLE I");
		expect(planetName("SOORATLE", 1)).toBe("SOORATLE II");
		expect(moonName("SOORATLE II", 0)).toBe("SOORATLE II a");
	});

	test("every contents and placed-body record carries the same name", () => {
		const record = generateGalaxy(42, 0).systems[0];
		const contents = generateContents(record);
		const placed = placeBodies(contents, 1234);
		const expected = new Map<string, string>([
			[contents.star.id, contents.star.name],
			...contents.planets.flatMap((planet) => [
				[planet.id, planet.name] as const,
				...planet.moons.map((moon) => [moon.id, moon.name] as const),
			]),
			...contents.stations.map(
				(station) => [station.id, station.name] as const,
			),
		]);
		expect(expected.size).toBe(placed.length);
		for (const body of placed) expect(expected.get(body.id)).toBe(body.name);
	});

	test("adding display names leaves the pre-name placement shape deterministic", () => {
		const record = generateGalaxy(baseline.worldSeed, baseline.galaxy).systems[
			baseline.system
		];
		const contents = generateContents(record);
		const rows = placeBodies(contents, baseline.gameTime).map(
			({ id, kind, pos, radiusKm }) =>
				[
					id,
					kind,
					pos.x.toExponential(12),
					pos.y.toExponential(12),
					pos.z.toExponential(12),
					radiusKm.toExponential(12),
				].join("\t"),
		);
		expect(rows).toEqual(baseline.rows);
	});
});

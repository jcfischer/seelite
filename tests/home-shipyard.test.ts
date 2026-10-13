/**
 * Node #818: a Commander docked at a shipyard boots holding for that form's
 * model, and only then (map #1, #830/#835: the home exterior blocks the boot).
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { homeRefineryForm, homeShipyardForm } from "../src/home-shipyard";
import { restoreWorld } from "../src/sim";
import { LOCAL_CARRIER_ID } from "../src/station";

const SEED = 42;

/** The first systems of galaxy 0 with a shipyard, and the form each picked. */
function shipyardSystems() {
	const found: { systemIndex: number; form: string; key: string }[] = [];
	for (
		let systemIndex = 0;
		found.length < 6 && systemIndex < 256;
		systemIndex++
	) {
		const { system } = restoreWorld(SEED, 0, systemIndex, 0);
		const yard = system.contents.stations.find((s) => s.type === "shipyard");
		if (yard)
			found.push({
				systemIndex,
				form: yard.formId,
				key: carrierKey(system.record.index, yard.localCarrierId),
			});
	}
	return found;
}

const save = (systemIndex: number, dockedAt: string | null) => ({
	world: { seed: SEED, gameTime: 0 },
	commander: { dockedAt, galaxyIndex: 0, systemIndex },
});

describe("node #818: the home shipyard", () => {
	test("a Commander docked at a shipyard waits for its form", () => {
		const systems = shipyardSystems();
		expect(systems.length).toBeGreaterThan(0);
		for (const { systemIndex, form, key } of systems)
			expect(homeShipyardForm(save(systemIndex, key))).toBe(
				form as "a" | "b" | "c",
			);
	});

	test("anywhere else, nothing: undocked, at another station, no save", () => {
		const [{ systemIndex }] = shipyardSystems();
		expect(homeShipyardForm(null)).toBeNull();
		expect(homeShipyardForm(save(systemIndex, null))).toBeNull();
		expect(
			homeShipyardForm(
				save(systemIndex, carrierKey(systemIndex, LOCAL_CARRIER_ID.trade)),
			),
		).toBeNull();
	});

	test("a save that will not restore is no home shipyard", () => {
		expect(
			homeShipyardForm({
				world: { seed: SEED, gameTime: -1 },
				commander: {
					dockedAt: carrierKey(0, LOCAL_CARRIER_ID.shipyard),
					galaxyIndex: 0,
					systemIndex: 0,
				},
			}),
		).toBeNull();
	});
});

describe("node #819: the home refinery", () => {
	/** The first systems of galaxy 0 with a refinery, and the form each picked. */
	function refinerySystems() {
		const found: { systemIndex: number; form: string; key: string }[] = [];
		for (
			let systemIndex = 0;
			found.length < 8 && systemIndex < 256;
			systemIndex++
		) {
			const { system } = restoreWorld(SEED, 0, systemIndex, 0);
			const plant = system.contents.stations.find((s) => s.type === "refinery");
			if (plant)
				found.push({
					systemIndex,
					form: plant.formId,
					key: carrierKey(system.record.index, plant.localCarrierId),
				});
		}
		return found;
	}

	test("a Commander docked at a refinery waits for its form", () => {
		const systems = refinerySystems();
		expect(systems.length).toBeGreaterThan(0);
		for (const { systemIndex, form, key } of systems)
			expect(homeRefineryForm(save(systemIndex, key))).toBe(
				form as "a" | "b" | "c" | "d",
			);
	});

	test("anywhere else, nothing: undocked, at a shipyard, no save", () => {
		const [{ systemIndex }] = refinerySystems();
		expect(homeRefineryForm(null)).toBeNull();
		expect(homeRefineryForm(save(systemIndex, null))).toBeNull();
		expect(
			homeRefineryForm(
				save(systemIndex, carrierKey(systemIndex, LOCAL_CARRIER_ID.shipyard)),
			),
		).toBeNull();
	});
});

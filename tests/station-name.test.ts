import { describe, expect, test } from "bun:test";
import { DOMAIN } from "../src/domains";
import {
	drawUniqueStationName,
	STATION_NAME_SLOT,
	stationNames,
} from "../src/station-name";
import { forEachSystem } from "./helpers/station-rows";

const WORLD_SEED = 1;
const GALAXIES = [0, 1] as const;

describe("node #110 — fixed station-name streams", () => {
	test("the new domain is appended and every fixed type owns a distinct slot", () => {
		expect(DOMAIN.STATION_NAME).toBe(11);
		expect(new Set(Object.values(STATION_NAME_SLOT)).size).toBe(4);
		expect(STATION_NAME_SLOT).toEqual({
			trade: 1,
			refinery: 2,
			shipyard: 3,
			outpost: 4,
		});
	});

	test("the same system seed always draws the same proper names", () => {
		const first = stationNames(47, "SOORATLE");
		expect(stationNames(47, "SOORATLE")).toEqual(first);
		expect(new Set(Object.values(first)).size).toBe(4);
		expect(Object.values(first)).not.toContain("SOORATLE");
	});

	test("a beltless system does not hand the refinery slot to the shipyard", () => {
		let checked = false;
		forEachSystem(WORLD_SEED, GALAXIES, (record, contents) => {
			if (checked || contents.belt || record.displayTL < 10) return;
			const shipyard = contents.stations.find((s) => s.type === "shipyard");
			if (!shipyard) return;
			const slots = stationNames(record.seed, record.name);
			expect(contents.stations.some((s) => s.type === "refinery")).toBe(false);
			expect(shipyard.name).toBe(slots.shipyard);
			expect(shipyard.name).not.toBe(slots.refinery);
			checked = true;
		});
		expect(checked).toBe(true);
	});

	test("every generated station receives its fixed slot's name", () => {
		let stations = 0;
		forEachSystem(WORLD_SEED, GALAXIES, (record, contents) => {
			const slots = stationNames(record.seed, record.name);
			for (const station of contents.stations) {
				stations++;
				expect(station.name).toBe(slots[station.type]);
			}
		});
		expect(stations).toBeGreaterThan(500);
	});
});

describe("node #110 — local collision guard", () => {
	test("redraws after the system name and after a sibling name", () => {
		const sequence = ["SOORATLE", "QUERIOR", "ARLEDI"];
		const drawn = drawUniqueStationName(
			() => sequence.shift() ?? "EXHAUSTED",
			new Set(["SOORATLE", "QUERIOR"]),
		);
		expect(drawn).toBe("ARLEDI");
	});

	test("generated names collide with neither system nor sibling", () => {
		const collisions: string[] = [];
		forEachSystem(WORLD_SEED, GALAXIES, (record, contents, galaxy) => {
			const names = contents.stations.map((s) => s.name);
			if (names.includes(record.name) || new Set(names).size !== names.length)
				collisions.push(`g${galaxy} ${record.index} ${record.name}: ${names}`);
		});
		expect(collisions).toEqual([]);
	});
});

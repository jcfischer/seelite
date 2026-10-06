import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { carrierKey } from "../src/carrier-key";
import { generateGalaxy } from "../src/galaxy";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import { restoreWorld } from "../src/sim";
import { generateContents, orbitWarmth } from "../src/system";
import { newWorld, visit } from "../src/world-state";

const SEED = 20260930;
const systems = Array.from({ length: 4 }, (_, galaxy) =>
	generateGalaxy(SEED, galaxy).systems.map((record) => ({
		record,
		contents: generateContents(record),
	})),
).flat();
const planets = systems.flatMap(({ contents }) => contents.planets);

test("unaffected inner planets retain their seeded identity, radius, and orbit", () => {
	// Captured before #590 from 983 inner planets in two galaxies. Moons are
	// intentionally excluded: adding them is the change this node owns.
	const rows: unknown[] = [];
	for (let galaxy = 0; galaxy < 2; galaxy++)
		for (const record of generateGalaxy(6218014, galaxy).systems) {
			const contents = generateContents(record);
			for (const planet of contents.planets)
				if (planet.aAu <= 2 * contents.habitableAu)
					rows.push([
						galaxy,
						record.index,
						planet.id,
						planet.name,
						planet.aAu,
						planet.radiusKm,
						planet.isPrimary,
						planet.orbit,
					]);
		}
	expect(rows.length).toBe(983);
	expect(createHash("sha256").update(JSON.stringify(rows)).digest("hex")).toBe(
		"fd8d03707723dc8cca2f71d2f3ca98e875ed43582d17247db82bbc26bf92c728",
	);
});

test("station names, flags, seeds, periods, and phases retain their old draws", () => {
	// Captured before #590 from 788 stations in the same two-galaxy corpus.
	// Parent and host-derived orbit fields are excluded because some shipyards
	// deliberately move; all draw-derived station details must stay put.
	const rows: unknown[] = [];
	for (let galaxy = 0; galaxy < 2; galaxy++)
		// Node #491's raider outpost is new and draws on its own stream;
		// every station that was already there must keep its draws.
		for (const record of generateGalaxy(6218014, galaxy).systems)
			for (const station of generateContents(record).stations)
				if (station.type !== "outpost")
					rows.push([
						galaxy,
						record.index,
						station.id,
						station.type,
						station.name,
						station.localCarrierId,
						station.blackMarket,
						station.spinRpm,
						station.berthSeed,
						station.assemblySeed,
						station.orbit.periodS,
						station.orbit.theta0,
					]);
	expect(rows.length).toBe(788);
	expect(createHash("sha256").update(JSON.stringify(rows)).digest("hex")).toBe(
		"2f2cdade80ae751a14bdbfc89bb45b844589ac2559b6a3748ac735379641ccc9",
	);
});

test("outer orbits contain both giants and cold rocky ice worlds", () => {
	const outer = systems.flatMap(({ contents }) =>
		contents.planets.filter(
			(planet) => orbitWarmth(planet.aAu, contents.star.luminosity) > 2,
		),
	);
	const coldRocky = outer.filter((planet) => !planet.isGasGiant);
	expect(outer.length).toBeGreaterThan(300);
	expect(coldRocky.length / outer.length).toBeGreaterThan(0.12);
	expect(coldRocky.length / outer.length).toBeLessThan(0.28);
	expect(outer.some((planet) => planet.isGasGiant)).toBe(true);
	expect(
		planets
			.filter((planet) => planet.isPrimary)
			.every((planet) => !planet.isGasGiant),
	).toBe(true);
});

test("half the rocky planets have exactly one smaller, clear-orbit moon", () => {
	const rocky = planets.filter((planet) => !planet.isGasGiant);
	const withMoon = rocky.filter((planet) => planet.moons.length === 1);
	expect(rocky.length).toBeGreaterThan(1000);
	expect(withMoon.length / rocky.length).toBeGreaterThan(0.45);
	expect(withMoon.length / rocky.length).toBeLessThan(0.55);
	for (const planet of rocky) {
		expect(planet.moons.length).toBeLessThanOrEqual(1);
		for (const moon of planet.moons) {
			expect(moon.id).toBe(`${planet.id}-moon-0`);
			expect(moon.radiusKm).toBeLessThan(planet.radiusKm);
			expect(moon.orbit.radiusKm).toBeGreaterThan(
				planet.radiusKm + moon.radiusKm,
			);
		}
	}
});

test("giants retain the full zero-to-three moon distribution", () => {
	const giants = planets.filter((planet) => planet.isGasGiant);
	expect(giants.length).toBeGreaterThan(300);
	for (let count = 0; count <= 3; count++)
		expect(
			giants.filter((planet) => planet.moons.length === count).length,
		).toBeGreaterThan(30);
	for (const planet of giants)
		planet.moons.forEach((moon, index) =>
			expect(moon.id).toBe(`${planet.id}-moon-${index}`),
		);
});

test("station identities survive and shipyards use only primary or giant hosts", () => {
	let shipyards = 0;
	let primaryFallbacks = 0;
	for (const { record, contents } of systems) {
		const again = generateContents(record);
		expect(again.stations).toEqual(contents.stations);
		const primary = contents.planets.find((planet) => planet.isPrimary);
		if (!primary) throw new Error(`missing primary in system ${record.index}`);
		expect(
			contents.stations.find((station) => station.type === "trade")?.parentId,
		).toBe(primary.id);
		for (const station of contents.stations) {
			expect(station.id).toBe(`station-${station.type}`);
			if (station.type !== "shipyard") continue;
			shipyards++;
			const host = contents.planets.find(
				(planet) => planet.id === station.parentId,
			);
			expect(host?.isPrimary || host?.isGasGiant).toBe(true);
			if (!contents.planets.some((planet) => planet.isGasGiant)) {
				primaryFallbacks++;
				expect(station.parentId).toBe(primary.id);
			}
		}
	}
	expect(shipyards).toBeGreaterThan(50);
	expect(primaryFallbacks).toBeGreaterThan(5);
});

test("a shipyard keeps its former host when that host remains eligible", () => {
	// Captured on generator v7 before #590. A removed giant may relocate its
	// shipyard, but a surviving host must not move because the candidate list
	// became shorter ahead of it.
	const oldHosts = JSON.parse(
		readFileSync(
			new URL("fixtures/shipyard-hosts-generator-v7.json", import.meta.url),
			"utf8",
		),
	) as [number, number, string][];
	expect(oldHosts.length).toBe(85);
	for (const [galaxy, index, oldHostId] of oldHosts) {
		const record = generateGalaxy(6218014, galaxy).systems[index];
		const contents = generateContents(record);
		const oldHost = contents.planets.find((planet) => planet.id === oldHostId);
		if (!oldHost)
			throw new Error(`missing old host ${galaxy}/${index}/${oldHostId}`);
		if (!oldHost.isPrimary && !oldHost.isGasGiant) continue;
		expect(
			contents.stations.find((station) => station.type === "shipyard")
				?.parentId,
		).toBe(oldHostId);
	}
});

test("a docked shipyard save still names the regenerated station after load", () => {
	const system = systems.find(({ contents }) =>
		contents.stations.some((station) => station.type === "shipyard"),
	);
	expect(system).toBeDefined();
	if (!system) return;
	const galaxyIndex = 0;
	const systemIndex = system.record.index;
	const shipyard = system.contents.stations.find(
		(station) => station.type === "shipyard",
	);
	expect(shipyard).toBeDefined();
	if (!shipyard) return;
	const key = carrierKey(systemIndex, shipyard.localCarrierId);
	const commander = {
		...newCommanderRecord("courier", { permadeath: false }),
		galaxyIndex,
		systemIndex,
		dockedAt: key,
	};
	const loaded = parseSave(
		serializeSave({
			world: visit(newWorld(SEED), galaxyIndex, systemIndex),
			commander,
		}),
	);
	const restored = restoreWorld(
		SEED,
		galaxyIndex,
		systemIndex,
		loaded.world.gameTime,
	);
	expect(loaded.commander.dockedAt).toBe(key);
	expect(
		restored.system.contents.stations.find(
			(station) => station.localCarrierId === shipyard.localCarrierId,
		)?.id,
	).toBe(shipyard.id);
});

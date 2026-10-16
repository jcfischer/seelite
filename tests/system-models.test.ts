import { expect, test } from "bun:test";
import { makeWorld, restoreWorld } from "../src/sim";
import { carrierKey } from "../src/carrier-key";
import {
	buildHaulerPlans,
	inboundCandidates,
} from "../src/inter-system-traffic";
import { generateContents } from "../src/system";
import { stationModel } from "../src/model-catalog";
import { bootModelIds, systemModelIds } from "../src/system-models";

test("boot waits only for cockpit and home exterior, including saves at any role", () => {
	const world = makeWorld(42);
	const home = world.system.contents.stations.find((s) => s.type === "trade")!;
	expect(bootModelIds(world.system, null)).toEqual([
		"cockpit",
		...[stationModel(home)].filter((id) => id !== null),
	]);
	for (let i = 0; i < 16; i++) {
		const { system } = restoreWorld(42, 0, i, 0);
		for (const station of system.contents.stations) {
			const ids = bootModelIds(system, carrierKey(i, station.localCarrierId));
			expect(ids).toEqual([
				"cockpit",
				...[stationModel(station)].filter((id) => id !== null),
			]);
			expect(ids).not.toContain("miner");
			expect(ids).not.toContain("interiors");
		}
	}
});

test("system set includes its stations, home and inbound Traffic hulls, and the flown hull", () => {
	const { system, galaxy } = makeWorld(42);
	const contents = (i: number) =>
		generateContents(galaxy.systems.find((r) => r.index === i)!);
	const actors = [
		...buildHaulerPlans(galaxy, system.record.index, contents),
		...inboundCandidates(galaxy, system.record.index, contents),
	].map((p) => p.actor);
	const ids = systemModelIds(
		system,
		actors.map((a) => a.hullId),
		"miner",
	);
	expect(ids).toContain("miner");
	expect(ids).toContain("cockpit");
	expect(ids).toContain("interiors");
	for (const station of system.contents.stations) {
		const id = stationModel(station);
		if (id) expect(ids).toContain(id);
	}
	for (const actor of actors)
		if (["courier", "tug", "miner"].includes(actor.hullId))
			expect(ids as string[]).toContain(actor.hullId);
	expect(new Set(ids).size).toBe(ids.length);
});

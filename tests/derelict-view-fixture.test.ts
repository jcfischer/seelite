import "../src/loadout";
import { expect, test } from "bun:test";
import { SEED, VIEWS } from "../scripts/lib/view-set.mjs";
import { derelictPose } from "../src/derelict";
import { buildDerelictMesh, disposeDerelict } from "../src/derelict-mesh";
import {
	derelictNextLossAt,
	derelictSlots,
	derelictTimeline,
} from "../src/derelict-slots";
import { isAuthoredHullModel } from "../src/model-catalog";
import { makeWorld, makeWorldAtSystem, resetWorldToStart } from "../src/sim";

test("derelict-tear's declared fixture selects a wreck with torn skin and exposed frame", () => {
	const view = VIEWS.find((view) => view.name === "derelict-tear");
	expect(view).toBeDefined();
	const shot = view!.shot as {
		seed?: number;
		system?: number;
		framing?: string;
	};
	expect(shot.framing).toBe("tear");
	const seed = shot.seed ?? SEED;
	const world =
		shot.system === undefined
			? makeWorld(seed)
			: makeWorldAtSystem(seed, shot.system);
	resetWorldToStart(world);
	const { system } = world;
	const candidates = derelictSlots(
		system.record.index,
		system.record.government,
	).map(({ key }) => {
		const at = derelictNextLossAt(system.record.seed, key) + 1;
		const phase = derelictTimeline(system.record.seed, key, at);
		expect(phase.condition).toBe("destroyed");
		return derelictPose(system, key, phase.instanceOrdinal, at);
	});
	const pose = candidates.find(({ hull }) => !isAuthoredHullModel(hull));
	expect(pose).toBeDefined();
	const wreck = buildDerelictMesh(pose!.hull);
	try {
		expect(wreck.userData.torn?.sites.length ?? 0).toBeGreaterThan(0);
		expect(wreck.userData.torn?.frame ?? 0).toBeGreaterThan(0);
	} finally {
		disposeDerelict(wreck);
	}
});

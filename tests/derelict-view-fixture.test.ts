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
	if (!view) throw Error("derelict-tear view is missing");
	const shot = view.shot;
	expect(shot.framing).toBe("tear");
	const seed = ("seed" in shot ? shot.seed : undefined) ?? SEED;
	const systemIndex = "system" in shot ? shot.system : undefined;
	const world =
		systemIndex === undefined
			? makeWorld(seed)
			: makeWorldAtSystem(seed, systemIndex);
	resetWorldToStart(world);
	const { system } = world;
	const candidates = derelictSlots(
		system.record.index,
		system.record.government,
	).map(({ key }) => {
		const at = derelictNextLossAt(system.record.seed, key) + 1;
		const phase = derelictTimeline(system.record.seed, key, at);
		if (phase.condition !== "destroyed") throw Error("next loss drew no wreck");
		return derelictPose(system, key, phase.instanceOrdinal, at);
	});
	const pose = candidates.find(({ hull }) => !isAuthoredHullModel(hull));
	expect(pose).toBeDefined();
	if (!pose) throw Error("fixture has no tearable derelict slot");
	const wreck = buildDerelictMesh(pose.hull);
	try {
		expect(wreck.userData.torn?.sites.length ?? 0).toBeGreaterThan(0);
		expect(wreck.userData.torn?.frame ?? 0).toBeGreaterThan(0);
	} finally {
		disposeDerelict(wreck);
	}
});

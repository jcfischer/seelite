import { derelictPose } from "../../src/derelict";
import {
	derelictNextLossAt,
	derelictSlots,
	derelictTimeline,
} from "../../src/derelict-slots";
import type { System } from "../../src/sim";

export function nextDerelictViewWreck(system: System) {
	for (const { key } of derelictSlots(
		system.record.index,
		system.record.government,
	)) {
		const at = derelictNextLossAt(system.record.seed, key) + 1;
		const phase = derelictTimeline(system.record.seed, key, at);
		if (phase.condition !== "destroyed") throw Error("next loss drew no wreck");
		const pose = derelictPose(system, key, phase.instanceOrdinal, at);
		return { key, at, pose };
	}
	throw Error("no derelict slot");
}

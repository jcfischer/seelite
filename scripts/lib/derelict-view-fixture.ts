import { derelictPose } from "../../src/derelict";
import {
	derelictNextLossAt,
	derelictSlots,
	derelictTimeline,
} from "../../src/derelict-slots";
import { isAuthoredHullModel } from "../../src/model-catalog";
import type { System } from "../../src/sim";

export function nextDerelictViewWreck(
	system: System,
	framing: "tear" | null = null,
) {
	for (const { key } of derelictSlots(
		system.record.index,
		system.record.government,
	)) {
		const at = derelictNextLossAt(system.record.seed, key) + 1;
		const phase = derelictTimeline(system.record.seed, key, at);
		if (phase.condition !== "destroyed") throw Error("next loss drew no wreck");
		const pose = derelictPose(system, key, phase.instanceOrdinal, at);
		if (framing !== "tear" || !isAuthoredHullModel(pose.hull))
			return { key, at, pose };
	}
	throw Error("no derelict slot whose wreck the tear can cut");
}

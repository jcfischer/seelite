/** Read-only cockpit projection of dated system sensor provenance. */
import { targetAgeLabel } from "./display-contact";
import { generateGalaxy } from "./galaxy";
import { generateContents } from "./system";
import type { SweepPanel } from "./live-cockpit";
import {
	SWEEP_CHARGE_S,
	SWEEP_STALE_S,
	sweepRefusal,
	type SweepReading,
	type SweepContext,
	type SweepCharge,
} from "./system-sweep";

export const SWEEP_KIND_LABEL: Record<SweepReading["kind"], string> = {
	relay: "Pirate relay signal",
	wreck: "Salvage wreck signal",
	pressure: "Raider pressure",
};
export const SWEEP_INTERRUPTED = "Sweep interrupted · press Sweep to restart";
export const sweepCompletion = (count: number): string =>
	count === 0
		? "Sweep complete · no signal regions found"
		: `Sweep complete · ${count} ${count === 1 ? "region" : "regions"} recorded`;

export const sweepAge = (row: SweepReading, now: number): string => {
	const age = Math.max(0, now - row.observedAt);
	return `${targetAgeLabel(age)} ago${age >= SWEEP_STALE_S ? " · STALE" : ""}`;
};
export function sweepRegionLabel(row: SweepReading, worldSeed: number): string {
	const record = generateGalaxy(worldSeed, row.galaxyIndex).systems[
		row.systemIndex
	];
	if (row.region.kind === "system-space")
		return `${record.name} · unsettled system space`;
	const { stationId } = row.region;
	const station = generateContents(record).stations.find(
		(s) => s.id === stationId,
	);
	return `Surrounds of ${station?.name ?? row.region.stationId}`;
}

export function sweepPanel(
	readings: readonly SweepReading[],
	now: number,
	worldSeed: number,
	context: SweepContext & {
		galaxyIndex: number;
		systemIndex: number;
		visible: boolean;
		charge: SweepCharge | null;
		status: string;
	},
): SweepPanel {
	const remaining = context.charge
		? Math.max(0, Math.ceil(SWEEP_CHARGE_S - (now - context.charge.startedAt)))
		: null;
	return {
		fitted: context.fitted,
		refusal: sweepRefusal(context),
		charging: remaining !== null,
		status:
			remaining !== null
				? `CHARGING · ${remaining}s remaining · runs without holding`
				: context.status,
		rows: context.visible
			? readings
					.filter(
						(r) =>
							r.galaxyIndex === context.galaxyIndex &&
							r.systemIndex === context.systemIndex,
					)
					.map((r) => ({
						id: r.id,
						label: SWEEP_KIND_LABEL[r.kind],
						region: sweepRegionLabel(r, worldSeed),
						age: sweepAge(r, now),
					}))
			: [],
	};
}

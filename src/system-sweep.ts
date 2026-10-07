/** System-scale sensor provenance (node #482). No knowledge writer, position,
 * contact or target is exposed by this module. */
import { derelictSlots } from "./derelict-slots";
import { targetAgeLabel } from "./display-contact";
import { generateGalaxy } from "./galaxy";
import { relayActive } from "./pirate-relay";
import { raiderSlots } from "./raider-slots";
import { relayPlan, relaySlot } from "./relay-slot";
import { generateContents } from "./system";
import {
	effectiveCarrier,
	effectiveDerelict,
	type WorldState,
} from "./world-state";

export const SWEEP_CHARGE_S = 10;
export const SWEEP_STALE_S = 3600;
export interface SweepContext {
	fitted: boolean;
	flying: boolean;
	cruise: boolean;
}
export interface SweepCharge {
	startedAt: number;
}
export const sweepRefusal = (c: SweepContext): string | null =>
	!c.fitted
		? "Long-Range Scanner required"
		: !c.flying
			? "Launch to sweep"
			: c.cruise
				? "Leave cruise to sweep"
				: null;
export const beginSweep = (
	charge: SweepCharge | null,
	now: number,
	context: SweepContext,
): SweepCharge | null =>
	sweepRefusal(context) ? null : (charge ?? { startedAt: now });
export function stepSweep(
	charge: SweepCharge | null,
	now: number,
	context: SweepContext,
): { charge: SweepCharge | null; completed: boolean } {
	if (!charge || sweepRefusal(context))
		return { charge: null, completed: false };
	const completed = now - charge.startedAt >= SWEEP_CHARGE_S;
	return { charge: completed ? null : charge, completed };
}

/** Named areas, never point geometry. The system-space fallback is deliberately
 * broad: derelict slots have no generated placement until the wreck build. */
export type SweepRegion =
	| { kind: "station-surrounds"; stationId: string }
	| { kind: "system-space" };
export interface SavedLead {
	id: string;
	galaxyIndex: number;
	systemIndex: number;
	kind: "relay" | "wreck" | "pressure";
	source: "own-sensors";
	observedAt: number;
	region: SweepRegion;
	confirmation: "unconfirmed";
}
const leadId = (galaxy: number, system: number, subject: string) =>
	`sweep:${galaxy}:${system}:${subject}`;

/** Read live sources only after the charge completes. No disabled home-berth
 * carrier is a source. Pressure is one regional reading, never a ship roster. */
export function sweepSources(
	world: WorldState,
	galaxyIndex: number,
	systemIndex: number,
): SavedLead[] {
	const record = generateGalaxy(world.seed, galaxyIndex).systems[systemIndex];
	const contents = generateContents(record);
	const env = world.galaxies[galaxyIndex];
	const now = world.gameTime;
	const rows: SavedLead[] = [];
	const add = (kind: SavedLead["kind"], subject: string, region: SweepRegion) =>
		rows.push({
			id: leadId(galaxyIndex, systemIndex, subject),
			galaxyIndex,
			systemIndex,
			kind,
			source: "own-sensors",
			observedAt: now,
			region,
			confirmation: "unconfirmed",
		});
	const plan = relayActive(record) ? relayPlan(contents, record.seed) : null;
	if (
		plan &&
		effectiveCarrier(env, relaySlot(systemIndex).key, now).condition ===
			"operational"
	)
		add("relay", "relay-00", {
			kind: "station-surrounds",
			stationId: plan.watchedStationId,
		});
	for (const slot of derelictSlots(systemIndex, record.government))
		if (
			effectiveDerelict(world, galaxyIndex, slot.key, now).condition ===
			"destroyed"
		)
			add("wreck", slot.localCarrierId, { kind: "system-space" });
	if (
		raiderSlots(systemIndex, record.government).some(
			(slot) =>
				effectiveCarrier(env, slot.key, now).condition === "operational",
		)
	) {
		const outpost = contents.stations.find((s) => s.type === "outpost");
		add(
			"pressure",
			"pressure",
			outpost
				? { kind: "station-surrounds", stationId: outpost.id }
				: { kind: "system-space" },
		);
	}
	return rows.sort((a, b) => a.id.localeCompare(b.id));
}

/** A new reading replaces this system's reports, including absences (S22).
 * Between deliberate sweeps old rows remain unchanged, even if a source dies. */
export const replaceSystemLeads = (
	old: readonly SavedLead[],
	found: readonly SavedLead[],
	galaxyIndex: number,
	systemIndex: number,
): SavedLead[] => [
	...old.filter(
		(r) => r.galaxyIndex !== galaxyIndex || r.systemIndex !== systemIndex,
	),
	...found,
];
export const sweepAge = (row: SavedLead, now: number): string => {
	const age = Math.max(0, now - row.observedAt);
	return `${targetAgeLabel(age)} ago${age >= SWEEP_STALE_S ? " · STALE" : ""}`;
};
export function sweepRegionLabel(row: SavedLead, worldSeed: number): string {
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

/** Pre-sweep saves migrate to an empty ledger. Every nonempty row is
 * validated against its named galaxy/system; it cannot acquire point geometry
 * or an identified reference through a crafted save. */
export function parseSweepLeads(
	value: unknown,
	world: WorldState,
): SavedLead[] {
	if (value === undefined) return [];
	const fail = (): never => {
		throw new Error(
			"save: invalid system sweep provenance, region, identity or clock",
		);
	};
	if (!Array.isArray(value) || value.length > 8 * 256 * 5) return fail();
	const seen = new Set<string>();
	const galaxies = new Map<number, ReturnType<typeof generateGalaxy>>();
	return value.map((v) => {
		if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
		const r = v as SavedLead;
		if (
			Object.keys(r).sort().join() !==
				"confirmation,galaxyIndex,id,kind,observedAt,region,source,systemIndex" ||
			!Number.isInteger(r.galaxyIndex) ||
			r.galaxyIndex < 0 ||
			r.galaxyIndex >= world.galaxies.length ||
			!Number.isInteger(r.systemIndex) ||
			r.systemIndex < 0 ||
			r.systemIndex >= 256 ||
			!Number.isFinite(r.observedAt) ||
			r.observedAt < 0 ||
			r.observedAt > world.gameTime ||
			r.source !== "own-sensors" ||
			r.confirmation !== "unconfirmed" ||
			typeof r.id !== "string" ||
			seen.has(r.id)
		)
			return fail();
		let galaxy = galaxies.get(r.galaxyIndex);
		if (!galaxy) {
			galaxy = generateGalaxy(world.seed, r.galaxyIndex);
			galaxies.set(r.galaxyIndex, galaxy);
		}
		const record = galaxy.systems[r.systemIndex];
		const contents = generateContents(record);
		const subject = r.id.slice(leadId(r.galaxyIndex, r.systemIndex, "").length);
		const subjects =
			r.kind === "relay"
				? relayPlan(contents, record.seed)
					? ["relay-00"]
					: []
				: r.kind === "wreck"
					? derelictSlots(r.systemIndex, record.government).map(
							(s) => s.localCarrierId,
						)
					: r.kind === "pressure"
						? ["pressure"]
						: [];
		if (
			!subjects.includes(subject) ||
			r.id !== leadId(r.galaxyIndex, r.systemIndex, subject)
		)
			return fail();
		const region = r.region;
		if (!region || typeof region !== "object" || Array.isArray(region))
			return fail();
		if (region.kind === "system-space") {
			if (Object.keys(region).join() !== "kind") return fail();
		} else if (region.kind === "station-surrounds") {
			if (
				Object.keys(region).sort().join() !== "kind,stationId" ||
				!contents.stations.some((s) => s.id === region.stationId)
			)
				return fail();
		} else return fail();
		// The subject is provenance only, not a contact lookup.
		seen.add(r.id);
		return structuredClone(r);
	});
}

import {
	carrierKey,
	localCarrierIdOfKey,
	systemIndexOfKey,
	type CarrierKey,
} from "./carrier-key";
import { DOMAIN } from "./domains";
import { systemAt } from "./galaxy";
import { fnv1a, mix } from "./rng";
import { generateContents, type Station } from "./system";

export const CAPABILITY_SERVICES = [
	"market",
	"equipment",
	"exclusive",
] as const;
export type CapabilityService = (typeof CAPABILITY_SERVICES)[number];
export interface CapabilitySlot {
	key: CarrierKey;
	localCarrierId: string;
	systemIndex: number;
	stationKey: CarrierKey;
	parentId: string;
	service: CapabilityService;
}

/** Fixed capability slots preserve sibling identity when a station lacks an exclusive service. */
export function capabilitySlots(
	systemIndex: number,
	station: Pick<Station, "localCarrierId" | "type">,
): CapabilitySlot[] {
	if (
		!Number.isInteger(systemIndex) ||
		systemIndex < 0 ||
		systemIndex > 255 ||
		typeof station.localCarrierId !== "string" ||
		!station.localCarrierId ||
		!["trade", "refinery", "shipyard", "outpost"].includes(station.type)
	)
		throw new Error("capability: invalid slot identity");
	if (station.type === "outpost") return [];
	return CAPABILITY_SERVICES.filter(
		(s) => s !== "exclusive" || station.type !== "trade",
	).map((service) => ({
		key: carrierKey(
			systemIndex,
			`${station.localCarrierId}/capability/${service}`,
		),
		localCarrierId: `${station.localCarrierId}/capability/${service}`,
		systemIndex,
		stationKey: carrierKey(systemIndex, station.localCarrierId),
		parentId: station.localCarrierId,
		service,
	}));
}

/** Resolve generated identity and its independent timing stream; absent slots refuse. */
export function capabilityIdentity(
	worldSeed: number,
	galaxyIndex: number,
	key: CarrierKey,
): CapabilitySlot & { seed: number; government: number } {
	if (
		!Number.isInteger(worldSeed) ||
		worldSeed < 0 ||
		worldSeed > 0xffffffff ||
		!Number.isInteger(galaxyIndex) ||
		galaxyIndex < 0 ||
		galaxyIndex > 7
	)
		throw new Error("capability: invalid world identity");
	const systemIndex = systemIndexOfKey(key);
	if (!Number.isInteger(systemIndex) || systemIndex < 0 || systemIndex > 255)
		throw new Error("capability: invalid system identity");
	const record = systemAt(worldSeed, galaxyIndex, systemIndex);
	const local = localCarrierIdOfKey(key);
	const slot = generateContents(record)
		.stations.flatMap((station) => capabilitySlots(systemIndex, station))
		.find((s) => s.localCarrierId === local);
	if (!slot || slot.key !== key)
		throw new Error("capability: absent or noncanonical generated service");
	return {
		...slot,
		government: record.government,
		seed: mix(
			fnv1a(
				JSON.stringify([worldSeed, galaxyIndex, slot.stationKey, slot.service]),
			),
			DOMAIN.CAPABILITY_TIME,
		),
	};
}

import type { HullId } from "./hull";
import type { Vec3 } from "./vec3";

/** Forward cockpit-eye offset from the hull centre, in kilometres. */
export const COCKPIT_FORWARD_KM = 0.008;

/** The authored cabins. A hull without a row flies the courier's. */
export type CabinId = "courier" | "miner";
/** The bridge seats. Only the miner's cabin has a second one. */
export type BridgeSeat = "pilot" | "miner";

const HULL_CABINS: Partial<Record<HullId, CabinId>> = { miner: "miner" };

/** The cabin `hull` flies, https://github.com/jcfischer/seelite/issues/1198; #911 adds the tug's row. */
export const cabinForHull = (hull: HullId): CabinId =>
	HULL_CABINS[hull] ?? "courier";

/**
 * The study's pilot eye, (0.6, 5.21, 20.2) m in the Longwall export
 * (`EYE_STUDY`, spikes/miner-cockpit/build_two_seat.py), in the ship mesh's
 * frame (https://github.com/jcfischer/seelite/issues/1143): the export's x and z turn over, and installing the model centres its
 * bounds. Each seat is 0.6 m off the centre line.
 */
const BRIDGE_EYE_KM = { sideKm: 0.0006, upKm: 0.006803, foreKm: 0.025 };

/** Where the eye sits in the ship mesh's frame, in kilometres (-Z the nose). */
export function cockpitEyeKm(cabin: CabinId, seat: BridgeSeat): Vec3 {
	if (cabin !== "miner") return { x: 0, y: 0, z: -COCKPIT_FORWARD_KM };
	return {
		x: seat === "miner" ? BRIDGE_EYE_KM.sideKm : -BRIDGE_EYE_KM.sideKm,
		y: BRIDGE_EYE_KM.upKm,
		z: -BRIDGE_EYE_KM.foreKm,
	};
}

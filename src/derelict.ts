/** Derelict pose and owned scoop: the row is persistence, never a canister lifetime.
 * Finding and the entrusted job item belong to their own builds. */
import type { CarrierKey } from "./carrier-key";
import { carrierInstanceSeed } from "./carrier-standing";
import { DOMAIN } from "./domains";
import { HULL_SPECS, PURCHASABLE_HULL_IDS, type HullId } from "./hull";
import { seededRand } from "./rng";
import { CANISTER_SCOOP_RADIUS_KM, scoops } from "./raider-wreck";
import {
	type CommanderState,
	commanderHold,
	scoopCargo,
} from "./station-commerce";
import { type DerelictRow, PLAYER_SALVAGE } from "./world-state";
import { type System, bodyVelocity } from "./sim";
import { PLANET_APPROACH_RADIUS } from "./planet-approach-boundary";
import { placeBodies } from "./system";
import { type Vec3, add, scale, v3, rotateAbout, length } from "./vec3";

export const DERELICT_TUMBLE_RAD_S = 0.012;
/** Starting placement, km above the chosen body. Never an orbital path of its own. */
export const DERELICT_ALTITUDE_KM = [100, 500] as const;
const hullRadius = (id: HullId) => {
	const { env, envCentre: c } = HULL_SPECS[id];
	return (
		Math.hypot(env.beamKm / 2, env.heightKm / 2, env.lengthKm / 2) +
		Math.hypot(c.rightKm, c.upKm, c.foreKm)
	);
};
const PILOT_REACH_KM = Math.max(...PURCHASABLE_HULL_IDS.map(hullRadius));
/** Entire scoop sphere clear for the largest flyable pilot, even with either hull turned. */
export function tetherOffset(hull: HullId, index: number): Vec3 {
	const angle = (index * Math.PI * 2) / 5;
	const reach =
		hullRadius(hull) + PILOT_REACH_KM + CANISTER_SCOOP_RADIUS_KM + 0.02;
	return v3(Math.cos(angle) * reach, Math.sin(angle) * reach, 0);
}
export function derelictPose(
	system: System,
	key: CarrierKey,
	ordinal: number,
	at: number,
) {
	const rand = seededRand(
		carrierInstanceSeed(system.record.seed, key, ordinal, DOMAIN.DERELICT_POSE),
	);
	const bodies = placeBodies(system.contents, at).filter(
		(b) => b.kind === "planet" || b.kind === "moon",
	);
	if (!bodies.length) throw Error("derelict has no local body");
	const body = bodies[Math.floor(rand() * bodies.length)];
	const hull =
		PURCHASABLE_HULL_IDS[Math.floor(rand() * PURCHASABLE_HULL_IDS.length)];
	const azimuth = rand() * Math.PI * 2;
	const z = rand() * 2 - 1;
	const radial = Math.sqrt(1 - z * z);
	const offset = scale(
		v3(radial * Math.cos(azimuth), z, radial * Math.sin(azimuth)),
		body.radiusKm * (body.kind === "planet" ? PLANET_APPROACH_RADIUS : 1) +
			DERELICT_ALTITUDE_KM[0] +
			rand() * (DERELICT_ALTITUDE_KM[1] - DERELICT_ALTITUDE_KM[0]),
	);
	const phase = rand() * Math.PI * 2 + at * DERELICT_TUMBLE_RAD_S;
	const axis = v3(0.3, 0.8, 0.5);
	const unit = scale(axis, 1 / length(axis));
	return {
		bodyId: body.id,
		hull,
		offset,
		pos: add(body.pos, offset),
		vel: bodyVelocity(system, body.id, at),
		nose: rotateAbout(v3(0, 0, -1), unit, phase),
		up: rotateAbout(v3(0, 1, 0), unit, phase),
	};
}
/** Tethers stay in the body's translating frame; the hull alone tumbles. */
export const tetherPose = (
	wreck: ReturnType<typeof derelictPose>,
	index: number,
) => ({ pos: add(wreck.pos, tetherOffset(wreck.hull, index)), vel: wreck.vel });

export function scoopWreckContainer(
	row: DerelictRow,
	index: number,
	commander: CommanderState,
	entrustedT: number,
	container: { pos: Vec3; vel: Vec3 },
	ship: { pos: Vec3; vel: Vec3 },
	at: number,
) {
	const unchanged = (refusal: string | null = null) => ({
		row,
		commander,
		tonnes: 0,
		refusal,
	});
	const item = row.containers[index];
	if (row.salvaged || !item || item.left <= 0 || !scoops(container, ship))
		return unchanged();
	const hold = commanderHold(commander, entrustedT);
	const freeT = hold.capacityT - hold.usedT;
	const took = Math.max(0, Math.min(item.left, Math.floor(freeT)));
	if (took <= 0)
		return unchanged(
			"Hold full: " + freeT + " t free; " + item.id + " left in space.",
		);
	const next =
		item.kind === "good"
			? scoopCargo(commander, item.id, took, entrustedT).commander
			: {
					...commander,
					recoveredFittings: [
						...(commander.recoveredFittings ?? []),
						{ id: item.id, tonnes: took },
					],
				};
	const containers = row.containers.map((c, i) =>
		i === index ? { ...c, left: c.left - took } : { ...c },
	);
	return {
		row: {
			...row,
			containers,
			...(containers.every((c) => c.left === 0)
				? { salvaged: { at, cause: PLAYER_SALVAGE } }
				: {}),
		},
		commander: next,
		tonnes: took,
		refusal: null,
	};
}

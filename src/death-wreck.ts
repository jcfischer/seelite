import { carriedModule, stockModuleAt, type FittedModule } from "./loadout";
/** Node #705: one own-loss wreck, a share of the inventory aboard at death.
 * Contents are fixed once, before the commander is restored. Entrusted lots
 * live in Requests and are deliberately never read here. */
import { carrierKey } from "./carrier-key";
import { type DeathCause, leftByEject } from "./death-cost";
import { DOMAIN } from "./domains";
import { fnv1a, seededRand } from "./rng";
import { EQUIPMENT, ESCAPE_POD, commodity } from "./market";
import type { CommanderState } from "./station-commerce";
import type { CommanderRecord } from "./save-envelope";
import { systemAt } from "./galaxy";
import { makeSystem, stationApertureFrame } from "./sim";
import { proxyReachKm, stationProxyOf } from "./station-proxy";
import { corridorRadiusKm } from "./station-interior";
import { AVOID_CLEARANCE_KM } from "./combat-enemy";
import { wreckFramePose, tetherOffset } from "./derelict";
import { add, sub, scale, dot, length, v3, type Vec3 } from "./vec3";
import {
	DEATH_WRECK_ID,
	DEATH_WRECK_MAX_CONTAINERS,
	type WorldState,
	type DeathWreckRow,
	type DerelictContainer,
} from "./world-state";

export const DEATH_WRECK_SURVIVAL_SHARE = 0.5;
/** One scalar draw per item identity: adding a lot never consumes a sibling's draw. */
export function deathWreckContents(
	seed: number,
	at: number,
	dying: CommanderState,
	cause: DeathCause,
): DerelictContainer[] {
	// The wreck keeps what the pod does not (#977).
	const state = cause === "eject" ? leftByEject(dying) : dying;
	const survives = (id: string) =>
		seededRand(fnv1a(`${seed}:${DOMAIN.DEATH_WRECK}:${at}:${id}`))() <
		DEATH_WRECK_SURVIVAL_SHARE;
	const containers: DerelictContainer[] = [];
	const put = (
		kind: "good" | "fitting",
		id: string,
		tonnes: number,
		token: string,
		fitting?: FittedModule,
	) => {
		if (tonnes > 0 && survives(token))
			containers.push({
				kind,
				id,
				tonnes,
				left: tonnes,
				unit: kind === "good" ? commodity(id).unit : "t",
				...(fitting ? { fitting } : {}),
			});
	};
	for (const [id, amount] of Object.entries(state.cargo).sort(([a], [b]) =>
		a.localeCompare(b),
	))
		put("good", id, amount, `cargo:${id}`);
	if (cause === "destroyed") {
		for (const [slot, module] of Object.entries(state.loadout).sort(
			([a], [b]) => a.localeCompare(b),
		)) {
			if (
				module.module === "escape-pod" ||
				stockModuleAt(state.hull, slot, module)
			)
				continue;
			const item = carriedModule(module);
			put("fitting", item.id, 1, `fitted:${slot}:${module.module}`, module);
		}
	}
	// Unfitted salvage is cargo too: the pod is still excluded and an eject
	// keeps fitted modules only. A carried module does not get fitted in flight.
	const counts = new Map<string, number>();
	for (const item of [...(state.recoveredFittings ?? [])].sort(
		(a, b) => a.id.localeCompare(b.id) || a.tonnes - b.tonnes,
	)) {
		if (item.id === ESCAPE_POD) continue;
		const token = `${item.id}:${item.tonnes}`;
		const ordinal = counts.get(token) ?? 0;
		counts.set(token, ordinal + 1);
		put(
			"fitting",
			item.id,
			item.tonnes,
			`carried:${token}:${ordinal}`,
			item.module
				? {
						module: item.module,
						size: item.size!,
						grade: item.grade!,
						...(item.variant ? { variant: item.variant } : {}),
						...(item.ammo !== undefined ? { ammo: item.ammo } : {}),
						...(item.purchaseCostCr !== undefined
							? { purchaseCostCr: item.purchaseCostCr }
							: {}),
					}
				: undefined,
		);
	}
	if (containers.length > DEATH_WRECK_MAX_CONTAINERS)
		throw Error(
			`death wreck: ${containers.length} containers exceeds ${DEATH_WRECK_MAX_CONTAINERS}`,
		);
	return containers;
}

/** Nearest centre outside a keep-out sphere AND its axial corridor. */
export function clearStationWreck(
	pos: Vec3,
	keepOut: {
		centre: Vec3;
		axis: Vec3;
		reference: Vec3;
		radius: number;
		corridor: number;
	},
): Vec3 {
	const { centre, axis, reference, radius, corridor } = keepOut;
	const delta = sub(pos, centre);
	const z = dot(delta, axis);
	const radial = sub(delta, scale(axis, z));
	const r = length(radial);
	if (r >= corridor && length(delta) >= radius) return pos;
	const dir = r > 1e-12 ? scale(radial, 1 / r) : reference;
	const candidates: [number, number][] = [];
	const magnitude = Math.hypot(r, z);
	if (magnitude > 0) {
		const rs = (r * radius) / magnitude;
		if (rs >= corridor) candidates.push([rs, (z * radius) / magnitude]);
	}
	const edgeZ = Math.sqrt(Math.max(0, radius * radius - corridor * corridor));
	if (Math.abs(z) >= edgeZ) candidates.push([corridor, z]);
	else candidates.push([corridor, z < 0 ? -edgeZ : edgeZ]);
	const [rr, zz] = candidates.sort(
		(a, b) =>
			(a[0] - r) ** 2 + (a[1] - z) ** 2 - ((b[0] - r) ** 2 + (b[1] - z) ** 2),
	)[0];
	return add(centre, add(scale(dir, rr), scale(axis, zz)));
}

export function deathWreckRow(
	world: WorldState,
	dying: CommanderRecord,
	cause: DeathCause,
	frameId?: string,
): DeathWreckRow | undefined {
	const at = world.gameTime;
	const containers = deathWreckContents(world.seed, at, dying.state, cause);
	if (!containers.length) return undefined;
	const record = systemAt(world.seed, dying.galaxyIndex, dying.systemIndex);
	const system = makeSystem(record, at);
	let bodyId = frameId ?? system.contents.star.id;
	let pos = v3(...dying.flight.pos);
	// S12: a whole wreck and its tethers must leave the station's keep-out.
	const margin = length(tetherOffset(dying.state.hull, 0)) + AVOID_CLEARANCE_KM;
	for (const station of system.contents.stations) {
		const centre = system.byId.get(station.id)!.pos;
		const frame = stationApertureFrame(system, station.id, at);
		const radius = proxyReachKm(stationProxyOf(station)) + margin;
		if (length(sub(pos, centre)) > radius && bodyId !== station.id) continue;
		pos = clearStationWreck(pos, {
			centre,
			axis: frame.axis,
			reference: frame.reference,
			radius,
			corridor: corridorRadiusKm(frame.aperture) + margin,
		});
		bodyId = station.id;
		break;
	}
	const frame = wreckFramePose(system, bodyId, at);
	const key = carrierKey(dying.systemIndex, DEATH_WRECK_ID);
	const previous = world.galaxies.flatMap((g) =>
		g.deathWreck ? [g.deathWreck] : [],
	)[0];
	return {
		key,
		instanceOrdinal: (previous?.instanceOrdinal ?? -1) + 1,
		lostAt: at,
		containers,
		hull: dying.state.hull,
		bodyId,
		offset: sub(pos, frame.pos),
	};
}

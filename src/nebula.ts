/** Seeded galactic cloud volumes. Prototype #685; no renderer or saved state. */
import { DOMAIN } from "./domains";
import {
	GALAXY_RADIUS_LY,
	GALAXY_FLATTENING_Q,
	galaxyRoot,
	stream,
} from "./galaxy";
import { skyFrame, skyBearing } from "./galaxy-frame";
import { mix } from "./rng";
import type { Vec3 } from "./vec3";

export interface NebulaCloud {
	id: number;
	center: Vec3;
	radiusLy: number;
	seed: number;
	palette: number;
}

/** Coherent cloud identities; the second color lights filaments within one family. */
export const NEBULA_PALETTES = [
	{ name: "rose", gas: [1, 0.1, 0.19], filament: [1, 0.45, 0.48] },
	{ name: "blue", gas: [0.1, 0.32, 0.85], filament: [0.35, 0.66, 1] },
	{ name: "amber", gas: [0.78, 0.32, 0.08], filament: [1, 0.69, 0.34] },
	{ name: "violet", gas: [0.43, 0.16, 0.65], filament: [0.74, 0.43, 0.81] },
] as const;

/** Trial values, subject to the principal's flown visual ruling. */
export const NEBULA_COUNT = 4;
export function generateNebulae(
	worldSeed: number,
	galaxy: number,
): NebulaCloud[] {
	const root = mix(galaxyRoot(worldSeed), galaxy);
	return Array.from({ length: NEBULA_COUNT }, (_, id) => {
		const rand = stream(mix(root, id), DOMAIN.NEBULA);
		const r = GALAXY_RADIUS_LY * (0.18 + 0.57 * Math.cbrt(rand()));
		const y = 2 * rand() - 1,
			az = rand() * Math.PI * 2,
			ring = Math.sqrt(1 - y * y);
		return {
			id,
			center: {
				x: r * ring * Math.cos(az),
				y: r * y * GALAXY_FLATTENING_Q,
				z: r * ring * Math.sin(az),
			},
			radiusLy: 4 + rand() * 2,
			seed: Math.floor(rand() * 0x7fffffff),
			palette: (id + (root >>> 0)) % NEBULA_PALETTES.length,
		};
	});
}
export function nebulaView(
	cloud: NebulaCloud,
	observer: { seed: number; pos: Vec3 },
) {
	const d = Math.hypot(
		cloud.center.x - observer.pos.x,
		cloud.center.y - observer.pos.y,
		cloud.center.z - observer.pos.z,
	);
	return {
		bearing: skyBearing(skyFrame(observer.seed), observer.pos, cloud.center),
		distanceLy: d,
		inside: d < cloud.radiusLy,
		angularRadiusRad:
			d <= cloud.radiusLy ? Math.PI : Math.asin(cloud.radiusLy / d),
	};
}

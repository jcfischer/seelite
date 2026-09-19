/** Generated machinery and steady hull light for #130. */
import * as THREE from "three";
import { DOMAIN } from "./domains";
import { shared } from "./gpu-teardown";
import type { HullId, HullVariantId } from "./hull";
import { uvUnitsOf } from "./loft";
import { fnv1a, mix, seededRand } from "./rng";
import type { DetailLevel } from "./detail-level";
import { detailLevel } from "./detail-level";

export type ShipSurface = "dorsal" | "ventral" | "port" | "starboard";

/** One explicitly chosen patch of one variant's plated structure. */
export interface ShipDetailZone {
	readonly name: string;
	readonly part: string;
	readonly surface: ShipSurface;
	/** Longitudinal interval on the named part, from nose (0) to tail (1). */
	readonly from: number;
	readonly to: number;
	readonly count: number;
}

export interface ShipDetailPlan {
	readonly zones: readonly ShipDetailZone[];
}

export const HABITABLE_HULLS = [
	"freighter",
	"carrier",
	"dreadnought",
] as const satisfies readonly HullId[];

export const SHIP_QUALITY = {
	high: { greebles: true },
	low: { greebles: false },
} as const;
export type ShipQuality = keyof typeof SHIP_QUALITY;

const box = shared(new THREE.BoxGeometry(1, 1, 1));
const tank = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
tank.rotateX(Math.PI / 2);
const fin = new THREE.BoxGeometry(1, 0.16, 1);
const PRIMITIVES = [box, shared(tank), shared(fin)] as const;

const machinery = shared(
	new THREE.MeshStandardMaterial({
		color: 0x8296a3,
		roughness: 0.5,
		metalness: 0.46,
	}),
);
const stripMaterial = shared(
	new THREE.MeshStandardMaterial({
		color: 0x8fdbf5,
		emissive: 0x36bff8,
		emissiveIntensity: 0.72,
		roughness: 0.34,
		metalness: 0.12,
	}),
);
const windowMaterial = shared(
	new THREE.MeshStandardMaterial({
		color: 0xffd89a,
		emissive: 0xffb85c,
		emissiveIntensity: 0.55,
		roughness: 0.3,
		metalness: 0.05,
	}),
);

interface VisualState {
	detail: DetailLevel;
	quality: ShipQuality;
	greebles: THREE.InstancedMesh[];
}

const stateOf = (root: THREE.Object3D): VisualState => {
	const state = root.userData.shipVisual as VisualState | undefined;
	if (!state)
		throw new Error(`${root.name || "ship"} has no ship visual state`);
	return state;
};

const faceNormal = (surface: ShipSurface): THREE.Vector3 => {
	switch (surface) {
		case "dorsal":
			return new THREE.Vector3(0, 1, 0);
		case "ventral":
			return new THREE.Vector3(0, -1, 0);
		case "port":
			return new THREE.Vector3(-1, 0, 0);
		case "starboard":
			return new THREE.Vector3(1, 0, 0);
	}
};

/** Cast a generated point back onto the exact named plated part. */
function mounter(target: THREE.Mesh, zone: ShipDetailZone, reachKm: number) {
	target.updateWorldMatrix(true, false);
	const bounds = new THREE.Box3().setFromObject(target);
	const normal = faceNormal(zone.surface);
	const ray = new THREE.Raycaster();
	const origin = new THREE.Vector3();
	const inward = normal.clone().negate();
	const span = bounds.max.z - bounds.min.z;
	return (along: number, across: number) => {
		// A loft can neck inward or carry an opening at the exact requested point.
		// Search a small deterministic stencil inside the authored patch rather
		// than keeping a floating piece or silently dropping it.
		for (const alongOffset of [0, 0.08, -0.08, 0.16, -0.16]) {
			for (const acrossOffset of [0, 0.12, -0.12, 0.24, -0.24]) {
				const a = THREE.MathUtils.clamp(along + alongOffset, 0.02, 0.98);
				const c = THREE.MathUtils.clamp(across + acrossOffset, 0.08, 0.92);
				origin.z =
					bounds.min.z + span * (zone.from + (zone.to - zone.from) * a);
				if (zone.surface === "dorsal" || zone.surface === "ventral") {
					origin.x = THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, c);
					origin.y =
						zone.surface === "dorsal"
							? bounds.max.y + reachKm * 0.08
							: bounds.min.y - reachKm * 0.08;
				} else {
					origin.x =
						zone.surface === "starboard"
							? bounds.max.x + reachKm * 0.08
							: bounds.min.x - reachKm * 0.08;
					origin.y = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, c);
				}
				ray.set(origin, inward);
				ray.far = reachKm * 0.5;
				const hit = ray.intersectObject(target, false)[0];
				if (hit) return { point: hit.point.clone(), normal: normal.clone() };
			}
		}
		throw new Error(
			`ship detail zone ${zone.name} missed plated part ${zone.part}`,
		);
	};
}

function basis(normal: THREE.Vector3): THREE.Quaternion {
	const along = new THREE.Vector3(0, 0, 1)
		.addScaledVector(normal, -normal.z)
		.normalize();
	const forward = along.lengthSq() > 0 ? along : new THREE.Vector3(0, 1, 0);
	const across = new THREE.Vector3().crossVectors(forward, normal).normalize();
	return new THREE.Quaternion().setFromRotationMatrix(
		new THREE.Matrix4().makeBasis(across, forward, normal),
	);
}

function addEmissives(
	root: THREE.Group,
	id: HullId,
	zone: ShipDetailZone,
	mount: ReturnType<typeof mounter>,
	reachKm: number,
) {
	// A paired rail reads at the canonical chase range where one sub-pixel strip
	// disappeared into the plate. It is repeated on every hull and therefore
	// remains illumination, never a semantic status code.
	for (const across of [0.36, 0.64]) {
		const centre = mount(0.5, across);
		const strip = new THREE.Mesh(box, stripMaterial);
		strip.name = "ship-strip";
		strip.position
			.copy(centre.point)
			.addScaledVector(centre.normal, reachKm * 0.003);
		strip.quaternion.copy(basis(centre.normal));
		strip.scale.set(
			reachKm * 0.014,
			reachKm * Math.max(0.12, (zone.to - zone.from) * 0.45),
			reachKm * 0.004,
		);
		root.add(strip);
	}

	if (!(HABITABLE_HULLS as readonly HullId[]).includes(id)) return;
	const count = reachKm > 0.1 ? 24 : 8;
	const windows = new THREE.InstancedMesh(box, windowMaterial, count);
	windows.name = "ship-windows";
	const matrix = new THREE.Matrix4();
	const scale = new THREE.Vector3(
		reachKm * 0.007,
		reachKm * 0.016,
		reachKm * 0.002,
	);
	for (let i = 0; i < count; i++) {
		const at = mount((i + 0.5) / count, i % 2 === 0 ? 0.38 : 0.62);
		windows.setMatrixAt(
			i,
			matrix.compose(
				at.point.addScaledVector(at.normal, reachKm * 0.001),
				basis(at.normal),
				scale,
			),
		);
	}
	windows.instanceMatrix.needsUpdate = true;
	root.add(windows);
}

/** Fill the authored zones and add the steady emissive inventory. */
export function buildShipDetails(
	root: THREE.Group,
	id: HullId,
	variant: HullVariantId,
	plan: ShipDetailPlan,
	reachKm: number,
): void {
	const matrices: THREE.Matrix4[][] = PRIMITIVES.map(() => []);
	for (const zone of plan.zones) {
		const target = root.getObjectByName(zone.part) as THREE.Mesh | undefined;
		if (!target?.geometry || uvUnitsOf(target.geometry) !== "plate")
			throw new Error(
				`ship detail zone ${id}/${variant}:${zone.name} needs plated part ${zone.part}`,
			);
		const random = seededRand(
			mix(DOMAIN.SHIP_GREEBLES, fnv1a(`${id}/${variant}/${zone.name}`)),
		);
		const mount = mounter(target, zone, reachKm);
		for (let i = 0; i < zone.count; i++) {
			const at = mount(
				(i + 0.25 + random() * 0.5) / zone.count,
				0.25 + random() * 0.5,
			);
			const kind = Math.min(
				PRIMITIVES.length - 1,
				Math.floor(random() * PRIMITIVES.length),
			);
			const height = reachKm * (0.01 + random() * 0.01);
			const scale = new THREE.Vector3(
				reachKm * (0.016 + random() * 0.024),
				reachKm * (0.018 + random() * 0.032),
				height,
			);
			const rotation = basis(at.normal).multiply(
				new THREE.Quaternion().setFromAxisAngle(
					new THREE.Vector3(0, 0, 1),
					(Math.floor(random() * 8) / 8) * Math.PI * 2,
				),
			);
			matrices[kind].push(
				new THREE.Matrix4().compose(
					at.point.addScaledVector(at.normal, height * 0.12),
					rotation,
					scale,
				),
			);
		}
		addEmissives(root, id, zone, mount, reachKm);
	}

	const greebles = PRIMITIVES.map((geometry, kind) => {
		const mesh = new THREE.InstancedMesh(
			geometry,
			machinery,
			matrices[kind].length,
		);
		mesh.name = `ship-greebles-${kind}`;
		matrices[kind].forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
		mesh.instanceMatrix.needsUpdate = true;
		root.add(mesh);
		return mesh;
	});
	root.userData.shipVisual = {
		detail: "full",
		quality: "high",
		greebles,
	} satisfies VisualState;
	root.userData.shipSilhouetteKm = reachKm;
}

function applyVisibility(state: VisualState) {
	const draw = state.detail === "full" && SHIP_QUALITY[state.quality].greebles;
	for (const mesh of state.greebles) mesh.visible = draw;
}

export function setShipDetail(root: THREE.Object3D, level: DetailLevel): void {
	const state = stateOf(root);
	state.detail = level;
	applyVisibility(state);
}

/** Update detail and the quality gate; emissives intentionally stay untouched. */
export function updateShipVisuals(
	root: THREE.Object3D,
	distanceKm: number,
	quality: ShipQuality,
): void {
	const state = stateOf(root);
	const reachKm = root.userData.shipSilhouetteKm as number;
	state.detail = detailLevel(state.detail, distanceKm / reachKm);
	state.quality = quality;
	applyVisibility(state);
}

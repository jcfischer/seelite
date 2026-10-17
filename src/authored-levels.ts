/**
 * The detail band's levels for an authored hull (node #812's courier, node
 * #815's miner): reduced copies of the approved model, made once at install
 * by meshoptimizer's simplifier and drawn past the band's edges in the
 * model's place (`ShipLevels`, `ship-detail.ts`).
 *
 * Moved here from `courier-hull.ts` by node #815, so both authored hulls make
 * their levels one way: each to a **target** error of half a device pixel at
 * the level's band edge, in `LEVEL_FRAME`, scaled by the hull's own reach. A
 * target and not a bound: the error is the simplifier's own metric, and how
 * the switch looks is judged by eye. A reduced level is drawn and never
 * measured: its meshes take no ray (`AuthoredLevelMesh`) and carry
 * `LEVEL_STAND_IN`, so the nav lights, the muzzles, the vent throats and the
 * vent placement are all measured on the approved metal.
 */
import * as THREE from "three";
import {
	mergeVertices,
	toCreasedNormals,
} from "three/addons/utils/BufferGeometryUtils.js";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { DETAIL_RADII } from "./detail-level";
import { shared } from "./gpu-teardown";
import { LEVEL_STAND_IN } from "./ship-detail";

/**
 * The frame a reduced level's target error is set in: the near camera's 60°
 * field of view (`main.ts`) on the player's retina panel, 900 CSS pixels tall
 * at device scale 2 — the frame the cost instruments here measure on. A
 * taller frame would see a reduced level's error at more than half a pixel.
 */
export const LEVEL_FRAME = { fovDeg: 60, heightPx: 1800 } as const;

/** The crease a reduced level's normals are split at: their faces are new,
 *  so their normals are computed, smooth across anything flatter than this. */
const LEVEL_CREASE_RAD = Math.PI / 6;

/**
 * The target error a reduced level is made to, kilometres: half a device
 * pixel in `LEVEL_FRAME` at the level's band edge — `DETAIL_RADII.full`
 * silhouette radii for `reduced` and `DETAIL_RADII.reduced` for `outline`,
 * a radius being the hull's `reachKm`. It is what the simplifier is asked
 * for, against its own error metric, and not a measured bound on how far the
 * level lies from the model. `detailLevel`'s hysteresis also draws a level
 * somewhat nearer than its edge on the way back in, and a frame taller than
 * `LEVEL_FRAME` sees the same error at more than half a pixel.
 */
export function levelErrorKm(
	level: "reduced" | "outline",
	reachKm: number,
): number {
	return halfPixelKm(
		level === "reduced" ? DETAIL_RADII.full : DETAIL_RADII.reduced,
		reachKm,
	);
}

/** Half a device pixel in `LEVEL_FRAME`, kilometres, at `radii` of a hull
 *  whose silhouette radius is `reachKm`: `levelErrorKm` at a band edge,
 *  and the target of a level made for a nearer distance than its edge
 *  (node #815's medium miner). */
export function halfPixelKm(radii: number, reachKm: number): number {
	const halfAngle = (LEVEL_FRAME.fovDeg * Math.PI) / 360;
	const pixelKm =
		(2 * radii * reachKm * Math.tan(halfAngle)) / LEVEL_FRAME.heightPx;
	return pixelKm / 2;
}

/** A reduced level's mesh: drawn, never measured. Every ray this repo casts
 *  at a hull asks where its metal is, and the approved model is the answer. */
export class AuthoredLevelMesh extends THREE.Mesh {
	override raycast(): void {}
}

/**
 * One mesh's geometry with edges collapsed while the error stays under
 * `errorM` (model metres). Welded on position first: an export's faces do
 * not share vertices across a hard edge, and an unwelded mesh has nothing
 * to collapse. A collapse moves a corner onto an existing vertex, so every
 * vertex of the reduced mesh is one of the approved one's and its box lies
 * inside the model's. That is all it shows: a triangle between existing
 * vertices can bridge a concavity, so the reduced surface may stand outside
 * the approved one inside that box. The welded corners keep
 * one of their texture coordinates, which a few pixels of hull cannot show.
 * `geometry` is `null` when nothing of the mesh survives the error;
 * `errorM` is the error the simplifier reports it reached, in the same
 * units, which is what the level's own record is built from.
 */
function reducedGeometry(
	source: THREE.BufferGeometry,
	errorM: number,
	permissive: boolean,
): { geometry: THREE.BufferGeometry | null; errorM: number } {
	const position = source.getAttribute("position");
	const positions = new Float32Array(position.count * 3);
	for (let i = 0; i < position.count; i++) {
		positions[3 * i] = position.getX(i);
		positions[3 * i + 1] = position.getY(i);
		positions[3 * i + 2] = position.getZ(i);
	}
	const index = source.getIndex();
	const remap = MeshoptSimplifier.generatePositionRemap(positions, 3);
	const count = index ? index.count : position.count;
	const welded = new Uint32Array(count);
	for (let i = 0; i < count; i++) welded[i] = remap[index ? index.getX(i) : i];
	const [kept, reached] = MeshoptSimplifier.simplify(
		welded,
		positions,
		3,
		0,
		errorM,
		permissive
			? ["ErrorAbsolute", "Prune", "Permissive"]
			: ["ErrorAbsolute", "Prune"],
	);
	if (kept.length === 0) return { geometry: null, errorM: reached };
	const reduced = new THREE.BufferGeometry();
	reduced.setAttribute("position", position);
	const uv = source.getAttribute("uv");
	if (uv) reduced.setAttribute("uv", uv);
	reduced.setIndex(new THREE.BufferAttribute(kept, 1));
	return {
		// Creasing splits every corner; welding again restores the index, so
		// a far hull shares a corner across the faces that agree on it.
		geometry: mergeVertices(toCreasedNormals(reduced, LEVEL_CREASE_RAD)),
		errorM: reached,
	};
}

/** Where a reduced level records the largest error its meshes reached, in
 *  kilometres of hull: what the simplifier reported, carried through each
 *  mesh's scale. The simplifier's own metric, so a record of what the level
 *  was made to against `levelErrorKm`, not a measurement of how far it lies
 *  from the model. */
export const LEVEL_REACHED_ERROR_KM = "levelReachedErrorKm";

/** What a hull's level leaves out of the simplifier: `skip` meshes are not
 *  drawn at the level at all, and `keep` meshes are drawn as the model draws
 *  them, geometry and all. Neither is the default. `permissive` lets an
 *  edge collapse across a seam the welded mesh still carries: Longwall B's
 *  painted hull meshes barely reduce without it (node #815: `pale-steel-0`
 *  keeps all 32,860 triangles at half a pixel at 40 radii, and 1,170 with it).
 *  The normals are recomputed either way. */
export interface LevelRules {
	readonly skip?: (mesh: THREE.Mesh) => boolean;
	readonly keep?: (mesh: THREE.Mesh) => boolean;
	readonly permissive?: boolean;
}

/** The model reduced to `errorM` (model metres), as a template like the
 *  model's own. `kmPerM` carries the reached error into kilometres. */
export function reducedLevel(
	template: THREE.Object3D,
	errorM: number,
	kmPerM: number,
	name: string,
	rules: LevelRules = {},
): THREE.Object3D {
	const level = template.clone(true);
	level.name = name;
	level.updateMatrixWorld(true);
	const toLevel = level.matrixWorld.clone().invert();
	const meshes: THREE.Mesh[] = [];
	level.traverse((o) => {
		if (o instanceof THREE.Mesh) meshes.push(o);
	});
	let reachedKm = 0;
	const scale = new THREE.Vector3();
	for (const mesh of meshes) {
		let geometry: THREE.BufferGeometry | null = null;
		if (rules.keep?.(mesh)) geometry = mesh.geometry;
		else if (!rules.skip?.(mesh)) {
			// The simplifier works in the mesh's own units; its error is a
			// distance there, and the largest axis scale is the most it can
			// stretch to in the model's metres.
			new THREE.Matrix4()
				.multiplyMatrices(toLevel, mesh.matrixWorld)
				.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
			const stretch = Math.max(
				Math.abs(scale.x),
				Math.abs(scale.y),
				Math.abs(scale.z),
			);
			const reduced = reducedGeometry(
				mesh.geometry,
				errorM / stretch,
				rules.permissive === true,
			);
			geometry = reduced.geometry;
			reachedKm = Math.max(reachedKm, reduced.errorM * stretch * kmPerM);
		}
		// A mesh with no reduced geometry still carries its children: they
		// move to a bare node in its place, or they would leave with it.
		let stand: THREE.Object3D | null = null;
		if (geometry) {
			const drawn = new AuthoredLevelMesh(shared(geometry), mesh.material);
			drawn.castShadow = mesh.castShadow;
			drawn.receiveShadow = mesh.receiveShadow;
			drawn.userData[LEVEL_STAND_IN] = true;
			stand = drawn;
		} else if (mesh.children.length > 0) stand = new THREE.Object3D();
		if (stand) {
			stand.name = mesh.name;
			stand.position.copy(mesh.position);
			stand.quaternion.copy(mesh.quaternion);
			stand.scale.copy(mesh.scale);
			for (const child of [...mesh.children]) stand.add(child);
			mesh.parent?.add(stand);
		}
		mesh.removeFromParent();
	}
	level.userData[LEVEL_REACHED_ERROR_KM] = reachedKm;
	return level;
}

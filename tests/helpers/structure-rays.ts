/**
 * Whether a station's structure is where a light says it is mounted (#300).
 *
 * The islands check in `station-mesh.test.ts` cannot hold a real-size lamp: its
 * shrink is larger than the fitting. So a lamp, and the pool of light it lays,
 * are checked against the surfaces themselves, by ray. A hull mesh is
 * `FrontSide`, so a ray only reports a surface it meets from outside — which is
 * the right answer here: a lamp buried inside a tube is not mounted on it.
 */
import * as THREE from "three";

/** The names of a station's lamp fittings: each is a light, not structure. */
export const LAMP_NAMES: ReadonlySet<string> = new Set([
	"strobe-a",
	"strobe-b",
	"mouth-strobe",
	"obstruction-beacon",
	"bay-flood",
	"weld-arc",
]);

/** Structure a light can be mounted on: a mesh that is not itself a light, a
 *  glow, a pool, or a window pane (a decal on a face, not a face). */
export const isStructure = (object: THREE.Object3D) =>
	Boolean((object as THREE.Mesh).isMesh) &&
	!object.userData.glow &&
	!LAMP_NAMES.has(object.name) &&
	!object.name.startsWith("beacon-") &&
	object.name !== "windows";

const raycaster = new THREE.Raycaster();

/** The nearest structure hit along a ray, in world units, or `null`. */
export function structureHit(
	root: THREE.Object3D,
	origin: THREE.Vector3,
	direction: THREE.Vector3,
	far: number,
): number | null {
	raycaster.set(origin, direction.clone().normalize());
	raycaster.near = 0;
	raycaster.far = far;
	const hit = raycaster
		.intersectObject(root, true)
		.find((h) => isStructure(h.object));
	return hit ? hit.distance : null;
}

/** An object's largest dimension, in its parent's units (kilometres on a
 *  station), from its own geometry. */
export function fittingSize(object: THREE.Object3D): number {
	const geometry = (object as THREE.Mesh).geometry;
	geometry.computeBoundingBox();
	const size = (geometry.boundingBox as THREE.Box3).getSize(
		new THREE.Vector3(),
	);
	return Math.max(size.x, size.y, size.z);
}

const AXES = [
	new THREE.Vector3(1, 0, 0),
	new THREE.Vector3(-1, 0, 0),
	new THREE.Vector3(0, 1, 0),
	new THREE.Vector3(0, -1, 0),
	new THREE.Vector3(0, 0, 1),
	new THREE.Vector3(0, 0, -1),
];

/**
 * Whether a lamp touches structure: a surface within its own size of its
 * centre, found from outside along any of the six axes.
 *
 * A lamp seated in a face passes along the face's normal — the ray passes the
 * lamp, which is not structure, and meets the face at the lamp's centre. A lamp
 * floating a few metres off, or buried inside a member, meets nothing that close.
 */
export function seatedOnStructure(
	root: THREE.Object3D,
	lamp: THREE.Object3D,
): boolean {
	lamp.updateWorldMatrix(true, false);
	const scale = lamp.matrixWorld.getMaxScaleOnAxis();
	const size = fittingSize(lamp);
	const centre = new THREE.Vector3().setFromMatrixPosition(lamp.matrixWorld);
	const standoff = size * 3 * scale;
	return AXES.some((axis) => {
		const origin = centre.clone().addScaledVector(axis, standoff);
		return (
			structureHit(
				root,
				origin,
				axis.clone().negate(),
				standoff + size * scale,
			) !== null
		);
	});
}

/**
 * Where a pool of light has no surface under it: points of its disc, at half
 * its radius, with no structure within `toleranceKm` behind the disc.
 *
 * Half the radius because that is where its falloff has dropped to a quarter;
 * the rim is faint enough to curve away from a curved hull without reading as
 * a sheet in space.
 */
export function poolOverhang(
	root: THREE.Object3D,
	pool: THREE.Mesh,
	toleranceKm: number,
): string[] {
	pool.updateWorldMatrix(true, false);
	const scale = pool.matrixWorld.getMaxScaleOnAxis();
	const geometry = pool.geometry as THREE.PlaneGeometry;
	const radius = geometry.parameters.width / 2;
	const normal = new THREE.Vector3(0, 0, 1)
		.transformDirection(pool.matrixWorld)
		.normalize();
	const lift = 0.002 * scale;
	const out: string[] = [];
	for (const [x, y] of [
		[0, 0],
		[0.5, 0],
		[-0.5, 0],
		[0, 0.5],
		[0, -0.5],
	]) {
		const at = new THREE.Vector3(x * radius, y * radius, 0).applyMatrix4(
			pool.matrixWorld,
		);
		const origin = at.clone().addScaledVector(normal, lift);
		if (
			structureHit(
				root,
				origin,
				normal.clone().negate(),
				lift + toleranceKm * scale,
			) === null
		)
			out.push(`(${x}, ${y})`);
	}
	return out;
}

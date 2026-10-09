import * as THREE from "three";
import { groupCopiesByPosition } from "../../src/cockpit-model";

/**
 * Degrees between two normals (node #839). `atan2` and not `acos`: at a dot
 * product within float32 rounding of 1, `acos` reads an identical pair 0.02°
 * apart. In `scripts/lib` because `tests/cockpit-model.test.ts` and
 * `scripts/measure-cockpit-normals.ts` both read angles with it.
 */
export const degBetween = (a: THREE.Vector3, b: THREE.Vector3) =>
	(Math.atan2(a.clone().cross(b).length(), a.dot(b)) * 180) / Math.PI;

/** One point in space of one mesh: each copy's normal as exported and as adopted. */
export type PositionCopies = {
	mesh: string;
	before: THREE.Vector3[];
	after: THREE.Vector3[];
};

/**
 * Every mesh's vertices grouped by exact position, pairing the normal each
 * copy was exported with (`exported`, never adopted) and the one it carries
 * in `adopted`. Blender's `poly()` writes fresh vertices for every face, so a
 * position shared by several faces holds one copy per face.
 */
export function pairCopies(
	exported: THREE.Object3D,
	adopted: THREE.Object3D,
): PositionCopies[] {
	const exportedByName = new Map<string, THREE.Mesh>();
	exported.traverse((o) => {
		if (o instanceof THREE.Mesh) exportedByName.set(o.name, o);
	});
	const out: PositionCopies[] = [];
	adopted.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const raw = exportedByName.get(o.name);
		if (!raw) throw new Error(`no exported mesh ${o.name}`);
		const was = raw.geometry.getAttribute("normal");
		const now = o.geometry.getAttribute("normal");
		const groups = groupCopiesByPosition(o.geometry.getAttribute("position"));
		for (const ids of groups.values())
			out.push({
				mesh: o.name,
				before: ids.map((i) => new THREE.Vector3().fromBufferAttribute(was, i)),
				after: ids.map((i) => new THREE.Vector3().fromBufferAttribute(now, i)),
			});
	});
	return out;
}

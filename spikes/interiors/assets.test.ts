import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MODULE_SIZE } from "./layout";
import { Box3, Matrix4, Vector3, Quaternion } from "three";
function boundsOf(name: string) {
	const bytes = readFileSync(new URL(`./modules/${name}.glb`, import.meta.url));
	const doc = JSON.parse(
		bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
	);
	const bounds = new Box3();
	function walk(index: number, parent: Matrix4) {
		const n = doc.nodes[index],
			m = n.matrix
				? new Matrix4().fromArray(n.matrix)
				: new Matrix4().compose(
						new Vector3(...(n.translation ?? [0, 0, 0])),
						new Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
						new Vector3(...(n.scale ?? [1, 1, 1])),
					);
		m.premultiply(parent);
		if (n.mesh !== undefined)
			for (const p of doc.meshes[n.mesh].primitives) {
				const a = doc.accessors[p.attributes.POSITION];
				bounds.union(
					new Box3(new Vector3(...a.min), new Vector3(...a.max)).applyMatrix4(
						m,
					),
				);
			}
		for (const c of n.children ?? []) walk(c, m);
	}
	for (const n of doc.scenes[doc.scene ?? 0].nodes) walk(n, new Matrix4());
	return { bounds, doc };
}
test("exported fitting geometry stays inside planner envelopes", () => {
	for (const [name, size] of Object.entries(MODULE_SIZE)) {
		const { bounds, doc } = boundsOf(name);
		console.log(name, bounds.min.toArray(), bounds.max.toArray());
		expect(bounds.min.x).toBeGreaterThanOrEqual(-size[0] / 2 - 0.3);
		expect(bounds.max.x).toBeLessThanOrEqual(size[0] / 2 + 0.3);
		expect(bounds.min.y).toBeGreaterThanOrEqual(-0.3);
		expect(bounds.max.y).toBeLessThanOrEqual(size[1] + 0.3);
		expect(bounds.min.z).toBeGreaterThanOrEqual(-size[2] / 2 - 0.3);
		expect(bounds.max.z).toBeLessThanOrEqual(size[2] / 2 + 0.3);
		expect(doc.images.every((i: any) => i.uri === "shared-paint.png")).toBe(
			true,
		);
		expect(
			readFileSync(new URL("./modules/shared-paint.png", import.meta.url))
				.length,
		).toBeGreaterThan(1000);
	}
});

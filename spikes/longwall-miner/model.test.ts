import { readFileSync } from "node:fs";
import { test, expect } from "bun:test";
const bytes = readFileSync(new URL("./longwall-miner.glb", import.meta.url));
const doc = JSON.parse(
	bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
);
const named = (name: string) => {
	const index = doc.nodes.findIndex((n: any) => n.name === name);
	expect(index).toBeGreaterThanOrEqual(0);
	return { index, node: doc.nodes[index] };
};
test("export preserves independent mechanisms and rotor parentage", () => {
	const feed = named("feed"),
		rotor = named("rotor"),
		hull = named("hull");
	expect(feed.node.children).toContain(rotor.index);
	expect(hull.node.children).not.toContain(feed.index);
	for (let i = 0; i < 4; i++)
		for (const suffix of [
			"body",
			"sleeve",
			"elbow",
			"lower",
			"lower-rod",
			"foot",
		])
			expect(
				named(`anchor-${i}-${suffix}`).node.children.length,
			).toBeGreaterThan(0);
});
test("three skip shells retain full-volume geometry", () => {
	for (let i = 0; i < 3; i++) {
		const node = named(`hull::sealed-skip-${i}`).node;
		const prim = doc.meshes[node.mesh].primitives[0];
		const accessor = doc.accessors[prim.attributes.POSITION];
		for (let axis = 0; axis < 3; axis++)
			expect(accessor.max[axis] - accessor.min[axis]).toBeGreaterThan(6);
		expect(doc.accessors[prim.indices].count).toBeGreaterThan(100);
	}
});
test("model embeds generated material and finite bounded geometry", () => {
	expect(doc.images.some((i: any) => i.bufferView !== undefined)).toBe(true);
	expect(
		doc.materials.some((m: any) => m.pbrMetallicRoughness?.baseColorTexture),
	).toBe(true);
	for (const m of doc.meshes)
		for (const p of m.primitives) {
			const a = doc.accessors[p.attributes.POSITION];
			expect([...a.min, ...a.max].every(Number.isFinite)).toBe(true);
			expect(
				Math.max(...a.max.map(Math.abs), ...a.min.map(Math.abs)),
			).toBeLessThan(100);
		}
});

test("bridge shell and glazing together form a closed pressure boundary", () => {
	const jsonLength = bytes.readUInt32LE(12),
		binaryStart = 28 + jsonLength;
	function accessor(index: number) {
		const a = doc.accessors[index],
			v = doc.bufferViews[a.bufferView];
		const n = a.type === "VEC3" ? 3 : 1,
			size = a.componentType === 5126 || a.componentType === 5125 ? 4 : 2;
		const result: number[][] = [];
		for (let i = 0; i < a.count; i++) {
			const offset =
				binaryStart +
				(v.byteOffset ?? 0) +
				(a.byteOffset ?? 0) +
				i * (v.byteStride ?? n * size);
			result.push(
				Array.from({ length: n }, (_, j) =>
					a.componentType === 5126
						? bytes.readFloatLE(offset + j * size)
						: size === 4
							? bytes.readUInt32LE(offset + j * size)
							: bytes.readUInt16LE(offset + j * size),
				),
			);
		}
		return result;
	}
	const edges = new Map<string, number>();
	for (const name of ["hull::bridge-shell", "hull::bridge-glazing"]) {
		const n = named(name).node;
		for (const p of doc.meshes[n.mesh].primitives) {
			const points = accessor(p.attributes.POSITION).map((v) =>
					v.map((x) => Math.round(x * 10000)).join(","),
				),
				indices = accessor(p.indices).flat();
			for (let i = 0; i < indices.length; i += 3)
				for (let j = 0; j < 3; j++) {
					const pair = [
						points[indices[i + j]],
						points[indices[i + ((j + 1) % 3)]],
					]
						.sort()
						.join("|");
					edges.set(pair, (edges.get(pair) ?? 0) + 1);
				}
		}
	}
	expect([...edges.values()].filter((v) => v !== 2)).toEqual([]);
});

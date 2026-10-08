import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("pressure body and both nacelles are closed, outward-wound shells", () => {
	const bytes = readFileSync(new URL("./courier-hull.glb", import.meta.url));
	const length = bytes.readUInt32LE(12);
	const doc = JSON.parse(bytes.toString("utf8", 20, 20 + length));
	const binary = 28 + length;
	function accessor(id: number, width: number) {
		const a = doc.accessors[id],
			v = doc.bufferViews[a.bufferView];
		const componentBytes = a.componentType === 5123 ? 2 : 4;
		return Array.from({ length: a.count }, (_, i) =>
			Array.from({ length: width }, (_, j) => {
				const offset =
					binary +
					(v.byteOffset ?? 0) +
					(a.byteOffset ?? 0) +
					i * (v.byteStride ?? width * componentBytes) +
					j * componentBytes;
				return a.componentType === 5126
					? bytes.readFloatLE(offset)
					: componentBytes === 2
						? bytes.readUInt16LE(offset)
						: bytes.readUInt32LE(offset);
			}),
		);
	}
	for (const name of ["pressure-hull", "engine-port", "engine-starboard"]) {
		const mesh = doc.meshes.find((m: { name: string }) => m.name === name);
		expect(mesh, name).toBeDefined();
		const edges = new Map<string, { count: number; balance: number }>();
		let volume6 = 0;
		for (const p of mesh.primitives) {
			const positions = accessor(p.attributes.POSITION, 3);
			const indices = accessor(p.indices, 1).flat();
			const keys = positions.map((v) =>
				v.map((c) => Math.round(c * 1e5)).join(","),
			);
			for (let i = 0; i < indices.length; i += 3) {
				const ids = indices.slice(i, i + 3);
				const [a, b, c] = ids.map((id) => positions[id]);
				volume6 +=
					a[0] * (b[1] * c[2] - b[2] * c[1]) +
					a[1] * (b[2] * c[0] - b[0] * c[2]) +
					a[2] * (b[0] * c[1] - b[1] * c[0]);
				for (let j = 0; j < 3; j++) {
					const from = keys[ids[j]],
						to = keys[ids[(j + 1) % 3]];
					const key = from < to ? `${from}|${to}` : `${to}|${from}`;
					const edge = edges.get(key) ?? { count: 0, balance: 0 };
					edge.count++;
					edge.balance += from < to ? 1 : -1;
					edges.set(key, edge);
				}
			}
		}
		expect(
			[...edges.values()].filter((e) => e.count !== 2 || e.balance !== 0),
			`${name} has open or inconsistent edges`,
		).toEqual([]);
		expect(volume6, `${name} faces outward`).toBeGreaterThan(0);
	}
});

test("export is a textured, bounded 3D courier with real depth and two engine bays", () => {
	const bytes = readFileSync(new URL("./courier-hull.glb", import.meta.url));
	expect(bytes.toString("ascii", 0, 4)).toBe("glTF");
	const json = JSON.parse(
		bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
	);
	const names = json.meshes.map((m: { name: string }) => m.name);
	expect(names).toContain("canopy-glass");
	expect(names).toContain("engine-port");
	expect(names).toContain("engine-starboard");
	expect(json.images.length).toBeGreaterThan(0);
	expect(
		json.materials.some(
			(m: { pbrMetallicRoughness?: { baseColorTexture?: unknown } }) =>
				m.pbrMetallicRoughness?.baseColorTexture,
		),
	).toBe(true);
	const min = [Infinity, Infinity, Infinity],
		max = [-Infinity, -Infinity, -Infinity];
	let triangles = 0;
	for (const mesh of json.meshes)
		for (const p of mesh.primitives) {
			const a = json.accessors[p.attributes.POSITION];
			for (let i = 0; i < 3; i++) {
				min[i] = Math.min(min[i], a.min[i]);
				max[i] = Math.max(max[i], a.max[i]);
			}
			triangles += json.accessors[p.indices].count / 3;
		}
	const size = max.map((v, i) => v - min[i]);
	expect(size[0]).toBeGreaterThan(45);
	expect(size[0]).toBeLessThan(62);
	expect(size[1]).toBeGreaterThan(6);
	expect(size[1]).toBeLessThan(15);
	expect(size[2]).toBeGreaterThan(50);
	expect(size[2]).toBeLessThan(68);
	expect(triangles).toBeGreaterThan(20000);
	expect(triangles).toBeLessThan(500000);
});

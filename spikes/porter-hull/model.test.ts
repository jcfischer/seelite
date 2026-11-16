import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("command hull and three cargo cassettes are closed, outward-wound shells", () => {
	const bytes = readFileSync(new URL("./porter-hull.glb", import.meta.url));
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
	for (const name of ["command-shell", "cargo-1", "cargo-2", "cargo-3"]) {
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
	const limits = (name: string) => {
		const mesh = doc.meshes.find((m: { name: string }) => m.name === name);
		const points: number[][] = mesh.primitives.flatMap(
			(p: { attributes: { POSITION: number } }) =>
				accessor(p.attributes.POSITION, 3),
		);
		return {
			min: [0, 1, 2].map((i) => Math.min(...points.map((v) => v[i]))),
			max: [0, 1, 2].map((i) => Math.max(...points.map((v) => v[i]))),
		};
	};
	const command = limits("command-shell");
	const pods = [1, 2, 3].map((i) => limits(`cargo-${i}`));
	for (const pod of pods) {
		expect(pod.min[0], "cargo remains beside the command keel").toBeGreaterThan(
			command.max[0],
		);
		expect(
			pod.max[1] - pod.min[1],
			"cargo has physical height",
		).toBeGreaterThan(10);
	}
	expect(
		pods[1].min[2],
		"aft cassette has a visible separation",
	).toBeGreaterThan(pods[0].max[2] + 2);
	expect(
		pods[2].min[2],
		"forward cassette has a visible separation",
	).toBeGreaterThan(pods[1].max[2] + 2);
});

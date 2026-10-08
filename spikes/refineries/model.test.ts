import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";

for (const id of ["o1", "o2", "o3", "o4"]) {
	test(id + ": textured rock and a genuinely open docking approach", () => {
		const bytes = readFileSync(new URL("./" + id + ".glb", import.meta.url));
		const len = bytes.readUInt32LE(12);
		const doc = JSON.parse(bytes.toString("utf8", 20, 20 + len));
		const binary = 28 + len;
		const rock = doc.nodes.find((n: any) => n.name === "quarried-asteroid");
		expect(rock).toBeDefined();
		expect(doc.images.length).toBeGreaterThanOrEqual(2);
		const dock = doc.nodes.find((n: any) => n.name === "docking-centre");
		expect(dock).toBeDefined();
		const [cx, cy, cz] = dock.translation;
		const read = (id: number, width: number) => {
			const a = doc.accessors[id],
				v = doc.bufferViews[a.bufferView];
			const size = a.componentType === 5123 ? 2 : 4;
			const start = binary + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
			return Array.from({ length: a.count }, (_, i) =>
				Array.from({ length: width }, (_, k) => {
					const offset = start + i * (v.byteStride ?? width * size) + k * size;
					return a.componentType === 5126
						? bytes.readFloatLE(offset)
						: size === 2
							? bytes.readUInt16LE(offset)
							: bytes.readUInt32LE(offset);
				}),
			);
		};
		// Triangle intersection with a 5x3 ray grid tests the actual exported
		// approach, including rock, instead of trusting authored helper metadata.
		const triangles: number[][][] = [];
		const rockMesh = doc.meshes[rock.mesh];
		const rockUV = read(rockMesh.primitives[0].attributes.TEXCOORD_0, 2);
		expect(
			rockUV.some((p: number[]) => Math.abs(p[0]) > 2 || Math.abs(p[1]) > 2),
			"Rock uses projected metre UVs rather than original unit UVs",
		).toBe(true);
		for (const n of doc.nodes)
			if (n.mesh !== undefined) {
				expect(n.translation ?? [0, 0, 0]).toEqual([0, 0, 0]);
				for (const p of doc.meshes[n.mesh].primitives) {
					expect(typeof p.material, "No material-less boolean fragments").toBe(
						"number",
					);
					const ps = read(p.attributes.POSITION, 3),
						ix = read(p.indices, 1).flat();
					for (let i = 0; i < ix.length; i += 3)
						triangles.push([ps[ix[i]], ps[ix[i + 1]], ps[ix[i + 2]]]);
				}
			}
		for (const dx of [-90, -45, 0, 45, 90])
			for (const dy of [-45, 0, 45]) {
				const x = cx + dx,
					y = cy + dy;
				let blocked = false;
				for (const [a, b, c] of triangles) {
					const d =
						(b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
					if (Math.abs(d) < 1e-7) continue;
					const u =
						((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
					const v =
						((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
					if (u < 0 || v < 0 || u + v > 1) continue;
					const z = u * a[2] + v * b[2] + (1 - u - v) * c[2];
					if (z > cz - 130 && z < cz + 1200) {
						blocked = true;
						break;
					}
				}
				expect(blocked, id + " obstructed approach at " + dx + "," + dy).toBe(
					false,
				);
			}
		expect(doc.meshes.length).toBeLessThan(65);
	});
}

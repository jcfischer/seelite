import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const bytes = readFileSync(new URL("./discovery.glb", import.meta.url));
const json = JSON.parse(
	bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
);
test("Discovery is a self contained textured model with finite geometry", () => {
	expect(bytes.toString("ascii", 0, 4)).toBe("glTF");
	expect(bytes.readUInt32LE(8)).toBe(bytes.length);
	expect(json.images.length).toBeGreaterThan(0);
	for (const img of json.images) expect(img.bufferView).toBeNumber();
	for (const a of json.accessors) {
		for (const x of [...(a.min ?? []), ...(a.max ?? [])])
			expect(Number.isFinite(x)).toBe(true);
	}
	expect(json.buffers.every((b: { uri?: string }) => !b.uri)).toBe(true);
});
test("Discovery retains an elongated body and distinct sphere surface meshes", () => {
	expect(
		json.meshes.some((m: { name: string }) => m.name.startsWith("sphere-")),
	).toBe(true);
	const mins = [Infinity, Infinity, Infinity],
		maxs = [-Infinity, -Infinity, -Infinity];
	for (const mesh of json.meshes)
		for (const p of mesh.primitives) {
			const a = json.accessors[p.attributes.POSITION];
			for (let i = 0; i < 3; i++) {
				mins[i] = Math.min(mins[i], a.min[i]);
				maxs[i] = Math.max(maxs[i], a.max[i]);
			}
		}
	const span = maxs.map((x, i) => x - mins[i]);
	expect(span[0] / span[1]).toBeGreaterThan(4.8);
	expect(span[0] / span[1]).toBeLessThan(5.4);
});

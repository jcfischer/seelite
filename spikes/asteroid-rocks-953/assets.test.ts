import { describe, expect, test } from "bun:test";
import { NodeIO } from "@gltf-transform/core";
import { readFileSync, statSync } from "node:fs";

const dir = new URL("./runtime/", import.meta.url);
const manifest = JSON.parse(
	readFileSync(new URL("manifest.json", dir), "utf8"),
);
describe("authored field rock shipping geometry", () => {
	test("each archetype has three bounded mesh levels sharing the material and UV atlas", async () => {
		const doc = await new NodeIO().read(new URL("asteroids.glb", dir).pathname);
		const meshes = doc.getRoot().listMeshes();
		expect(manifest.count).toBe(16);
		expect(meshes.length).toBe(manifest.count * 3);
		expect(doc.getRoot().listMaterials().length).toBe(1);
		const material = doc.getRoot().listMaterials()[0];
		expect(material.getBaseColorTexture()).not.toBeNull();
		expect(material.getNormalTexture()).not.toBeNull();
		for (const arch of manifest.archetypes) {
			let previous = Infinity;
			for (const level of arch.levels) {
				const node = doc
					.getRoot()
					.listNodes()
					.find((n) => n.getName() === level.name);
				expect(node).toBeDefined();
				const p = node!.getMesh()!.listPrimitives()[0];
				const pos = p.getAttribute("POSITION")!;
				const norm = p.getAttribute("NORMAL")!;
				const uv = p.getAttribute("TEXCOORD_0")!;
				expect(p.getAttribute("TEXCOORD_1")).toBeNull();
				if (level.name.endsWith("L0")) {
					let maxU = 0;
					for (let i = 0; i < uv.getCount(); i++)
						maxU = Math.max(maxU, uv.getElement(i, [])[0]);
					expect(maxU).toBeGreaterThan(3.8);
				}
				expect(norm.getCount()).toBe(pos.getCount());
				expect(uv.getCount()).toBe(pos.getCount());
				const v: number[] = [];
				for (let i = 0; i < pos.getCount(); i++) {
					pos.getElement(i, v);
					expect(Math.hypot(...v)).toBeLessThanOrEqual(1.00001);
					norm.getElement(i, v);
					expect(Math.hypot(...v)).toBeCloseTo(1, 3);
					const t = uv.getElement(i, []);
					expect(t.every((n) => Number.isFinite(n))).toBe(true);
				}
				const count = p.getIndices()!.getCount() / 3;
				expect(count).toBe(level.triangles);
				expect(count).toBeLessThan(previous);
				previous = count;
			}
		}
		expect(statSync(new URL("asteroids.glb", dir)).size).toBeLessThan(
			25 * 1024 * 1024,
		);
	});
});

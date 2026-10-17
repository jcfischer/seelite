import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { selectLod } from "./lod";
// @ts-ignore Node authoring utilities intentionally remain JavaScript.
import { readGLB, measure, primitives, attribute } from "./lod-assets.mjs";
const report = JSON.parse(
	readFileSync(new URL("./lod-report.json", import.meta.url), "utf8"),
);
test("LOD uses drawing-buffer pixels, holds bands and restores nearby full detail", () => {
	expect(selectLod(0, 100, 1000, [0.2, 0.3])).toBe(0);
	expect(selectLod(0, 210, 1000, [0.2, 0.3])).toBe(1);
	expect(selectLod(1, 180, 1000, [0.2, 0.3])).toBe(1);
	expect(selectLod(1, 160, 1000, [0.2, 0.3])).toBe(0);
	expect(selectLod(1, 310, 1000, [0.2, 0.3])).toBe(2);
	expect(selectLod(2, 260, 1000, [0.2, 0.3])).toBe(2);
	expect(selectLod(2, 240, 1000, [0.2, 0.3])).toBe(1);
	expect(selectLod(2, 1, 1000, [0.2, 0.3])).toBe(0);
	expect(selectLod(0, 310, 2000, [0.2, 0.3])).toBe(0);
	expect(selectLod(2, 0, 1000, [0.2, 0.3])).toBe(0);
});
function triangles(asset: any) {
	const out = new Set<string>();
	for (const { p, indices, mesh } of primitives(asset)) {
		const attrs = Object.entries(p.attributes)
			.sort()
			.map(([name, i]) => [name, attribute(asset, i).raw] as const);
		for (let i = 0; i < indices.length; i += 3)
			out.add(
				mesh +
					"/" +
					asset.doc.materials[p.material].name +
					"/" +
					indices
						.slice(i, i + 3)
						.map((v: number) =>
							attrs
								.map(([name, raw]) => name + ":" + raw[v].toString("hex"))
								.join("|"),
						)
						.join(";"),
			);
	}
	return out;
}
test("all reduced surfaces are exact source triangles; no changes to full files, materials or envelope", () => {
	const materialDefinitions = new Map<string, string>();
	for (const [name, row] of Object.entries(report.modules) as [string, any][]) {
		const full = readGLB(new URL(`./modules/${name}.glb`, import.meta.url));
		for (const material of full.doc.materials) {
			const definition = JSON.stringify(material, (key, value) => {
				if (key === "baseColorTexture") {
					const texture = full.doc.textures[value.index];
					return {
						...value,
						index: undefined,
						image: full.doc.images[texture.source],
						sampler: full.doc.samplers[texture.sampler],
					};
				}
				return value;
			});
			if (materialDefinitions.has(material.name))
				expect(definition).toBe(materialDefinitions.get(material.name));
			materialDefinitions.set(material.name, definition);
		}
		expect(createHash("sha256").update(full.bytes).digest("hex")).toBe(
			row.sha256,
		);
		const source = triangles(full);
		let last = row.full.triangles;
		for (const level of row.levels) {
			const asset = readGLB(
					new URL("./modules/" + level.file, import.meta.url),
				),
				m = measure(asset);
			expect(m.triangles).toBe(level.triangles);
			expect(m.triangles).toBeGreaterThan(0);
			expect(m.triangles).toBeLessThanOrEqual(last);
			last = m.triangles;
			expect(asset.doc.materials).toEqual(full.doc.materials);
			expect(asset.doc.images).toEqual(full.doc.images);
			for (let a = 0; a < 3; a++) {
				expect(Number.isFinite(m.min[a])).toBe(true);
				expect(m.min[a]).toBeGreaterThanOrEqual(row.full.min[a]);
				expect(m.max[a]).toBeLessThanOrEqual(row.full.max[a]);
			}
			for (const t of triangles(asset)) expect(source.has(t)).toBe(true);
		}
	}
});

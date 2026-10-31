import { expect, test } from "bun:test";
import * as THREE from "three";
import { readShippedCoriolisBuilder } from "./helpers/read-coriolis-glb";
import { forEachWorldVertex } from "./helpers/world-triangles";

test("diagnose the CI-only NaN in the Coriolis detail", async () => {
	const { build } = await readShippedCoriolisBuilder();
	for (const seed of [0, 1, 7]) {
		const mesh = build(seed, 0x9aa6b2);
		const other = build(seed + 1, 0x9aa6b2);
		let printed = 0;
		let total = 0;
		forEachWorldVertex(mesh.root, (v, object) => {
			total++;
			if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z))
				return;
			if (printed++ > 4) return;
			const m = object as THREE.Mesh;
			const p = m.geometry.getAttribute("position");
			console.log(
				"DIAG2",
				seed,
				object.name,
				object.type,
				"count",
				p.count,
				"itemSize",
				p.itemSize,
				"arrayLen",
				p.array.length,
				p.constructor.name,
				(p as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ?? false,
				"world",
				m.matrixWorld.elements.map((e) => e.toPrecision(3)).join(","),
			);
		});
		const parts: string[] = [];
		mesh.root.traverse((o) => {
			if (o.name === "scale-detail-maintenance-white") {
				const g = (o as THREE.Mesh).geometry;
				const p = g.getAttribute("position");
				parts.push(
					`${o.uuid.slice(0, 8)} geom ${g.uuid.slice(0, 8)} count ${p.count} len ${p.array.length} drawRange ${g.drawRange.start}+${g.drawRange.count}`,
				);
			}
		});
		console.log("DIAG2 seed", seed, "vertices", total, "bad", printed, parts.join(" | "));
		mesh.dispose();
		other.dispose();
	}
	expect(true).toBe(true);
});

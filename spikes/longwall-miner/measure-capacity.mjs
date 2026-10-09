/** Geometric study estimate, not production hold statistics. Read exported skip shells. */
import { readFileSync } from "node:fs";
const b = readFileSync(new URL("./longwall-miner.glb", import.meta.url)),
	jl = b.readUInt32LE(12),
	doc = JSON.parse(b.subarray(20, 20 + jl)),
	bin = 28 + jl;
function read(i) {
	const a = doc.accessors[i],
		v = doc.bufferViews[a.bufferView],
		n = a.type === "VEC3" ? 3 : 1,
		size = [5125, 5126].includes(a.componentType) ? 4 : 2;
	return Array.from({ length: a.count }, (_, j) =>
		Array.from({ length: n }, (_, k) => {
			const o =
				bin +
				(v.byteOffset ?? 0) +
				(a.byteOffset ?? 0) +
				j * (v.byteStride ?? n * size) +
				k * size;
			return a.componentType === 5126
				? b.readFloatLE(o)
				: size === 4
					? b.readUInt32LE(o)
					: b.readUInt16LE(o);
		}),
	);
}
const skipVolumes = Array.from({ length: 3 }, (_, i) => {
	const node = doc.nodes.find((n) => n.name === `hull::sealed-skip-${i}`);
	let sum = 0;
	for (const p of doc.meshes[node.mesh].primitives) {
		const v = read(p.attributes.POSITION),
			indices = read(p.indices).flat();
		for (let j = 0; j < indices.length; j += 3) {
			const a = v[indices[j]],
				c = v[indices[j + 1]],
				d = v[indices[j + 2]];
			sum +=
				(a[0] * (c[1] * d[2] - c[2] * d[1]) +
					a[1] * (c[2] * d[0] - c[0] * d[2]) +
					a[2] * (c[0] * d[1] - c[1] * d[0])) /
				6;
		}
	}
	return Math.abs(sum);
});
const gross = skipVolumes.reduce((a, b) => a + b, 0);
console.log(
	JSON.stringify(
		{
			source: "exported closed skip backing meshes; metres",
			externalSkipVolumesM3: skipVolumes,
			totalExternalM3: gross,
			assumptions: {
				usableVolumeFraction: [0.6, 0.7],
				brokenOreBulkDensityTonnesPerM3: [1.5, 2],
			},
			usableVolumeM3: [gross * 0.6, gross * 0.7],
			cargoTonnes: [gross * 0.6 * 1.5, gross * 0.7 * 2],
			limitation:
				"Volume-only estimate; structure, mass, thrust, economics and production hold unverified",
		},
		null,
		2,
	),
);

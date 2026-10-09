import { readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readGLB, measure, reduce } from "./lod-assets.mjs";
const root = new URL("./modules/", import.meta.url),
	report = {
		method:
			"Exact component removal; surviving positions, normals, UVs and material definitions unchanged",
		modules: {},
	};
for (const file of readdirSync(root)
	.filter((f) => f.endsWith(".glb") && !/-lod[12]\.glb$/.test(f))
	.sort()) {
	const name = file.slice(0, -4),
		source = readGLB(new URL(file, root));
	for (const node of source.doc.nodes) {
		if (
			node.matrix ||
			node.translation?.some((v) => v !== 0) ||
			node.scale?.some((v) => v !== 1) ||
			node.rotation?.some((v, i) => v !== (i === 3 ? 1 : 0))
		)
			throw Error(`${name}: expected baked metre coordinates`);
	}
	const row = {
		sha256: createHash("sha256").update(source.bytes).digest("hex"),
		full: measure(source),
		levels: [],
	};
	for (const [i, width] of [0.16, 0.24].entries()) {
		const result = reduce(source, width),
			output = `${name}-lod${i + 1}.glb`;
		if (result.removedTriangles)
			writeFileSync(new URL(output, root), result.bytes);
		row.levels.push({
			file: result.removedTriangles ? output : file,
			maxRemovedDiameter: result.maxRemovedDiameter,
			...(result.removedTriangles
				? measure(readGLB(new URL(output, root)))
				: row.full),
		});
	}
	report.modules[name] = row;
	console.log(name, row.full.triangles, ...row.levels.map((x) => x.triangles));
}
writeFileSync(
	new URL("./lod-report.json", import.meta.url),
	JSON.stringify(report, null, 2) + "\n",
);

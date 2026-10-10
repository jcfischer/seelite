/** Narrow GLB reader/writer for this Blender kit. No weld or normal/UV changes. */
import { readFileSync } from "node:fs";
export function readGLB(path) {
	const bytes = readFileSync(path),
		length = bytes.readUInt32LE(12);
	if (bytes.toString("utf8", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2)
		throw Error("Expected GLB2");
	const doc = JSON.parse(bytes.subarray(20, 20 + length));
	if (
		doc.extensionsRequired?.length ||
		doc.animations?.length ||
		doc.skins?.length
	)
		throw Error("Unsupported asset");
	return { bytes, doc, bin: bytes.subarray(28 + length) };
}
export function attribute(asset, index) {
	const a = asset.doc.accessors[index],
		v = asset.doc.bufferViews[a.bufferView];
	const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type],
		size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
	if (a.sparse || !width || !size) throw Error("Unsupported accessor");
	const packed = width * size,
		offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0),
		stride = v.byteStride ?? packed;
	const raw = Array.from({ length: a.count }, (_, i) =>
		asset.bin.subarray(offset + i * stride, offset + i * stride + packed),
	);
	const fn = {
		5121: "readUInt8",
		5123: "readUInt16LE",
		5125: "readUInt32LE",
		5126: "readFloatLE",
	}[a.componentType];
	return {
		raw,
		values: raw.map((b) =>
			Array.from({ length: width }, (_, i) => b[fn](i * size)),
		),
	};
}
export function primitives(asset) {
	return asset.doc.meshes.flatMap((m) =>
		m.primitives.map((p) => ({
			mesh: m.name,
			p,
			positions: attribute(asset, p.attributes.POSITION).values,
			indices:
				p.indices === undefined
					? Array.from(
							{ length: asset.doc.accessors[p.attributes.POSITION].count },
							(_, i) => i,
						)
					: attribute(asset, p.indices).values.flat(),
		})),
	);
}
export function measure(asset) {
	let triangles = 0;
	const min = [Infinity, Infinity, Infinity],
		max = [-Infinity, -Infinity, -Infinity];
	for (const { positions, indices } of primitives(asset)) {
		triangles += indices.length / 3;
		for (const i of indices)
			for (let a = 0; a < 3; a++) {
				min[a] = Math.min(min[a], positions[i][a]);
				max[a] = Math.max(max[a], positions[i][a]);
			}
	}
	return { triangles, min, max, bytes: asset.bytes.length };
}
export function components(positions, indices) {
	// Weld only the connectivity search. Output keeps the original split vertices.
	const ids = new Map(),
		parent = [];
	const vi = positions.map((p) => {
		const key = p.join(",");
		if (!ids.has(key)) {
			ids.set(key, parent.length);
			parent.push(parent.length);
		}
		return ids.get(key);
	});
	function find(i) {
		while (parent[i] !== i) {
			parent[i] = parent[parent[i]];
			i = parent[i];
		}
		return i;
	}
	for (let i = 0; i < indices.length; i += 3) {
		const a = find(vi[indices[i]]);
		parent[find(vi[indices[i + 1]])] = a;
		parent[find(vi[indices[i + 2]])] = a;
	}
	const groups = new Map();
	for (let i = 0; i < indices.length; i += 3) {
		const key = find(vi[indices[i]]);
		if (!groups.has(key))
			groups.set(key, {
				indices: [],
				min: [Infinity, Infinity, Infinity],
				max: [-Infinity, -Infinity, -Infinity],
			});
		const g = groups.get(key);
		for (const j of indices.slice(i, i + 3)) {
			g.indices.push(j);
			for (let a = 0; a < 3; a++) {
				g.min[a] = Math.min(g.min[a], positions[j][a]);
				g.max[a] = Math.max(g.max[a], positions[j][a]);
			}
		}
	}
	return [...groups.values()];
}
export function reduce(asset, maxWidth) {
	const doc = structuredClone(asset.doc),
		chunks = [];
	let offset = 0,
		removedTriangles = 0,
		maxRemovedDiameter = 0;
	doc.accessors = [];
	doc.bufferViews = [];
	const append = (data, template, target) => {
		const view = doc.bufferViews.length;
		doc.bufferViews.push({
			buffer: 0,
			byteOffset: offset,
			byteLength: data.length,
			target,
		});
		chunks.push(data);
		offset += data.length;
		const pad = (4 - (offset % 4)) % 4;
		chunks.push(Buffer.alloc(pad));
		offset += pad;
		const index = doc.accessors.length;
		const { byteOffset, bufferView, sparse, ...rest } = template;
		doc.accessors.push({ ...rest, bufferView: view });
		return index;
	};
	for (let mi = 0; mi < doc.meshes.length; mi++) {
		const output = [];
		for (const source of asset.doc.meshes[mi].primitives) {
			if ((source.mode ?? 4) !== 4 || source.targets)
				throw Error("Expected static triangles");
			const positions = attribute(asset, source.attributes.POSITION).values;
			const original =
				source.indices === undefined
					? positions.map((_, i) => i)
					: attribute(asset, source.indices).values.flat();
			const mat = asset.doc.materials[source.material].name;
			const eligible =
				["dark-structure", "machined-alloy"].includes(mat) &&
				!doc.meshes[mi].name.includes("cladding");
			const kept = [];
			for (const g of components(positions, original)) {
				const dims = g.max.map((v, i) => v - g.min[i]),
					tris = g.indices.length / 3;
				if (
					eligible &&
					tris >= 12 &&
					tris <= 40 &&
					Math.max(...dims) <= maxWidth &&
					Math.min(...dims) <= 0.08
				) {
					removedTriangles += tris;
					maxRemovedDiameter = Math.max(
						maxRemovedDiameter,
						Math.hypot(...dims),
					);
				} else kept.push(...g.indices);
			}
			if (!kept.length) continue;
			const unique = [...new Set(kept)],
				remap = new Map(unique.map((v, i) => [v, i])),
				p = { ...source, attributes: {} };
			for (const [semantic, index] of Object.entries(source.attributes)) {
				const a = asset.doc.accessors[index],
					{ raw, values } = attribute(asset, index),
					template = { ...a, count: unique.length };
				if (a.min || a.max) {
					template.min = values[0].map((_, axis) =>
						Math.min(...unique.map((i) => values[i][axis])),
					);
					template.max = values[0].map((_, axis) =>
						Math.max(...unique.map((i) => values[i][axis])),
					);
				}
				p.attributes[semantic] = append(
					Buffer.concat(unique.map((i) => raw[i])),
					template,
					34962,
				);
			}
			const data = Buffer.alloc(kept.length * 4);
			kept.forEach((v, i) => data.writeUInt32LE(remap.get(v), i * 4));
			p.indices = append(
				data,
				{ componentType: 5125, count: kept.length, type: "SCALAR" },
				34963,
			);
			output.push(p);
		}
		doc.meshes[mi].primitives = output;
	}
	// Empty metal batches can disappear while the authored node hierarchy survives.
	const map = new Map();
	doc.meshes = doc.meshes.filter((m, i) => {
		if (!m.primitives.length) return false;
		map.set(i, map.size);
		return true;
	});
	for (const node of doc.nodes)
		if (node.mesh !== undefined) {
			const next = map.get(node.mesh);
			if (next === undefined) delete node.mesh;
			else node.mesh = next;
		}
	if (doc.images?.some((i) => i.uri !== "shared-paint.png"))
		throw Error("Run share-texture.mjs first");
	doc.buffers = [{ byteLength: offset }];
	const j = Buffer.from(JSON.stringify(doc)),
		json = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 32)]),
		binary = Buffer.concat(chunks),
		header = Buffer.alloc(20),
		bh = Buffer.alloc(8);
	header.write("glTF");
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(28 + json.length + binary.length, 8);
	header.writeUInt32LE(json.length, 12);
	header.writeUInt32LE(0x4e4f534a, 16);
	bh.writeUInt32LE(binary.length);
	bh.writeUInt32LE(0x004e4942, 4);
	return {
		bytes: Buffer.concat([header, json, bh, binary]),
		removedTriangles,
		maxRemovedDiameter,
	};
}

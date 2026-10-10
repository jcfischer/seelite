/** Deduplicate Blender-embedded paint into one same-origin texture.
 * Run after build_kit.py. Editable .blend files retain their packed texture.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
const dir = new URL("./modules/", import.meta.url);
let textureHash;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".glb"))) {
	const path = new URL(file, dir),
		bytes = readFileSync(path),
		jsonLength = bytes.readUInt32LE(12),
		doc = JSON.parse(bytes.subarray(20, 20 + jsonLength)),
		bin = bytes.subarray(28 + jsonLength);
	if (doc.images.every((i) => i.uri === "shared-paint.png")) continue;
	const removed = new Set();
	for (const image of doc.images) {
		if (image.bufferView === undefined)
			throw Error("Unexpected external image");
		const view = doc.bufferViews[image.bufferView],
			paint = bin.subarray(
				view.byteOffset ?? 0,
				(view.byteOffset ?? 0) + view.byteLength,
			),
			hash = createHash("sha256").update(paint).digest("hex");
		if (textureHash && textureHash !== hash)
			throw Error("Different image cannot share the paint filename");
		textureHash = hash;
		writeFileSync(new URL("shared-paint.png", dir), paint);
		removed.add(image.bufferView);
		delete image.bufferView;
		image.uri = "shared-paint.png";
	}
	let offset = 0;
	const chunks = [],
		views = [],
		remap = new Map();
	doc.bufferViews.forEach((v, i) => {
		if (removed.has(i)) return;
		const data = bin.subarray(
			v.byteOffset ?? 0,
			(v.byteOffset ?? 0) + v.byteLength,
		);
		remap.set(i, views.length);
		views.push({ ...v, byteOffset: offset });
		chunks.push(data);
		offset += data.length;
		const pad = (4 - (offset % 4)) % 4;
		if (pad) {
			chunks.push(Buffer.alloc(pad));
			offset += pad;
		}
	});
	for (const accessor of doc.accessors) {
		if (accessor.bufferView !== undefined)
			accessor.bufferView = remap.get(accessor.bufferView);
		if (accessor.sparse) throw Error("Sparse accessor requires explicit remap");
	}
	doc.bufferViews = views;
	doc.buffers[0].byteLength = offset;
	const encoded = Buffer.from(JSON.stringify(doc)),
		json = Buffer.concat([
			encoded,
			Buffer.alloc((4 - (encoded.length % 4)) % 4, 32),
		]),
		binary = Buffer.concat(chunks),
		header = Buffer.alloc(20),
		binHeader = Buffer.alloc(8);
	header.write("glTF");
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(28 + json.length + binary.length, 8);
	header.writeUInt32LE(json.length, 12);
	header.writeUInt32LE(0x4e4f534a, 16);
	binHeader.writeUInt32LE(binary.length, 0);
	binHeader.writeUInt32LE(0x004e4942, 4);
	writeFileSync(path, Buffer.concat([header, json, binHeader, binary]));
	console.log(
		file,
		Math.round(bytes.length / 1024),
		"->",
		Math.round((28 + json.length + binary.length) / 1024),
		"KiB",
	);
}

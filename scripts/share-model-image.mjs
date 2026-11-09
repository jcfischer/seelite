/**
 * Removes one image from the shipping GLBs that embed it, and writes it beside
 * them as one file, which `src/shared-image.ts` resolves at load:
 * https://github.com/jcfischer/seelite/issues/1222
 *
 *   node scripts/share-model-image.mjs
 *
 * Reproducible: a re-exported model is prepared again by the same command, and
 * a prepared one is left byte for byte. The bytes of every other buffer view
 * are moved, never re-encoded.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SHARED_IMAGE_EXTENSION = "SEELITE_shared_image";

/** The image this command shares, and every model that embeds it. */
export const INDUSTRIAL_SURFACE = Object.freeze({
	sha256: "10d4d0776274448b52fc3191941d09dc0a74f1967854f23f86406188bf1eedd7",
	name: "industrial-surface",
	file: "src/models/industrial-surface.webp",
	models: Object.freeze([
		"coriolis",
		"outpost-buoy",
		"outpost-cluster",
		"outpost-derrick",
		"outpost-rig",
		"outpost-salvage",
		"shipyard-foundry",
		"shipyard-gantry",
		"shipyard-slipway",
		"station-interiors",
		"trade-assembly",
		"trade-drum",
		"trade-ring",
		"trade-wheel",
	]),
});

const WEBP = "EXT_texture_webp";
const MESHOPT = "EXT_meshopt_compression";
const REGISTRY_SAMPLER = {
	magFilter: 9729,
	minFilter: 9987,
	wrapS: 10497,
	wrapT: 10497,
};

function checkUses(json) {
	if (json.images.length !== 1 || json.textures?.length !== 1)
		throw new Error("expected one image and one texture");
	const sampler = json.samplers?.[json.textures[0].sampler] ?? {};
	for (const [key, value] of Object.entries(REGISTRY_SAMPLER))
		if (sampler[key] !== value)
			throw new Error(`sampler ${key} is not what the registry applies`);
	const walk = (value, inBaseColor) => {
		for (const [key, child] of Object.entries(value)) {
			if (!child || typeof child !== "object") continue;
			if (key.endsWith("Texture")) {
				if (key !== "baseColorTexture" || !inBaseColor)
					throw new Error(`the image is used by ${key}`);
				if (child.texCoord || child.extensions)
					throw new Error("the image is used with a UV set or a transform");
			} else walk(child, key === "pbrMetallicRoughness");
		}
	};
	for (const material of json.materials ?? []) walk(material, false);
}

function remapBufferViews(value, removed) {
	for (const [key, child] of Object.entries(value)) {
		if (key === "bufferView" && typeof child === "number") {
			if (child === removed) throw new Error("another reference to the image");
			if (child > removed) value[key] = child - 1;
		} else if (child && typeof child === "object")
			remapBufferViews(child, removed);
	}
}

/**
 * `bytes` without the embedded image whose sha256 is `sha256`, its texture
 * naming that hash instead. `image` is the removed bytes; `null` when the file
 * holds no image, in which case `bytes` is returned as it came.
 */
export function shareImage(bytes, sha256) {
	const file = Buffer.from(bytes);
	if (file.readUInt32LE(0) !== 0x46546c67 || file.readUInt32LE(4) !== 2)
		throw new Error("expected a glTF 2 binary");
	const jsonLength = file.readUInt32LE(12);
	const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
	if (!json.images) return { bytes, image: null };
	checkUses(json);
	const binStart = 28 + jsonLength;
	const binLength = file.readUInt32LE(20 + jsonLength);
	const bin = file.subarray(binStart, binStart + binLength);
	const removed = json.images[0].bufferView;
	const view = json.bufferViews[removed];
	const start = view.byteOffset ?? 0;
	const image = bin.subarray(start, start + view.byteLength);
	if (createHash("sha256").update(image).digest("hex") !== sha256)
		throw new Error("the embedded image is not the one being shared");

	const owner = view.buffer;
	const ranges = json.bufferViews.flatMap((v) => {
		const out = [];
		if (v.buffer === owner) out.push(v);
		const compressed = v.extensions?.[MESHOPT];
		if (compressed?.buffer === owner) out.push(compressed);
		return out;
	});
	const after = ranges
		.map((r) => r.byteOffset ?? 0)
		.filter((offset) => offset > start);
	const end = after.length ? Math.min(...after) : binLength;
	const cut = end - start;
	if (cut % 8 !== 0 && after.length)
		throw new Error("removing the image would change the data's alignment");
	for (const range of ranges)
		if ((range.byteOffset ?? 0) >= end) range.byteOffset -= cut;

	delete json.images;
	json.bufferViews.splice(removed, 1);
	remapBufferViews(json, removed);
	json.buffers[owner].byteLength -= cut;
	const { sampler } = json.textures[0];
	json.textures[0] = {
		sampler,
		extensions: { [SHARED_IMAGE_EXTENSION]: { sha256 } },
	};
	json.extensionsUsed = [
		...json.extensionsUsed.filter((name) => name !== WEBP),
		SHARED_IMAGE_EXTENSION,
	];
	json.extensionsRequired = json.extensionsRequired.filter(
		(name) => name !== WEBP,
	);

	const text = Buffer.from(JSON.stringify(json));
	const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
	text.copy(padded);
	const kept = Buffer.concat([bin.subarray(0, start), bin.subarray(end)]);
	const header = Buffer.alloc(20);
	header.write("glTF");
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(28 + padded.length + kept.length, 8);
	header.writeUInt32LE(padded.length, 12);
	header.writeUInt32LE(0x4e4f534a, 16);
	const binHeader = Buffer.alloc(8);
	binHeader.writeUInt32LE(kept.length, 0);
	binHeader.writeUInt32LE(0x004e4942, 4);
	return {
		bytes: Buffer.concat([header, padded, binHeader, kept]),
		image: Buffer.from(image),
	};
}

function main() {
	const { sha256, file, models } = INDUSTRIAL_SURFACE;
	for (const model of models) {
		const path = `src/models/${model}.glb`;
		const before = readFileSync(path);
		const { bytes, image } = shareImage(before, sha256);
		if (!image) {
			console.log(`${model}: already prepared, ${before.length} bytes`);
			continue;
		}
		writeFileSync(file, image);
		writeFileSync(path, bytes);
		console.log(`${model}: ${before.length} -> ${bytes.length} bytes`);
	}
	if (!existsSync(file)) throw new Error(`${file} is missing`);
	const shared = readFileSync(file);
	if (createHash("sha256").update(shared).digest("hex") !== sha256)
		throw new Error(`${file} does not hold ${sha256}`);
	console.log(`${file}: ${statSync(file).size} bytes, sha256 ${sha256}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

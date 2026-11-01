// The game's authored trade and outpost forms (nodes #1031–1033): the approved studies
// (#810) as flight exports, Meshopt and lossless WebP, written to src/models/. The flight
// export is `build_model.py -- <name> --flight`: the approved layout without
// plate fasteners, seam strips, wear trails or the cladding bevel, its front
// redrawn to the sim's outpost pad (principal ruling, 2026-10-19, option 1),
// and the whole model moved so the aperture plane lies on +Z at the sim's
// figure. Forms a-d (Derrick, Buoy, Rig, Cluster) are also turned so their
// pad faces +Z, and the Rig's moved so its pad is on the axis. This step adds no simplification, quantization or resize: the
// written file's triangles are compared with the flight export's as read.
//
//   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
//     --python spikes/stations/build_model.py -- salvage derrick buoy rig cluster --flight
//   node spikes/stations/prepare-flight-asset.mjs [name ...]
import { NodeIO } from "@gltf-transform/core";
import {
	ALL_EXTENSIONS,
	EXTMeshoptCompression,
} from "@gltf-transform/extensions";
import {
	cloneDocument,
	dedup,
	prune,
	reorder,
	textureCompress,
} from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { triangleSoup } from "../longwall-miner/triangle-soup.mjs";
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({
		"meshopt.encoder": MeshoptEncoder,
		"meshopt.decoder": MeshoptDecoder,
	});
const pixels = async (doc) =>
	Promise.all(
		doc
			.getRoot()
			.listTextures()
			.map(async (texture) => [
				texture.getName(),
				await sharp(texture.getImage()).ensureAlpha().raw().toBuffer(),
			]),
	);
const attributes = (doc) =>
	doc
		.getRoot()
		.listMeshes()
		.map((mesh) => ({
			name: mesh.getName(),
			primitives: mesh.listPrimitives().map((primitive) =>
				Object.fromEntries(
					primitive
						.listSemantics()
						.sort()
						.map((semantic) => [
							semantic,
							Array.from(primitive.getAttribute(semantic).getArray()),
						]),
				),
			),
		}));
await mkdir("src/models", { recursive: true });
const wanted = process.argv.slice(2);
for (const [id, name] of [
	["derrick", "derrick"],
	["buoy", "buoy"],
	["rig", "rig"],
	["cluster", "cluster"],
	["salvage", "salvage"],
	["ring", "ring"],
	["drum", "drum"],
	["wheel", "wheel"],
]) {
	const trade = ["ring", "drum", "wheel"].includes(id);
	if (wanted.length ? !wanted.includes(id) : trade) continue;
	const source = `.dream-loop/station-flight/${id}.glb`;
	const role = trade ? "trade" : "outpost";
	const target = `src/models/${role}-${name}.glb`;
	const document = await io.read(source);
	const originalPixels = await pixels(document);
	const approved = triangleSoup(document);
	await document.transform(
		dedup(),
		reorder({ encoder: MeshoptEncoder }),
		textureCompress({ encoder: sharp, targetFormat: "webp", lossless: true }),
	);
	// QUANTIZE selects the lossless NONE filter in glTF Transform (see the
	// Coriolis script); FILTER would introduce lossy normal/rotation filters.
	document
		.createExtension(EXTMeshoptCompression)
		.setRequired(true)
		.setEncoderOptions({
			method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
		});
	const outputs = [[target, document]];
	if (id === "ring") {
		const detail = cloneDocument(document);
		const isDetail = (node) => node.getName().startsWith("scale-detail/");
		for (const node of document.getRoot().listNodes())
			if (isDetail(node)) node.dispose();
		const scene = detail.getRoot().listScenes()[0];
		for (const node of detail.getRoot().listNodes())
			if (isDetail(node)) scene.addChild(node);
		for (const node of detail.getRoot().listNodes())
			if (!isDetail(node)) node.dispose();
		for (const material of detail.getRoot().listMaterials()) {
			const texture = material.getBaseColorTexture();
			if (!texture) continue;
			material.setExtras({
				...material.getExtras(),
				baseColorMap: texture.getName(),
			});
			material.setBaseColorTexture(null);
		}
		await document.transform(prune({ keepAttributes: true, keepLeaves: true }));
		await detail.transform(prune({ keepAttributes: true, keepLeaves: true }));
		assert.equal(
			detail.getRoot().listTextures().length,
			0,
			"Ring detail carries an image",
		);
		detail
			.createExtension(EXTMeshoptCompression)
			.setRequired(true)
			.setEncoderOptions({
				method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
			});
		outputs.push(["src/models/trade-ring-detail.glb", detail]);
	}
	const decodedOutputs = [];
	for (const [output, doc] of outputs) {
		const beforeEncoding = attributes(doc);
		await io.write(output, doc);
		const decoded = await io.read(output);
		decodedOutputs.push(decoded);
		assert.deepEqual(
			attributes(decoded),
			beforeEncoding,
			`${output}: Meshopt changed vertex attributes`,
		);
		const { size } = await stat(output);
		assert(size < 25_000_000, `${output}: exceeds the flight asset budget`);
		const sha256 = createHash("sha256")
			.update(await readFile(output))
			.digest("hex");
		console.log(
			`Verified ${output}: exact vertex attributes; ${size} bytes (${(size / 2 ** 20).toFixed(2)} MiB), sha256 ${sha256}.`,
		);
	}
	const [decoded, detail] = decodedOutputs;
	assert.deepEqual(
		await pixels(decoded),
		originalPixels,
		`${target}: WebP changed texture pixels`,
	);
	if (detail) {
		const textures = new Map(
			decoded
				.getRoot()
				.listTextures()
				.map((texture) => [texture.getName(), texture]),
		);
		for (const material of detail.getRoot().listMaterials()) {
			const name = material.getExtras().baseColorMap;
			if (name) {
				assert(textures.has(name), `Missing base texture ${name}`);
				const texture = textures.get(name);
				material.setBaseColorTexture(
					detail
						.createTexture(name)
						.setImage(texture.getImage())
						.setMimeType(texture.getMimeType()),
				);
			}
		}
	}
	assert.deepEqual(
		Object.assign({}, ...decodedOutputs.map(triangleSoup)),
		approved,
		`${target}: split or encoding changed triangles or material inputs`,
	);
	console.log(
		`Verified ${target}: exact flight-export triangles, material inputs and texture pixels across ${outputs.length} file(s).`,
	);
}

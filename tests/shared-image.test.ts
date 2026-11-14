/**
 * One decoded image per texture many models embed: `industrial-surface`
 * (https://github.com/jcfischer/seelite/issues/1222) and the seven-ship wear map
 * (nodes #1034/#1035). The prepared files decode through the production loader,
 * with the image loader stubbed because Bun has no image decoder; the browser
 * half is `scripts/probe-shared-image.mjs`.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import originals from "./fixtures/shared-image-originals.json";
import {
	INDUSTRIAL_SURFACE,
	STEEL_WEAR,
	shareImage,
	writeGlb,
	SHARED_IMAGE_EXTENSION,
} from "../scripts/share-model-image.mjs";
import { glbDigest } from "../scripts/lib/glb-digest";
import { disposeSubtree, isShared } from "../src/gpu-teardown";
import { restoreWorld } from "../src/sim";
import { bootModelIds } from "../src/system-models";
import { SHARED_IMAGES } from "../src/model-urls";
import {
	createSharedImages,
	EXTENSION,
	sharedImagePlugin,
	type ImageLoader,
} from "../src/shared-image";

const IMAGES = [INDUSTRIAL_SURFACE, STEEL_WEAR] as const;
const MODELS = Object.keys(originals) as (keyof typeof originals)[];
/** The image a model names, from whichever registry lists it. */
const imageOf = (model: string) => {
	const image = IMAGES.find((one) => one.models.includes(model));
	if (!image) throw new Error(`${model} names no shared image`);
	return image;
};
const pathOf = (model: string) => `src/models/${model}.glb`;

const documentOf = (bytes: Uint8Array) => {
	const buffer = Buffer.from(bytes);
	return JSON.parse(
		buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString(),
	);
};

const IMAGE = Buffer.from("not really a webp!!!");
const SHA = createHash("sha256").update(IMAGE).digest("hex");
const embedded = () => ({
	asset: { version: "2.0" },
	extensionsUsed: ["EXT_meshopt_compression", "EXT_texture_webp"],
	extensionsRequired: ["EXT_meshopt_compression", "EXT_texture_webp"],
	buffers: [{ byteLength: 32 }, { byteLength: 12, extensions: {} }],
	images: [{ bufferView: 0, mimeType: "image/webp", name: "surface" }],
	samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
	textures: [{ sampler: 0, extensions: { EXT_texture_webp: { source: 0 } } }],
	materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
	bufferViews: [
		{ buffer: 0, byteOffset: 0, byteLength: IMAGE.length },
		{
			buffer: 1,
			byteOffset: 0,
			byteLength: 12,
			extensions: {
				EXT_meshopt_compression: {
					buffer: 0,
					byteOffset: 24,
					byteLength: 8,
				},
			},
		},
		{ buffer: 0, byteOffset: 24, byteLength: 4 },
	],
	accessors: [{ bufferView: 1 }, { bufferView: 2 }],
});
const binOf = () => {
	const bin = Buffer.alloc(32, 7);
	IMAGE.copy(bin);
	return bin;
};

describe("shareImage", () => {
	const prepared = () => {
		const { bytes, image } = shareImage(writeGlb(embedded(), binOf()), SHA);
		return { bytes, image, json: documentOf(bytes) };
	};

	test("removes the image, compacts the binary and shifts what followed it", () => {
		const { json, bytes, image } = prepared();
		expect(Buffer.from(image!).equals(IMAGE)).toBe(true);
		expect(json.images).toBeUndefined();
		expect(json.bufferViews).toHaveLength(2);
		expect(
			json.bufferViews[0].extensions.EXT_meshopt_compression.byteOffset,
		).toBe(0);
		expect(json.bufferViews[1].byteOffset).toBe(0);
		expect(
			json.accessors.map((a: { bufferView: number }) => a.bufferView),
		).toEqual([0, 1]);
		expect(json.buffers[0].byteLength).toBe(8);
		expect(Buffer.from(bytes).readUInt32LE(4)).toBe(2);
		expect(Buffer.from(bytes).readUInt32LE(8)).toBe(bytes.length);
	});

	test("records the shared image on the texture and drops the webp extension", () => {
		const { json } = prepared();
		expect(json.textures[0]).toEqual({
			sampler: 0,
			extensions: { [SHARED_IMAGE_EXTENSION]: { sha256: SHA } },
		});
		expect(json.extensionsUsed).toEqual([
			"EXT_meshopt_compression",
			SHARED_IMAGE_EXTENSION,
		]);
		expect(json.extensionsRequired).toEqual(["EXT_meshopt_compression"]);
	});

	test("leaves an already prepared file byte for byte", () => {
		const { bytes } = prepared();
		const again = shareImage(bytes, SHA);
		expect(again.image).toBeNull();
		expect(Buffer.from(again.bytes).equals(Buffer.from(bytes))).toBe(true);
	});

	test.each([
		["another image", (d: any) => d, "0".repeat(64)],
		[
			"a second image",
			(d: any) => d.images.push({ bufferView: 2, mimeType: "image/webp" }),
			SHA,
		],
		[
			"a slot other than base colour",
			(d: any) => {
				d.materials[0] = { normalTexture: { index: 0 } };
			},
			SHA,
		],
		[
			"a second UV set",
			(d: any) => {
				d.materials[0].pbrMetallicRoughness.baseColorTexture.texCoord = 1;
			},
			SHA,
		],
		[
			"a texture transform",
			(d: any) => {
				d.materials[0].pbrMetallicRoughness.baseColorTexture.extensions = {
					KHR_texture_transform: {},
				};
			},
			SHA,
		],
		[
			"a sampler other than the one the registry applies",
			(d: any) => {
				d.samplers[0].wrapS = 33071;
			},
			SHA,
		],
	])("refuses %s", (_, change, sha) => {
		const json = embedded();
		change(json);
		expect(() => shareImage(writeGlb(json, binOf()), sha as string)).toThrow();
	});

	test("the extension's spelling is the one the plugin reads", () => {
		expect(SHARED_IMAGE_EXTENSION).toBe(EXTENSION);
	});
});

describe("the prepared shipping models", () => {
	test.each(IMAGES.map((one) => [one.file, one] as const))(
		"%s holds the image its models embedded",
		(_file, shared) => {
			const bytes = readFileSync(shared.file);
			expect(createHash("sha256").update(bytes).digest("hex")).toBe(
				shared.sha256,
			);
			expect(SHARED_IMAGES[shared.sha256]?.name).toBe(shared.name);
		},
	);

	test("every model in the fixture is listed by exactly one image", () => {
		const listed = IMAGES.flatMap((one) => [...one.models]).sort();
		expect(listed).toEqual([...MODELS].sort());
	});

	test.each(MODELS)(
		"%s embeds no image; run `node scripts/share-model-image.mjs` after a re-export",
		(model) => {
			const json = documentOf(readFileSync(pathOf(model)));
			expect(json.images).toBeUndefined();
			expect(json.textures).toHaveLength(1);
			expect(json.textures[0].extensions).toEqual({
				[SHARED_IMAGE_EXTENSION]: { sha256: imageOf(model).sha256 },
			});
		},
	);

	test.each(MODELS)(
		"%s decodes to the original's attributes, smaller by the image",
		async (model) => {
			const now = await glbDigest(pathOf(model));
			const was = originals[model];
			expect(now.attributes).toBe(was.attributes);
			expect(now.document).toBe(was.document);
			const removed = was.bytes - now.bytes;
			const shared = readFileSync(imageOf(model).file).length;
			expect(removed).toBeGreaterThan(shared - 4096);
			expect(removed).toBeLessThan(shared + 4096);
		},
	);

	test.each(MODELS)(
		"%s loads through the plugin with the embedded texture's settings",
		async (model) => {
			const image = new THREE.Texture();
			const registry = createSharedImages(SHARED_IMAGES, async () => image);
			const bytes = readFileSync(pathOf(model));
			const gltf = await new GLTFLoader()
				.setMeshoptDecoder(MeshoptDecoder)
				.register(sharedImagePlugin(undefined, registry))
				.parseAsync(
					bytes.buffer.slice(
						bytes.byteOffset,
						bytes.byteOffset + bytes.byteLength,
					) as ArrayBuffer,
					"",
				);
			const maps = new Set<THREE.Texture>();
			gltf.scene.traverse((o) => {
				const { material } = o as THREE.Mesh;
				for (const m of [material ?? []].flat())
					if ((m as THREE.MeshStandardMaterial).map)
						maps.add((m as THREE.MeshStandardMaterial).map!);
			});
			expect([...maps]).toEqual([image]);
			expect(image.flipY).toBe(false);
			expect(image.colorSpace).toBe(THREE.SRGBColorSpace);
			expect(image.wrapS).toBe(THREE.RepeatWrapping);
			expect(image.wrapT).toBe(THREE.RepeatWrapping);
			expect(image.magFilter).toBe(THREE.LinearFilter);
			expect(image.minFilter).toBe(THREE.LinearMipmapLinearFilter);
			expect(image.generateMipmaps).toBe(true);
			expect(image.anisotropy).toBe(1);
			expect(image.name).toBe(imageOf(model).name);
		},
	);

	test("a loader without the plugin refuses rather than drawing untextured", async () => {
		const bytes = readFileSync(pathOf("trade-drum"));
		const data = bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		) as ArrayBuffer;
		await expect(
			new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(data, ""),
		).rejects.toThrow();
	});
});

test("a fresh pilot's boot always needs a model that uses the image", () => {
	const usesTheImage = /^(coriolis|trade\/[bcde])$/;
	for (let index = 0; index < 256; index++) {
		const { system } = restoreWorld(42, 0, index, 0);
		const exterior = bootModelIds(system, null).filter(
			(id) => id !== "cockpit",
		);
		if (system.contents.stations.length)
			expect(exterior.join()).toMatch(usesTheImage);
	}
}, 30_000);

describe("the shared image registry", () => {
	const HASH = "a".repeat(64);
	const TABLE = { [HASH]: { url: "/surface.webp", name: "surface" } };
	const LOADER = {} as ImageLoader;
	const counting = () => {
		const calls: string[] = [];
		return {
			calls,
			load: async (url: string) => {
				calls.push(url);
				return new THREE.Texture();
			},
		};
	};

	test("fetches once and hands two exterior callers one texture", async () => {
		const { calls, load } = counting();
		const images = createSharedImages(TABLE, load);
		const [a, b] = await Promise.all([
			images.texture(HASH, undefined, LOADER),
			images.texture(HASH, undefined, LOADER),
		]);
		const c = await images.texture(HASH, undefined, LOADER);
		expect(a).toBe(b);
		expect(a).toBe(c);
		expect(calls).toEqual(["/surface.webp"]);
	});

	test("a named owner gets its own settings over the same decoded image", async () => {
		const { calls, load } = counting();
		const images = createSharedImages(TABLE, load);
		const base = await images.texture(HASH, undefined, LOADER);
		const own = await images.texture(HASH, "interior", LOADER);
		own.anisotropy = 8;
		expect(own).not.toBe(base);
		expect(own.source).toBe(base.source);
		expect(base.anisotropy).toBe(1);
		expect(await images.texture(HASH, "interior", LOADER)).toBe(own);
		expect(isShared(own)).toBe(true);
		expect(calls).toHaveLength(1);
	});

	test("tearing down a model keeps the texture for the next", async () => {
		const { load } = counting();
		const images = createSharedImages(TABLE, load);
		const map = await images.texture(HASH, undefined, LOADER);
		let disposed = 0;
		map.addEventListener("dispose", () => disposed++);
		const root = new THREE.Mesh(
			new THREE.BufferGeometry(),
			new THREE.MeshStandardMaterial({ map }),
		);
		expect(disposeSubtree(root).kept.has(map)).toBe(true);
		expect(disposed).toBe(0);
	});

	test("a failed fetch rejects every waiter and the next call fetches again", async () => {
		let attempts = 0;
		const images = createSharedImages(TABLE, async () => {
			if (++attempts === 1) throw new Error("offline");
			return new THREE.Texture();
		});
		const first = images.texture(HASH, undefined, LOADER);
		const own = images.texture(HASH, "interior", LOADER);
		const failed = await Promise.allSettled([first, own]);
		expect(failed.map((r) => r.status)).toEqual(["rejected", "rejected"]);
		const map = await images.texture(HASH, "interior", LOADER);
		expect(map).toBeInstanceOf(THREE.Texture);
		expect(attempts).toBe(2);
	});

	test("an unknown hash rejects", async () => {
		const { load } = counting();
		await expect(
			createSharedImages(TABLE, load).texture(
				"b".repeat(64),
				undefined,
				LOADER,
			),
		).rejects.toThrow("b".repeat(64));
	});
});

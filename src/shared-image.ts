/**
 * Images several models share, fetched and decoded once:
 * https://github.com/jcfischer/seelite/issues/1222
 *
 * A prepared GLB holds no copy of the image: its texture names one by content
 * hash (`scripts/share-model-image.mjs`), and `sharedImagePlugin` resolves that
 * through the module-level registry here. A failed fetch forgets its promise,
 * so the model's next load fetches again, and rejects the load, because three's
 * own texture path answers a failed image with an untextured model.
 *
 * Models keep one texture object. An `owner` isolates its settings on another
 * texture over the same decoded `Source`. The registry applies an image's
 * optional anisotropy before cloning; matching sampler settings share one GPU
 * upload even across owner copies, including the interiors at anisotropy 8.
 * Consumers identify registry maps by Source, including owner copies and clones,
 * and leave their sampler policy to the registry.
 */
import * as THREE from "three";
import type {
	GLTFLoaderPlugin,
	GLTFParser,
} from "three/addons/loaders/GLTFLoader.js";
import { shared } from "./gpu-teardown";
import { SHARED_IMAGES, type SharedImage } from "./model-urls";

/** The texture extension a prepared GLB carries; the script holds the same
 *  spelling and `tests/shared-image.test.ts` asserts they agree. */
export const EXTENSION = "SEELITE_shared_image";

/** `GLTFParser.textureLoader`: whichever loader three chose for this browser. */
export type ImageLoader = THREE.TextureLoader | THREE.ImageBitmapLoader;

const registrySources = new WeakSet<THREE.Source>();

/** Whether a texture uses a registry-owned image, including owner copies and clones. */
export const isSharedImage = (texture: THREE.Texture): boolean =>
	registrySources.has(texture.source);

const decode = (url: string, loader: ImageLoader): Promise<THREE.Texture> =>
	new Promise((resolve, reject) => {
		const onImage = (image: THREE.Texture | ImageBitmap) => {
			if (image instanceof THREE.Texture) return resolve(image);
			const texture = new THREE.Texture(image);
			texture.needsUpdate = true;
			resolve(texture);
		};
		(loader as THREE.Loader<THREE.Texture | ImageBitmap>).load(
			url,
			onImage,
			undefined,
			reject,
		);
	});

/** A registry over `images`; `load` is the fetch and decode, replaced in tests.
 *  `texture` is the shared texture, or with an `owner` that owner's own texture
 *  over the same decoded image. */
export function createSharedImages(
	images: Readonly<Record<string, SharedImage>>,
	load: (url: string, loader: ImageLoader) => Promise<THREE.Texture> = decode,
) {
	const bases = new Map<string, Promise<THREE.Texture>>();
	const copies = new Map<string, THREE.Texture>();
	const base = (sha256: string, loader: ImageLoader) => {
		const known = bases.get(sha256);
		if (known) return known;
		const image = images[sha256];
		if (!image) return Promise.reject(new Error(`No shared image ${sha256}`));
		const loading = load(image.url, loader).then((texture) => {
			texture.name = image.name;
			texture.flipY = false;
			texture.magFilter = THREE.LinearFilter;
			texture.minFilter = THREE.LinearMipmapLinearFilter;
			texture.wrapS = THREE.RepeatWrapping;
			texture.wrapT = THREE.RepeatWrapping;
			if (image.anisotropy !== undefined) texture.anisotropy = image.anisotropy;
			registrySources.add(texture.source);
			return shared(texture);
		});
		bases.set(sha256, loading);
		loading.catch(() => bases.delete(sha256));
		return loading;
	};
	return {
		async texture(
			sha256: string,
			owner: string | undefined,
			loader: ImageLoader,
		): Promise<THREE.Texture> {
			const texture = await base(sha256, loader);
			if (owner === undefined) return texture;
			const key = `${sha256}/${owner}`;
			let copy = copies.get(key);
			if (!copy) {
				copy = shared(texture.clone());
				copies.set(key, copy);
			}
			return copy;
		},
	};
}

const sharedImages = createSharedImages(SHARED_IMAGES);

/** Register on a `GLTFLoader` that may read a prepared GLB. A loader without it
 *  rejects such a file, because its texture has no `source`. */
export const sharedImagePlugin =
	(owner?: string, registry = sharedImages) =>
	(parser: GLTFParser): GLTFLoaderPlugin => ({
		name: EXTENSION,
		loadTexture(index) {
			const sha256 =
				parser.json.textures[index].extensions?.[EXTENSION]?.sha256;
			if (typeof sha256 !== "string") return null;
			return registry.texture(sha256, owner, parser.textureLoader);
		},
	});

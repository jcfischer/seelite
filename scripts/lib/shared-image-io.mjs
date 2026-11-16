import { readFileSync } from "node:fs";
import {
	SHARED_MODEL_IMAGES,
	SHARED_IMAGE_EXTENSION,
} from "../share-model-image.mjs";

/** Read a shipped model with glTF-Transform, resolving the production image registry. */
export async function readSharedModel(io, file) {
	const document = await io.binaryToJSON(readFileSync(file));
	const { json, resources } = document;
	for (const texture of json.textures ?? []) {
		const sha256 = texture.extensions?.[SHARED_IMAGE_EXTENSION]?.sha256;
		if (!sha256) continue;
		const image = SHARED_MODEL_IMAGES.find((entry) => entry.sha256 === sha256);
		if (!image) throw new Error(`Unknown shared image ${sha256}`);
		const uri = `${sha256}.webp`;
		resources[uri] = readFileSync(image.file);
		json.images ??= [];
		texture.source = json.images.length;
		json.images.push({ uri, name: image.name, mimeType: "image/webp" });
		delete texture.extensions[SHARED_IMAGE_EXTENSION];
	}
	for (const key of ["extensionsUsed", "extensionsRequired"])
		if (json[key])
			json[key] = json[key].filter((name) => name !== SHARED_IMAGE_EXTENSION);
	return io.readJSON(document);
}

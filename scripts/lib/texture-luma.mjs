/**
 * Mean luma of a glTF texture's pixels, through the same image decoder the
 * asset pipeline encodes with (node #887).
 *
 * A base colour *factor* is only half of a paint: every exterior paint on the O4
 * courier multiplies its factor by a `steel-wear` map whose pixels mean **0.44**
 * linear, while the Longwall B's `dark-structure` and `machined-alloy` carry no
 * map at all. The same lift rule over those two assets is a different brightness
 * by a factor of two, and a rule sized on one of them silently overshoots the
 * other. So the map is measured rather than assumed, and the number is passed to
 * `liftAuthoredHullPaint` with the factor.
 *
 * In its own module because it is the one part of this node that needs an image
 * decoder: `authored-hull-paint.mjs` stays pure arithmetic, and the bun tests
 * that read it do not load a native binding to do it.
 */
import sharp from "sharp";

/** The sRGB-to-linear transfer, so a mean over 0–255 pixels lands in the same
 *  space as a base colour factor. */
export const srgbToLinear = (channel) =>
	channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** Rec. 709 luma of a linear triple. */
export const linearLuma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Every 97th pixel of a `@gltf-transform` Texture, as linear Rec. 709 luma.
 *
 * 97 rather than every pixel because this is a mean over a 1254² map and a stride
 * of 97 — coprime with the width, so the sample walks every column rather than
 * riding one — and a mean of a wear map does not need all 1.5 M pixels to be
 * stable to the third decimal. `null` (no image) means no map: the caller reads
 * that as 1, since a factor with nothing to multiply is the whole paint.
 */
export async function textureMeanLuma(texture) {
	if (!texture) return 1;
	const image = texture.getImage();
	if (!image) return 1;
	const { data, info } = await sharp(image)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const pixels = info.width * info.height;
	if (!(pixels > 0))
		throw new Error(`${texture.getName()} decoded to no pixels`);
	// Averaged **after** the transfer, not before: sRGB to linear is convex, so the
	// luma of a mean sRGB triple is not the mean luma of the pixels. For the
	// courier's `steel-wear` the two differ by 0.09 — 0.44 against 0.53 — and the
	// figure here is what a paint's factor actually multiplies on the way to the
	// screen.
	let mean = 0;
	let seen = 0;
	for (let i = 0; i < pixels; i += 97) {
		mean += linearLuma([
			srgbToLinear(data[i * 4] / 255),
			srgbToLinear(data[i * 4 + 1] / 255),
			srgbToLinear(data[i * 4 + 2] / 255),
		]);
		seen++;
	}
	if (!(seen > 0)) throw new Error(`${texture.getName()} sampled nothing`);
	mean /= seen;
	if (!Number.isFinite(mean))
		throw new Error(`${texture.getName()} mean luma is not finite: ${mean}`);
	return mean;
}

/** `material.getName() → base colour map mean`, for a loaded document. */
export async function baseColorLumaByMaterial(document) {
	const means = new Map();
	for (const material of document.getRoot().listMaterials()) {
		const texture = material.getBaseColorTexture();
		if (!texture) continue;
		if (!means.has(texture)) means.set(texture, await textureMeanLuma(texture));
	}
	const byName = new Map();
	for (const material of document.getRoot().listMaterials())
		byName.set(
			material.getName(),
			means.get(material.getBaseColorTexture()) ?? 1,
		);
	return byName;
}

function wrap(value: number, size: number): number {
	return ((value % size) + size) % size;
}

function blur(
	input: Float32Array,
	width: number,
	height: number,
	radius: number,
): Float32Array {
	let values = input;
	const diameter = 2 * radius + 1;
	for (let pass = 0; pass < 3; pass++) {
		for (const horizontal of [true, false]) {
			const output = new Float32Array(values.length);
			const length = horizontal ? width : height;
			const lines = horizontal ? height : width;
			for (let line = 0; line < lines; line++) {
				const at = (position: number) =>
					horizontal
						? line * width + wrap(position, length)
						: wrap(position, length) * width + line;
				let sum = 0;
				for (let k = -radius; k <= radius; k++) sum += values[at(k)];
				for (let position = 0; position < length; position++) {
					output[at(position)] = sum / diameter;
					sum +=
						values[at(position + radius + 1)] - values[at(position - radius)];
				}
			}
			values = output;
		}
	}
	return values;
}

const linear = (byte: number): number => {
	const s = byte / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const byte = (value: number): number =>
	Math.round(Math.max(0, Math.min(1, value)) * 255);

/** Derive full-resolution height and tangent-space RGB normals from an sRGB tile: https://github.com/jcfischer/seelite/issues/1232 */
export function deriveMaterialMaps(
	rgb: Uint8Array,
	width: number,
	height: number,
): {
	height: Uint8Array;
	normal: Uint8Array;
} {
	if (
		!Number.isSafeInteger(width) ||
		!Number.isSafeInteger(height) ||
		width < 1 ||
		height < 1 ||
		rgb.length !== width * height * 3
	)
		throw new Error(
			"Expected positive integer dimensions and a complete RGB tile",
		);
	const luma = Float32Array.from(
		{ length: width * height },
		(_, i) =>
			0.2126 * linear(rgb[3 * i]) +
			0.7152 * linear(rgb[3 * i + 1]) +
			0.0722 * linear(rgb[3 * i + 2]),
	);
	const low = blur(luma, width, height, 24);
	const values = blur(
		luma.map((value, i) => value - low[i]),
		width,
		height,
		1,
	);
	const rms = Math.sqrt(
		values.reduce((sum, value) => sum + value * value, 0) / values.length,
	);
	for (let i = 0; i < values.length; i++)
		values[i] = rms > 1e-12 ? values[i] / (3 * rms) : 0;
	const heightMap = Uint8Array.from(values, (value) => byte(0.5 + value / 2));
	const normal = new Uint8Array(width * height * 3);
	const at = (x: number, y: number) =>
		values[wrap(y, height) * width + wrap(x, width)];
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const nx = -2.5 * (at(x + 1, y) - at(x - 1, y));
			const ny = 2.5 * (at(x, y + 1) - at(x, y - 1));
			const length = Math.hypot(nx, ny, 1);
			const offset = (y * width + x) * 3;
			normal[offset] = byte(0.5 + nx / length / 2);
			normal[offset + 1] = byte(0.5 + ny / length / 2);
			normal[offset + 2] = byte(0.5 + 1 / length / 2);
		}
	return { height: heightMap, normal };
}

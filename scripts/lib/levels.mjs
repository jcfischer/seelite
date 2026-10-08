/**
 * Display-luma statistics, not linear-light luminance and not a visual gate.
 * Rec. 709 weights the decoded 8-bit RGB; round to one display code before
 * histogramming. Alpha is ignored: captures are opaque composed frames.
 * Percentiles use nearest rank (ceil(q * N)); tails include codes 250 and 7.
 * Sample (0,0), (stride,0), ... on both axes, without resizing or filtering.
 */
export const LEVELS_STRIDE = 4;

/** @param {{width: number, height: number, data: Uint8Array}} image
 * @param {number} [stride] positive integer pixel stride on each axis
 */
export function levels({ width, height, data }, stride = LEVELS_STRIDE) {
	if (!Number.isSafeInteger(stride) || stride < 1)
		throw new Error("levels: stride must be a positive integer");
	if (
		!Number.isSafeInteger(width) ||
		width < 1 ||
		!Number.isSafeInteger(height) ||
		height < 1 ||
		!(data instanceof Uint8Array) ||
		data.length !== width * height * 4
	)
		throw new Error("levels: expected a nonempty decoded 8-bit RGBA frame");
	const histogram = new Float64Array(256);
	let count = 0,
		sum = 0,
		clipped = 0,
		black = 0;
	for (let y = 0; y < height; y += stride) {
		for (let x = 0; x < width; x += stride) {
			const i = (y * width + x) * 4;
			const code = Math.round(
				0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2],
			);
			histogram[code]++;
			count++;
			sum += code;
			if (code >= 250) clipped++;
			if (code <= 7) black++;
		}
	}
	const percentile = (q) => {
		const rank = Math.ceil(q * count);
		let cumulative = 0;
		for (let code = 0; code < histogram.length; code++) {
			cumulative += histogram[code];
			if (cumulative >= rank) return code;
		}
		throw new Error("levels: invalid histogram");
	};
	return {
		mean: sum / count,
		p1: percentile(0.01),
		p50: percentile(0.5),
		p99: percentile(0.99),
		clip: clipped / count,
		black: black / count,
	};
}

// Measures how alike the two horizontal header bands are, and how strongly each repeats along
// its length, in a game capture (#1143). Normalised cross-correlation on grey, detrended crops.
// Usage: node spikes/miner-cockpit/band-repeat.mjs <capture.png> [x0 x1 upperY0 upperY1 lowerY0 lowerY1]
import sharp from "sharp";

const [file, ...nums] = process.argv.slice(2);
const [x0, x1, u0, u1, l0, l1] = nums.length
	? nums.map(Number)
	: [470, 1480, 42, 72, 92, 128];
const grey = async (top, bottom) => {
	const { data, info } = await sharp(file)
		.extract({ left: x0, top, width: x1 - x0, height: bottom - top })
		.greyscale()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const cols = new Float64Array(info.width);
	for (let x = 0; x < info.width; x++) {
		let s = 0;
		for (let y = 0; y < info.height; y++) s += data[y * info.width + x];
		cols[x] = s / info.height;
	}
	const k = 25;
	return cols.map((_, x) => {
		let s = 0;
		let n = 0;
		for (
			let j = Math.max(0, x - k);
			j <= Math.min(cols.length - 1, x + k);
			j++
		) {
			s += cols[j];
			n++;
		}
		return cols[x] - s / n;
	});
};
const ncc = (a, b) => {
	const n = Math.min(a.length, b.length);
	let ma = 0;
	let mb = 0;
	for (let i = 0; i < n; i++) {
		ma += a[i];
		mb += b[i];
	}
	ma /= n;
	mb /= n;
	let sab = 0;
	let saa = 0;
	let sbb = 0;
	for (let i = 0; i < n; i++) {
		sab += (a[i] - ma) * (b[i] - mb);
		saa += (a[i] - ma) ** 2;
		sbb += (b[i] - mb) ** 2;
	}
	return sab / Math.sqrt(saa * sbb || 1);
};
const selfRepeat = (sig) => {
	let best = { lag: 0, r: -1 };
	for (let lag = 40; lag < sig.length / 2; lag++) {
		const r = ncc(sig.slice(0, sig.length - lag), sig.slice(lag));
		if (r > best.r) best = { lag, r: +r.toFixed(3) };
	}
	return best;
};
const upper = await grey(u0, u1);
const lower = await grey(l0, l1);
let cross = -1;
for (let lag = -150; lag <= 150; lag++) {
	const a = lag >= 0 ? upper.slice(lag) : upper;
	const b = lag >= 0 ? lower : lower.slice(-lag);
	cross = Math.max(cross, ncc(a, b));
}
console.log(
	JSON.stringify({
		file: file.split("/").pop(),
		upperVsLowerBestNcc: +cross.toFixed(3),
		upperSelfRepeat: selfRepeat(upper),
		lowerSelfRepeat: selfRepeat(lower),
	}),
);

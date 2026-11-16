// Wear amount on the header bands of a game capture (#1143): luminance spread and the share of
// chip-bright pixels, per band. Usage: node spikes/miner-cockpit/band-wear.mjs <capture.png>...
import sharp from "sharp";

const bands = { upper: [42, 72], lower: [92, 128] };
for (const file of process.argv.slice(2)) {
	const row = { file: file.split("/").slice(-2).join("/") };
	for (const [name, [top, bottom]] of Object.entries(bands)) {
		const { data } = await sharp(file)
			.extract({ left: 470, top, width: 1010, height: bottom - top })
			.greyscale()
			.raw()
			.toBuffer({ resolveWithObject: true });
		let s = 0;
		for (const v of data) s += v;
		const mean = s / data.length;
		let q = 0;
		for (const v of data) q += (v - mean) ** 2;
		const sd = Math.sqrt(q / data.length);
		let chips = 0;
		for (const v of data) if (v > mean + 2 * sd) chips++;
		row[name] = {
			mean: +mean.toFixed(1),
			sd: +sd.toFixed(1),
			chipShare: +(chips / data.length).toFixed(4),
		};
	}
	console.log(JSON.stringify(row));
}

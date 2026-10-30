// The strut paint texture (#1143) from its generated 4K source. Chips are the small spots darker
// than their surround by more than `edge`; each is lifted toward bare steel at `chipLum`. `contrast`
// then stretches every texel about the image mean. Written at 2048.
// Usage: node spikes/miner-cockpit/strut-texture.mjs <source> <out.png> <chipLum> <contrast> [edge]
import sharp from "sharp";

const [src, out, chipLumArg, contrastArg, edgeArg] = process.argv.slice(2);
const chipLum = Number(chipLumArg);
const contrast = Number(contrastArg);
const edge = Number(edgeArg ?? 12);
const base = sharp(src).removeAlpha().resize(2048, 2048);
const { data, info } = await base
	.clone()
	.raw()
	.toBuffer({ resolveWithObject: true });
const blur = await base.clone().blur(6).raw().toBuffer();
for (let i = 0; i < data.length; i += 3) {
	const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
	const b = (blur[i] + blur[i + 1] + blur[i + 2]) / 3;
	if (b - l > edge) {
		const w = Math.min(1, (b - l - edge) / 12);
		for (let c = 0; c < 3; c++)
			data[i + c] = Math.round(
				data[i + c] * (1 - w) + chipLum * (c === 2 ? 1.04 : 1) * w,
			);
	}
}
let mean = 0;
for (const v of data) mean += v;
mean /= data.length;
for (let i = 0; i < data.length; i++)
	data[i] = Math.max(
		0,
		Math.min(255, Math.round(mean + (data[i] - mean) * contrast)),
	);
await sharp(data, {
	raw: { width: info.width, height: info.height, channels: 3 },
})
	.png()
	.toFile(out);

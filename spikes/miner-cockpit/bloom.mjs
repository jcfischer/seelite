// A screen-space glow over a study render, standing in for the game's bloom pass.
// Usage: node spikes/miner-cockpit/bloom.mjs <in.png> <out.png>
import sharp from "sharp";

const [input, output] = process.argv.slice(2);
const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const bright = Buffer.alloc(data.length);
for (let i = 0; i < data.length; i += 3) {
	const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
	const k = Math.max(0, (l - 170) / 85);
	for (let c = 0; c < 3; c++) bright[i + c] = Math.min(255, data[i + c] * k);
}
const raw = { raw: { width: info.width, height: info.height, channels: 3 } };
const glow = await sharp(bright, raw).blur(14).raw().toBuffer();
const wide = await sharp(bright, raw).blur(40).raw().toBuffer();
const outBuf = Buffer.alloc(data.length);
for (let i = 0; i < data.length; i++) outBuf[i] = Math.min(255, data[i] + glow[i] * 0.55 + wide[i] * 0.35);
await sharp(outBuf, raw).png().toFile(output);

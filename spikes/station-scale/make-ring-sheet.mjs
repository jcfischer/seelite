import sharp from "sharp";
import { resolve } from "node:path";

const out = resolve(process.argv[2] ?? "spikes/station-scale/evidence-ring");
const shots = ["03-face-close", "04-wide", "06-hero", "07-sun-wide", "08-sun-close"];
const width = 1600;
const height = 900;
const header = 60;
const label = 32;
const layers = [];
const text = (value, size, x, y) => `<text x="${x}" y="${y}" fill="white" font-family="sans-serif" font-size="${size}">${value}</text>`;
layers.push({
	input: Buffer.from(`<svg width="3200" height="${header}">${text("Main ec561ec5", 26, 12, 40)}${text("Node 1145: post-split production loader", 26, width + 12, 40)}</svg>`),
	left: 0,
	top: 0,
});
for (const [row, shot] of shots.entries()) {
	const top = header + row * (height + label);
	layers.push({ input: Buffer.from(`<svg width="3200" height="${label}">${text(shot, 22, 12, 24)}${text(shot, 22, width + 12, 24)}</svg>`), left: 0, top });
	for (const [column, arm] of ["before", "after"].entries()) {
		const input = resolve(out, arm, `trade-b-${shot}.png`);
		const meta = await sharp(input).metadata();
		if (meta.width !== width || meta.height !== height) throw Error(`Unexpected capture size: ${input}`);
		layers.push({ input, left: column * width, top: top + label });
	}
}
await sharp({ create: { width: width * 2, height: header + shots.length * (height + label), channels: 3, background: "#10151b" } })
	.composite(layers).png().toFile(resolve(out, "ring-before-after.png"));

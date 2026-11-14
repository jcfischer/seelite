import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { deriveMaterialMaps } from "../scripts/lib/derive-material-maps";

function tile(width: number, height: number) {
	return Uint8Array.from(
		{ length: width * height * 3 },
		(_, i) => (i * 71 + Math.floor(i / 7) * 29) % 256,
	);
}

function reference(rgb: Uint8Array, width: number, height: number) {
	const at = (x: number, y: number) =>
		(((y % height) + height) % height) * width +
		(((x % width) + width) % width);
	const linear = (byte: number) => {
		const s = byte / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const luma = Array.from({ length: width * height }, (_, i) =>
		Math.fround(
			0.2126 * linear(rgb[3 * i]) +
				0.7152 * linear(rgb[3 * i + 1]) +
				0.0722 * linear(rgb[3 * i + 2]),
		),
	);
	const blur = (values: number[], radius: number) => {
		for (let pass = 0; pass < 3; pass++) {
			for (const horizontal of [true, false])
				values = values.map((_, i) => {
					let sum = 0;
					for (let offset = -radius; offset <= radius; offset++)
						sum +=
							values[
								at(
									(i % width) + (horizontal ? offset : 0),
									Math.floor(i / width) + (horizontal ? 0 : offset),
								)
							];
					return Math.fround(sum / (2 * radius + 1));
				});
		}
		return values;
	};
	const low = blur(luma, 24);
	const v = blur(
		luma.map((l, i) => Math.fround(l - low[i])),
		1,
	);
	const rms = Math.sqrt(
		v.reduce((s, value) => s + value * value, 0) / v.length,
	);
	const normalized = v.map((value) => Math.fround(value / (3 * rms)));
	const byte = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
	return {
		height: Uint8Array.from(normalized, (v) => byte(0.5 + v / 2)),
		normal: Uint8Array.from(
			normalized.flatMap((_, i) => {
				const x = i % width;
				const y = Math.floor(i / width);
				const nx = -2.5 * (normalized[at(x + 1, y)] - normalized[at(x - 1, y)]);
				const ny = 2.5 * (normalized[at(x, y + 1)] - normalized[at(x, y - 1)]);
				const length = Math.hypot(nx, ny, 1);
				return [
					byte(0.5 + nx / length / 2),
					byte(0.5 + ny / length / 2),
					byte(0.5 + 1 / length / 2),
				];
			}),
		),
	};
}

test("flat tiles produce a neutral tangent normal and mid-height", () => {
	for (const value of [0, 64, 128, 255]) {
		const result = deriveMaterialMaps(
			new Uint8Array(8 * 6 * 3).fill(value),
			8,
			6,
		);
		expect(result.height).toEqual(new Uint8Array(48).fill(128));
		expect(result.normal).toEqual(
			Uint8Array.from({ length: 144 }, (_, i) => (i % 3 === 2 ? 255 : 128)),
		);
	}
});

test("derivation matches a direct wrapped reference including luma, blur radii and derivative signs", () => {
	const rgb = tile(7, 5);
	expect(deriveMaterialMaps(rgb, 7, 5)).toEqual(reference(rgb, 7, 5));
});

test("repeating the input yields repeated maps, including both opposite-edge neighbourhoods", () => {
	const width = 13,
		height = 11;
	const rgb = tile(width, height);
	const repeated = Uint8Array.from(
		{ length: width * height * 3 * 9 },
		(_, i) => {
			const pixel = Math.floor(i / 3);
			return rgb[
				((Math.floor(pixel / (width * 3)) % height) * width + (pixel % width)) *
					3 +
					(i % 3)
			];
		},
	);
	const one = deriveMaterialMaps(rgb, width, height);
	const nine = deriveMaterialMaps(repeated, width * 3, height * 3);
	for (let y = 0; y < height * 3; y++)
		for (let x = 0; x < width * 3; x++) {
			const a = (y % height) * width + (x % width);
			const b = y * width * 3 + x;
			expect(nine.height[b]).toBe(one.height[a]);
			expect(nine.normal.slice(3 * b, 3 * b + 3)).toEqual(
				one.normal.slice(3 * a, 3 * a + 3),
			);
		}
});

test("invalid dimensions and incomplete RGB buffers are refused", () => {
	for (const [width, height] of [
		[0, 1],
		[1, -1],
		[1.5, 2],
		[NaN, 1],
	])
		expect(() => deriveMaterialMaps(new Uint8Array(), width, height)).toThrow();
	expect(() => deriveMaterialMaps(new Uint8Array(2), 1, 1)).toThrow();
});

test("CLI reproduces the shipped half-size normal and writes only a full-size height into its output directory", async () => {
	const directory = await mkdtemp(join(tmpdir(), "seelite-derive-"));
	try {
		const path = "src/models/courier-steel-wear-normal.webp";
		const before = await Bun.file(path).bytes();
		const child = Bun.spawn(
			["bun", "scripts/derive-material-maps.ts", "--out", directory],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const stdout = await new Response(child.stdout).text();
		const stderr = await new Response(child.stderr).text();
		expect([await child.exited, stderr]).toEqual([0, ""]);
		expect(JSON.parse(stdout).tile).toEqual([1254, 1254]);
		expect(await Bun.file(path).bytes()).toEqual(before);
		const normal = await sharp(path).metadata();
		expect([normal.width, normal.height, normal.format]).toEqual([
			627,
			627,
			"webp",
		]);
		expect(await readdir(directory)).toEqual(["courier-steel-wear-height.png"]);
		const height = await sharp(
			join(directory, "courier-steel-wear-height.png"),
		).metadata();
		expect([height.width, height.height, height.format]).toEqual([
			1254,
			1254,
			"png",
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 30_000);

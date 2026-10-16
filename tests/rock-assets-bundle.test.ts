import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";

test("rock collision data is inline JS, with the GLB a separate hashed bundle asset", async () => {
	const result = await build({
		configFile: false,
		logLevel: "silent",
		build: {
			write: false,
			minify: false,
			rollupOptions: {
				input: resolve("src/rock-assets.ts"),
				preserveEntrySignatures: "strict",
			},
		},
	});
	if (Array.isArray(result) || !("output" in result))
		throw new Error("Expected a single bundle");
	const chunks = result.output.filter((o) => o.type === "chunk");
	const js = chunks.map((c) => c.code).join("\n");
	expect(js).toContain(
		readFileSync("src/models/rock-heightfields.bin").toString("base64"),
	);
	expect(js).not.toMatch(/\bfetch\s*\(/);
	expect(
		result.output.filter((o) => /rock-heightfields.*\.bin$/.test(o.fileName)),
	).toHaveLength(0);
	expect(
		result.output.filter((o) => /asteroids-[\w-]+\.glb$/.test(o.fileName)),
	).toHaveLength(1);
	expect(readFileSync("src/main.ts", "utf8")).toContain(
		"readonly rockAssets = ROCK_ASSETS",
	);
}, 30_000);

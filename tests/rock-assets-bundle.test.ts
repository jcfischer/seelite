import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
	// Execute the actual bundle in a fresh process: module import must not
	// decode anything, and the first access must decode once without fetching.
	const directory = mkdtempSync(join(tmpdir(), "seelite-rock-bundle-"));
	try {
		const modulePath = join(directory, "rock-assets.mjs");
		writeFileSync(modulePath, js);
		const script = `
		import assert from "node:assert/strict";
		const decode = globalThis.atob;
		let calls = 0;
		globalThis.atob = (value) => { calls++; return decode(value); };
		globalThis.fetch = () => { throw new Error("Unexpected fetch"); };
		const { ROCK_ASSETS, getRockHeightfields } = await import(${JSON.stringify(pathToFileURL(modulePath).href)});
		assert.equal(calls, 0, "module import eagerly decoded collision data");
		assert.match(ROCK_ASSETS.glbUrl, /asteroids-[\\w-]+\\.glb$/);
		assert.equal(calls, 0, "reading the model URL decoded collision data");
		const fields = ROCK_ASSETS.heightfields;
		assert.equal(calls, 1);
		assert.strictEqual(ROCK_ASSETS.heightfields, fields);
		assert.strictEqual(getRockHeightfields(), fields);
		assert.equal(calls, 1, "repeated access decoded collision data again");
		assert.equal(fields.fields.length, 16);
		assert.equal(fields.fields[0].r.length, 6 * 64 * 64);
		assert.equal(fields.sourceSha256, "0622d06b78601aae32b7d6f414d0c1eebfb29e2a79a200e370529008f084cd1c");
		console.log("lazy bundle access passed");
	`;
		const execution = Bun.spawnSync(["node", "--input-type=module"], {
			stdin: Buffer.from(script),
		});
		expect(execution.stderr.toString()).toBe("");
		expect(execution.exitCode).toBe(0);
		expect(execution.stdout.toString()).toContain("lazy bundle access passed");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}, 30_000);

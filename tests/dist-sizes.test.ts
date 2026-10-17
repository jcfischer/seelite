/**
 * The built site's per-asset limit (`scripts/check-dist-sizes.mjs`).
 *
 * Sparse files stand in for real assets: `truncateSync` sets a size without
 * writing 25 MiB of bytes.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	truncateSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	MAX_ASSET_BYTES,
	oversizedFiles,
} from "../scripts/check-dist-sizes.mjs";

const site = (sizes: Record<string, number>) => {
	const dir = mkdtempSync(join(tmpdir(), "dist-sizes-"));
	for (const [file, bytes] of Object.entries(sizes)) {
		const path = join(dir, file);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, "");
		truncateSync(path, bytes);
	}
	return dir;
};

describe("the built site's per-asset limit", () => {
	test("is Cloudflare Pages' 25 MiB", () => {
		expect(MAX_ASSET_BYTES).toBe(26_214_400);
	});

	test("passes a file at the limit and names a nested one over it", () => {
		const dir = site({
			"index.html": 100,
			"assets/at-limit.glb": MAX_ASSET_BYTES,
			"models/station-interiors.glb": MAX_ASSET_BYTES + 1,
		});
		try {
			expect(oversizedFiles(dir)).toEqual([
				{ file: "models/station-interiors.glb", bytes: MAX_ASSET_BYTES + 1 },
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("the command exits non-zero on an oversized file and zero without one", () => {
		const bad = site({ "big.bin": MAX_ASSET_BYTES + 1 });
		const good = site({ "small.bin": 10 });
		try {
			const run = (dir: string) =>
				spawnSync("node", ["scripts/check-dist-sizes.mjs", dir], {
					encoding: "utf8",
				});
			const red = run(bad);
			expect(red.status).toBe(1);
			expect(red.stderr).toContain("big.bin");
			expect(run(good).status).toBe(0);
		} finally {
			rmSync(bad, { recursive: true, force: true });
			rmSync(good, { recursive: true, force: true });
		}
	});

	test("npm run build runs it", async () => {
		const pkg = await Bun.file("package.json").json();
		expect(pkg.scripts.build).toEndWith("node scripts/check-dist-sizes.mjs");
	});
});

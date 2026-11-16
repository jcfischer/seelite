import { expect, test } from "bun:test";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Assembly preparation passes a decoded script path to Blender", async () => {
	const directory = await mkdtemp(join(tmpdir(), "assembly kit Zürich "));
	try {
		await copyFile(
			new URL("../spikes/stations/assembly-kit/prepare.ts", import.meta.url),
			join(directory, "prepare.ts"),
		);
		await writeFile(join(directory, "build_kit.py"), "");
		const blender = join(directory, "blender");
		await writeFile(
			blender,
			'#!/bin/sh\nfor argument do script="$argument"; done\nif test -f "$script"; then echo "SCRIPT_FOUND"; else echo "SCRIPT_MISSING:$script"; fi\nexit 1\n',
			{ mode: 0o755 },
		);
		const result = Bun.spawnSync(
			[process.execPath, join(directory, "prepare.ts")],
			{
				env: { ...process.env, BLENDER: blender },
			},
		);
		expect(result.stdout.toString()).toContain("SCRIPT_FOUND");
		expect(result.stderr.toString()).toContain("Blender exited 1");
		expect(result.exitCode).toBe(1);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

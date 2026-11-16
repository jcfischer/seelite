import { expect, test } from "bun:test";

test("an interrupted trade fit disposes its station and can be run again", () => {
	const result = Bun.spawnSync(
		[process.execPath, "tests/fixtures/trade-fitter-failure.ts"],
		{ cwd: process.cwd(), timeout: 30000 },
	);
	expect(result.stderr.toString()).toBe("");
	expect(result.exitCode).toBe(0);
});

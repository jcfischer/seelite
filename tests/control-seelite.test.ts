import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(".claude/skills/verify-seelite/control-seelite.mjs");
const run = (...args: string[]) =>
	spawnSync(process.execPath, [cli, ...args], {
		encoding: "utf8",
		env: { ...process.env, CONTROL_SEELITE_ORIGIN: "http://127.0.0.1:1" },
	});

describe("control-seelite CLI", () => {
	test("doctor reports server, Playwright and renderer status as JSON", () => {
		const result = run("doctor");
		expect(result.status).toBe(1);
		const report = JSON.parse(result.stdout);
		expect(report.ok).toBe(false);
		expect(report.checks.server.ok).toBe(false);
		expect(report.checks).toHaveProperty("playwright");
		expect(report.checks).toHaveProperty("renderer");
	});

	test("probe uses the existing single-probe runner", () => {
		const result = run("probe", "boot", "--dry-run");
		expect(result.status).toBe(0);
		const plan = JSON.parse(result.stdout);
		expect(plan.command).toEqual([
			"npm",
			"run",
			"probe:one",
			"--",
			"probe-boot.mjs",
		]);
	});

	test("unknown names give suggestions and invalid camera names are refused", () => {
		const result = run("measure", "aperture-fi", "--dry-run");
		expect(result.status).toBe(1);
		expect(JSON.parse(result.stdout).error).toContain("aperture-fit");
		expect(run("goto", "made-up", "--dry-run").status).toBe(1);
	});

	test("measure passes literal arguments, output and exit status through", async () => {
		const { dispatchPlan, executePlan } = await import(
			"../.claude/skills/verify-seelite/dispatch.mjs"
		);
		const root = mkdtempSync(join(tmpdir(), "seelite-dispatch-"));
		try {
			mkdirSync(join(root, "scripts"));
			writeFileSync(
				join(root, "scripts/measure-fixture.mjs"),
				'process.stdout.write(JSON.stringify(process.argv.slice(2))); process.stderr.write("fixture stderr"); process.exitCode = 7;',
			);
			const plan = dispatchPlan(root, "measure", "fixture", [
				"a b",
				"$(false)",
			]);
			const result = spawnSync(plan.command[0], plan.command.slice(1), {
				cwd: root,
				encoding: "utf8",
			});
			expect(result.status).toBe(7);
			expect(result.stdout).toBe('["a b","$(false)"]');
			expect(result.stderr).toBe("fixture stderr");
			expect(await executePlan(plan, { stdio: "ignore" })).toBe(7);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

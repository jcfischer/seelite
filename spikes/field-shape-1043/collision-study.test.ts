import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

function run(candidate: string, mode = "adapted", drop = false) {
	return spawnSync(
		process.execPath,
		[
			"run",
			"spikes/field-shape-1043/collision-worker.ts",
			candidate,
			mode,
			"verify",
			...(drop ? ["drop"] : []),
		],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
	);
}

test("baseline input adapter reproduces the unmodified production query", () => {
	const native = run("baseline", "native");
	const adapted = run("baseline");
	expect(native.status).toBe(0);
	expect(adapted.status).toBe(0);
	const a = JSON.parse(native.stdout);
	const b = JSON.parse(adapted.stdout);
	expect(b.verification).toEqual(a.verification);
	expect(b.querySource).toEqual(a.querySource);
}, 60_000);

test("all candidate queries agree with a complete all-rock traversal", () => {
	let common: unknown;
	for (const candidate of ["baseline", "expanded", "clusters", "broken"]) {
		const result = run(candidate);
		expect(result.status).toBe(0);
		const data = JSON.parse(result.stdout);
		const current = data.verification.fixtures.map(
			(f: { queries: { name: string; group: string; ship: unknown }[] }) =>
				f.queries
					.filter((q) => q.group === "common")
					.map((q) => ({ name: q.name, ship: q.ship })),
		);
		if (candidate === "baseline") common = current;
		else expect(current).toEqual(common);
		expect(
			data.verification.fixtures.map((f: { kind: string }) => f.kind),
		).toEqual(["charted", "rare"]);
		for (const fixture of data.verification.fixtures) {
			expect(fixture.rocks).toBeGreaterThan(0);
			expect(
				fixture.queries.some(
					(q: { group: string; count: number }) =>
						q.group === "common" && q.count > 0,
				),
			).toBe(true);
			expect(
				fixture.queries.find((q: { name: string }) => q.name === "occupied")
					.count,
			).toBeGreaterThan(0);
			expect(
				fixture.queries.find((q: { name: string }) => q.name === "far").count,
			).toBe(0);
			expect(
				fixture.queries.find(
					(q: { name: string }) => q.name === "enclosing-stress",
				).count,
			).toBe(fixture.rocks);
		}
	}
}, 120_000);

test("the all-rock oracle refuses a silently omitted candidate before timing", () => {
	const result = run("broken", "adapted", true);
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("oracle mismatch");
	expect(result.stdout).toBe("");
}, 60_000);

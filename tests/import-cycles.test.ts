import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	cycleMembers,
	firstImportTdz,
	importGraph,
} from "./helpers/import-cycles";

const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "src");

describe("first import alone (node #1114)", () => {
	test("the scan sees value imports and drops type-only ones", () => {
		const graph = importGraph(SRC);
		expect(graph.get(join(SRC, "world-state.ts"))).toContain(
			join(SRC, "loadout.ts"),
		);
		expect(graph.get(join(SRC, "units.ts"))).toEqual([]);
		expect(graph.get(join(SRC, "vec3.ts"))).toEqual([]);
	});

	test("a cycle read at evaluation is found, and each member throws a TDZ when it loads first", async () => {
		const dir = mkdtempSync(join(tmpdir(), "seelite-cycle-"));
		try {
			writeFileSync(
				join(dir, "a.ts"),
				'import { B } from "./b";\nexport const A = 1;\nexport const viaB = B;\n',
			);
			writeFileSync(
				join(dir, "b.ts"),
				'import { A } from "./a";\nexport const B = A + 1;\n',
			);
			writeFileSync(
				join(dir, "c.ts"),
				'import { A } from "./a";\nexport const C = A;\n',
			);
			const members = cycleMembers(importGraph(dir));
			expect(members).toEqual([join(dir, "a.ts"), join(dir, "b.ts")]);
			const tdz = await firstImportTdz(members, dir);
			expect(tdz.map((t) => t.module).sort()).toEqual(["a.ts", "b.ts"]);
			expect(tdz.find((t) => t.module === "a.ts")?.error).toContain(
				"Cannot access 'A' before initialization",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("an import that does not finish is reported, not passed", async () => {
		const dir = mkdtempSync(join(tmpdir(), "seelite-hang-"));
		try {
			writeFileSync(join(dir, "hang.ts"), "setInterval(() => {}, 1000);\n");
			expect(
				await firstImportTdz(["hang.ts"], dir, { timeoutMs: 1_000 }),
			).toEqual([{ module: "hang.ts", error: "timeout" }]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("every src module on an import cycle loads first and alone without a TDZ error", async () => {
		const members = cycleMembers(importGraph(SRC));
		expect(await firstImportTdz(members, ROOT)).toEqual([]);
	}, 120_000);
});

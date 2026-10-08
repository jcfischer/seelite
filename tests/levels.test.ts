import { describe, expect, test } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	mkdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error pngjs ships no declarations; it is the existing PNG dependency.
import { PNG } from "pngjs";
import { levels } from "../scripts/lib/levels.mjs";
import { writeRunLevels } from "../scripts/lib/levels-report.mjs";
import { contactSheet, VIEWS } from "../scripts/lib/view-set.mjs";

const frame = (codes: number[]) => ({
	width: codes.length,
	height: 1,
	data: Uint8Array.from(codes.flatMap((v) => [v, v, v, 255])),
});

describe("display luma levels", () => {
	test("known histogram pins every column and inclusive tail boundaries", () => {
		const codes = [0, 7, 8, ...Array(95).fill(100), 250, 255];
		expect(levels(frame(codes), 1)).toEqual({
			mean: 100.2,
			p1: 0,
			p50: 100,
			p99: 250,
			clip: 0.02,
			black: 0.02,
		});
	});
	test("Rec. 709 is applied to display RGB, rounded without linearising", () => {
		const image = {
			width: 3,
			height: 1,
			data: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0]),
		};
		expect(levels(image, 1)).toEqual({
			mean: 254 / 3,
			p1: 18,
			p50: 54,
			p99: 182,
			clip: 0,
			black: 0,
		});
	});
	test("stride samples both axes, including partial last strides", () => {
		const image = frame([
			10, 255, 20, 255, 30, 255, 255, 255, 255, 255, 40, 255, 50, 255, 60,
		]);
		image.width = 5;
		image.height = 3;
		expect(levels(image, 2)).toEqual({
			mean: 35,
			p1: 10,
			p50: 30,
			p99: 60,
			clip: 0,
			black: 0,
		});
	});
	test("empty or malformed frames and invalid strides refuse", () => {
		for (const stride of [0, -1, 1.5, NaN])
			expect(() => levels(frame([100]), stride)).toThrow();
		expect(() => levels(frame([]), 1)).toThrow();
		expect(() =>
			levels({ width: 2, height: 1, data: new Uint8Array(4) }, 1),
		).toThrow();
	});
});

const cli = join(import.meta.dir, "../scripts/levels-view-set.mjs");
const fixture = (root: string, label: string, code: number) => {
	mkdirSync(join(root, label));
	const png = PNG.sync.write({
		...frame([code]),
		data: Buffer.from(frame([code]).data),
	});
	const run = {
		label,
		gitRef: "fixture",
		renderer: "fixture",
		seed: 47,
		capturedAt: "2026-10-08T00:00:00Z",
		levelsFile: `${label}/levels.txt`,
		views: VIEWS.map((v) => ({ name: v.name, file: `${label}/${v.name}.png` })),
	};
	for (const v of run.views) writeFileSync(join(root, v.file), png);
	writeFileSync(join(root, label, "manifest.json"), JSON.stringify(run));
	return run;
};

test("CLI writes both complete tables and signed deltas", () => {
	const root = mkdtempSync(join(tmpdir(), "seelite-levels-"));
	try {
		const before = fixture(root, "before", 7);
		fixture(root, "after", 250);
		const result = spawnSync("node", [cli, "--out", root, "before", "after"], {
			encoding: "utf8",
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Δp99");
		expect(result.stdout).toContain("+243.00");
		expect(result.stdout).toContain("+100.00");
		expect(result.stdout).toContain("-100.00");
		for (const label of ["before", "after"]) {
			const report = readFileSync(join(root, label, "levels.txt"), "utf8");
			expect(result.stdout).toContain(report.trim());
			expect(report).toContain("average");
			for (const v of VIEWS) expect(report).toContain(v.name);
		}
		expect(contactSheet([before])).toContain('href="before/levels.txt"');
		expect(contactSheet([{ ...before, levelsFile: undefined }])).not.toContain(
			'href="before/levels.txt"',
		);
		const single = spawnSync("node", [cli, "--out", root, "before"], {
			encoding: "utf8",
		});
		expect(single.status).toBe(0);
		expect(single.stdout).not.toContain("Δp99");
		expect(single.stdout).toMatch(
			/average\s+7\.00\s+7\.00\s+7\.00\s+7\.00\s+0\.00\s+100\.00/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("average weights views equally rather than pooling unequal frame sizes", async () => {
	const root = mkdtempSync(join(tmpdir(), "seelite-levels-"));
	try {
		const run = fixture(root, "mixed", 0);
		const large = frame(Array(32).fill(250));
		writeFileSync(
			join(root, run.views[0].file),
			PNG.sync.write({
				...large,
				data: Buffer.from(large.data),
			}),
		);
		const report = await writeRunLevels(run, root);
		expect(report.average.mean).toBe(250 / VIEWS.length);
		expect(report.average.p99).toBe(250 / VIEWS.length);
		expect(report.average.clip).toBe(1 / VIEWS.length);
		expect(report.average.black).toBe((VIEWS.length - 1) / VIEWS.length);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("missing PNG or manifest view refuses and removes stale levels", async () => {
	const root = mkdtempSync(join(tmpdir(), "seelite-levels-"));
	try {
		const run = fixture(root, "broken", 100);
		await writeRunLevels(run, root);
		rmSync(join(root, run.views[0].file));
		const result = spawnSync("node", [cli, "--out", root, "broken"], {
			encoding: "utf8",
		});
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain(run.views[0].name);
		expect(() => readFileSync(join(root, "broken/levels.txt"))).toThrow();
		await expect(
			writeRunLevels({ ...run, views: run.views.slice(1) }, root),
		).rejects.toThrow("missing");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("corrupt PNG and duplicate or extra views fail without a report", async () => {
	const root = mkdtempSync(join(tmpdir(), "seelite-levels-"));
	try {
		const run = fixture(root, "invalid", 100);
		await expect(
			writeRunLevels({ ...run, views: [...run.views, run.views[0]] }, root),
		).rejects.toThrow("duplicate");
		await expect(
			writeRunLevels(
				{ ...run, views: [...run.views, { name: "extra", file: "extra.png" }] },
				root,
			),
		).rejects.toThrow("extra");
		writeFileSync(join(root, run.views[0].file), "not a PNG");
		await expect(writeRunLevels(run, root)).rejects.toThrow(run.views[0].name);
		expect(() => readFileSync(join(root, "invalid/levels.txt"))).toThrow();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("CLI refuses missing or flag-shaped --out values before reading a run", () => {
	for (const suffix of [[], ["--out"], ["-x"]]) {
		const result = spawnSync("node", [cli, "before", "--out", ...suffix], {
			encoding: "utf8",
		});
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("--out requires a directory");
	}
});

test("sheet refuses duplicate views as the tone report does", () => {
	const run = {
		label: "duplicate",
		gitRef: "fixture",
		renderer: "fixture",
		seed: 47,
		capturedAt: "2026-10-08T00:00:00Z",
		views: VIEWS.map((v) => ({
			name: v.name,
			file: `duplicate/${v.name}.png`,
		})),
	};
	expect(() =>
		contactSheet([{ ...run, views: [...run.views, run.views[0]] }]),
	).toThrow("duplicate");
});

test("capture source wires sheet invalidation, table, manifest, then sheet rebuild", () => {
	const capture = readFileSync(
		join(import.meta.dir, "../scripts/capture-views.mjs"),
		"utf8",
	);
	const publication = capture.slice(capture.indexOf("const manifest = {"));
	const tableAt = publication.indexOf("await writeRunLevels(manifest, OUT)");
	const invalidationAt = publication.indexOf(
		'await rm(join(OUT, "index.html"), { force: true })',
	);
	const manifestAt = publication.indexOf('join(dir, "manifest.json")');
	const sheetAt = publication.indexOf("await rebuildSheet(OUT)");
	expect(invalidationAt).toBeGreaterThan(0);
	expect(tableAt).toBeGreaterThan(0);
	expect(manifestAt).toBeGreaterThan(0);
	expect(sheetAt).toBeGreaterThan(0);
	expect(invalidationAt).toBeLessThan(tableAt);
	expect(tableAt).toBeLessThan(manifestAt);
	expect(manifestAt).toBeLessThan(sheetAt);
	const rebuild = capture.slice(
		capture.indexOf("async function rebuildSheet(out)"),
		capture.indexOf("async function rebuildSheet(out)") + 1000,
	);
	const rebuildInvalidation = rebuild.indexOf(
		'await rm(join(out, "index.html"), { force: true })',
	);
	const rebuildWrite = rebuild.indexOf(
		'await writeFile(join(out, "index.html"), contactSheet(runs))',
	);
	expect(rebuildInvalidation).toBeGreaterThan(0);
	expect(rebuildWrite).toBeGreaterThan(rebuildInvalidation);
});

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..", "src");
const ROOT = join(import.meta.dir, "..");

const sources = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sources(path);
		return /\.(ts|css|html)$/.test(name) ? [path] : [];
	});

const SYSTEM_UI_MONO = /ui-monospace|SFMono-Regular|["']SF Mono["']/g;

describe("monospace family stacks (#1178)", () => {
	test("no source names a system-UI monospace family, whose resolution changes within a session", () => {
		const hits = sources(SRC).flatMap((file) =>
			[...readFileSync(file, "utf8").matchAll(SYSTEM_UI_MONO)].map(
				(m) => `${relative(ROOT, file)}: ${m[0]}`,
			),
		);
		expect(hits).toEqual([]);
	});

	test("every stack that names Menlo puts it first and ends in Consolas or the generic family", () => {
		const bad = sources(SRC).flatMap((file) =>
			[
				...readFileSync(file, "utf8").matchAll(
					/([\w"'-]+\s*,\s*)?Menlo((?:\s*,\s*[\w-]+)*)/g,
				),
			]
				.filter(
					([, before, after]) =>
						before !== undefined ||
						![", monospace", ", Consolas, monospace"].includes(
							after.replace(/\s+/g, " "),
						),
				)
				.map(
					([stack]) => `${relative(ROOT, file)}: ${stack.replace(/\s+/g, " ")}`,
				),
		);
		expect(bad).toEqual([]);
	});
});

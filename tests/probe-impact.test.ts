import { describe, expect, test } from "bun:test";
import {
	affectedProbes,
	changedMethods,
	dependencyClosure,
} from "../scripts/lib/probe-impact.mjs";
import { selectImpact } from "../scripts/lib/probe-impact.mjs";
import {
	PROBE_ROOTS,
	SMOKE_PROBES,
} from "../scripts/lib/probe-contract-roots.mjs";
import { discoverProbeFiles } from "../scripts/lib/probe-inventory.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const sources = new Map<string, string>();
function readSources(dir: string) {
	for (const entry of readdirSync(resolve(root, dir), {
		withFileTypes: true,
	})) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) readSources(path);
		else if (/\.(ts|js|mjs|css|json)$/.test(path))
			sources.set(path, readFileSync(resolve(root, path), "utf8"));
	}
}
readSources("src");
readSources("scripts");
const inventory = discoverProbeFiles(resolve(root, "scripts"));
const impact = (paths: string[], before = sources, after = sources) =>
	selectImpact(paths, { before, after }, inventory);

describe("production contract ownership", () => {
	test("owns every runner probe and roots exist", () => {
		expect(Object.keys(PROBE_ROOTS).sort()).toEqual(inventory);
		for (const roots of Object.values(PROBE_ROOTS))
			for (const path of roots) expect(sources.has(path)).toBe(true);
	});
	test("equipment display excludes music and cinematics but keeps its consumers and smoke", () => {
		const selected = impact(["src/outfitting-view.ts"]).probes!;
		for (const probe of [
			...SMOKE_PROBES,
			"probe-outfitting.mjs",
			"probe-station-console.mjs",
		])
			expect(selected).toContain(probe);
		expect(selected).not.toContain("probe-music.mjs");
		expect(selected).not.toContain("probe-opening-cinematic.mjs");
	});
	test("camera and synth changes select their expensive contracts", () => {
		expect(impact(["src/opening-camera.ts"]).probes).toContain(
			"probe-opening-cinematic.mjs",
		);
		const music = impact(["src/music-worklet.ts"]).probes!;
		expect(music).toContain("probe-music.mjs");
		expect(music).toContain("probe-music-game.mjs");
	});
	test("new ownerless sources and catalog drift expand coverage", () => {
		expect(impact(["src/unknown.ts"]).probes).toBeUndefined();
		expect(
			selectImpact(["src/outfitting.ts"], { before: sources, after: sources }, [
				...inventory,
				"probe-new.mjs",
			]).probes,
		).toBeUndefined();
	});
	test("mapped main projection narrows; new collaborators and unowned methods expand", () => {
		const before = new Map(sources);
		before.set(
			"src/main.ts",
			"class Game { navRows() { return 1; } update() { return 1; } }",
		);
		const after = new Map(before);
		after.set(
			"src/main.ts",
			before
				.get("src/main.ts")!
				.replace("navRows() { return 1", "navRows() { return 2"),
		);
		expect(impact(["src/main.ts"], before, after).probes).toContain(
			"probe-navigation-console.mjs",
		);
		expect(impact(["src/main.ts"], before, after).probes).not.toContain(
			"probe-music.mjs",
		);
		after.set(
			"src/main.ts",
			"class Game { navRows() { this.saveFlush(); return 1; } update() { return 1; } }",
		);
		expect(impact(["src/main.ts"], before, after).probes).toBeUndefined();
		after.set(
			"src/main.ts",
			before
				.get("src/main.ts")!
				.replace("update() { return 1", "update() { return 2"),
		);
		expect(impact(["src/main.ts"], before, after).probes).toBeUndefined();
	});
});

describe("deterministic browser impact", () => {
	test("follows static, dynamic and worklet URL imports transitively", () => {
		const sources = new Map([
			[
				"src/root.ts",
				'import {x} from "./a"; import("./b"); new URL("./worker.ts", import.meta.url);',
			],
			["src/a.ts", 'export {x} from "./leaf";'],
			["src/b.ts", ""],
			["src/worker.ts", ""],
			["src/leaf.ts", ""],
		]);
		expect([...dependencyClosure(["src/root.ts"], sources)].sort()).toEqual(
			[...sources.keys()].sort(),
		);
	});
	test("a changed helper reaches its owner, not an unrelated synth", () => {
		const sources = new Map([
			["src/panel.ts", 'import "./text";'],
			["src/text.ts", ""],
			["src/music.ts", ""],
		]);
		const contracts = { panel: ["src/panel.ts"], music: ["src/music.ts"] };
		expect(
			affectedProbes(["src/text.ts"], sources, sources, contracts),
		).toEqual(["panel"]);
	});
	test("removed imports retain base-side coverage", () => {
		const before = new Map([
			["src/panel.ts", 'import "./text";'],
			["src/text.ts", ""],
		]);
		const after = new Map([["src/panel.ts", ""]]);
		expect(
			affectedProbes(["src/text.ts"], before, after, {
				panel: ["src/panel.ts"],
			}),
		).toEqual(["panel"]);
	});
	test("unknown source impact refuses exclusion", () => {
		expect(
			affectedProbes(["src/new.ts"], new Map(), new Map(), {
				panel: ["src/panel.ts"],
			}),
		).toBeNull();
	});
	test("compares complete method bodies, and refuses changes outside methods", () => {
		const before =
			"class Game { panel() { return 1; } update() { this.panel(); } }";
		expect(
			changedMethods(before, before.replace("return 1", "return 2")),
		).toEqual(["panel"]);
		expect(changedMethods(before, 'import "./new"; ' + before)).toBeNull();
		expect(
			changedMethods(before, before.replace("panel()", "other()")),
		).toBeNull();
	});
});

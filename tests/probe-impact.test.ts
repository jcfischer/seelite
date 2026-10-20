import { describe, expect, test } from "bun:test";
import {
	affectedProbes,
	changedMethods,
	dependencyClosure,
} from "../scripts/lib/probe-impact.mjs";
import { selectImpact, methodCallers } from "../scripts/lib/probe-impact.mjs";
import { selectProbes } from "../scripts/lib/probe-selection.mjs";
import {
	PROBE_ROOTS,
	SMOKE_PROBES,
	MAIN_METHOD_CALLERS,
	contractRoots,
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
	test("new probe contracts inherit game dependencies unless reviewed standalone", () => {
		const roots = contractRoots("probe-new-game-contract.mjs", [
			"src/new-feature.ts",
		]);
		expect(roots).toContain("src/new-feature.ts");
		expect(roots).toContain("src/boot-system.ts");
		expect(roots).toContain("src/sim.ts");
		for (const probe of ["probe-music.mjs", "probe-public-site.mjs"])
			expect(contractRoots(probe, [])).not.toContain("src/boot-system.ts");
	});
	test("feature fixtures use dependencies, while shared runner edits expand", async () => {
		const result = await selectProbes({
			changedFiles: ["scripts/lib/opening-probe.mjs"],
			impact: { before: sources, after: sources },
		});
		expect(result.mode).toBe("affected");
		expect(result.probes).toContain("probe-opening.mjs");
		expect(result.probes).toContain("probe-opening-cinematic.mjs");
		expect(result.probes).not.toContain("probe-music.mjs");
		const harness = await selectProbes({
			changedFiles: ["scripts/lib/probe-lock.mjs"],
			impact: { before: sources, after: sources },
		});
		expect(harness.mode).toBe("all");
	});
	test("reviewed method callers match the production orchestrator", () => {
		for (const [method, callers] of Object.entries(MAIN_METHOD_CALLERS))
			expect(methodCallers(sources.get("src/main.ts"), method)).toEqual(
				callers,
			);
	});
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
	test("a comment burn-down slice selects its file's contracts, not the suite", () => {
		const slice = impact([
			"src/market.ts",
			"eslint-suppressions.json",
			"tests/market.test.ts",
		]).probes!;
		expect(slice).toEqual(impact(["src/market.ts"]).probes!);
		expect(slice).toContain("probe-market-shelf.mjs");
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
	test("a measurement script no probe loads selects smoke, not the suite", () => {
		// The retro on 2026-10-11: a `scripts/measure-*.ts` edit sent #866 to
		// all probes, 2163 s, though no probe can load the file.
		const instrument = impact(["scripts/measure-ladder-rates.ts"]);
		expect(instrument.probes).toEqual([...SMOKE_PROBES].sort());
		expect(instrument.reason).toContain("measurement script");
		// A new instrument is just as unreachable, on the head side only.
		const after = new Map(sources);
		after.set("scripts/measure-new-thing.mjs", "export const x = 1;");
		expect(
			impact(["scripts/measure-new-thing.mjs"], sources, after).probes,
		).toEqual([...SMOKE_PROBES].sort());
		// One a probe imports keeps that probe's ownership.
		const reached = new Map(sources);
		const owner = Object.keys(PROBE_ROOTS).find(
			(p) => p !== "probe-boot.mjs" && !SMOKE_PROBES.includes(p),
		)!;
		reached.set(
			`scripts/${owner}`,
			`import "./measure-ladder-rates.ts";\n${sources.get(`scripts/${owner}`)}`,
		);
		expect(
			impact(["scripts/measure-ladder-rates.ts"], sources, reached).probes,
		).toContain(owner);
		// The name alone does not exempt a source file.
		expect(impact(["src/measure-unknown.ts"]).probes).toBeUndefined();
	});
	test("a new probe's catalog and roots entries select that probe and smoke", async () => {
		// The retro on 2026-10-11: registering one new probe sent #865 to all
		// probes, because both registries live under scripts/lib/probe-*.
		const CATALOG = "scripts/lib/probe-catalog.mjs";
		const ROOTS = "scripts/lib/probe-contract-roots.mjs";
		const PROBE = "scripts/probe-witchspace.mjs";
		const before = new Map(sources);
		const catalog = sources.get(CATALOG)!;
		const start = catalog.indexOf('\t\tentry(\n\t\t\t"probe-witchspace.mjs"');
		const end = catalog.indexOf("\t\t),\n", start) + "\t\t),\n".length;
		before.set(CATALOG, catalog.slice(0, start) + catalog.slice(end));
		const roots = sources.get(ROOTS)!;
		const line = roots.match(/\t"probe-witchspace\.mjs": .*\n/)![0];
		before.set(ROOTS, roots.replace(line, ""));
		before.delete(PROBE);
		const select = (after: Map<string, string>, files = [CATALOG, ROOTS]) =>
			selectProbes({
				changedFiles: [...files, PROBE],
				impact: { before, after },
			});
		const added = await select(sources);
		expect(added.mode).toBe("exact");
		expect(added.probes).toEqual(
			[...SMOKE_PROBES, "probe-witchspace.mjs"].sort(),
		);
		expect(added.reason).toContain("probe-witchspace.mjs");
		// Its own sources still route through the new contract's roots.
		const withSource = await select(sources, [
			CATALOG,
			ROOTS,
			"src/witchspace.ts",
		]);
		expect(withSource.mode).toBe("affected");
		expect(withSource.probes).toContain("probe-witchspace.mjs");
		// Anything but a pure addition is still the harness.
		const edited = new Map(sources);
		edited.set(
			CATALOG,
			catalog.replace(
				"the live station-witness legal loop",
				"the station-witness legal loop",
			),
		);
		expect((await select(edited)).mode).toBe("all");
		const smoke = new Map(sources);
		smoke.set(ROOTS, roots.replace('"probe-live-cockpit.mjs",', ""));
		expect((await select(smoke)).mode).toBe("all");
		const removed = await selectProbes({
			changedFiles: [CATALOG, ROOTS],
			impact: { before: sources, after: before },
		});
		expect(removed.mode).toBe("all");
	});
	test("quarantining or lifting a red selects that probe and smoke", async () => {
		// F13 of the 2026-10-11 retro: the list lived in the runner, so recording
		// a red there sent the PR to all probes.
		const FILE = "scripts/lib/probe-quarantine.mjs";
		const text = sources.get(FILE)!;
		const quarantined = new Map(sources);
		quarantined.set(
			FILE,
			text.replace(
				"new Map([\n",
				'new Map([\n\t["probe-witchspace.mjs", "#1 the rift lens"],\n',
			),
		);
		const select = (before: Map<string, string>, after: Map<string, string>) =>
			selectProbes({ changedFiles: [FILE], impact: { before, after } });
		const add = await select(sources, quarantined);
		expect(add.mode).toBe("exact");
		expect(add.probes).toEqual(
			[...SMOKE_PROBES, "probe-witchspace.mjs"].sort(),
		);
		const lift = await select(quarantined, sources);
		expect(lift.probes).toEqual(add.probes);
		const reworded = new Map(sources);
		reworded.set(
			FILE,
			quarantined.get(FILE)!.replace("the rift lens", "the arrival lens"),
		);
		expect((await select(quarantined, reworded)).probes).toEqual(add.probes);
		// A probe the runner does not know, or a line outside the list, is harness.
		const unknown = new Map(sources);
		unknown.set(
			FILE,
			text.replace("new Map([\n", 'new Map([\n\t["probe-nope.mjs", "#1"],\n'),
		);
		expect((await select(sources, unknown)).mode).toBe("all");
		const outside = new Map(sources);
		outside.set(FILE, `${quarantined.get(FILE)}\nexport const X = 1;\n`);
		expect((await select(sources, outside)).mode).toBe("all");
	});
	test("mapped main projection narrows; new collaborators and unowned methods expand", () => {
		const before = new Map(sources);
		before.set(
			"src/main.ts",
			"class Game { updateCockpit() { return this.navRows(); } navRows() { return 1; } update() { return 1; } }",
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
		const drifted = new Map(before);
		drifted.set(
			"src/main.ts",
			before
				.get("src/main.ts")!
				.replace(
					"class Game {",
					"class Game { audit() { return this.navRows(); }",
				),
		);
		const driftedAfter = new Map(drifted);
		driftedAfter.set(
			"src/main.ts",
			drifted
				.get("src/main.ts")!
				.replace("navRows() { return 1", "navRows() { return 2"),
		);
		expect(
			impact(["src/main.ts"], drifted, driftedAfter).probes,
		).toBeUndefined();
		after.set(
			"src/main.ts",
			"class Game { updateCockpit() { return this.navRows(); } navRows() { this.saveFlush(); return 1; } update() { return 1; } }",
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

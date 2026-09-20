/**
 * The two static gates over `scripts/`, held by a test of their own (#402), and
 * the row holding that the pull-request gate runs one of them (#403).
 *
 * Neither gate runs in CI's browser tier, because there is none (#14). What
 * each does run is a process, so each is asserted by its **exit code** and by
 * a case built to make it fail: a gate only ever seen green is a gate nobody
 * has shown can fail.
 */
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	HARDWARE_RENDERER,
	PLAYWRIGHT_ENV_VARS,
	PROBE_RENDERER_ENV,
} from "../scripts/probe-guard.mjs";
import { probeRunnerEnvironment } from "../scripts/lib/probe-runner-env.mjs";
import { repoPath } from "./lib/source-scan";

const BIOME = repoPath("node_modules/.bin/biome");

/**
 * Lint one file placed at `path` in a scratch tree that carries a copy of the
 * repo's `biome.jsonc`, so the config's path-scoped rule applies to a file that
 * exists only for this run. It has to be a real file: `--stdin-file-path` never
 * evaluates this rule at all — it answers "the contents aren't fixed" for clean
 * and offending input alike — so a test through it would pass or fail for a
 * reason unrelated to the config.
 */
const lintAs = (path: string, source: string) => {
	const root = mkdtempSync(join(tmpdir(), "seelite-lint-"));
	try {
		copyFileSync(repoPath("biome.jsonc"), join(root, "biome.jsonc"));
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), source);
		return spawnSync(BIOME, ["lint", path], { cwd: root, encoding: "utf8" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
};

/**
 * Run the wiring gate over a scratch `scripts/` holding copies of the gate, the
 * launcher and its one import, plus `files`. The gate scans its own directory,
 * so this is what lets a case be built to make it fail without touching the
 * real tree.
 */
const wiringOver = (files: Record<string, string>) => {
	const root = mkdtempSync(join(tmpdir(), "seelite-wiring-"));
	try {
		for (const rel of [
			"check-launcher-wiring.mjs",
			"probe-guard.mjs",
			"lib/tree-declaration.mjs",
			"lib/players-renderer.mjs",
		]) {
			mkdirSync(dirname(join(root, "scripts", rel)), { recursive: true });
			copyFileSync(repoPath(`scripts/${rel}`), join(root, "scripts", rel));
		}
		for (const [rel, source] of Object.entries(files)) {
			mkdirSync(dirname(join(root, "scripts", rel)), { recursive: true });
			writeFileSync(join(root, "scripts", rel), source);
		}
		return spawnSync(
			"node",
			[join(root, "scripts/check-launcher-wiring.mjs")],
			{
				encoding: "utf8",
			},
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
};

/** A probe that satisfies every rule, and the base each red case breaks once. */
const GOOD_PROBE = `import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";
const t = tally();
const browser = await launchChromium();
const page = await browser.newPage();
t.watch(page);
`;

test("the launcher-wiring gate exits 0 on the tree as it stands", () => {
	const run = spawnSync(
		"node",
		[repoPath("scripts/check-launcher-wiring.mjs")],
		{
			encoding: "utf8",
		},
	);
	// The gate's own output names every problem, so a red run reads itself.
	expect({ status: run.status, out: run.stdout }).toMatchObject({ status: 0 });
}, 60_000);

test("the launcher-wiring gate goes red for each rule it states, and only then", () => {
	// The control first: without a passing case, a red below could be the scratch
	// tree failing for a reason of its own.
	expect(wiringOver({ "probe-x.mjs": GOOD_PROBE }).status).toBe(0);

	const cases: Array<[string, Record<string, string>, string]> = [
		[
			"a page opened with no tally()",
			{
				"probe-x.mjs": GOOD_PROBE.replace("const t = tally();\n", "").replace(
					"t.watch(page);\n",
					"",
				),
			},
			"calls no tally()",
		],
		[
			"a tally() whose watch never reaches the page",
			{ "probe-x.mjs": GOOD_PROBE.replace("t.watch(page);\n", "") },
			"no watch within",
		],
		[
			"a probe that mounts ?perf",
			{ "probe-x.mjs": `${GOOD_PROBE}const opts = { perf: "1" };\n` },
			"?perf",
		],
		[
			"a helper that resolves Playwright itself",
			{
				"probe-x.mjs": GOOD_PROBE,
				"lib/env.mjs": "export const d = process.env.PLAYWRIGHT_DIR;\n",
			},
			"still resolves Playwright itself",
		],
	];
	for (const [label, files, message] of cases) {
		const run = wiringOver(files);
		expect({ label, status: run.status }).toEqual({ label, status: 1 });
		expect(run.stdout).toContain(message);
	}
}, 60_000);

test("the runner's environment forwards the variables the launcher reads", () => {
	// `probe-runner-env.mjs` passes those variables through, and the wiring gate
	// refuses any script that spells their names. The file takes the list from
	// the launcher instead of spelling it. The names are spelled *here* on
	// purpose: read from the export, the expectation would shrink with the file
	// and stay green when a variable stopped being forwarded.
	for (const name of ["PLAYWRIGHT_DIR", "PLAYWRIGHT_MODULE"]) {
		expect(PLAYWRIGHT_ENV_VARS).toContain(name);
		expect(probeRunnerEnvironment({ [name]: "x" })[name]).toBe("x");
	}
	expect(
		probeRunnerEnvironment({ [PROBE_RENDERER_ENV]: HARDWARE_RENDERER })[
			PROBE_RENDERER_ENV
		],
	).toBe(HARDWARE_RENDERER);
});

test("the lint tier fails on an undeclared name in scripts/", () => {
	for (const path of ["scripts/x.mjs", "scripts/x.ts"]) {
		const run = lintAs(path, "export const x = neverDeclared(1);\n");
		expect(run.status).not.toBe(0);
		expect(run.stderr + run.stdout).toContain("noUndeclaredVariables");
	}
}, 60_000);

test("the lint tier accepts the Bun global, and the rule is scoped to scripts/", () => {
	for (const path of ["scripts/x.mjs", "scripts/x.ts"])
		expect(lintAs(path, "export const x = Bun.argv;\n").status).toBe(0);
	// Outside `scripts/` the rule is off: `src/` and `tests/` are type-checked
	// by `tsc`, and this tier does not claim them.
	expect(
		lintAs("src/x.ts", "export const x = neverDeclared(1);\n").status,
	).toBe(0);
}, 60_000);

test("`npm run lint` runs the rule over the real tree and it is clean", () => {
	// Through the script itself, so a `lint` entry that stopped covering
	// `scripts/` — or stopped existing — is red here rather than green by text.
	const run = spawnSync("npm", ["run", "lint"], {
		cwd: repoPath("."),
		encoding: "utf8",
	});
	expect({ status: run.status, out: run.stdout + run.stderr }).toMatchObject({
		status: 0,
	});
}, 60_000);

/** One entry from a workflow's `steps:` list. */
type WorkflowStep = {
	job: string;
	/** Position within its job, so an ordering claim can be made. */
	index: number;
	name?: string;
	run?: string;
	uses?: string;
	/** The step's `if:`, which is how a step skips itself on an event. */
	condition?: string;
};

/**
 * The steps of a workflow file, read from its configuration and not from its
 * prose.
 *
 * There is no YAML dependency here and one is not wanted for a file this size.
 * What is needed instead is a reader that a comment cannot satisfy:
 * `deploy.yml` explains itself at length, so a substring search over the whole
 * file goes green on the paragraph that merely *says* a gate runs. Only lines
 * inside a `steps:` block are read, comment lines are dropped, and the `- `
 * opening a step is blanked so its first key lines up with the keys under it.
 *
 * It knows the shape this repo's workflows are written in — two-space indents,
 * one key per line, a block scalar for a multi-line command. A workflow written
 * some other way reads as *fewer* steps, which is the direction that reports a
 * missing gate rather than inventing one.
 */
const workflowSteps = (rel: string): WorkflowStep[] => {
	const steps: WorkflowStep[] = [];
	let job = "";
	let inJobs = false;
	let inSteps = false;
	let current: WorkflowStep | null = null;
	let stepIndex = 0;
	let block: { key: "run" | "name" | "uses"; parts: string[] } | null = null;

	const flush = () => {
		if (block && current) current[block.key] = block.parts.join("\n");
		block = null;
	};

	for (const raw of readFileSync(repoPath(rel), "utf8").split("\n")) {
		if (raw.trimStart().startsWith("#")) continue;

		if (inSteps) {
			if (!/^ {6}- /.test(raw) && raw.trim() !== "" && !/^ {8,}/.test(raw)) {
				flush();
				inSteps = false;
				current = null;
			} else if (block && (/^ {10,}/.test(raw) || raw.trim() === "")) {
				block.parts.push(raw.trim());
				continue;
			} else {
				flush();
			}
		}
		if (!inSteps) {
			if (raw === "jobs:") inJobs = true;
			const named = inJobs && raw.match(/^ {2}([\w-]+):\s*$/);
			if (named) {
				job = named[1];
				inSteps = false;
			}
			if (/^ {4}steps:\s*$/.test(raw)) {
				inSteps = true;
				stepIndex = 0;
			}
			continue;
		}

		const isStep = /^ {6}- /.test(raw);
		const line = isStep ? `        ${raw.slice(8)}` : raw;
		if (isStep) {
			current = { job, index: steps.length };
			steps.push(current);
		}
		if (!current) continue;

		const key = line.match(/^ {8}([\w-]+):\s*(.*)$/);
		if (!key) continue;
		const [name, value] = [key[1], key[2]] as const;
		if (/^[|>][-+]?$/.test(value)) {
			if (name === "run" || name === "name" || name === "uses")
				block = { key: name, parts: [] };
			continue;
		}
		const scalar = value.replace(/^['"]|['"]$/g, "");
		if (name === "run" || name === "uses" || name === "name")
			current[name] = scalar;
		if (name === "if") current.condition = scalar;
	}
	flush();
	return steps;
};

/**
 * The pull-request gate runs the launcher-wiring check (#403).
 *
 * The gate is static — it scans `scripts/` and opens no browser — so #14's
 * reason for keeping the browser tier off GitHub does not reach it, and #402
 * made it green on `main`, so adding it cannot open every PR red.
 *
 * The command is read out of the workflow and then spawned, not restated here,
 * for the reason the `npm run lint` row above goes through the script: a step
 * naming an entry that stopped existing is red here rather than green by text.
 *
 * What no row here can hold is that a runner runs it. That is proven on the
 * runner — a commit adding a probe without `tally()` must redden the `Deploy`
 * job at this step — and the run is recorded on node #403's receipt.
 */
test("the pull-request gate runs the launcher-wiring check", () => {
	const steps = workflowSteps(".github/workflows/deploy.yml");
	// A parse that finds nothing finds nothing for a reason of its own, and a
	// green below would then be an absence measured as a presence.
	expect(steps.length).toBeGreaterThan(0);

	const wiring = steps.filter((s) => (s.run ?? "").includes("check:wiring"));
	// Exactly one, and by the name the local tier uses.
	expect(wiring.map((s) => s.run)).toEqual(["npm run check:wiring"]);

	const step = wiring[0];
	// Nothing skips it on a pull request: an `if:` naming an event is exactly
	// how the two deploy steps keep off PRs, and this must not be written so.
	expect(step.condition).toBeUndefined();
	// It sits in the job a pull request already waits on, and fails before
	// anything can publish. Both jobs are pinned to a name rather than compared
	// to each other: a bare equality reads green when neither step was found.
	const unit = steps.find((s) => (s.run ?? "").trim() === "npm test");
	expect({ gateJob: step.job, unitJob: unit?.job }).toEqual({
		gateJob: "deploy",
		unitJob: "deploy",
	});
	const publish = steps.filter((s) =>
		/wrangler|pages deploy/.test(`${s.run ?? ""} ${s.uses ?? ""}`),
	);
	expect(publish.length).toBeGreaterThan(0);
	expect(step.index).toBeLessThan(Math.min(...publish.map((s) => s.index)));

	const { scripts } = JSON.parse(
		readFileSync(repoPath("package.json"), "utf8"),
	) as unknown as { scripts: Record<string, string> };
	expect(scripts["check:wiring"]).toBe(
		"node scripts/check-launcher-wiring.mjs",
	);

	// And it passes when run the way the gate runs it. Splitting on spaces is
	// the command only because it carries no shell: that is asserted, so a step
	// that later grew a pipe is red here rather than run as two arguments.
	const command = (step.run ?? "").trim();
	expect(command).toMatch(/^[\w./: -]+$/);
	const [bin, ...args] = command.split(/\s+/);
	const run = spawnSync(bin, args, { cwd: repoPath("."), encoding: "utf8" });
	expect({ status: run.status, out: run.stdout }).toMatchObject({ status: 0 });
}, 60_000);

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
import {
	commandOf,
	letsFailurePass,
	parseWorkflow,
	type Workflow,
} from "./lib/workflow-scan";

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

let parsed: Workflow | null = null;
/** Parsed once: the rows below all read the same file. */
const deployWorkflow = () =>
	(parsed ??= parseWorkflow(".github/workflows/deploy.yml"));

/**
 * The single step that runs the launcher-wiring gate, claimed by the rows that
 * need it.
 *
 * Each of them asks for it through here rather than indexing a filter itself, so
 * a workflow that lost the step fails on "there is exactly one, and this is its
 * command" instead of on a `TypeError` over `undefined` — which is the shape a
 * deleted step reached twice.
 */
const theWiringStep = () => {
	const found = deployWorkflow().steps.filter((s) =>
		commandOf(s).includes("check:wiring"),
	);
	expect(found.map(commandOf)).toEqual(["npm run check:wiring"]);
	return found[0];
};

/**
 * The pull-request gate runs the launcher-wiring check (#403).
 *
 * `npm test` has run that gate on every pull request since #402, so these rows
 * do not claim first coverage. They hold the shape the new step adds: an event
 * list that reaches pull requests without a filter hiding them, neither the step
 * nor its job skipping itself or shrugging off a failure, the step ahead of the
 * unit tier and of anything in its job that can publish, and the command it names
 * still the script the local tier runs. Each is a row of its own because each is
 * a claim of its own, and a failure should say which.
 *
 * What no row here can hold is that a runner runs the step. That is the `Deploy`
 * job's own step list, which names `Run npm run check:wiring` on a green pull
 * request and stops a red one there; the headless tier can only hold what the
 * file says. The reader these rows stand on is measured in
 * `tests/workflow-scan.test.ts`, not by them.
 */
test("the deploy workflow runs on a pull request, with no filter hiding it", () => {
	const { triggers, steps } = deployWorkflow();
	// A parse that finds nothing finds nothing for a reason of its own, and every
	// green below would then be an absence measured as a presence.
	expect(steps.length).toBeGreaterThan(0);
	expect(triggers.map((t) => t.name)).toContain("pull_request");
	const pull = triggers.find((t) => t.name === "pull_request");
	// Pinned rather than searched for absence: `branches: [main]` is the file's
	// intent and is meant to be here. A `paths:` or `types:` join is the same
	// event name on a workflow that no longer runs on the pull requests in hand.
	expect(pull?.keys).toEqual(["branches"]);
});

test("neither the wiring step nor its job skips or excuses a pull request", () => {
	const step = theWiringStep();
	const job = deployWorkflow().jobs.find((j) => j.name === step.job);
	// An `if:` naming an event is how the two deploy steps keep off pull requests,
	// and neither this step nor the job holding it may be written so. The job is
	// found by name rather than the job list pinned: a second job added for some
	// other reason says nothing about this gate.
	expect(step.job).toBe("deploy");
	expect(step.condition).toBeUndefined();
	expect(job?.condition).toBeUndefined();
	// And a gate that reports success while failing gates nothing, at either
	// level. Only a truthy value is that: `continue-on-error: false` is the
	// default said out loud, and a row that reddens it has stopped measuring the
	// hazard and started constraining a spelling.
	expect(letsFailurePass(step.continueOnError)).toBe(false);
	expect(letsFailurePass(job?.continueOnError)).toBe(false);
});

test("the wiring step runs ahead of the unit tier and of anything that publishes", () => {
	const step = theWiringStep();
	// One assertion over the order rather than a comparison per pair: being ahead
	// of these two *is* the step's whole justification, and a row that fetched
	// `npm test` and discarded its position did not hold it. The list is in
	// per-job file order and cannot pass by omission — all three must be present,
	// in that order, in the gate's own job. A publish step relocated to a second
	// job leaves this list without its third entry rather than silently passing a
	// comparison over an empty set.
	expect(
		deployWorkflow()
			.steps.filter((s) => s.job === step.job)
			.filter((s) =>
				/check:wiring|npm test|wrangler|pages deploy/.test(commandOf(s)),
			)
			.map(commandOf),
	).toEqual([
		"npm run check:wiring",
		"npm test",
		"cloudflare/wrangler-action@v4",
	]);
});

/**
 * The chain from the step to the gate, held statically rather than executed.
 *
 * The step names an npm entry; the entry names a script. That is the whole
 * chain, and the exit code at the end of it is proven once per suite by the row
 * at the top of this file, which spawns the same script. Spawning it here again
 * would buy only a faithfulness claim about `npm run`, at the cost of a third
 * scan of `scripts/` on every pull request — the step, the row above, this one.
 */
test("the wiring step runs the entry the local tier runs", () => {
	expect(theWiringStep().run).toBe("npm run check:wiring");
	const { scripts } = JSON.parse(
		readFileSync(repoPath("package.json"), "utf8"),
	) as unknown as { scripts: Record<string, string> };
	// The entry is pinned to the same script the gate row above spawns by path,
	// so the two rows meet at one file and cannot drift apart.
	expect(scripts["check:wiring"]).toBe(
		"node scripts/check-launcher-wiring.mjs",
	);
});

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

/** A line of a workflow, with its comments gone and its indent measured. */
type Line = { text: string; indent: number };

/**
 * The layout this reader admits, in columns.
 *
 * Two spaces a level, `on:` and `jobs:` at column zero. Level two is a child of
 * a top-level key — an event, or a job — and level four is a key of that child:
 * a trigger's filter, or a job's setting. Six opens a step, eight is a key of
 * that step. Named once because round 3 found the same rule written three times
 * and already diverging: one reader anchored the job header to end of line and
 * the other did not, so a job one read and the other missed made "the job
 * carrying this step has no `if:`" pass on a job nothing had found.
 */
const COLUMN = { child: 2, childKey: 4, step: 6, stepKey: 8 } as const;

/** `key: written`, read at exactly `indent` columns. */
const keyAt = (line: Line, indent: number) => {
	const key = line.text.match(new RegExp(`^ {${indent}}([\\w-]+):\\s*(.*)$`));
	return key ? { name: key[1], written: key[2] } : null;
};

/** The name of a key that carries no value: an event, a job, a `steps:`. */
const headerAt = (line: Line, indent: number) => {
	const key = keyAt(line, indent);
	return key && key.written === "" ? key.name : undefined;
};

/** An event under `on:`, with the keys nested under it — its filters. */
type WorkflowTrigger = { name: string; keys: string[] };

/** A job's name and its `if:`, which is how a whole job skips an event. */
type WorkflowJob = { name: string; condition?: string };

/** One entry from a workflow's `steps:` list. */
type WorkflowStep = {
	job: string;
	/** Position within its job, so an ordering claim can be made. */
	index: number;
	run?: string;
	uses?: string;
	/** The step's `if:`, which is how a step skips itself on an event. */
	condition?: string;
	/** A step that fails without failing the job is a gate that does not gate. */
	continueOnError?: string;
};

/** What a row may need to know about a workflow file. */
type Workflow = {
	triggers: WorkflowTrigger[];
	jobs: WorkflowJob[];
	steps: WorkflowStep[];
};

/**
 * A key's value: the text after the colon, or — when that text is a block
 * scalar indicator — every following line indented deeper than the key, joined.
 *
 * This is not a `run:`-only concern. `if:` may be written as a block scalar too,
 * and a reader that collected only `run` reports a step with no `if:` for a step
 * whose `if:` is a folded scalar: the one reading that turns "nothing skips this
 * step" green on a step skipped on every event. Returns how many further lines
 * the value consumed.
 */
const readValue = (lines: Line[], at: number, written: string) => {
	if (!/^[|>][-+]?\d*$/.test(written))
		return { value: written.replace(/^['"]|['"]$/g, ""), used: 0 };
	const parts: string[] = [];
	let used = 0;
	while (at + 1 + used < lines.length) {
		const next = lines[at + 1 + used];
		if (next.text.trim() === "" || next.indent > lines[at].indent) {
			parts.push(next.text.trim());
			used++;
		} else break;
	}
	return { value: parts.join("\n").trim(), used };
};

/** The file's lines, without comments, each with its indent measured. */
const workflowLines = (rel: string): Line[] =>
	readFileSync(repoPath(rel), "utf8")
		.split("\n")
		.map((text) => ({
			text,
			indent: text.length - text.trimStart().length,
		}))
		.filter((line) => !line.text.trimStart().startsWith("#"));

/** The lines under one top-level key, up to the next one. */
const topLevelBlock = (lines: Line[], key: string): Line[] => {
	const block: Line[] = [];
	let inBlock = false;
	for (const line of lines) {
		if (line.text.trim() === "") continue;
		if (line.indent === 0) {
			inBlock = line.text === `${key}:`;
			continue;
		}
		if (inBlock) block.push(line);
	}
	return block;
};

/**
 * The events under `on:`, each with the keys nested under it.
 *
 * A bare event name is not the claim. `pull_request:` carrying a `paths:` filter
 * is a workflow that stops running on most pull requests while still listing the
 * event, so the filters are read rather than assumed absent.
 */
const readTriggers = (block: Line[]): WorkflowTrigger[] => {
	const triggers: WorkflowTrigger[] = [];
	for (const line of block) {
		const event = headerAt(line, COLUMN.child);
		if (event) {
			triggers.push({ name: event, keys: [] });
			continue;
		}
		const key = keyAt(line, COLUMN.childKey);
		if (key && triggers.length)
			triggers[triggers.length - 1].keys.push(key.name);
	}
	return triggers;
};

/**
 * Each job and its `if:`, in file order.
 *
 * A job-level `if:` is the other way a pull request can stop waiting on a step,
 * and it sits at a column no step reader ever looks at.
 */
const readJobs = (block: Line[]): WorkflowJob[] => {
	const jobs: WorkflowJob[] = [];
	for (let i = 0; i < block.length; i++) {
		const line = block[i];
		if (line.indent === COLUMN.child) {
			const name = headerAt(line, COLUMN.child);
			if (name) jobs.push({ name });
			continue;
		}
		if (line.indent !== COLUMN.childKey || !jobs.length) continue;
		const written = keyAt(line, COLUMN.childKey);
		if (written?.name !== "if") continue;
		const { value, used } = readValue(block, i, written.written);
		i += used;
		jobs[jobs.length - 1].condition = value;
	}
	return jobs;
};

/** The keys of one step, from the lines of its entry with the `- ` blanked. */
const readStep = (job: string, index: number, lines: Line[]): WorkflowStep => {
	const step: WorkflowStep = { job, index };
	for (let i = 0; i < lines.length; i++) {
		const written = keyAt(lines[i], COLUMN.stepKey);
		if (!written) continue;
		const { value, used } = readValue(lines, i, written.written);
		i += used;
		if (written.name === "run") step.run = value;
		if (written.name === "uses") step.uses = value;
		if (written.name === "if") step.condition = value;
		if (written.name === "continue-on-error") step.continueOnError = value;
	}
	return step;
};

/**
 * Every step of every job, numbered within its own job.
 *
 * The numbering is per job because a position in one job says nothing about the
 * order of another's.
 */
const readSteps = (block: Line[]): WorkflowStep[] => {
	const steps: WorkflowStep[] = [];
	let job = "";
	let inSteps = false;
	let group: Line[] | null = null;
	let index = 0;

	const close = () => {
		if (group) steps.push(readStep(job, index++, group));
		group = null;
	};

	for (const line of block) {
		if (line.text.trim() === "") continue;
		if (line.indent <= COLUMN.step) close();
		if (line.indent === COLUMN.child) {
			inSteps = false;
			index = 0;
			const name = headerAt(line, COLUMN.child);
			if (name) job = name;
			continue;
		}
		if (line.indent === COLUMN.childKey) {
			if (headerAt(line, COLUMN.childKey) === "steps") {
				inSteps = true;
				index = 0;
			}
			continue;
		}
		if (!inSteps) continue;
		if (
			line.indent === COLUMN.step &&
			line.text.startsWith("- ", COLUMN.step)
		) {
			group = [
				{
					text: `${" ".repeat(COLUMN.stepKey)}${line.text.slice(COLUMN.stepKey)}`,
					indent: COLUMN.stepKey,
				},
			];
			continue;
		}
		if (group) group.push(line);
	}
	close();
	return steps;
};

/**
 * A workflow file, read from its configuration and not from its prose.
 *
 * There is no YAML dependency here and one is not wanted for a file this size
 * and one caller. What is needed instead is a reader a comment cannot satisfy:
 * `deploy.yml` explains itself at length, so a substring search over the whole
 * file goes green on the paragraph that merely *says* a gate runs.
 *
 * What it admits is `COLUMN`'s layout. A workflow written some other way reads as
 * *fewer* triggers, jobs or steps, which is the direction that reports a missing
 * gate rather than inventing one. Two claims do not live by that direction, and
 * both are handled where they are read rather than argued here: a key written as
 * a block scalar is read as a value, because "this step has no `if:`" is a claim
 * about absence; and every reader takes a header from the same `headerAt`, so one
 * cannot see a job another has missed.
 */
const parseWorkflow = (rel: string): Workflow => {
	const lines = workflowLines(rel);
	const jobsBlock = topLevelBlock(lines, "jobs");
	return {
		triggers: readTriggers(topLevelBlock(lines, "on")),
		jobs: readJobs(jobsBlock),
		steps: readSteps(jobsBlock),
	};
};

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
 * command" instead of on a `TypeError` over `undefined` — which is the shape the
 * last finding is about, and the shape a deleted step reached twice.
 */
const theWiringStep = () => {
	const found = deployWorkflow().steps.filter((s) =>
		(s.run ?? "").includes("check:wiring"),
	);
	expect(found.map((s) => (s.run ?? "").trim())).toEqual([
		"npm run check:wiring",
	]);
	return found[0];
};

/**
 * The pull-request gate runs the launcher-wiring check (#403).
 *
 * `npm test` has run that gate on every pull request since #402, so these rows
 * do not claim first coverage. They hold the shape the new step adds: an event
 * list that reaches pull requests without a path filter, neither the step nor its
 * job skipping itself, the step ahead of the unit tier and of anything in its job
 * that can publish, and the command it names still the script the local tier
 * runs. Each is a row of its own because each is a claim of its own, and a
 * failure should say which.
 *
 * What no row here can hold is that a runner runs the step. That is the `Deploy`
 * job's own step list, which names `Run npm run check:wiring` on a green pull
 * request and stops a red one there; the headless tier can only hold what the
 * file says.
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

test("neither the wiring step nor its job skips a pull request", () => {
	const step = theWiringStep();
	expect(step.condition).toBeUndefined();
	// A step that fails without failing the job is a gate that does not gate.
	expect(step.continueOnError).toBeUndefined();
	// An `if:` naming an event is how the two deploy steps keep off pull
	// requests, and neither this step nor the job holding it may be written so.
	// The job is found by name rather than the job list pinned: a second job
	// added for some other reason says nothing about this gate.
	expect(step.job).toBe("deploy");
	expect(
		deployWorkflow().jobs.find((j) => j.name === step.job)?.condition,
	).toBeUndefined();
});

test("the wiring step runs ahead of the unit tier and of anything that publishes", () => {
	const step = theWiringStep();
	const inJob = deployWorkflow().steps.filter((s) => s.job === step.job);
	// One assertion over the order rather than a comparison per pair, because
	// being ahead of these two *is* the step's whole justification, and a row
	// that fetched `npm test` and discarded its position did not hold it. This
	// list cannot pass by omission: all three must be there, in that order.
	const order = inJob
		.filter((s) =>
			/check:wiring|npm test|wrangler|pages deploy/.test(
				`${s.run ?? ""} ${s.uses ?? ""}`,
			),
		)
		.map((s) => `${s.run ?? s.uses ?? ""}`.trim());
	expect(order).toEqual([
		"npm run check:wiring",
		"npm test",
		"cloudflare/wrangler-action@v4",
	]);
	// And the position the order is measured on is the one this row's other
	// claims read: per job, so a second job cannot shift it.
	expect(step.index).toBeLessThan(
		Math.min(
			...inJob
				.filter((s) =>
					/wrangler|pages deploy/.test(`${s.run ?? ""} ${s.uses ?? ""}`),
				)
				.map((s) => s.index),
		),
	);
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

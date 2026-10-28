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
	existsSync,
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
	actionOf,
	commandOf,
	letsFailurePass,
	parseWorkflow,
	refOf,
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
 * Every module the entries reach through a relative import, transitively, as
 * paths under `scripts/`.
 *
 * The list this replaces was typed, which made the fixture a second copy of the
 * import graph: adding one import to `probe-guard.mjs` — #882's contention
 * notice did — left the scratch tree unable to load the gate at all, and the test
 * failed as `ERR_MODULE_NOT_FOUND` naming a file nobody had heard of. Deriving
 * the list is what stops the next person reading that error as their own bug.
 *
 * Text rather than a real module load, because the fixture's job is to know which
 * *files* to copy, not to evaluate them. Entries and results are paths under
 * `scripts/`, which is what the copy loop below expects.
 */
const transitiveScripts = (entries: string[]): string[] => {
	const seen = new Set<string>();
	const queue = [...entries];
	while (queue.length) {
		const rel = queue.shift() as string;
		if (seen.has(rel) || !existsSync(repoPath(join("scripts", rel)))) continue;
		seen.add(rel);
		const dir = dirname(join("scripts", rel)).replace(/^scripts\/?/, "");
		const source = readFileSync(repoPath(join("scripts", rel)), "utf8");
		for (const m of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
			const target = join("scripts", dir, m[1]);
			if (target.startsWith("scripts/"))
				queue.push(target.slice("scripts/".length));
		}
	}
	return [...seen];
};

/**
 * Run the wiring gate over a scratch `scripts/` holding copies of the gate, the
 * launcher and everything the launcher imports, plus `files`. The gate scans its
 * own directory, so this is what lets a case be built to make it fail without
 * touching the real tree.
 */
const wiringOver = (files: Record<string, string>) => {
	const root = mkdtempSync(join(tmpdir(), "seelite-wiring-"));
	try {
		for (const rel of transitiveScripts([
			"check-launcher-wiring.mjs",
			"probe-guard.mjs",
		])) {
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
const ciWorkflow = () => (parsed ??= parseWorkflow(".github/workflows/ci.yml"));

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
	const found = ciWorkflow().steps.filter((s) =>
		commandOf(s).includes("check:wiring"),
	);
	expect(found.map(commandOf)).toEqual(["npm run check:wiring"]);
	return found[0];
};

/**
 * The pull-request gate runs the launcher-wiring check (#403), and publishes
 * only from `main`.
 *
 * `npm test` has run that gate on every pull request since #402, so these rows
 * do not claim first coverage. They hold the shape the step adds: an event list
 * that reaches pull requests without a filter hiding them, neither the step nor
 * its job skipping itself or shrugging off a failure, the gate ahead of the unit
 * tier and of anything that publishes, and the command it names still the
 * script the local tier runs. The rows after those hold the split into stages:
 * where publishing is decided, and what the unit tier's shards may not do.
 * Each is a row of its own because each is a claim of its own, and a failure
 * should say which.
 *
 * What no row here can hold is that a runner runs the step. That is the `static`
 * job's own step list, which names `Run npm run check:wiring` on a green pull
 * request and stops a red one there; the headless tier can only hold what the
 * file says. The reader these rows stand on is measured in
 * `tests/workflow-scan.test.ts`, not by them.
 */
test("the CI workflow runs on a pull request, with no filter hiding it", () => {
	const { triggers, steps } = ciWorkflow();
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
	const job = ciWorkflow().jobs.find((j) => j.name === step.job);
	// An `if:` naming the publish decision is how the steps a site needs alone
	// keep off pull requests, and neither this step nor the job holding it may be
	// written so. The job is found by name rather than the job list pinned: a
	// second job added for some other reason says nothing about this gate.
	expect(step.job).toBe("static");
	expect(step.condition).toBeUndefined();
	expect(job?.condition).toBeUndefined();
	// And a gate that reports success while failing gates nothing, at either
	// level. Only a truthy value is that: `continue-on-error: false` is the
	// default said out loud, and a row that reddens it has stopped measuring the
	// hazard and started constraining a spelling.
	expect(letsFailurePass(step.continueOnError)).toBe(false);
	expect(letsFailurePass(job?.continueOnError)).toBe(false);
});

/** Every job `root` waits on, directly or through the jobs it waits on. */
const waitsOn = (root: string): Set<string> => {
	const seen = new Set<string>();
	const queue = [root];
	while (queue.length) {
		const name = queue.shift() as string;
		const job = ciWorkflow().jobs.find((j) => j.name === name);
		for (const need of job?.needs ?? [])
			if (!seen.has(need)) {
				seen.add(need);
				queue.push(need);
			}
	}
	return seen;
};

/** The steps that put bytes on the live site, wherever they are written. */
const publishSteps = () =>
	ciWorkflow().steps.filter((s) => /wrangler|pages deploy/.test(commandOf(s)));

test("the wiring gate runs ahead of the unit tier and of anything that publishes", () => {
	const step = theWiringStep();
	// `needs` is the only order a workflow of several jobs has. The single job
	// that came before held this claim with three steps in one column; with the
	// stages pulled apart, "ahead" means *needed* — transitively, by the job that
	// publishes — and a job that stopped being needed would let the site publish
	// over a red gate.
	//
	// One assertion over the whole closure rather than a comparison per pair: it
	// cannot pass by omission, and a job added, renamed or dropped off the graph
	// is the set that says so.
	expect([...waitsOn("deploy")].sort()).toEqual([
		"build",
		"gate",
		"static",
		"unit",
	]);
	// The shards beside the static checks rather than queued behind them: both
	// are stage 1, and making a shard wait on Biome buys nothing.
	expect(ciWorkflow().jobs.find((j) => j.name === "unit")?.needs).toEqual([
		"gate",
	]);
	expect(waitsOn(step.job).has("unit")).toBe(false);
	// And no job that only tests publishes. The guard above, because an empty
	// publish list would make every one of these loops pass on nothing.
	expect(publishSteps().map(actionOf)).toEqual(["cloudflare/wrangler-action"]);
	for (const job of ciWorkflow().jobs)
		if (job.name !== "deploy")
			expect(
				publishSteps()
					.filter((s) => s.job === job.name)
					.map(commandOf),
			).toEqual([]);
});

test("publishing is decided once, from the ref", () => {
	const [publish] = publishSteps();
	const job = ciWorkflow().jobs.find((j) => j.name === publish.job);
	// The step no longer gates itself; the job does. A decision held by the job
	// cannot be undone by editing the step, and a second publishing step added to
	// that job inherits it rather than having to be remembered.
	expect(publish.condition).toBeUndefined();
	expect(job?.condition).toContain("needs.gate.outputs.publish");
	// And what that output is computed from is the ref. The reader returns a block
	// scalar as the text it holds, so this is the script the runner runs, not a
	// comment about it: `refs/heads/main` on the side that refuses, `publish=true`
	// as what it writes when nothing refuses.
	const gate = ciWorkflow().steps.find((s) => s.job === "gate");
	expect(gate?.run).toContain("refs/heads/main");
	expect(gate?.run).toContain("publish=true");
});

test("only the advisory mutation job asks the event alone", () => {
	// How a hand-run on a feature branch used to be able to publish: the publish
	// steps were gated on `github.event_name != 'pull_request'`, and every event
	// that is not a pull request satisfies that — `workflow_dispatch` from any
	// branch included, while the step named `--branch=main`. The decision reads
	// the ref now, and an event condition is how it would regress: same file, same
	// steps, a branch shipping to the live site.
	for (const step of ciWorkflow().steps)
		expect(step.condition ?? "").not.toContain("github.event_name");
	for (const job of ciWorkflow().jobs) {
		if (job.name === "mutation-changed") continue;
		expect(job.condition ?? "").not.toContain("github.event_name");
	}
});

test("a merge to main is not cancelled by the next push", () => {
	// Stage 2 sits at the end of a several-minute stage 1, so what a second push
	// to `main` does to the run in flight decides which commit ships. Measured on
	// 2026-10-11, three consecutive `main` runs went cancelled, cancelled, failed
	// under `cancel-in-progress: true` before one finished: merges whose only
	// evidence was a grey dot. A pull request still loses to its own next push —
	// those minutes are wasted ones — so the value names the ref rather than
	// turning cancelling off everywhere.
	const { concurrency } = ciWorkflow();
	expect(concurrency?.cancelInProgress).toContain("refs/heads/main");
	// And the group keeps `main`'s queue apart from every pull request's, or a
	// burst of PR runs becomes the thing a deploy waits behind.
	expect(concurrency?.group).toContain("github.ref");
});

test("every action the workflows call is pinned to a commit", () => {
	// A `vN` tag is a branch someone can force-push, so every `uses:` here names
	// a commit instead. The pins and their versions are listed at the top of
	// `ci.yml`; this row holds that the steps actually carry one, so a bump that
	// writes `@v4` back into a step is red here rather than drift between that
	// table and the file. Both workflows are read: `probes.yml` shares the two
	// actions and its steps would otherwise be unpinned by nobody noticing.
	const called = [".github/workflows/ci.yml", ".github/workflows/probes.yml"]
		.flatMap((path) => parseWorkflow(path).steps)
		.filter((step) => step.uses !== undefined)
		.map((step) => ({ action: actionOf(step), ref: refOf(step) ?? "" }));
	expect(called.length).toBeGreaterThan(0);
	expect(
		called
			.filter(({ ref }) => !/^[0-9a-f]{40}$/.test(ref))
			.map(({ action, ref }) => `${action}@${ref}`),
	).toEqual([]);
});

test("the shards split the suite across runners without narrowing it", () => {
	const runs = ciWorkflow().steps.filter((s) =>
		commandOf(s).includes("bun test"),
	);
	expect(runs.map((s) => s.job)).toEqual(["unit"]);
	// The path is still the whole of `tests/`, so `--shard` is the only thing that
	// divides the suite. A path narrowed to make a shard quicker would run a
	// quarter of it on every pull request and report green.
	//
	// The `run:` is a folded scalar, which the reader hands back line by line.
	expect(
		commandOf(runs[0])
			.split("\n")
			.map((line) => line.trim()),
	).toEqual([
		"bun test tests/",
		"--shard=${{ matrix.shard }}/${{ matrix.total }}",
		"--timeout=60000",
		"--parallel=4",
		"--no-isolate",
		"--timings=tests/timings.json",
		"--update-timings",
	]);
	// A shard that skips itself is a shard that never ran, and a shard that
	// shrugs off a failure reports a green quarter of a suite it did not run.
	expect(runs[0].condition).toBeUndefined();
	expect(letsFailurePass(runs[0].continueOnError)).toBe(false);
	// And the local entry is untouched: the split is CI's, not the suite's.
	const { scripts } = JSON.parse(
		readFileSync(repoPath("package.json"), "utf8"),
	) as unknown as { scripts: Record<string, string> };
	expect(scripts.test).toBe("bun test tests/");
});

const PINNED_BUN = "1.4.2";

test("every bun the CI workflow installs is the pinned release the shard flags exist in", () => {
	const setups = ciWorkflow().steps.filter(
		(s) => actionOf(s) === "oven-sh/setup-bun",
	);
	expect(setups.map((s) => s.job)).toContain("unit");
	const writtenVersions = [
		...readFileSync(repoPath(".github/workflows/ci.yml"), "utf8").matchAll(
			/^\s+bun-version:\s*(\S+)\s*$/gm,
		),
	].map((m) => m[1]);
	expect(writtenVersions).toEqual(setups.map(() => PINNED_BUN));
});

test("the timings file the shards balance on is one bun reads", () => {
	const timings = JSON.parse(
		readFileSync(repoPath("tests/timings.json"), "utf8"),
	) as { version: number; files: Record<string, number> };
	expect(timings.version).toBe(1);
	const durations = Object.entries(timings.files);
	expect(durations.length).toBeGreaterThan(100);
	for (const [file, ms] of durations) {
		expect(file).toMatch(/^tests\/.*\.test\.ts$/);
		expect(ms).toBeGreaterThan(0);
	}
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

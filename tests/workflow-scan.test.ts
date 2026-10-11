import { describe, expect, test } from "bun:test";
import {
	commandOf,
	letsFailurePass,
	parseWorkflowText,
	type WorkflowStep,
} from "./lib/workflow-scan";

/**
 * The reader the workflow rows stand on (#403).
 *
 * Four rounds of review on those rows found four readings this reader got wrong
 * on the first attempt: a step's `if:` written as a block scalar read as no `if:`
 * at all, a header rule written three times and already diverging between the
 * readers, `pull_request:` read as unconditional while carrying a `paths:`
 * filter, and a step's position retrieved and then thrown away. Every one of them
 * was found by hand, against the real `ci.yml`, and each left a row green
 * that should have been red.
 *
 * That is the reason this file exists rather than those rows being trusted
 * directly: a claim about a workflow read through a reader is only as good as the
 * reader, and the honest way to check a reader is to hand it text whose meaning
 * is settled independently of what the repository happens to contain today. Each
 * fixture below is the smallest workflow that asks one question.
 */

/** A workflow whose one step is written by `step`, in a job on a pull request. */
const aroundStep = (step: string) => `
on:
  pull_request:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
${step}
`;

const firstStep = (text: string): WorkflowStep => {
	const [step] = parseWorkflowText(text).steps;
	return step;
};

describe("a key written as a block scalar is read as a value", () => {
	// The bug this guards is the one that made "nothing skips this step" pass on a
	// step skipped on every event: a reader that collected `|` blocks for `run`
	// and `uses` alone reported an `if:` written as a folded scalar as no `if:`.
	// So the scalar arm is tested for every key the rows assert the absence of.
	test("run", () => {
		const step = firstStep(
			aroundStep(`      - run: |
          npm ci
          npm run format:check`),
		);
		expect(step.run).toBe("npm ci\nnpm run format:check");
	});

	test("if", () => {
		const step = firstStep(
			aroundStep(`      - if: >-
          github.event_name !=
          "pull_request"
        run: npm run check:wiring`),
		);
		// Joined by line, not folded to spaces the way a YAML `>` would. That is
		// the reader's whole claim about a scalar: it says what the key *holds*,
		// line by line, and never what the expression would evaluate to — no row
		// here asks that, because each asks only whether a key is present.
		expect(step.condition).toBe('github.event_name !=\n"pull_request"');
		expect(step.run).toBe("npm run check:wiring");
	});

	test("if, on a job", () => {
		const { jobs } = parseWorkflowText(`
on: pull_request
jobs:
  deploy:
    if: |
      github.event_name == "push"
      && github.ref == "refs/heads/main"
    runs-on: ubuntu-latest
    steps:
      - run: npm test
`);
		expect(jobs[0].condition).toBe(
			'github.event_name == "push"\n&& github.ref == "refs/heads/main"',
		);
	});

	// And the direction the reader is offered as safe: an unrecognised layout
	// reads as *fewer* things, so a row goes red rather than green. A step
	// indented as a mapping rather than a sequence item is invisible to it.
	test("and a layout it does not admit reads as no step at all", () => {
		const { steps } = parseWorkflowText(`
on: pull_request
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
        run: npm test
`);
		expect(steps).toEqual([]);
	});
});

describe("every reader names a header the same way", () => {
	// Three readers once had three spellings of "this line opens a job", one of
	// them anchored to end of line. A job one saw and another missed made "the
	// job carrying this step has no `if:`" pass on a job nothing had found.
	const text = `
on:
  pull_request:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: cloudflare/wrangler-action@v4
`;

	test("so no row can look up a job the step reader has not seen", () => {
		const workflow = parseWorkflowText(text);
		const seen = workflow.jobs.map((j) => j.name);
		expect(seen).toEqual(["deploy", "publish"]);
		for (const step of workflow.steps) expect(seen).toContain(step.job);
	});

	test("and indexes each job's steps from zero, not the file's", () => {
		const { steps } = parseWorkflowText(text);
		expect(steps.map((s) => [s.job, s.index, s.run ?? s.uses])).toEqual([
			["deploy", 0, "npm test"],
			["publish", 0, "cloudflare/wrangler-action@v4"],
		]);
	});
});

describe("a trigger is read with what narrows it", () => {
	// A bare event name is not the claim. These three are the same workflow to a
	// reader that only collects the names, and only one of them runs on the pull
	// requests a gate is meant to be guarding.
	test("a filter under an event is reported, not skipped over", () => {
		const { triggers } = parseWorkflowText(`
on:
  pull_request:
    branches: [main]
    paths:
      - src/**
  push:
    branches: [main]
jobs:
  deploy:
    steps:
      - run: npm test
`);
		expect(triggers).toEqual([
			{ name: "pull_request", keys: ["branches", "paths"] },
			{ name: "push", keys: ["branches"] },
		]);
	});

	test("an event with no filter carries none", () => {
		const { triggers } = parseWorkflowText(`
on:
  pull_request:
jobs:
  deploy:
    steps:
      - run: npm test
`);
		expect(triggers).toEqual([{ name: "pull_request", keys: [] }]);
	});
});

describe("continue-on-error only matters when it lets a failure pass", () => {
	// The hazard is a gate that reports success while failing. A row that also
	// reddens `continue-on-error: false` has stopped measuring the hazard and
	// started constraining a spelling, which is a worse row for the next person.
	for (const written of ["true", "True", "yes", "on", "1"])
		test(`${written} gates nothing`, () =>
			expect(letsFailurePass(written)).toBe(true));

	for (const written of ["false", "off", "no", "0"])
		test(`${written} is the default said out loud`, () =>
			expect(letsFailurePass(written)).toBe(false));

	test("and a key that is simply absent is the same as the default", () => {
		expect(letsFailurePass(undefined)).toBe(false);
	});

	test("read from a step, and from the job around it", () => {
		const step = firstStep(
			aroundStep(`      - continue-on-error: true
        run: npm test`),
		);
		expect(letsFailurePass(step.continueOnError)).toBe(true);
		const { jobs } = parseWorkflowText(`
on: pull_request
jobs:
  deploy:
    continue-on-error: true
    steps:
      - run: npm test
`);
		expect(letsFailurePass(jobs[0].continueOnError)).toBe(true);
	});
});

test("a comment cannot satisfy any of it", () => {
	// The reason the reader exists at all: `ci.yml` explains itself at length, so
	// a search over the file goes green on the paragraph that merely says a gate
	// runs. This fixture is all prose and no configuration.
	const { triggers, jobs, steps } = parseWorkflowText(`
# This workflow runs the launcher-wiring check on every pull request, ahead of
# the unit tier, and nothing skips it.
on:
  pull_request:
jobs:
  deploy:
    steps: []
`);
	// One trigger, one job — and the step list the prose describes is empty. An
	// event written inline rather than as a block (`on: pull_request`) is not read
	// either, and that is the safe direction: the rows go red, not green.
	expect(steps).toEqual([]);
	expect(jobs.map((j) => j.name)).toEqual(["deploy"]);
	expect(triggers).toEqual([{ name: "pull_request", keys: [] }]);
});

describe("needs is read as the list it means", () => {
	// "Stage 1 runs ahead of the publish" is a claim about `needs` now that the
	// work sits in several jobs, and the key has three spellings that mean one
	// thing. A reader that collected only the flow list would report the job
	// written `needs: gate` as a job with no dependencies — which is the reading
	// that turns "nothing waits on the unit tier" green on a tier three jobs wait
	// on.
	const twoJobs = (gateNeeds: string, secondNeeds: string) => `
on: pull_request
jobs:
  gate:
    runs-on: ubuntu-latest
    ${gateNeeds}
    steps:
      - run: npm run check:wiring
  publish:
    runs-on: ubuntu-latest
    ${secondNeeds}
    steps:
      - run: npm run build
`;

	test("a bare job name", () => {
		const { jobs } = parseWorkflowText(twoJobs("", "needs: gate"));
		// Absent is reported as absent, not as an empty list: `needs: []` reads as
		// `[]`, and the difference is a job that waits on nothing written two ways.
		expect(jobs.map((j) => j.needs)).toEqual([undefined, ["gate"]]);
	});

	test("a flow list", () => {
		const { jobs } = parseWorkflowText(twoJobs("", "needs: [gate, build]"));
		expect(jobs[1].needs).toEqual(["gate", "build"]);
	});

	test("a block list", () => {
		const { jobs } = parseWorkflowText(
			twoJobs("", "needs:\n      - gate\n      - build"),
		);
		expect(jobs[1].needs).toEqual(["gate", "build"]);
	});

	test("and a block list belongs to its own job only", () => {
		// The items sit at the column a step reader also looks at, so the two
		// hazards are the ones a cursor that does not skip them produces: the next
		// job inherits them, or a `- gate` line is counted as a step. Neither is
		// safe, so neither is allowed to happen.
		const { jobs, steps } = parseWorkflowText(`
on: pull_request
jobs:
  gate:
    needs:
      - build
    steps:
      - run: npm run check:wiring
  publish:
    steps:
      - run: npm run build
`);
		expect(jobs.map((j) => [j.name, j.needs])).toEqual([
			["gate", ["build"]],
			["publish", undefined],
		]);
		expect(steps.map((s) => [s.job, commandOf(s)])).toEqual([
			["gate", "npm run check:wiring"],
			["publish", "npm run build"],
		]);
	});
});

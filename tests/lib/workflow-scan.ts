/**
 * Reading a GitHub Actions workflow from its configuration rather than its prose,
 * for the rows that check what the pull-request gate actually runs.
 *
 * `ci.yml` explains itself at length, so a substring search over the file goes
 * green on the paragraph that merely *says* a gate runs. And there is no
 * YAML dependency in this tree — this is one file, of a hundred lines, with one
 * caller, so the shape is `tests/lib/source-scan.ts` again: a reader written for
 * the question, with the direction of its failure stated rather than assumed.
 *
 * That direction is the reason this lives beside a guard file of its own. Four
 * rounds of review found four readings this reader got wrong on its first
 * attempt — a block scalar dropped, a header rule written three times and
 * already diverging, `pull_request:` read as unconditional while it carried a
 * `paths:` filter, and a step's position retrieved and then thrown away. A row
 * built on a reader like that is checked by the reader, which is not an answer,
 * so `tests/workflow-scan.test.ts` measures the reader on text it writes itself.
 */

import { readFileSync } from "node:fs";
import { repoPath } from "./source-scan";

/** A line of a workflow, with its comments gone and its indent measured. */
type Line = { text: string; indent: number };

/**
 * The layout this reader admits, in columns.
 *
 * Two spaces a level, `on:` and `jobs:` at column zero. Level two is a child of
 * a top-level key — an event, or a job — and level four is a key of that child:
 * a trigger's filter, or a job's setting. Six opens a step, eight is a key of
 * that step. Named once because the same rule written three times had already
 * diverged: one reader anchored a header to end of line and the others did not,
 * so a header one read and another missed made "the job carrying this step has
 * no `if:`" pass on a job nothing had found.
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
export type WorkflowTrigger = { name: string; keys: string[] };

/** A job, and the two ways a whole job stops running on an event. */
export type WorkflowJob = {
	name: string;
	/** Its `if:`. */
	condition?: string;
	/** A job that fails without failing the run gates nothing either. */
	continueOnError?: string;
	/**
	 * Its `needs:`, as a list whatever the spelling.
	 *
	 * The order a workflow runs in is this key, and nothing else: once a stage's
	 * work split into jobs, "the wiring gate runs ahead of the unit tier" is a
	 * claim about the graph rather than about two lines' positions in a file.
	 * Read as a list for the same reason `if:` is read through `readValue` — a
	 * scalar, a flow list and a block list are one claim written three ways, and
	 * a reader that saw only one of them would report a stage with no
	 * dependencies for a stage that has three.
	 */
	needs?: string[];
};

/** One entry from a workflow's `steps:` list. */
export type WorkflowStep = {
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
export type Workflow = {
	triggers: WorkflowTrigger[];
	jobs: WorkflowJob[];
	steps: WorkflowStep[];
};

/**
 * A key's value: the text after the colon, or — when that text is a block scalar
 * indicator — every following line indented deeper than the key, joined.
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
const workflowLines = (text: string): Line[] =>
	text
		.split("\n")
		.map((line) => ({
			text: line,
			indent: line.length - line.trimStart().length,
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
 * is a workflow that stops running on most pull requests while still naming the
 * event, so a filter is read rather than assumed absent.
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
 * `needs:` as the list it means, from any of the three spellings.
 *
 * A block list's items are not values `readValue` returns: it stops at the first
 * line it cannot fold into a scalar, and `- gate` at six columns is one of
 * those. So the items are collected here, and `used` reports how many lines they
 * took, so the caller's cursor does not walk back over them and read the last
 * job's dependencies into the next job.
 */
const readNeeds = (
	block: Line[],
	at: number,
	written: string,
): { needs: string[]; used: number } => {
	const inline = written.trim();
	if (inline !== "")
		return {
			needs: inline
				.replace(/^\[|\]$/g, "")
				.split(",")
				.map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
				.filter(Boolean),
			used: 0,
		};
	const needs: string[] = [];
	let used = 0;
	while (at + 1 + used < block.length) {
		const next = block[at + 1 + used];
		if (next.text.trim() === "") {
			used++;
			continue;
		}
		if (next.indent <= COLUMN.childKey) break;
		const item = next.text.trim().match(/^-\s*(\S+)\s*$/);
		if (!item) break;
		needs.push(item[1].replace(/^['"]|['"]$/g, ""));
		used++;
	}
	return { needs, used };
};

/**
 * Each job, with the two keys that take it off an event and the one that places
 * it in a stage.
 *
 * All three sit at a column no step reader ever looks at, and either of the
 * first two is enough to stop a pull request waiting on a gate it was supposed
 * to run.
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
		if (
			!written ||
			(written.name !== "if" &&
				written.name !== "continue-on-error" &&
				written.name !== "needs")
		)
			continue;
		const job = jobs[jobs.length - 1];
		if (written.name === "needs") {
			const { needs, used } = readNeeds(block, i, written.written);
			i += used;
			job.needs = needs;
			continue;
		}
		const { value, used } = readValue(block, i, written.written);
		i += used;
		if (written.name === "if") job.condition = value;
		else job.continueOnError = value;
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
 * A workflow from its text, read from configuration and not from prose.
 *
 * What it admits is `COLUMN`'s layout. A workflow written some other way reads as
 * *fewer* triggers, jobs or steps, which is the direction that reports a missing
 * gate rather than inventing one. Two claims do not live by that direction, and
 * both are handled where they are read: a key written as a block scalar is read
 * as a value, because "this step has no `if:`" is a claim about absence; and
 * every reader takes a header from the same `headerAt`, so one cannot see a job
 * another has missed.
 */
export const parseWorkflowText = (text: string): Workflow => {
	const lines = workflowLines(text);
	const jobsBlock = topLevelBlock(lines, "jobs");
	return {
		triggers: readTriggers(topLevelBlock(lines, "on")),
		jobs: readJobs(jobsBlock),
		steps: readSteps(jobsBlock),
	};
};

/** A workflow from its path in the repository. */
export const parseWorkflow = (rel: string): Workflow =>
	parseWorkflowText(readFileSync(repoPath(rel), "utf8"));

/** What a step runs, in the one spelling every filter over the list should use. */
export const commandOf = (step: WorkflowStep) =>
	`${step.run ?? ""}${step.uses ?? ""}`.trim();

/**
 * Whether a `continue-on-error:` takes the teeth out of what it is written on.
 *
 * `false` is the default said out loud, and a check that reddens it has begun to
 * constrain a harmless spelling rather than the hazard — which is a step, or a
 * job, that reports success while failing.
 */
export const letsFailurePass = (written?: string) =>
	written !== undefined && !/^(false|no|off|0)$/i.test(written.trim());

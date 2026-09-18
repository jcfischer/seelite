#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTypeSafeProbeJudge } from "./lib/typesafe-probe-judge.mjs";
import { probeRunnerEnvironment } from "./lib/probe-runner-env.mjs";
import { selectProbes } from "./lib/probe-selection.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROBE_RUNNER = fileURLToPath(new URL("./probe-all.mjs", import.meta.url));

const VALUE_FLAGS = new Set([
	"--base",
	"--head",
	"--title",
	"--body",
	"--changed-file",
]);

function parseArgs(argv) {
	const out = {
		base: "origin/main",
		head: "HEAD",
		title: process.env.PR_TITLE ?? "",
		body: process.env.PR_BODY ?? "",
		changedFiles: [],
		json: false,
		run: false,
		includeDiff: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === "--json" || flag === "--run") {
			out[flag.slice(2)] = true;
			continue;
		}
		if (flag === "--include-diff") {
			out.includeDiff = true;
			continue;
		}
		if (!VALUE_FLAGS.has(flag) || argv[i + 1] === undefined)
			throw new Error(`unknown or incomplete argument: ${flag}`);
		const value = argv[++i];
		if (flag === "--changed-file") out.changedFiles.push(value);
		else out[flag.slice(2)] = value;
	}
	return out;
}

const git = (args) =>
	execFileSync("git", args, {
		cwd: PROJECT_ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

function readGitEvidence(base, head, includeDiff) {
	const range = `${base}...${head}`;
	return {
		changedFiles: git(["diff", "--name-only", range])
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean),
		diff: includeDiff
			? git(["diff", "--no-ext-diff", "--unified=2", range]).slice(0, 40_000)
			: "",
	};
}

const renderText = (result) => {
	console.log(`probe selection: ${result.mode}`);
	console.log(`reason: ${result.reason}`);
	console.log(`selected: ${result.probes.length}`);
	for (const file of result.probes) {
		const decision = result.decisions?.find((row) => row.file === file);
		console.log(
			`  ${file}${decision ? ` (p=${decision.probability.toFixed(3)})` : ""}`,
		);
	}
	if (result.usage)
		console.log(
			`TypeSafe: ${result.model ?? "unknown model"}, ${result.usage.input_tokens} input + ${result.usage.output_tokens} output tokens`,
		);
	console.log(`decision latency: ${result.latencyMs} ms`);
};

function runSelectedProbes(result) {
	if (!result.probes.length) {
		console.log("No browser probes selected; nothing to run.");
		return;
	}
	const selected = result.mode === "all" ? undefined : result.probes;
	const child = spawnSync(process.execPath, [PROBE_RUNNER], {
		cwd: PROJECT_ROOT,
		stdio: "inherit",
		env: probeRunnerEnvironment(process.env, selected),
	});
	if (child.error)
		console.error(`could not start probe runner: ${child.error.message}`);
	process.exitCode = child.status ?? 1;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	let gitEvidence = { changedFiles: args.changedFiles, diff: "" };
	if (args.changedFiles.length && args.includeDiff)
		console.error(
			"--include-diff is ignored with explicit --changed-file evidence; omit --changed-file to read the base/head diff.",
		);
	if (!args.changedFiles.length) {
		try {
			gitEvidence = readGitEvidence(args.base, args.head, args.includeDiff);
		} catch (error) {
			console.error(
				`could not read git diff ${args.base}...${args.head}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	const judge = process.env.TYPESAFE_API_KEY
		? createTypeSafeProbeJudge({ apiKey: process.env.TYPESAFE_API_KEY })
		: undefined;
	if (gitEvidence.diff)
		console.error(
			"TypeSafe selection includes up to 40,000 characters of the git diff because --include-diff was set.",
		);
	const started = performance.now();
	const result = await selectProbes(
		{
			changedFiles: gitEvidence.changedFiles,
			title: args.title,
			body: args.body,
			diff: gitEvidence.diff,
		},
		judge,
	);
	const output = {
		...result,
		changedFiles: gitEvidence.changedFiles,
		latencyMs: Math.round(performance.now() - started),
	};
	if (args.json) console.log(JSON.stringify(output, null, 2));
	else renderText(output);

	if (args.run) runSelectedProbes(result);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});

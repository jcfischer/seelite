#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readGitEvidence } from "./lib/probe-git-evidence.mjs";
import { createTypeSafeProbeJudge } from "./lib/typesafe-probe-judge.mjs";
import { probeRunnerEnvironment } from "./lib/probe-runner-env.mjs";
import { selectProbes } from "./lib/probe-selection.mjs";
import { readTypeSafeApiKey } from "./lib/typesafe-key.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));

const VALUE_FLAGS = new Set(["--base", "--head", "--changed-file", "--intent"]);

function parseArgs(argv) {
	const out = {
		base: "origin/main",
		head: "HEAD",
		changedFiles: [],
		intent: "",
		json: false,
		run: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === "--json" || flag === "--run") {
			out[flag.slice(2)] = true;
			continue;
		}
		if (!VALUE_FLAGS.has(flag)) throw new Error(`unknown argument: ${flag}`);
		if (argv[i + 1] === undefined) throw new Error(`${flag} requires a value`);
		const value = argv[++i];
		if (flag === "--changed-file") out.changedFiles.push(value);
		else out[flag.slice(2)] = value;
	}
	return out;
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
	const childEnv = probeRunnerEnvironment(process.env, selected);
	const npm = process.platform === "win32" ? "npm.cmd" : "npm";
	const child = spawnSync(npm, ["run", "probe"], {
		cwd: PROJECT_ROOT,
		stdio: "inherit",
		env: childEnv,
	});
	if (child.error)
		console.error(`could not start npm run probe: ${child.error.message}`);
	process.exitCode = child.error ? 1 : (child.status ?? 1);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	let gitEvidence = { changedFiles: args.changedFiles };
	if (!args.changedFiles.length) {
		try {
			gitEvidence = readGitEvidence(args.base, args.head, PROJECT_ROOT);
		} catch (error) {
			throw new Error(
				`could not read git diff ${args.base}...${args.head}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	const apiKey = readTypeSafeApiKey();
	const judge = apiKey ? createTypeSafeProbeJudge({ apiKey }) : undefined;
	const started = performance.now();
	const result = await selectProbes(
		{ changedFiles: gitEvidence.changedFiles, intent: args.intent },
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

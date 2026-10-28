import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TARGET = "tests/timings.json";
const SHARD_ARTIFACT = /^unit-timings-\d+$/;

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" }).trim();

const latestGreenMainRun = () =>
	gh([
		"run",
		"list",
		"--workflow",
		"ci.yml",
		"--branch",
		"main",
		"--status",
		"success",
		"--limit",
		"1",
		"--json",
		"databaseId",
		"-q",
		".[0].databaseId",
	]);

const runId = process.argv[2] ?? latestGreenMainRun();
if (!/^\d+$/.test(runId)) {
	console.error(`update-unit-timings: no CI run id (got "${runId}")`);
	process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "unit-timings-"));
try {
	gh(["run", "download", runId, "--pattern", "unit-timings-*", "--dir", dir]);
	const shards = readdirSync(dir).filter((name) => SHARD_ARTIFACT.test(name));
	if (shards.length === 0) {
		console.error(`update-unit-timings: run ${runId} has no shard timings`);
		process.exit(1);
	}
	const files = {};
	for (const shard of shards) {
		const read = JSON.parse(
			readFileSync(join(dir, shard, "timings.json"), "utf8"),
		);
		if (read.version !== 1)
			throw new Error(`${shard}: version ${read.version}`);
		Object.assign(files, read.files);
	}
	const kept = Object.fromEntries(
		Object.entries(files)
			.filter(([file, ms]) => existsSync(file) && ms > 0)
			.sort(([a], [b]) => a.localeCompare(b)),
	);
	writeFileSync(
		TARGET,
		`${JSON.stringify({ version: 1, files: kept }, null, "\t")}\n`,
	);
	const total = Object.values(kept).reduce((sum, ms) => sum + ms, 0);
	console.log(
		`update-unit-timings: run ${runId}, ${shards.length} shards, ${Object.keys(kept).length} files, ${Math.round(total / 1000)} s summed -> ${TARGET}`,
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}

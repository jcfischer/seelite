#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchPlan, executePlan } from "./dispatch.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
export const root = resolve(directory, "../../..");
export const origin =
	process.env.CONTROL_SEELITE_ORIGIN ?? "http://127.0.0.1:5173";
const key = createHash("sha256")
	.update(
		`${root}\n${origin}\n${process.env.CONTROL_SEELITE_SESSION ?? "default"}`,
	)
	.digest("hex")
	.slice(0, 20);
export const sessionDirectory = join(
	tmpdir(),
	`seelite-control-${process.getuid()}-${key}`,
);
export const socketPath = join(sessionDirectory, "driver.sock");
const report = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

export function request(command, args = []) {
	return new Promise((resolveResult, reject) => {
		const socket = createConnection(socketPath);
		let text = "";
		socket.setTimeout(90000, () =>
			socket.destroy(
				new Error(
					"Control session timed out; inspect driver.log and run close before retrying.",
				),
			),
		);
		socket.once("error", reject);
		socket.once("connect", () =>
			socket.end(`${JSON.stringify({ command, args })}\n`),
		);
		socket.on("data", (part) => {
			text += part;
		});
		socket.once("end", () => {
			try {
				resolveResult(JSON.parse(text));
			} catch {
				reject(new Error(`Invalid control response: ${text}`));
			}
		});
	});
}

async function startSession() {
	try {
		return await request("ping");
	} catch (error) {
		if (!["ENOENT", "ECONNREFUSED"].includes(error.code)) throw error;
		if (error.code === "ECONNREFUSED")
			throw new Error(
				`Stale session socket at ${socketPath}. Confirm its driver is gone, then remove that socket and retry.`,
			);
	}
	mkdirSync(sessionDirectory, { recursive: true, mode: 0o700 });
	const log = openSync(join(sessionDirectory, "driver.log"), "a", 0o600);
	const child = spawn(process.execPath, [join(directory, "driver.mjs")], {
		cwd: root,
		detached: true,
		stdio: ["ignore", log, log],
		env: process.env,
	});
	closeSync(log);
	child.unref();
	let spawnError;
	child.once("error", (error) => {
		spawnError = error;
	});
	for (let i = 0; i < 100; i++) {
		if (spawnError) throw spawnError;
		try {
			return await request("ping");
		} catch {
			await new Promise((done) => setTimeout(done, 100));
		}
	}
	throw new Error(
		`Control driver did not start. Inspect ${join(sessionDirectory, "driver.log")}`,
	);
}

async function main() {
	const input = process.argv.slice(2);
	const dryRun = input.includes("--dry-run");
	const args = input.filter((arg) => arg !== "--dry-run");
	const [command, ...rest] = args;
	if (["measure", "probe"].includes(command)) {
		const plan = dispatchPlan(root, command, rest[0], rest.slice(1));
		if (dryRun) report({ ok: true, dryRun: true, ...plan });
		else process.exitCode = await executePlan(plan);
		return;
	}
	if (command === "help" || command === "--help" || !command) {
		report({
			commands: [
				"doctor",
				"goto cockpit|chase",
				"wait-settle",
				"screenshot <path.png>",
				"snapshot",
				"measure <name> [args]",
				"probe <name> [args]",
				"close",
			],
			origin,
			socketPath,
		});
		return;
	}
	if (
		![
			"doctor",
			"goto",
			"wait-settle",
			"screenshot",
			"snapshot",
			"close",
		].includes(command)
	)
		throw new Error(`Unknown command ${command}. Run help.`);
	if (command === "goto" && !["cockpit", "chase"].includes(rest[0]))
		throw new Error(
			"goto requires a camera view: cockpit or chase. Canonical shot names belong to capture-views, not camera views.",
		);
	if (command === "screenshot" && (!rest[0] || !rest[0].endsWith(".png")))
		throw new Error("screenshot requires a path ending in .png");
	if (rest.length !== (["goto", "screenshot"].includes(command) ? 1 : 0))
		throw new Error(`Unexpected arguments for ${command}`);
	if (dryRun) {
		report({ ok: true, dryRun: true, command, args: rest, origin });
		return;
	}
	if (command === "doctor") {
		const { doctor } = await import("./driver.mjs");
		const result = await doctor();
		report(result);
		process.exitCode = result.ok ? 0 : (result.exitCode ?? 1);
		return;
	}
	if (command === "goto") await startSession();
	let result;
	try {
		result = await request(
			command,
			command === "screenshot" ? [resolve(rest[0])] : rest,
		);
	} catch (error) {
		if (command === "close" && error.code === "ENOENT")
			result = { ok: true, closed: true };
		else
			throw new Error(`${error.message}. Run goto cockpit to start a session.`);
	}
	report(result);
	process.exitCode = result.ok ? 0 : (result.exitCode ?? 1);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main().catch((error) => {
		report({ ok: false, error: error.message });
		process.exitCode = 1;
	});
}

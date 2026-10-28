import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export function dispatchPlan(root, verb, name, args = []) {
	const candidates = readdirSync(join(root, "scripts"))
		.filter(
			(file) => file.startsWith(`${verb}-`) && /\.(mjs|ts|js)$/.test(file),
		)
		.map((file) => ({
			file,
			name: file.replace(`${verb}-`, "").replace(/\.(mjs|ts|js)$/, ""),
		}));
	const selected = candidates.find((item) => item.name === name);
	if (!selected) {
		const matches = candidates
			.filter(
				(item) =>
					item.name.includes(name ?? "") || (name ?? "").includes(item.name),
			)
			.map((item) => item.name);
		throw new Error(
			`Unknown ${verb} ${JSON.stringify(name)}. Available${matches.length ? " close matches" : " names"}: ${(matches.length ? matches : candidates.map((item) => item.name)).join(", ")}`,
		);
	}
	return {
		cwd: root,
		command:
			verb === "probe"
				? ["npm", "run", "probe:one", "--", selected.file, ...args]
				: [
						selected.file.endsWith(".ts") ? "bun" : "node",
						join(root, "scripts", selected.file),
						...args,
					],
	};
}

export function executePlan(plan, { stdio = "inherit" } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(plan.command[0], plan.command.slice(1), {
			cwd: plan.cwd,
			stdio,
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
	});
}

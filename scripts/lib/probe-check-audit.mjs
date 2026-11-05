import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "@typescript-eslint/parser";

const ignored = new Set(["range", "loc", "comments", "tokens"]);
function canonical(node) {
	if (Array.isArray(node)) return node.map(canonical);
	if (!node || typeof node !== "object") return node;
	return Object.fromEntries(
		Object.keys(node)
			.filter(
				(key) =>
					!ignored.has(key) && !(key === "raw" && node.type === "Literal"),
			)
			.sort()
			.map((key) => [key, canonical(node[key])]),
	);
}

function predicates(source) {
	const found = [];
	function visit(node) {
		if (!node || typeof node !== "object") return;
		if (
			node.type === "CallExpression" &&
			node.callee.type === "Identifier" &&
			node.callee.name === "check"
		) {
			const predicate = node.arguments[1];
			if (!predicate) throw new Error("check call has no predicate");
			found.push({
				key: JSON.stringify(canonical(predicate)),
				label: source.slice(...node.arguments[0].range),
				predicate: source.slice(...predicate.range),
			});
		}
		for (const [key, value] of Object.entries(node)) {
			if (ignored.has(key)) continue;
			if (Array.isArray(value)) value.forEach(visit);
			else if (value && typeof value === "object") visit(value);
		}
	}
	visit(parse(source, { range: true, sourceType: "module" }));
	return found;
}

/** Compare the multiset of check predicate ASTs; this does not compare their upstream data flow. */
export function auditCheckPredicates(before, after) {
	const remaining = predicates(after);
	const missing = [];
	let matched = 0;
	for (const prior of predicates(before)) {
		const index = remaining.findIndex((next) => next.key === prior.key);
		if (index < 0) missing.push(prior);
		else {
			remaining.splice(index, 1);
			matched++;
		}
	}
	const display = ({ label, predicate }) => ({ label, predicate });
	return {
		matched,
		missing: missing.map(display),
		added: remaining.map(display),
	};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const base = process.argv[2];
	const head = process.argv[3];
	if (!base)
		throw new Error(
			"Usage: node scripts/lib/probe-check-audit.mjs <base> [head]",
		);
	const results = {};
	for (const name of ["death", "docking", "binding-store", "boot"]) {
		const path = `scripts/probe-${name}.mjs`;
		const fromGit = (ref) =>
			execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" });
		results[name] = auditCheckPredicates(
			fromGit(base),
			head ? fromGit(head) : readFileSync(path, "utf8"),
		);
	}
	console.log(
		JSON.stringify({ base, head: head ?? "working-tree", results }, null, 2),
	);
	if (Object.values(results).some((result) => result.missing.length > 0))
		process.exitCode = 1;
}

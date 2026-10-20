import ts from "typescript";
import { posix } from "node:path";
import {
	PROBE_ROOTS,
	MAIN_METHOD_ROOTS,
	MAIN_METHOD_CALLERS,
	SMOKE_PROBES,
} from "./probe-contract-roots.mjs";

const snapshotEdges = new WeakMap();

/** Import closure over a git snapshot, including browser imports and worker URLs. */
export function dependencyClosure(roots, sources) {
	let edges = snapshotEdges.get(sources);
	if (!edges) {
		edges = new Map();
		snapshotEdges.set(sources, edges);
	}
	const seen = new Set();
	const visit = (file) => {
		if (seen.has(file)) return;
		seen.add(file);
		if (edges.has(file)) {
			for (const child of edges.get(file)) visit(child);
			return;
		}
		const text = sources.get(file);
		if (text === undefined) return;
		const children = new Set();
		edges.set(file, children);
		const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
		const walk = (node) => {
			if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
			if (ts.isExportDeclaration(node) && node.isTypeOnly) return;
			// Literal module paths also cover imports inside page.evaluate and the
			// new URL(..., import.meta.url) seam used by workers and worklets.
			if (ts.isStringLiteralLike(node)) {
				const raw = node.text.split("?")[0];
				if (raw.startsWith(".") || raw.startsWith("/src/")) {
					const stem = raw.startsWith("/src/")
						? raw.slice(1)
						: posix.normalize(posix.join(posix.dirname(file), raw));
					const resolved = [
						stem,
						`${stem}.ts`,
						`${stem}.js`,
						`${stem}.mjs`,
						`${stem}/index.ts`,
					].find((p) => sources.has(p));
					if (resolved) children.add(resolved);
				}
			}
			ts.forEachChild(node, walk);
		};
		walk(ast);
		for (const child of children) visit(child);
	};
	for (const root of roots) visit(root);
	return seen;
}

/** Null means at least one path has no declared owner: expand, never guess. */
export function affectedProbes(changed, before, after, contracts) {
	const covered = new Set();
	const selected = [];
	for (const [probe, roots] of Object.entries(contracts)) {
		const dependencies = new Set([
			...dependencyClosure(roots, before),
			...dependencyClosure(roots, after),
		]);
		const hits = changed.filter((file) => dependencies.has(file));
		if (hits.length) selected.push(probe);
		for (const file of hits) covered.add(file);
	}
	return changed.every((file) => covered.has(file)) ? selected.sort() : null;
}

/** Only body-only edits to existing Game methods can use reviewed ownership.
 * Imports, fields, signatures, additions/deletions and top-level boot expand.
 */
export function changedMethods(before, after) {
	const parts = (text) => {
		const ast = ts.createSourceFile(
			"main.ts",
			text,
			ts.ScriptTarget.Latest,
			true,
		);
		if (ast.parseDiagnostics.length) return null;
		const game = ast.statements.find(
			(n) => ts.isClassDeclaration(n) && n.name?.text === "Game",
		);
		if (!game) return null;
		const bodies = new Map();
		let skeleton = "";
		let last = 0;
		for (const member of game.members) {
			if (
				!ts.isMethodDeclaration(member) ||
				!member.body ||
				!ts.isIdentifier(member.name)
			)
				continue;
			const start = member.body.getStart(ast);
			const end = member.body.end;
			bodies.set(member.name.text, text.slice(start, end));
			skeleton += text.slice(last, start) + "{}";
			last = end;
		}
		return { bodies, skeleton: skeleton + text.slice(last) };
	};
	const a = parts(before),
		b = parts(after);
	if (!a || !b || a.skeleton !== b.skeleton) return null;
	return [...a.bodies.keys()].filter(
		(key) => a.bodies.get(key) !== b.bodies.get(key),
	);
}

function memberReads(text, method) {
	const ast = ts.createSourceFile(
		"main.ts",
		text,
		ts.ScriptTarget.Latest,
		true,
	);
	const reads = new Set();
	const walk = (node) => {
		if (ts.isPropertyAccessExpression(node)) reads.add(node.getText(ast));
		if (ts.isElementAccessExpression(node)) reads.add(node.getText(ast));
		if (ts.isCallExpression(node)) reads.add(node.expression.getText(ast));
		if (ts.isNewExpression(node))
			reads.add(`new:${node.expression.getText(ast)}`);
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
			node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
		)
			reads.add(`write:${node.left.getText(ast)}`);
		if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
			reads.add(`unary:${node.operator}:${node.operand.getText(ast)}`);
		if (ts.isDeleteExpression(node))
			reads.add(`delete:${node.expression.getText(ast)}`);
		ts.forEachChild(node, walk);
	};
	const game = ast.statements.find(
		(n) => ts.isClassDeclaration(n) && n.name?.text === "Game",
	);
	const member = game?.members.find((n) => n.name?.getText(ast) === method);
	if (member) walk(member);
	return reads;
}

export function methodCallers(text, method) {
	const ast = ts.createSourceFile(
		"main.ts",
		text,
		ts.ScriptTarget.Latest,
		true,
	);
	const game = ast.statements.find(
		(n) => ts.isClassDeclaration(n) && n.name?.text === "Game",
	);
	if (!game) return [];
	const callers = [];
	for (const member of game.members) {
		let hit = false;
		const walk = (node) => {
			if (ts.isPropertyAccessExpression(node) && node.name.text === method)
				hit = true;
			if (
				ts.isElementAccessExpression(node) &&
				ts.isStringLiteralLike(node.argumentExpression) &&
				node.argumentExpression.text === method
			)
				hit = true;
			ts.forEachChild(node, walk);
		};
		walk(member);
		if (hit)
			callers.push(
				ts.isConstructorDeclaration(member)
					? "constructor"
					: member.name?.getText(ast),
			);
	}
	return callers.sort();
}

/** Probe registries: the declaration that holds each one's entries, and
 * whether an existing entry may change. A catalog or roots edit changes what an
 * existing contract means; a quarantine edit only changes whether it gates.
 */
export const PROBE_REGISTRIES = Object.freeze({
	"scripts/lib/probe-catalog.mjs": { declaration: "PROBE_CATALOG" },
	"scripts/lib/probe-contract-roots.mjs": { declaration: "OWNERS" },
	"scripts/lib/probe-quarantine.mjs": {
		declaration: "QUARANTINED",
		edits: true,
	},
});

/** The node naming an entry's probe file, in each registry's shape. */
function entryKey(item) {
	// OWNERS: `"probe-x.mjs": [roots]`
	if (ts.isPropertyAssignment(item)) return item.name;
	// PROBE_CATALOG: `entry("probe-x.mjs", contract, evidence)`
	if (ts.isCallExpression(item)) return item.arguments[0];
	// QUARANTINED: `["probe-x.mjs", "#123 why"]`
	if (ts.isArrayLiteralExpression(item)) return item.elements[0];
	return undefined;
}

/** Entries keyed by probe file, and the file's text with the list cut out. */
function registryEntries(text, declaration) {
	const ast = ts.createSourceFile("r.mjs", text, ts.ScriptTarget.Latest, true);
	if (ast.parseDiagnostics.length) return null;
	let list;
	const find = (node) => {
		if (list) return;
		if (ts.isArrayLiteralExpression(node)) list = node.elements;
		else if (ts.isObjectLiteralExpression(node)) list = node.properties;
		else ts.forEachChild(node, find);
	};
	const walk = (node) => {
		if (
			ts.isVariableDeclaration(node) &&
			node.name.getText(ast) === declaration
		)
			find(node.initializer);
		else ts.forEachChild(node, walk);
	};
	walk(ast);
	if (!list) return null;
	const entries = new Map();
	for (const item of list) {
		const key = entryKey(item);
		if (!key || !ts.isStringLiteralLike(key) || entries.has(key.text))
			return null;
		entries.set(key.text, item.getText(ast));
	}
	return {
		entries,
		skeleton: text.slice(0, list.pos) + text.slice(list.end),
	};
}

/** Probes whose registry entries a change adds, or in the quarantine also
 * edits or removes. Null when it edits or removes a catalog or roots entry, or
 * changes a line outside the lists. Entry order is free: lists are read as sets.
 */
export function registryChanges(changedFiles, before, after) {
	const changed = new Set();
	for (const [file, { declaration, edits }] of Object.entries(
		PROBE_REGISTRIES,
	)) {
		if (!changedFiles.includes(file)) continue;
		const a = registryEntries(before.get(file) ?? "", declaration),
			b = registryEntries(after.get(file) ?? "", declaration);
		if (!a || !b || a.skeleton !== b.skeleton) return null;
		for (const [key, text] of a.entries)
			if (b.entries.get(key) !== text) {
				if (!edits) return null;
				changed.add(key);
			}
		for (const key of b.entries.keys())
			if (!a.entries.has(key)) changed.add(key);
	}
	return changed.size ? [...changed].sort() : null;
}

/** Deterministic selection from both revisions. Unknown ownership expands all. */
/** Files no browser probe can observe: documentation, headless tests and lint configuration. */
export const isNonRuntime = (file) =>
	file.startsWith("docs/") ||
	file.startsWith("tests/") ||
	file.endsWith(".md") ||
	file === "biome.jsonc" ||
	file === "eslint.config.mjs" ||
	file === "eslint-suppressions.json";

export function selectImpact(changedFiles, impact, inventory) {
	if (
		Object.keys(PROBE_ROOTS).length !== inventory.length ||
		inventory.some((p) => !PROBE_ROOTS[p])
	)
		return {
			reason: "Probe dependency ownership differs from the runner inventory.",
		};
	const { before, after } = impact;
	const runtime = changedFiles.filter((p) => !isNonRuntime(p));
	const mainChanged = runtime.includes("src/main.ts");
	const paths = runtime.filter((p) => p !== "src/main.ts");
	let methods = [];
	if (mainChanged) {
		const a = before.get("src/main.ts") ?? "",
			b = after.get("src/main.ts") ?? "";
		methods = changedMethods(a, b);
		if (!methods?.length || methods.some((m) => !MAIN_METHOD_ROOTS[m]))
			return {
				reason:
					"src/main.ts changes unowned methods, declarations or boot wiring.",
			};
		if (
			methods.some((m) =>
				[a, b].some(
					(text) =>
						JSON.stringify(methodCallers(text, m)) !==
						JSON.stringify(MAIN_METHOD_CALLERS[m]),
				),
			)
		)
			return {
				reason:
					"src/main.ts method callers differ from reviewed ownership; impact needs review.",
			};
		// A mapped projection acquiring a new collaborator needs an ownership
		// review. Do not silently keep its old consumer list.
		if (
			methods.some((m) => {
				const oldReads = memberReads(a, m),
					newReads = memberReads(b, m);
				return [...newReads].some((r) => !oldReads.has(r));
			})
		)
			return {
				reason:
					"src/main.ts introduces new calls/member access; impact needs review.",
			};
		paths.push(...methods.flatMap((m) => MAIN_METHOD_ROOTS[m]));
	}
	const a = new Map(before),
		b = new Map(after);
	// The orchestrator's import fan-out is not a behavioral dependency. Its
	// changes are checked above; contracts declare the mechanisms they observe.
	a.delete("src/main.ts");
	b.delete("src/main.ts");
	// A measurement script is run by hand, never by the runner. One that no
	// contract reaches in either revision cannot change a probe; one a probe
	// imports keeps that probe's ownership below.
	const contracts = Object.values(PROBE_ROOTS);
	const instruments = paths.filter(
		(p) =>
			/^scripts\/measure-[^/]+$/.test(p) &&
			!contracts.some(
				(roots) =>
					dependencyClosure(roots, a).has(p) ||
					dependencyClosure(roots, b).has(p),
			),
	);
	const owned = paths.filter((p) => !instruments.includes(p));
	const affected = affectedProbes(owned, a, b, PROBE_ROOTS);
	if (!affected)
		return {
			reason:
				"At least one changed path has no dependency owner; impact is unknown.",
		};
	return {
		probes: [...new Set([...SMOKE_PROBES, ...affected])].sort(),
		reason: `Smoke plus contracts reached through base/head dependencies${methods.length ? `; Game.${methods.join(", Game.")}` : ""}${instruments.length ? `; no probe loads measurement script ${instruments.join(", ")}` : ""}.`,
	};
}

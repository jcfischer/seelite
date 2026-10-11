/**
 * What a script reads off `/src` still exists there.
 *
 * Probes and measurement scripts are `.mjs` and `tsc` never sees them, so a
 * renamed export or a renamed save field reaches them only as a browser red
 * — after a suite, or on ranger's worker. Two did: removing `SHIELD_POOL` left
 * `conditionMod.SHIELD_POOL` in `probe-traffic-engagement.mjs` (#866), and
 * `ownedEquipment` becoming `loadout` crashed `probe-system-sweep.mjs` (#769).
 *
 * This reads each script's AST: every `import("/src/…")` binding — a module
 * name read as `mod.X`, a destructured `{ X }`, or `(await import(…)).X` —
 * must name an export of that module, and every `g.commander.X` a field of
 * `CommanderState`.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dir, "..");

type Use = { script: string; line: number; module: string; member: string };

const parse = (file: string, text: string) =>
	ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

const lineOf = (node: ts.Node) =>
	node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;

/** The runtime names a module exports, following `export *`. */
export function moduleExports(
	file: string,
	read: (file: string) => string | undefined,
	seen = new Set<string>(),
): Set<string> {
	const names = new Set<string>();
	if (seen.has(file)) return names;
	seen.add(file);
	const text = read(file);
	if (text === undefined) return names;
	const exported = (n: ts.Node) =>
		ts.canHaveModifiers(n) &&
		ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
	for (const s of parse(file, text).statements) {
		if (ts.isVariableStatement(s) && exported(s)) {
			for (const d of s.declarationList.declarations)
				if (ts.isIdentifier(d.name)) names.add(d.name.text);
		} else if (
			(ts.isFunctionDeclaration(s) ||
				ts.isClassDeclaration(s) ||
				ts.isEnumDeclaration(s)) &&
			exported(s)
		) {
			const isDefault = ts
				.getModifiers(s)
				?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
			if (isDefault) names.add("default");
			else if (s.name) names.add(s.name.text);
		} else if (ts.isExportAssignment(s)) names.add("default");
		else if (ts.isExportDeclaration(s)) {
			const from =
				s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier)
					? resolveModule(join(dirname(file), s.moduleSpecifier.text), read)
					: undefined;
			if (!s.exportClause) {
				if (from) for (const n of moduleExports(from, read, seen)) names.add(n);
			} else if (ts.isNamespaceExport(s.exportClause))
				names.add(s.exportClause.name.text);
			else
				for (const e of s.exportClause.elements)
					if (!e.isTypeOnly) names.add(e.name.text);
		}
	}
	return names;
}

function resolveModule(stem: string, read: (f: string) => string | undefined) {
	const base = stem.replace(/\.(js|mjs)$/, "");
	return [
		stem,
		`${base}.ts`,
		`${base}.js`,
		`${base}.mjs`,
		`${base}/index.ts`,
	].find((p) => read(p) !== undefined);
}

/** Every member a script reads off a dynamically imported `/src` module. */
export function srcUses(script: string, text: string): Use[] {
	const uses: Use[] = [];
	const sf = parse(script, text);
	// name → module per block that declares it; null when a declaration that
	// is not a /src import shadows an outer one.
	const scopes = new Map<ts.Node, Map<string, string | null>>();
	const blockOf = (n: ts.Node): ts.Node => {
		let p = n.parent;
		while (p && !ts.isBlock(p) && !ts.isSourceFile(p)) p = p.parent;
		return p ?? sf;
	};
	const bind = (decl: ts.Node, name: string, module: string | null) => {
		const block = blockOf(decl);
		if (!scopes.has(block)) scopes.set(block, new Map());
		scopes.get(block)!.set(name, module);
	};
	const lookup = (n: ts.Node, name: string) => {
		for (let p: ts.Node | undefined = n; p; p = p.parent) {
			const scope = scopes.get(p);
			if (scope?.has(name)) return scope.get(name) ?? undefined;
		}
		return undefined;
	};
	const add = (n: ts.Node, module: string, member: string) =>
		uses.push({ script, line: lineOf(n), module, member });
	const srcImport = (n: ts.Node): string | undefined => {
		let e = n;
		while (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e))
			e = e.expression;
		if (
			ts.isCallExpression(e) &&
			e.expression.kind === ts.SyntaxKind.ImportKeyword &&
			e.arguments[0] &&
			ts.isStringLiteralLike(e.arguments[0]) &&
			e.arguments[0].text.startsWith("/src/")
		)
			return e.arguments[0].text.slice(1).split("?")[0];
		return undefined;
	};
	const destructure = (pattern: ts.ObjectBindingPattern, module: string) => {
		for (const el of pattern.elements) {
			const key = el.propertyName ?? el.name;
			if (ts.isIdentifier(key)) add(el, module, key.text);
		}
	};
	// Bindings first, so a use above its declaration in source order resolves.
	const declare = (n: ts.Node) => {
		if (ts.isVariableDeclaration(n) && n.initializer) {
			if (ts.isIdentifier(n.name))
				bind(n, n.name.text, srcImport(n.initializer) ?? null);
		}
		ts.forEachChild(n, declare);
	};
	declare(sf);
	const visit = (n: ts.Node) => {
		if (ts.isVariableDeclaration(n) && n.initializer) {
			const module = srcImport(n.initializer);
			if (module && ts.isObjectBindingPattern(n.name))
				destructure(n.name, module);
			// `const { X } = mod` after `const mod = await import(…)`.
			if (ts.isIdentifier(n.initializer) && ts.isObjectBindingPattern(n.name)) {
				const bound = lookup(n, n.initializer.text);
				if (bound) destructure(n.name, bound);
			}
		}
		if (ts.isPropertyAccessExpression(n)) {
			const direct = srcImport(n.expression);
			if (direct) add(n.name, direct, n.name.text);
			else if (ts.isIdentifier(n.expression)) {
				const bound = lookup(n, n.expression.text);
				if (bound) add(n.name, bound, n.name.text);
			}
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	return uses;
}

/** Every field a script reads as `g.commander.X` (or `game.` / `__seelite.`). */
export function commanderUses(script: string, text: string) {
	const uses: { script: string; line: number; field: string }[] = [];
	const visit = (n: ts.Node) => {
		if (
			ts.isPropertyAccessExpression(n) &&
			ts.isPropertyAccessExpression(n.expression) &&
			n.expression.name.text === "commander" &&
			ts.isIdentifier(n.expression.expression) &&
			["g", "game", "__seelite"].includes(n.expression.expression.text)
		)
			uses.push({ script, line: lineOf(n), field: n.name.text });
		ts.forEachChild(n, visit);
	};
	visit(parse(script, text));
	return uses;
}

const read = (file: string) => {
	const path = resolve(root, file);
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
};
const scripts = readdirSync(resolve(root, "scripts"))
	.filter((f) => f.endsWith(".mjs"))
	.map((f) => `scripts/${f}`);

describe("what a script reads off /src", () => {
	const uses = scripts.flatMap((s) => srcUses(s, read(s)!));
	const exportsOf = new Map<string, Set<string>>();

	test("finds the reads it exists to check", () => {
		// A parser that stopped matching would pass every row below on nothing.
		expect(uses.length).toBeGreaterThan(200);
		expect(
			uses.some(
				(u) =>
					u.script === "scripts/probe-traffic-engagement.mjs" &&
					u.module === "src/ship-condition.ts",
			),
		).toBe(true);
	});

	test("every member names an export of its module", () => {
		const missing = uses
			.filter((u) => {
				const file = resolveModule(u.module, read);
				if (!file) return true;
				if (!exportsOf.has(file))
					exportsOf.set(file, moduleExports(file, read));
				return !exportsOf.get(file)!.has(u.member);
			})
			.map(
				(u) => `${u.script}:${u.line} ${u.module} has no export ${u.member}`,
			);
		expect(missing).toEqual([]);
	});

	test("a removed export is reported, by every binding form", () => {
		const fake = (f: string) =>
			f === "src/m.ts" ? "export const KEPT = 1;" : undefined;
		const script = [
			'const m = await import("/src/m.ts");',
			"m.KEPT; m.GONE;",
			'const { GONE: g2 } = await import("/src/m.ts");',
			'(await import("/src/m.ts")).GONE;',
			"{ const m = 1; m.NOT_A_MODULE; }",
		].join("\n");
		const found = srcUses("scripts/x.mjs", script);
		const names = moduleExports("src/m.ts", fake);
		expect(
			found.filter((u) => !names.has(u.member)).map((u) => [u.line, u.member]),
		).toEqual([
			[2, "GONE"],
			[3, "GONE"],
			[4, "GONE"],
		]);
	});
});

describe("what a script reads off the commander", () => {
	const fields = (() => {
		const sf = parse(
			"src/station-commerce.ts",
			read("src/station-commerce.ts")!,
		);
		const state = sf.statements.find(
			(s): s is ts.InterfaceDeclaration =>
				ts.isInterfaceDeclaration(s) && s.name.text === "CommanderState",
		)!;
		return new Set(
			state.members
				.map((m) => (m.name && ts.isIdentifier(m.name) ? m.name.text : ""))
				.filter(Boolean),
		);
	})();
	const uses = scripts.flatMap((s) => commanderUses(s, read(s)!));

	test("finds CommanderState and the reads", () => {
		expect(fields.has("loadout")).toBe(true);
		expect(uses.length).toBeGreaterThan(50);
	});

	test("every field is one CommanderState declares", () => {
		expect(
			uses
				.filter((u) => !fields.has(u.field))
				.map((u) => `${u.script}:${u.line} commander has no field ${u.field}`),
		).toEqual([]);
	});
});

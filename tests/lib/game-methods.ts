/**
 * Run `Game`'s real methods, and `main.ts`'s own top-level functions, without
 * constructing WebGL. The members are read out of the source with the
 * TypeScript AST, transpiled into a bare class, and handed the module-level
 * names they close over through `bindings`, so a test drives the shipped body
 * rather than restating it. `display-contact.test.ts` also reads the parsed
 * source itself, which is why `mainSource` and `gameClass` are exported.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { repoPath } from "./source-scan";

export const mainSource = ts.createSourceFile(
	"main.ts",
	readFileSync(repoPath("src/main.ts"), "utf8"),
	ts.ScriptTarget.Latest,
	true,
);
const source = mainSource;
export const gameClass = source.statements.find(
	(n): n is ts.ClassDeclaration =>
		ts.isClassDeclaration(n) && n.name?.text === "Game",
);

const transpile = (text: string) =>
	ts.transpileModule(text, {
		compilerOptions: { target: ts.ScriptTarget.ES2022 },
	}).outputText;

function bind(js: string, ret: string, bindings: Record<string, unknown>) {
	const names = Object.keys(bindings);
	return new Function(...names, `${js}; return ${ret};`)(
		...names.map((n) => bindings[n]),
	);
}

/** The source text of one of `Game`'s methods or getters. */
export function gameMethodSource(name: string): string {
	const member = gameClass?.members.find(
		(n) =>
			(ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n)) &&
			n.name.getText(source) === name,
	);
	if (!member) throw new Error(`Missing Game.${name}`);
	return member.getText(source);
}

/** Game.render statements from a named declaration through a for-of loop, inclusive. */
export function renderStatementSlice(
	startName: string,
	loopExpr: string,
): string {
	const render = gameClass?.members.find(
		(member) =>
			ts.isMethodDeclaration(member) &&
			member.name.getText(source) === "render",
	);
	if (!render || !ts.isMethodDeclaration(render) || !render.body)
		throw new Error("Missing Game.render body");
	const statements = [...render.body.statements];
	const start = statements.findIndex(
		(statement) =>
			ts.isVariableStatement(statement) &&
			statement.declarationList.declarations.some(
				(declaration) => declaration.name.getText(source) === startName,
			),
	);
	if (start < 0)
		throw new Error(`Missing Game.render declaration: ${startName}`);
	const end = statements.findIndex(
		(statement) =>
			ts.isForOfStatement(statement) &&
			statement.expression.getText(source) === loopExpr,
	);
	if (end <= start)
		throw new Error(`Missing Game.render loop after ${startName}: ${loopExpr}`);
	return statements
		.slice(start, end + 1)
		.map((statement) => statement.getText(source))
		.join("\n");
}

/** `Game`'s named methods and getters, on a prototype with no constructor. */
export function gameMethods(
	names: string[],
	bindings: Record<string, unknown> = {},
): any {
	return bind(
		transpile(`class Subject { ${names.map(gameMethodSource).join("\n")} }`),
		"Subject.prototype",
		bindings,
	);
}

/** One of `main.ts`'s top-level function declarations. */
export function mainFunction(
	name: string,
	bindings: Record<string, unknown> = {},
): (...args: any[]) => any {
	const fn = source.statements.find(
		(n): n is ts.FunctionDeclaration =>
			ts.isFunctionDeclaration(n) && n.name?.text === name,
	);
	if (!fn) throw new Error(`Missing function ${name} in main.ts`);
	return bind(transpile(fn.getText(source)), name, bindings);
}

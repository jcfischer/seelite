/**
 * Run `Game`'s real methods, and `main.ts`'s own top-level functions, without
 * constructing WebGL — the way `display-contact.test.ts` does. The members are
 * read out of the source with the TypeScript AST, transpiled into a bare class,
 * and handed the module-level names they close over through `bindings`, so a
 * test drives the shipped body rather than restating it.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.createSourceFile(
	"main.ts",
	readFileSync("src/main.ts", "utf8"),
	ts.ScriptTarget.Latest,
	true,
);
const game = source.statements.find(
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

/** `Game`'s named methods and getters, on a prototype with no constructor. */
export function gameMethods(
	names: string[],
	bindings: Record<string, unknown> = {},
): any {
	const members = names.map((name) => {
		const member = game?.members.find(
			(n) =>
				(ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n)) &&
				n.name.getText(source) === name,
		);
		if (!member) throw new Error(`Missing Game.${name}`);
		return member.getText(source);
	});
	return bind(
		transpile(`class Subject { ${members.join("\n")} }`),
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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

const transpiler = new Bun.Transpiler({ loader: "ts" });

function tsFiles(dir: string): string[] {
	return readdirSync(dir)
		.flatMap((name) => {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) return tsFiles(path);
			return path.endsWith(".ts") ? [path] : [];
		})
		.sort();
}

/**
 * Each `.ts` module under `dir`, mapped to the modules under `dir` it imports.
 * Edges come from Bun's own import scan, so a type-only import is not an edge;
 * static imports, re-exports and dynamic `import()` all are, and a query
 * suffix such as `?worker` is dropped. The result over-approximates what runs
 * at evaluation time, which is the safe direction for a cycle search.
 */
export function importGraph(dir: string): Map<string, string[]> {
	const files = tsFiles(dir);
	const known = new Set(files);
	const graph = new Map<string, string[]>();
	for (const file of files) {
		const deps = transpiler
			.scanImports(readFileSync(file, "utf8"))
			.map((i) => i.path.split("?")[0])
			.filter((p) => p.startsWith("."))
			.map((p) => {
				const path = normalize(join(dirname(file), p));
				return path.endsWith(".ts") ? path : `${path}.ts`;
			})
			.filter((p) => known.has(p));
		graph.set(file, [...new Set(deps)]);
	}
	return graph;
}

/**
 * Every module that sits on an import cycle: the members of each strongly
 * connected component larger than one, and any module that imports itself.
 *
 * Only these can throw a temporal-dead-zone error on a first import. A module
 * on no cycle has every dependency fully evaluated before its own body runs,
 * so nothing it reads can be uninitialised; entering a cycle from outside it
 * enters at one member, which importing that member first reproduces.
 */
export function cycleMembers(graph: Map<string, string[]>): string[] {
	let next = 0;
	const index = new Map<string, number>();
	const low = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const members: string[] = [];
	const visit = (v: string): void => {
		index.set(v, next);
		low.set(v, next);
		next++;
		stack.push(v);
		onStack.add(v);
		for (const w of graph.get(v) ?? []) {
			if (!index.has(w)) {
				visit(w);
				low.set(v, Math.min(low.get(v)!, low.get(w)!));
			} else if (onStack.has(w)) {
				low.set(v, Math.min(low.get(v)!, index.get(w)!));
			}
		}
		if (low.get(v) !== index.get(v)) return;
		const component: string[] = [];
		let w: string;
		do {
			w = stack.pop()!;
			onStack.delete(w);
			component.push(w);
		} while (w !== v);
		if (component.length > 1 || graph.get(v)!.includes(v)) {
			members.push(...component);
		}
	};
	for (const v of graph.keys()) if (!index.has(v)) visit(v);
	return members.sort();
}

const TDZ = /Cannot access '[^']+' before initialization/;

/**
 * Imports each module first and alone, one fresh `bun` process per module, and
 * returns the ones whose first import threw a temporal-dead-zone
 * `ReferenceError`, with the message. Any other failure (a module that needs
 * `document`, `window` or a worklet global) is outside the headless tier and
 * is not reported: this asks about evaluation order and nothing else.
 */
export async function firstImportTdz(
	modules: string[],
	cwd: string,
): Promise<{ module: string; error: string }[]> {
	const runs = modules.map(async (module) => {
		const proc = Bun.spawn(
			[
				process.execPath,
				"-e",
				`await import(${JSON.stringify(resolve(cwd, module))})`,
			],
			{ cwd, stdout: "ignore", stderr: "pipe" },
		);
		const timer = setTimeout(() => proc.kill(), 30_000);
		const stderr = await new Response(proc.stderr).text();
		await proc.exited;
		clearTimeout(timer);
		const error = stderr.split("\n").find((line) => TDZ.test(line));
		return error
			? { module: relative(cwd, resolve(cwd, module)), error }
			: null;
	});
	return (await Promise.all(runs)).filter((r) => r !== null);
}

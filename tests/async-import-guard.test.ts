import { expect, test } from "bun:test";
import { rollup } from "rollup";
import { asyncImportGuard } from "../scripts/lib/async-import-guard.mjs";

/** The production failure: cockpit is both a static dependency of main and
 * dynamically imported by its loader. Rollup folds cockpit into main. */
async function buildFixture({ fixed = false, awaited = true } = {}) {
	const modules: Record<string, string> = {
		main: `import { load } from 'loader';
			import { cockpit } from 'cockpit';
			export const result = ${awaited ? "await" : ""} load();
			console.log(cockpit);`,
		loader: fixed
			? `import { cockpit } from 'cockpit'; export const load = async () => cockpit;`
			: `export const load = async () => (await import('cockpit')).cockpit;`,
		cockpit: `export const cockpit = 'ready';`,
	};
	const build = await rollup({
		input: "main",
		plugins: [
			{
				name: "fixture",
				resolveId: (id) => (id in modules ? id : null),
				load: (id) => modules[id],
			},
			asyncImportGuard(),
		],
	});
	try {
		return await build.generate({ format: "es" });
	} finally {
		await build.close();
	}
}

test("refuses the bundled cockpit self-import before it can ship", async () => {
	await expect(buildFixture()).rejects.toThrow("async startup import cycle");
});

test("direct cockpit dependency builds without the startup cycle", async () => {
	await expect(buildFixture({ fixed: true })).resolves.toBeDefined();
});

test("await inside a function is not top-level await", async () => {
	await expect(buildFixture({ awaited: false })).resolves.toBeDefined();
});

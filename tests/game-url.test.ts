/**
 * One way for a script to boot the game (`persistent-world-state.md` §11.6).
 *
 * #306 puts the Commander overlay in front of every boot. A browser script that
 * loads the default route and waits for a booted game would then wait on an
 * overlay nobody answers, so every such boot goes through `gameUrl`, which adds
 * `?boot=direct`. This file holds the builder to that and holds the scripts to
 * the builder.
 *
 * The row that matters most is the scan. A script that builds its own game URL
 * keeps working until the overlay lands and then hangs on it, and nothing on
 * GitHub runs the probes (#14) — so the hand-built URL has to fail here, in
 * the headless tier, where CI does run.
 *
 * The scan reads the navigations a **script** makes. The page makes its own: a
 * workbench's close drops its route parameter and assigns the rest of the URL,
 * which lands on the default route. No text scan of `scripts/` sees that, so
 * `workbenchUrl` carries `boot=direct` as well, and a row below holds both
 * closes to keeping every other parameter.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BOOT_DIRECT,
	BOOT_PARAM,
	gameUrl,
	PUBLIC_ROUTES,
	publicUrl,
	WORKBENCH_ROUTES,
	workbenchUrl,
} from "../scripts/lib/game-url.mjs";
import {
	BOOT_QUERY,
	BOOT_DIRECT as SRC_BOOT_DIRECT,
	bootMode,
} from "../src/boot-mode";
import {
	callArguments,
	codeOf,
	repoPath,
	scriptFiles,
	stripComments,
} from "./lib/source-scan";

const ORIGIN = "http://127.0.0.1:5199";

const BUILDERS = ["gameUrl", "workbenchUrl", "publicUrl"];

/**
 * Every `.goto(` in a script source whose URL is not visibly a builder's.
 *
 * Accepted: a builder call as the argument, or a name bound by
 * `const|let|var NAME = gameUrl(…)` / `workbenchUrl(…)` somewhere in the file.
 * Refused: everything else, including a function parameter — its call sites
 * are not checked, so a helper that takes a URL has to build it inside.
 *
 * Textual, and it says so: a name bound to a builder in one scope and shadowed
 * by a hand-built string in another passes. It reads the source through the
 * suite's one comment stripper and one argument walker (`tests/lib/source-scan.ts`)
 * rather than its own, and inherits that stripper's stated limit — a
 * block-comment opener inside a string literal blanks what follows it.
 */
function unbuiltNavigations(source: string): { line: number; arg: string }[] {
	const code = stripComments(source);
	const builderCall = new RegExp(`^(?:${BUILDERS.join("|")})\\s*\\(`);
	const bound = new Set(
		[
			...code.matchAll(
				new RegExp(
					`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${BUILDERS.join("|")})\\s*\\(`,
					"g",
				),
			),
		].map((m) => m[1]),
	);
	return callArguments(code, /\.goto\s*\(/g).flatMap(({ index, args }) => {
		const arg = (args[0] ?? "").trim();
		if (builderCall.test(arg)) return [];
		if (/^[A-Za-z_$][\w$]*$/.test(arg) && bound.has(arg)) return [];
		return [{ line: code.slice(0, index).split("\n").length, arg }];
	});
}

describe("gameUrl", () => {
	test("adds boot=direct to a default-route boot", () => {
		const url = new URL(gameUrl(ORIGIN, { seed: 42 }));
		expect(url.origin).toBe(ORIGIN);
		expect(url.pathname).toBe("/");
		expect(url.searchParams.get("seed")).toBe("42");
		expect(url.searchParams.get("boot")).toBe("direct");
	});

	test("with no parameters it still boots direct", () => {
		expect(new URL(gameUrl(ORIGIN)).searchParams.get("boot")).toBe("direct");
	});

	test("a true parameter is a bare flag, which is how the game reads ?fps", () => {
		const url = gameUrl(ORIGIN, { seed: 47, fps: true });
		expect(url).toContain("fps");
		expect(new URL(url).searchParams.has("fps")).toBe(true);
		expect(new URL(url).searchParams.get("fps")).toBe("");
	});

	test("false and undefined parameters are left off", () => {
		const url = new URL(
			gameUrl(ORIGIN, { seed: 1, combat: false, hull: undefined }),
		);
		expect(url.searchParams.has("combat")).toBe(false);
		expect(url.searchParams.has("hull")).toBe(false);
	});

	test("a caller cannot set boot through the parameters", () => {
		expect(() => gameUrl(ORIGIN, { boot: "overlay" })).toThrow(/boot/);
	});

	test("boot: null leaves the parameter off, for a probe of the overlay itself", () => {
		expect(
			new URL(gameUrl(ORIGIN, { seed: 3 }, { boot: null })).searchParams.has(
				"boot",
			),
		).toBe(false);
	});

	test("an override replaces the origin and query, and still boots direct", () => {
		const url = new URL(
			gameUrl(
				ORIGIN,
				{ seed: 42 },
				{ override: "http://other.test:9/?seed=7" },
			),
		);
		expect(url.origin).toBe("http://other.test:9");
		expect(url.searchParams.get("seed")).toBe("7");
		expect(url.searchParams.get("boot")).toBe("direct");
	});

	test("an override's parameters win, and the caller's fill in what it lacks", () => {
		const url = new URL(
			gameUrl(
				ORIGIN,
				{ seed: 42, fps: true },
				{ override: "http://other.test:9/?seed=7" },
			),
		);
		expect(url.searchParams.get("seed")).toBe("7");
		expect(url.searchParams.has("fps")).toBe(true);
	});

	test("an override that already names a boot keeps it", () => {
		const url = new URL(
			gameUrl(ORIGIN, {}, { override: `${ORIGIN}/?boot=overlay` }),
		);
		expect(url.searchParams.get("boot")).toBe("overlay");
	});

	test("an empty override is no override", () => {
		expect(
			new URL(gameUrl(ORIGIN, { seed: 2 }, { override: "" })).searchParams.get(
				"seed",
			),
		).toBe("2");
	});

	test("a forced parameter overwrites the override's value", () => {
		// `probe-boot`'s combat arm: a `PROBE_URL` carrying `combat=0` must not
		// switch off the flag the arm exists to set.
		const url = new URL(
			gameUrl(
				ORIGIN,
				{ seed: 42, combat: 1 },
				{ override: "http://o.test:1/?seed=7&combat=0", force: ["combat"] },
			),
		);
		expect(url.searchParams.get("combat")).toBe("1");
		expect(url.searchParams.get("seed")).toBe("7");
	});

	test("force must name a parameter the caller set", () => {
		expect(() => gameUrl(ORIGIN, { seed: 1 }, { force: ["combat"] })).toThrow(
			/force/,
		);
	});

	test("a workbench route is refused, because it does not boot the game", () => {
		for (const route of WORKBENCH_ROUTES)
			expect(() => gameUrl(ORIGIN, { [route]: "x" })).toThrow(/workbench/);
	});

	test("an override naming a workbench route is refused too", () => {
		expect(() =>
			gameUrl(
				ORIGIN,
				{ seed: 1 },
				{ override: `${ORIGIN}/?model-viewer=ship` },
			),
		).toThrow(/workbench/);
	});
});

describe("publicUrl", () => {
	test("builds only the declared static public routes", () => {
		for (const route of PUBLIC_ROUTES) {
			const url = new URL(publicUrl(ORIGIN, route));
			expect(url.search).toBe("");
			expect(url.pathname).toBe(route === "" ? "/" : `/${route}/`);
		}
		expect(() => publicUrl(ORIGIN, "play")).toThrow(/unknown public route/);
	});
});

describe("workbenchUrl", () => {
	test("names its route and boots direct, for the close that drops the route", () => {
		const url = new URL(
			workbenchUrl(ORIGIN, { "model-viewer": "station", finish: "worn" }),
		);
		expect(url.searchParams.get("model-viewer")).toBe("station");
		expect(url.searchParams.get("finish")).toBe("worn");
		expect(url.searchParams.get("boot")).toBe("direct");
	});

	test("refuses parameters that name no workbench route, which would boot the game", () => {
		expect(() => workbenchUrl(ORIGIN, { seed: 42 })).toThrow(/workbench/);
	});

	test("refuses a boot in the parameters, which the close would keep", () => {
		expect(() =>
			workbenchUrl(ORIGIN, { "model-viewer": "ship", boot: "overlay" }),
		).toThrow(/boot/);
	});

	test("a route whose value is left off is no route", () => {
		expect(() => workbenchUrl(ORIGIN, { "planet-prototype": false })).toThrow(
			/workbench/,
		);
		expect(() =>
			workbenchUrl(ORIGIN, { "galaxy-map": undefined, seed: 1 }),
		).toThrow(/workbench/);
	});

	test("both workbench closes keep every parameter but their route", () => {
		// What makes `boot=direct` on a workbench URL reach the flight it closes
		// to: each close deletes its own route and assigns the rest.
		for (const [file, route] of [
			["src/model-viewer.ts", "model-viewer"],
			["src/state-gallery.ts", "hud-gallery"],
		]) {
			const code = codeOf(file);
			const assigns = code.match(/window\.location\.assign\(/g) ?? [];
			expect(assigns.length).toBe(1);
			expect(code).toMatch(
				new RegExp(
					`new URL\\(window\\.location\\.href\\);\\s*\\w+\\.searchParams\\.delete\\("${route}"\\);\\s*window\\.location\\.assign\\(`,
				),
			);
		}
	});

	test("the route list is the branches main.ts takes instead of the game", () => {
		// The chain is `if (query.has(a)) … else if (query.has(b)) … else { game }`.
		// Its `else if` arms name themselves; its head is the last plain `if` on
		// `query.has` before the first of them. `?fps` is a plain `if` too, and
		// mounts a meter *beside* whatever follows — reading every `query.has`
		// branch counted it as a workbench.
		//
		// **Since #406 the head is the postcard viewer**, which reads the
		// fragment rather than the query and is not a workbench: every workbench
		// is an `else if` arm behind it. The head is read as the last top-level
		// `if (…) {` before the first arm, so a workbench moved to the head — or
		// a query gate slipped in front of the viewer — is a red row here.
		const main = readFileSync(join(import.meta.dir, "../src/main.ts"), "utf8");
		const firstElseIf = main.search(/\} else if \(query\.has\(/);
		expect(firstElseIf).toBeGreaterThan(0);
		const head = [
			...main.slice(0, firstElseIf).matchAll(/\nif \((.+)\) \{/g),
		].at(-1);
		expect(head?.[1]).toBe("postcard");
		const arms = [
			...main.matchAll(/\} else if \(query\.has\("([a-z-]+)"\)\)/g),
		].map((m) => m[1]);
		expect(arms.sort()).toEqual([...WORKBENCH_ROUTES].sort());
		expect(main.slice(firstElseIf)).toMatch(/\} else \{[\s\S]*new Game\(/);
	});

	test("an override replaces the whole URL, and must still name a workbench", () => {
		expect(
			workbenchUrl(
				ORIGIN,
				{ "planet-prototype": true },
				{ override: "http://o.test:1/?planet-prototype=moon" },
			),
		).toBe("http://o.test:1/?planet-prototype=moon&boot=direct");
		expect(() =>
			workbenchUrl(
				ORIGIN,
				{ "planet-prototype": true },
				{ override: "http://o.test:1/?seed=4" },
			),
		).toThrow(/workbench/);
	});
});

describe("the page and the builder name one parameter", () => {
	test("the builder's name and value are the ones main.ts reads", () => {
		expect(BOOT_PARAM).toBe(BOOT_QUERY);
		expect(BOOT_DIRECT).toBe(SRC_BOOT_DIRECT);
	});

	test("bootMode reads direct from what gameUrl builds", () => {
		expect(bootMode(new URL(gameUrl(ORIGIN, { seed: 1 })).searchParams)).toBe(
			"direct",
		);
	});

	test("anything else is the overlay, which is every player's boot", () => {
		expect(bootMode(new URLSearchParams(""))).toBe("overlay");
		expect(bootMode(new URLSearchParams("seed=4"))).toBe("overlay");
		expect(bootMode(new URLSearchParams("boot=Direct"))).toBe("overlay");
		expect(bootMode(new URLSearchParams("boot="))).toBe("overlay");
	});
});

describe("unbuiltNavigations", () => {
	const found = (src: string) => unbuiltNavigations(src).map((n) => n.arg);

	test("a template URL is refused", () => {
		expect(
			found("await page.goto(`${ORIGIN}/?seed=42`, { waitUntil: 'load' });"),
		).toEqual(["`${ORIGIN}/?seed=42`"]);
	});

	test("a bare origin is refused — it boots the default route", () => {
		expect(found("await page.goto(ORIGIN, { waitUntil: 'load' });")).toEqual([
			"ORIGIN",
		]);
	});

	test("a variable holding a hand-built URL is refused", () => {
		const src =
			"const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=42`;\nawait page.goto(URL);";
		expect(found(src)).toEqual(["URL"]);
	});

	test("a function parameter is refused, because the call sites are not checked", () => {
		expect(
			found("async function open(url) {\n\tawait page.goto(url);\n}"),
		).toEqual(["url"]);
	});

	test("a builder call is accepted, however its arguments are written", () => {
		const src = [
			"await page.goto(gameUrl(ORIGIN, { seed: `${n}`, fps: true }), { waitUntil: 'load' });",
			"await bench.goto(workbenchUrl(ORIGIN, { 'model-viewer': (x ? 'a' : 'b') }));",
		].join("\n");
		expect(found(src)).toEqual([]);
	});

	test("a variable bound to a builder call is accepted", () => {
		const src = [
			"const URL = gameUrl(ORIGIN, { seed: 42 }, { override: process.env.PROBE_URL });",
			"let other =\n\tworkbenchUrl(ORIGIN, { 'galaxy-map': 0 });",
			"await page.goto(URL);",
			"await page.goto(other, { waitUntil: 'load' });",
		].join("\n");
		expect(found(src)).toEqual([]);
	});

	test("a navigation in a comment is not a navigation", () => {
		const src =
			"/* page.goto(`${ORIGIN}/?seed=1`) */\n// await page.goto(ORIGIN);\n";
		expect(found(src)).toEqual([]);
	});

	test("every navigation in a file is read, not only the first", () => {
		const src =
			"await a.goto(gameUrl(O));\nawait b.goto(`${O}/`);\nawait c.goto(O);";
		expect(found(src)).toEqual(["`${O}/`", "O"]);
	});
});

describe("every script boots through the builder", () => {
	// `.ts` as well as `.mjs`: `scripts/` holds TypeScript instruments, and one
	// of those opening a page would boot the game like any probe.
	const all = scriptFiles([".mjs", ".ts"]);
	const sourceOf = (rel: string) => readFileSync(repoPath(rel), "utf8");

	test("the scan sees the scripts directory", () => {
		// A floor rather than a count, for `check-launcher-wiring.mjs`'s reason: a
		// retired probe should not fail this, and a scan that sees nothing must.
		const navigating = all.filter((f) => /\.goto\s*\(/.test(sourceOf(f)));
		expect(navigating.length).toBeGreaterThanOrEqual(30);
	});

	test("no script builds a game URL by hand", () => {
		const offenders = all.flatMap((f) =>
			unbuiltNavigations(sourceOf(f)).map((n) => `${f}:${n.line}: ${n.arg}`),
		);
		expect(offenders).toEqual([]);
	});
});

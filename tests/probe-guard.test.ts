/**
 * `assertServingThisTree` — the refusal that stands between a probe and a dev
 * server serving somebody else's checkout.
 *
 * **Both arms, always.** #123's fingerprint passed a sibling worktree and every
 * capture taken against it was silently of the wrong build; a check that only
 * ever sees a correct server cannot be shown to discriminate. So each row here
 * stands a real vite server up in-process and asks the guard about it: one that
 * should be refused, and one that should not.
 *
 * Headless on purpose. The guard is a fetch and a string comparison, so the
 * browser tier has nothing to add and would cost a Chromium per row.
 */
import { afterAll, expect, test } from "bun:test";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { codeOf, repoPath } from "./lib/source-scan";
import {
	assertServingThisTree,
	TREE_ENDPOINT,
} from "../scripts/probe-guard.mjs";
import { treeDeclaration } from "../scripts/lib/tree-declaration.mjs";

const REPO = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));

/**
 * A port nobody is serving on, from the OS.
 *
 * Vite's own `port: 0` is not honoured — it falls back to 5173, which is the
 * developer's `npm run dev` default. `probe-all.mjs` carries the same helper
 * for the same reason; duplicated rather than shared because that one is a
 * runner's private concern and importing it here would make a test file depend
 * on the probe runner booting.
 */
const freePort = (): Promise<number> =>
	new Promise((resolve, reject) => {
		const probe = netServer();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const { port } = probe.address() as { port: number };
			probe.close(() => resolve(port));
		});
	});

/**
 * Every server this file starts, closed at the end.
 *
 * bun runs every test file in one process, so a leaked vite listener does not
 * end with the file — it holds the port and the process, and the suite hangs
 * somewhere that looks unrelated.
 */
const running: Array<{ close: () => Promise<void> }> = [];
/** Every tmp tree this file makes, removed with the servers. Two rows copy
 *  `src/units.ts` and `src/main.ts` into one, and a suite that leaves a fresh
 *  pair in tmp on every run is littering. */
const madeDirs: string[] = [];
const tmpTree = (prefix: string) => {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	madeDirs.push(dir);
	return dir;
};
afterAll(async () => {
	for (const s of running) await s.close();
	for (const d of madeDirs) rmSync(d, { recursive: true, force: true });
});

/**
 * A vite dev server on `root`, with or without the declaration plugin, and the
 * origin to ask about it.
 *
 * `configFile: false` and the plugin passed by hand, because these rows are
 * about the *guard* and need to vary something the shipped config does not.
 * That is also their limit, and the wiring row below is what covers it: none of
 * them would notice `vite.config.ts` losing the plugin.
 */
async function serve(root: string, { declare = true } = {}): Promise<string> {
	const port = await freePort();
	const server = await createServer({
		configFile: false,
		root,
		logLevel: "silent",
		plugins: declare ? [treeDeclaration()] : [],
		server: { port, strictPort: true, host: "127.0.0.1" },
	});
	await server.listen();
	running.push(server);
	return `http://127.0.0.1:${port}`;
}

/**
 * A second tree whose fingerprint files are byte-identical to this one's.
 *
 * This is #123's actual failure, reduced: two checkouts that agree on every
 * top-level numeric constant and are nonetheless different trees. Copying the
 * two files the old `FINGERPRINT` named makes the old comparison pass by
 * construction, so the row measures the identity rule rather than a lucky
 * difference in the constants.
 */
function siblingTree(): string {
	const dir = tmpTree("seelite-sibling-");
	mkdirSync(join(dir, "src"), { recursive: true });
	for (const f of ["src/units.ts", "src/main.ts"])
		cpSync(join(REPO, f), join(dir, f));
	writeFileSync(
		join(dir, "index.html"),
		"<!doctype html><title>sibling</title>\n",
	);
	return dir;
}

test("a server on another tree with identical constants is refused", async () => {
	const sibling = siblingTree();
	const origin = await serve(sibling);
	// The constants agree — that is the fixture's whole point — so the message
	// must be about identity. Both roots are named, because "wrong tree" without
	// saying which one sends the reader to check the server they are looking at.
	const err = await assertServingThisTree(origin).then(
		() => null,
		(e: Error) => e,
	);
	expect(err).not.toBeNull();
	expect(err!.message).toContain(realpathSync(sibling));
	expect(err!.message).toContain(REPO);
}, 60000);

test("a server on this tree passes, and reports the tree it declared", async () => {
	const origin = await serve(REPO);
	const served = await assertServingThisTree(origin);
	expect(served.root).toBe(REPO);
	// The git fields are what the contact sheet stamps. They are optional by
	// contract, but this tree is a git checkout, so here they are present.
	expect(served.head).toMatch(/^[0-9a-f]{40}$/);
	expect(typeof served.branch).toBe("string");
	expect(typeof served.dirty).toBe("boolean");
}, 60000);

test("a server with no declaration is refused, by what came back and not by a status", async () => {
	const origin = await serve(REPO, { declare: false });
	const err = await assertServingThisTree(origin).then(
		() => null,
		(e: Error) => e,
	);
	expect(err).not.toBeNull();
	// Vite answers an unknown path with `index.html` and a **200**, so a guard
	// reading `res.ok` would take the SPA fallback for a declaration. The message
	// names what came back instead.
	expect(err!.message).toContain("text/html");
}, 60000);

test("a root reached through a symlink passes", async () => {
	// Where a correct server gets wrongly accused. macOS `/tmp` is a symlink to
	// `/private/tmp`, so this is the standing case rather than an exotic one:
	// the two spellings of one tree must compare equal.
	const link = join(tmpTree("seelite-link-"), "tree");
	symlinkSync(REPO, link);
	const origin = await serve(link);
	const served = await assertServingThisTree(origin);
	expect(served.root).toBe(REPO);
}, 60000);

/**
 * A declaration under a status the guard is not allowed to read.
 *
 * The row above shows a 200 being refused; on its own that is also what a guard
 * checking `res.ok` would do, because vite's fallback is a 200 *and* HTML. This
 * is the other half: a real declaration served under a 503 must be **accepted**,
 * which no `res.ok` guard can do. Written after the first version of that pair
 * asserted the absence of a status in the message — a string no branch of it
 * ever contains, so the assertion passed on the build it was meant to catch.
 *
 * A plain node server rather than vite: the point is a response shape vite has
 * no way to produce.
 */
test("a declaration is read on its shape, whatever status carries it", async () => {
	const port = await freePort();
	const http = await import("node:http");
	const server = http.createServer((_req, res) => {
		res.writeHead(503, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ root: REPO }));
	});
	await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
	running.push({
		close: () => new Promise<void>((r) => server.close(() => r())),
	});
	const served = await assertServingThisTree(`http://127.0.0.1:${port}`);
	expect(served.root).toBe(REPO);
}, 60000);

/**
 * The shipped `vite.config.ts` still lists the plugin.
 *
 * **Every other row here boots with `configFile: false` and hands the plugin
 * over by argument**, so all of them prove the guard and none of them prove the
 * wiring (#296 review). Deleting `plugins: [treeDeclaration()]` from the config
 * leaves `npm test`, `tsc`, `format:check` and `build` green — the plugin is
 * `configureServer`-only, so a production build never touches it — and the
 * probes do not run in CI. That is a one-line edit with nothing between it and
 * a merge.
 *
 * It boots the **real config** rather than reading the file for a substring: a
 * grep would pass on the import alone, on a commented-out line, and on a
 * plugin listed under a condition that is false at run time. What is asserted
 * is that a server started the way `npm run dev` starts one answers with this
 * tree.
 */
test("the shipped vite config serves the declaration", async () => {
	const port = await freePort();
	const server = await createServer({
		root: REPO,
		logLevel: "silent",
		server: { port, strictPort: true, host: "127.0.0.1" },
	});
	await server.listen();
	running.push(server);
	const served = await assertServingThisTree(`http://127.0.0.1:${port}`);
	expect(served.root).toBe(REPO);
}, 60000);

/**
 * The endpoint answers a local caller and nobody else.
 *
 * `vite.config.ts` sets `host: true`, so the dev server binds every interface,
 * and the declaration spells the absolute project root — which carries the OS
 * username — plus the branch in hand. A non-loopback caller falls through to
 * vite and gets `index.html`, which is what a server with no plugin looks
 * like, so the refusal an outsider sees is the truthful one.
 *
 * Driven through `remoteAddress` rather than by actually reaching in over the
 * LAN, which a test cannot arrange. The socket is the one thing the middleware
 * reads, so this is the decision under test and not a mock of it.
 */
test("a non-loopback caller gets no declaration", async () => {
	const port = await freePort();
	const server = await createServer({
		configFile: false,
		root: REPO,
		logLevel: "silent",
		plugins: [treeDeclaration()],
		server: { port, strictPort: true, host: "127.0.0.1" },
	});
	await server.listen();
	running.push(server);
	// The connection is genuinely local, so its address is overwritten on the
	// way in — the middleware asks the socket and this is what it will be told.
	server.httpServer?.on("connection", (socket) => {
		Object.defineProperty(socket, "remoteAddress", {
			value: "192.168.1.50",
			configurable: true,
		});
	});
	const res = await fetch(`http://127.0.0.1:${port}${TREE_ENDPOINT}`);
	expect(res.headers.get("content-type")).toContain("text/html");
}, 60000);

test("the guard and the plugin agree on where the declaration lives", () => {
	// One owner for the path. A guard looking somewhere the plugin does not serve
	// refuses every server in the repo, and reads exactly like a server that does
	// not declare.
	expect(TREE_ENDPOINT).toBe("/__seelite/tree");
});

test("no caller passes a file list any more", () => {
	// The fingerprint took a `files` argument and every probe passed one.
	// JavaScript swallows an extra argument in silence, so a caller left with a
	// stale list is bit-identical to one that was cleaned up, and a green probe
	// run says nothing either way. This is the half that can fail.
	//
	// **The walk is recursive and the count is not stated.** A flat read of
	// `scripts` plus a hardcoded `scripts/lib` leaves any new subdirectory
	// unscanned, which is the fail-open shape `tests/lib/source-scan.ts` records
	// against its own walk; and a figure in the name of a test is a figure that
	// rots — the first version of this said fifty where the sweep touched 33.
	//
	// Comments are stripped first: this file's own prose names the old shape,
	// and so does `probe-guard.mjs`'s history note. A scan that read those would
	// be red about text nobody executes.
	const walk = (rel: string): string[] =>
		readdirSync(repoPath(rel), { withFileTypes: true }).flatMap((e) =>
			e.isDirectory()
				? walk(`${rel}/${e.name}`)
				: e.name.endsWith(".mjs")
					? [`${rel}/${e.name}`]
					: [],
		);
	// A balanced scan from the call's own open paren, not `[^)]*` — that stops
	// at the first `)` and so reads `guardedOrigin(originOf(x), [...])` as
	// single-argument, which is the call shape most likely to be left behind.
	const passesTwo = (source: string) => {
		for (const m of source.matchAll(
			/\b(?:guardedOrigin|assertServingThisTree)\s*\(/g,
		)) {
			let depth = 0;
			for (let i = m.index + m[0].length - 1; i < source.length; i++) {
				const c = source[i];
				if ("([{".includes(c)) depth++;
				else if (")]}".includes(c)) {
					if (--depth === 0) break;
				} else if (c === "," && depth === 1) return true;
			}
		}
		return false;
	};
	expect(walk("scripts").filter((f) => passesTwo(codeOf(f)))).toEqual([]);
});

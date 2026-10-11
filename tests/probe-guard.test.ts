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
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { freePort } from "../scripts/lib/free-port.mjs";
import {
	callsWithArgument,
	codeOf,
	repoPath,
	scriptFiles,
} from "./lib/source-scan";
import {
	assertServingThisTree,
	HARDWARE_RENDERER,
	PROBE_RENDERER_ENV,
	rendererLaneNotice,
	TREE_ENDPOINT,
} from "../scripts/probe-guard.mjs";
import { treeDeclaration } from "../scripts/lib/tree-declaration.mjs";

const REPO = realpathSync(join(dirname(fileURLToPath(import.meta.url)), ".."));

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
async function serve(
	root: string,
	{ declare = true, useConfigFile = false } = {},
): Promise<{ origin: string; server: ViteDevServer }> {
	const port = await freePort();
	const server = await createServer({
		// `useConfigFile` is the wiring row's, and it is the one arm that must
		// **not** pass the plugin by hand: the whole question there is whether
		// the shipped `vite.config.ts` still lists it.
		...(useConfigFile
			? {}
			: {
					configFile: false,
					plugins: declare ? [treeDeclaration()] : [],
					// **No dependency discovery**, and it is a teardown fix rather
					// than a speed one. The `declare: false` row is the only server
					// here that lets a request reach vite — it answers
					// `index.html` — which starts the optimizer and its esbuild
					// child, and `server.close()` then waits on that child past
					// bun's 5 s hook timeout. It surfaced as an unnamed test with a
					// hook timeout, and moved between rows as rows were added.
					// Nothing here needs an optimized dependency.
					optimizeDeps: { noDiscovery: true, include: [] },
				}),
		root,
		logLevel: "silent",
		server: { port, strictPort: true, host: "127.0.0.1" },
	});
	await server.listen();
	running.push({ close: () => server.close() });
	return { origin: `http://127.0.0.1:${port}`, server };
}

/**
 * One plugin-enabled server on this tree, shared by every row that varies only
 * the *request*.
 *
 * A vite boot is not free and `npm test` runs on every change; three rows were
 * standing up three identical servers to ask three different questions of them
 * (#296 review). Rows that vary the *server* — another root, no plugin, the
 * shipped config — still get their own.
 */
let ownTree: Promise<{ origin: string; server: ViteDevServer }> | null = null;
const ownTreeOrigin = async () => {
	ownTree ??= serve(REPO);
	return (await ownTree).origin;
};

/**
 * A bare node server answering the endpoint with exactly this, and `index.html`
 * for everything else.
 *
 * Three of the guard's four refusals are about a response vite has no way to
 * make — a declaration under a failing status, JSON that does not parse, JSON
 * with no `root`. The messages were split apart because one of them was a
 * confident wrong answer for a round; without an arm each, nothing says which
 * branch a reader actually gets.
 */
async function serveRaw(
	status: number,
	type: string,
	body: string,
): Promise<string> {
	const port = await freePort();
	const http = await import("node:http");
	const server = http.createServer((req, res) => {
		if ((req.url ?? "").split("?")[0] !== TREE_ENDPOINT) {
			res.writeHead(200, { "Content-Type": "text/html" });
			return res.end("<!doctype html>");
		}
		res.writeHead(status, { "Content-Type": type });
		res.end(body);
	});
	await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
	running.push({
		close: () =>
			new Promise<void>((r) => {
				// **Connections first.** `close()` stops accepting and then waits
				// for the sockets already open, and `fetch` leaves a keep-alive
				// one behind after every row — so the teardown sat on them until
				// bun's 5 s hook timeout and the file reported a failure with no
				// test attached to it.
				server.closeAllConnections();
				server.close(() => r());
			}),
	});
	return `http://127.0.0.1:${port}`;
}

const refusalFrom = async (origin: string) =>
	assertServingThisTree(origin).then(
		() => null,
		(e: Error) => e,
	);

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
	const { origin } = await serve(sibling);
	// The constants agree — that is the fixture's whole point — so the message
	// must be about identity. Both roots are named, because "wrong tree" without
	// saying which one sends the reader to check the server they are looking at.
	const err = await refusalFrom(origin);
	expect(err).not.toBeNull();
	expect(err?.message).toContain(realpathSync(sibling));
	expect(err?.message).toContain(REPO);
}, 60000);

test("a server on this tree passes, and reports the tree it declared", async () => {
	const served = await assertServingThisTree(await ownTreeOrigin());
	expect(served.root).toBe(REPO);
	// The git fields are what the contact sheet stamps. They are optional by
	// contract, but this tree is a git checkout, so here they are present.
	expect(served.head).toMatch(/^[0-9a-f]{40}$/);
	expect(typeof served.branch).toBe("string");
	expect(typeof served.dirty).toBe("boolean");
}, 60000);

test("a server with no declaration is refused, by what came back and not by a status", async () => {
	const { origin } = await serve(REPO, { declare: false });
	const err = await refusalFrom(origin);
	expect(err).not.toBeNull();
	// Vite answers an unknown path with `index.html` and a **200**, so a guard
	// reading `res.ok` would take the SPA fallback for a declaration. The message
	// names what came back instead.
	expect(err?.message).toContain("text/html");
}, 60000);

test("a root reached through a symlink passes", async () => {
	// Where a correct server gets wrongly accused. macOS `/tmp` is a symlink to
	// `/private/tmp`, so this is the standing case rather than an exotic one:
	// the two spellings of one tree must compare equal.
	const link = join(tmpTree("seelite-link-"), "tree");
	symlinkSync(REPO, link);
	const { origin } = await serve(link);
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
	const origin = await serveRaw(
		503,
		"application/json",
		JSON.stringify({ root: REPO }),
	);
	const served = await assertServingThisTree(origin);
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
	const { origin } = await serve(REPO, { useConfigFile: true });
	const served = await assertServingThisTree(origin);
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
	const { origin, server } = await serve(REPO);
	// The connection is genuinely local, so its address is overwritten on the
	// way in — the middleware asks the socket and this is what it will be told.
	server.httpServer?.on("connection", (socket) => {
		Object.defineProperty(socket, "remoteAddress", {
			value: "192.168.1.50",
			configurable: true,
		});
	});
	const res = await fetch(`${origin}${TREE_ENDPOINT}`);
	expect(res.headers.get("content-type")).toContain("text/html");
}, 60000);

/**
 * A loopback socket asking for somebody else's name gets nothing.
 *
 * **The socket test alone shipped for a round and does not hold.** The
 * middleware runs before vite's internal ones on purpose — the SPA fallback
 * would otherwise answer first — which also puts it before vite's
 * `allowedHosts` check. A page at `evil.example.com` re-resolved to 127.0.0.1
 * reaches this over a loopback socket, so the socket says yes. Measured on the
 * branch that shipped it: `Host: evil.example.com` got **403** from vite on
 * `/src/main.ts` and **200 application/json** here, carrying the root, the
 * branch and the head.
 *
 * No override this time — the `Host` header is the request's own, so this is
 * the attack spelt exactly as it arrives.
 */
test("a loopback socket asking for a foreign host gets no declaration", async () => {
	const origin = await ownTreeOrigin();
	const res = await fetch(`${origin}${TREE_ENDPOINT}`, {
		headers: { Host: "evil.example.com" },
	});
	expect(res.headers.get("content-type")).not.toContain("application/json");
	// And the ordinary local spellings still work, or the gate is just off.
	for (const host of ["localhost", "127.0.0.1"]) {
		const ok = await fetch(`${origin}${TREE_ENDPOINT}`, {
			headers: { Host: host },
		});
		expect(ok.headers.get("content-type")).toContain("application/json");
	}
}, 60000);

/**
 * JSON that carries no `root` is refused, and not by blaming the config.
 *
 * The advice differs by cause and that is the whole reason there is more than
 * one message: telling the operator of a server that *is* answering this path
 * to go and check `vite.config.ts` sends them to a file that is fine.
 */
test("JSON with no root is refused without blaming vite.config.ts", async () => {
	const origin = await serveRaw(
		200,
		"application/json",
		JSON.stringify({ branch: "main" }),
	);
	const err = await refusalFrom(origin);
	expect(err).not.toBeNull();
	expect(err?.message).toContain("carries no");
	expect(err?.message).not.toContain("vite.config.ts still lists");
}, 60000);

/** A content type that lies about its body is a third case again — the message
 *  that used to cover it opened "That is JSON", on the branch where parsing
 *  had just failed. */
test("a body that claims JSON and is not says so", async () => {
	const origin = await serveRaw(200, "application/json", "not json at all");
	const err = await refusalFrom(origin);
	expect(err?.message).toContain("claims to be JSON");
	expect(err?.message).not.toContain("vite.config.ts still lists");
}, 60000);

/**
 * A root this machine cannot resolve is a mismatch, named as declared.
 *
 * `realpathSync` throws on a path that is not there, and swallowing that would
 * report the tree as agreeing. "The server says it is serving a directory I
 * cannot see" is the useful half of the message, so the declared string is
 * printed rather than dropped.
 */
test("a root that does not exist here is refused, and named as declared", async () => {
	const origin = await serveRaw(
		200,
		"application/json",
		JSON.stringify({ root: "/no/such/tree/anywhere" }),
	);
	const err = await refusalFrom(origin);
	expect(err?.message).toContain("/no/such/tree/anywhere");
	expect(err?.message).toContain(REPO);
}, 60000);

/**
 * No web page can read the declaration.
 *
 * The whole reason for the two gates above is that this answer is worth not
 * handing out: the root spells the OS username and the branch says what is
 * being worked on. Neither gate helps against a page that simply `fetch`es it
 * — the browser sends no foreign `Host`, and the socket is loopback. What
 * stops that is the **absence of an `Access-Control-Allow-Origin` header**.
 *
 * **That absence is structural, not a default**, and the review finding this
 * row answers said otherwise — that it rests on vite 6's restrictive `cors`
 * setting, so `server.cors: true` would silently expose the root and branch.
 * Measured: with `cors: true` the row still passes, because the middleware is
 * pre-internal and ends the response itself, so vite's cors middleware never
 * runs on it. No vite setting can reach this response.
 *
 * What the row does catch is the regression that is actually reachable: the
 * endpoint growing a permissive header of its own. Adding
 * `res.setHeader("Access-Control-Allow-Origin", "*")` beside the content type
 * makes this the one failure in the file. Written down because a row that
 * cannot fail reads exactly like one that holds — and this one nearly shipped
 * with the wrong mechanism named above it.
 */
test("the declaration is not readable cross-origin", async () => {
	const origin = await ownTreeOrigin();
	const res = await fetch(`${origin}${TREE_ENDPOINT}`, {
		headers: { Origin: "http://evil.example.com" },
	});
	expect(res.headers.get("access-control-allow-origin")).toBeNull();
	// And the request still succeeded, or the row would pass on a server that
	// refused it for some unrelated reason.
	expect(res.headers.get("content-type")).toContain("application/json");
}, 60000);

test("the endpoint path is pinned", () => {
	// **Not an agreement check** — it read as one for a round, and there is only
	// one value: `probe-guard.mjs` re-exports the plugin's constant, so the
	// disagreement it named cannot be produced. What proves guard and plugin
	// meet is the wiring row above, which boots a server and asks it.
	//
	// What this pins is the literal: the path is a URL an operator curls and a
	// reader greps for, so moving it should be a decision rather than a rename.
	expect(TREE_ENDPOINT).toBe("/__seelite/tree");
});

test("no caller passes a file list any more", () => {
	// The fingerprint took a `files` argument and every probe passed one.
	// JavaScript swallows an extra argument in silence, so a caller left with a
	// stale list is bit-identical to one that was cleaned up, and a green probe
	// run says nothing either way. This is the half that can fail.
	//
	// **The walk is recursive and the count is not stated.** Both were wrong
	// once: a flat read of `scripts` left any new subdirectory unscanned, and
	// the prose said fifty where the sweep touched 33. The walk and the
	// argument scan live in `tests/lib/source-scan.ts` now, beside the rest of
	// this suite's source-reading machinery.
	//
	// Comments are stripped first: this file's own prose names the old shape,
	// and so does `probe-guard.mjs`'s history note. A scan that read those would
	// be red about text nobody executes.
	const offenders = scriptFiles().filter((f) =>
		callsWithArgument(codeOf(f), [
			"guardedOrigin",
			"assertServingThisTree",
			"guardedTree",
		]),
	);
	expect(offenders).toEqual([]);
});

test("the renderer lane a direct run took is named, and only to that run", () => {
	// The GPU default says nothing about itself, and neither does the software
	// lane when the run is a suite's child — `npm run probe:cpu` chose it, and a
	// hundred children would print it a hundred times.
	expect(rendererLaneNotice({ mode: HARDWARE_RENDERER, direct: true })).toBe(
		"",
	);
	expect(rendererLaneNotice({ mode: null, direct: false })).toBe("");
	// The row that can fail is the third: a bare `node scripts/probe-x.mjs` gets
	// a software page and nothing said so. `docs/receipts/node-882-probe-wall-clock.md`
	// §2 has the measured gap between the lanes — this file does not restate it — and
	// the words have to name the variable, and the npm script that would have put
	// the run on the other lane.
	const line = rendererLaneNotice({ mode: null, direct: true });
	expect(line).toContain("software");
	expect(line).toContain(PROBE_RENDERER_ENV);
	expect(line).toContain("probe:one");
});

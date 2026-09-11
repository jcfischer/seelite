/**
 * The dev server says which working tree it is serving, and the guard reads it.
 *
 * ## Why a declaration rather than a fingerprint
 *
 * `probe-guard` used to compare *top-level numeric constants* between the file
 * on disk and the module the server handed back. Two sibling worktrees off the
 * same commit agree on every one of those unless a branch happens to change a
 * module constant — so the fingerprint was a subset of the file both copies
 * share by construction, and it could not separate them. #123 measured the
 * miss: `src/ship-mesh.ts` differed between two checkouts by 5,567 added and
 * 5,038 removed lines, and the guard read that as the same tree.
 *
 * Similarity cannot answer an identity question. This does: the server states
 * the absolute path of the tree it was started in, and the guard compares that
 * against its own. One fetch, one string comparison, and the refusal can name
 * the offending checkout rather than a constant that happened to differ.
 *
 * ## What the fields are for
 *
 * `root` is the only compared field, and it is the vite project root through
 * `realpathSync` — resolved, because a server started through a symlinked path
 * would otherwise declare a root that is spelt differently from the same tree
 * reached directly, and macOS `/tmp` → `/private/tmp` makes that the ordinary
 * case rather than an exotic one.
 *
 * `head`, `branch` and `dirty` are for the human reading a contact sheet, which
 * is the tier where a wrong-checkout run is *least* likely to be noticed: a
 * probe asserts numbers, a sheet is looked at by someone with no way to know
 * which tree it came from. They are read per request — cached for at most
 * `GIT_TTL_MS`, and never once at boot — because `dirty` changes under an
 * editing session and a stale answer there is the kind of precise-and-wrong
 * label `capture-views` already avoids for its own ref. They are **omitted** where git cannot be read — an archive export or
 * a tree with no `.git` is still a tree worth declaring — so a consumer checks
 * for them rather than assuming them.
 */
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { isIP } from "node:net";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Where the declaration is served.
 *
 * Exported and imported by the guard rather than written out at both ends: a
 * path spelt twice is a path that can be changed once, and the failure of a
 * guard looking at the wrong URL is indistinguishable from a server that does
 * not declare at all.
 */
export const TREE_ENDPOINT = "/__seelite/tree";

/**
 * What the endpoint answers with.
 *
 * Exported for the reason `TREE_ENDPOINT` is: the shape was spelt out in
 * `view-set.mjs`'s JSDoc, again as a `type Served` in `tests/view-set.test.ts`,
 * and again as assertions in `tests/probe-guard.test.ts`, with the producer
 * owning none of it. The git fields are one optional group — `readGit` returns
 * all three or returns nothing — which is why a consumer that keys on `branch`
 * while reading `head` is reading a shape this does not produce.
 *
 * @typedef {{root: string, head?: string, branch?: string, dirty?: boolean}} TreeDeclaration
 */

/**
 * `head`, `branch` and `dirty`, or nothing at all. See the note above on why a
 * missing git is not an error.
 *
 * **Async, and that is the mitigation rather than the cache below it.**
 * `execFileSync` stalls the whole Node event loop while it forks, and
 * `git status --porcelain` walks the working tree — so on a server serving
 * probes, that stall lands on another request's module transform. The first
 * fix for this was a one-second cache, which does not help: `probe-all` runs
 * probes sequentially by default and each one boots a Chromium before asking,
 * so consecutive fetches are minutes apart and every one of them misses. The
 * cache is kept for a burst, and it is not what stops the stall.
 */
async function readGit(cwd) {
	try {
		const at = async (args) =>
			(await run("git", args, { cwd, encoding: "utf8" })).stdout.trim();
		// In parallel: three unrelated processes, and nothing here reads
		// another's output. Serial cost measured at about 0.13 s against 0.03 s
		// for one, paid by every probe and capture before Chromium launches.
		const [head, branch, status] = await Promise.all([
			at(["rev-parse", "HEAD"]),
			at(["rev-parse", "--abbrev-ref", "HEAD"]),
			at(["status", "--porcelain"]),
		]);
		return { head, branch, dirty: status.length > 0 };
	} catch {
		return {};
	}
}

/**
 * How long a reading of git is reused.
 *
 * **Not the mitigation** — `readGit` above is, and the claim that used to sit
 * here ("a run of probes pays for one reading rather than thirty-seven") was
 * false under the runner's own default. What this covers is a burst: several
 * fetches inside a second, which a concurrent run can produce.
 *
 * Cached rather than computed once at boot, which was the other option offered:
 * a branch *can* change under a running server, and a stale branch printed on a
 * contact sheet is exactly the precise-and-wrong label this file exists to
 * prevent.
 */
const GIT_TTL_MS = 1000;

/**
 * One cache per plugin instance, which is one per served root.
 *
 * **Not a module-level cache**, and the first version was: two servers in one
 * process then share a reading, so a tree with no git can hand its empty answer
 * to a real checkout that asks a millisecond later. `tests/probe-guard.test.ts`
 * does exactly that — it stands a tmp tree up and this tree up in the same
 * file — and went red on it. A cache keyed on nothing is keyed on whoever
 * asked first.
 */
function gitCache() {
	let at = 0;
	/** The *promise*, not the value: two requests arriving together must share
	 *  one reading rather than starting a second before the first resolves. */
	let pending = null;
	return (cwd) => {
		const now = Date.now();
		if (!pending || now - at > GIT_TTL_MS) {
			pending = readGit(cwd);
			at = now;
		}
		return pending;
	};
}

/**
 * The vite plugin.
 *
 * The middleware is installed **directly** rather than from a returned
 * function, which is vite's difference between running before the internal
 * middlewares and running after them. After them is too late: the SPA fallback
 * answers an unknown path with `index.html` and a 200, which is exactly the
 * shape the guard has to be able to tell apart from a declaration.
 */
export function treeDeclaration() {
	/**
	 * Annotated, because `apply` is a literal union in vite's types and a plain
	 * object literal in a `.mjs` widens it to `string` — which `tsc --noEmit`
	 * rejects at every call site rather than here.
	 *
	 * @type {import("vite").Plugin}
	 */
	const plugin = {
		name: "seelite-tree-declaration",
		// Serve only, stated rather than implied by having `configureServer`
		// alone. `vite.config.ts` is loaded by `npm run build` too, and a
		// probe-harness module reaching the production config graph with no
		// declared scope is a direction this repo does not otherwise allow
		// (#296 review).
		apply: "serve",
		configureServer(server) {
			const root = realpathSync(server.config.root);
			const gitFacts = gitCache();
			server.middlewares.use(async (req, res, next) => {
				// The query is split off rather than matched through, so a cache
				// buster on the URL does not read as a different path.
				if ((req.url ?? "").split("?")[0] !== TREE_ENDPOINT) return next();
				// **Two gates, and one of them is not enough.**
				//
				// `vite.config.ts` sets `host: true`, so the server binds every
				// interface, and this answer carries the absolute project root —
				// which spells the OS username — plus the branch in hand. Every
				// consumer is a probe or a capture on this machine, so the socket
				// has to be loopback.
				//
				// That alone was shipped for a round and does not hold. Running
				// before vite's internal middlewares is deliberate — the SPA
				// fallback would otherwise answer first — but it also means
				// running before vite's `allowedHosts` check. A page at
				// `evil.example.com` that re-resolves to 127.0.0.1 reaches this
				// over a **loopback socket**, and the socket test waves it
				// through: measured on this branch, `Host: evil.example.com` got
				// 403 from vite on `/src/main.ts` and 200 with the declaration
				// here. So the `Host` header is checked too, and the ordering
				// stays.
				//
				// A refused caller falls through to **vite**, and what it sees is
				// vite's answer rather than a refusal of ours: `index.html` for a
				// remote address asking for a local name, and its own 403 where
				// `allowedHosts` rejects the host — which is what the rebinding
				// case gets, measured. Either way it is indistinguishable from a
				// server that does not carry this plugin, which is the truthful
				// thing for it to look like.
				if (!isLocalRequest(req)) return next();
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify({ root, ...(await gitFacts(root)) }));
			});
		},
	};
	return plugin;
}

/** `::1` and `::ffff:127.0.0.1` are both how a dual-stack listener spells a
 *  local caller, so the check cannot be an equality against one string. */
const isLoopback = (addr) =>
	addr === "::1" ||
	addr === "127.0.0.1" ||
	(typeof addr === "string" &&
		(addr.startsWith("127.") || addr.startsWith("::ffff:127.")));

/**
 * The hostname the caller asked for, without its port, and without `new URL`.
 *
 * A bracketed IPv6 literal keeps its brackets stripped rather than being split
 * on the colons inside it.
 */
const hostnameOf = (host) => {
	const h = String(host ?? "");
	if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
	return h.split(":")[0];
};

/**
 * A name that cannot have been handed out by somebody else's DNS.
 *
 * `localhost` and anything under it are reserved for the loopback interface,
 * and a bare IP literal is not a name at all — there is no zone to rebind. Any
 * other name reached this server because a resolver said so, and that resolver
 * is not necessarily the user's.
 *
 * **`isIP` rather than a pattern**, because the patterns this replaces were
 * wider than the thing they described: `/^\d{1,3}(\.\d{1,3}){3}$/` admits
 * `999.1.1.1` and `/^[0-9a-f:]+$/i` admits a bare label like `beef`, neither of
 * which is an IP literal — and a resolver search suffix can give a bare label
 * an answer. No registrable TLD matches either today, so this was a widening
 * of the allow-list rather than a demonstrated path, and it is still the wrong
 * shape of check: parse the literal, do not describe it.
 */
const isLocalName = (name) =>
	name === "localhost" || name.endsWith(".localhost") || isIP(name) !== 0;

/** Both gates: a loopback socket *and* a host nobody else's DNS can spell. */
const isLocalRequest = (req) =>
	isLoopback(req.socket?.remoteAddress) &&
	isLocalName(hostnameOf(req.headers?.host));

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
 * which tree it came from. They are read per request rather than once at boot,
 * because `dirty` changes under an editing session and a stale answer there is
 * the kind of precise-and-wrong label `capture-views` already avoids for its
 * own ref. They are **omitted** where git cannot be read — an archive export or
 * a tree with no `.git` is still a tree worth declaring — so a consumer checks
 * for them rather than assuming them.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

/**
 * Where the declaration is served.
 *
 * Exported and imported by the guard rather than written out at both ends: a
 * path spelt twice is a path that can be changed once, and the failure of a
 * guard looking at the wrong URL is indistinguishable from a server that does
 * not declare at all.
 */
export const TREE_ENDPOINT = "/__seelite/tree";

/** `head`, `branch` and `dirty`, or nothing at all. See the note above on why
 *  a missing git is not an error. */
function readGit(cwd) {
	try {
		const at = (args) =>
			execFileSync("git", args, {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		return {
			head: at(["rev-parse", "HEAD"]),
			branch: at(["rev-parse", "--abbrev-ref", "HEAD"]),
			dirty: at(["status", "--porcelain"]).length > 0,
		};
	} catch {
		return {};
	}
}

/**
 * How long a reading of git is reused.
 *
 * Three `execFileSync` calls inside a middleware stall the whole Node event
 * loop while they fork, and `git status --porcelain` walks the working tree —
 * so on a concurrent `probe-all` that stall lands on another probe's in-flight
 * module transform (#296 review). A second is short enough that an edit is
 * reflected by the time anyone reads the answer, and long enough that a run of
 * probes pays for one reading rather than thirty-seven.
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
	let value = {};
	return (cwd) => {
		const now = Date.now();
		if (!at || now - at > GIT_TTL_MS) {
			value = readGit(cwd);
			at = now;
		}
		return value;
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
			server.middlewares.use((req, res, next) => {
				// The query is split off rather than matched through, so a cache
				// buster on the URL does not read as a different path.
				if ((req.url ?? "").split("?")[0] !== TREE_ENDPOINT) return next();
				// **Loopback only.** `vite.config.ts` sets `host: true`, so the dev
				// server binds every interface — and this answer carries the
				// absolute project root, which spells the OS username, plus the
				// branch being worked on. That is worth nothing to an attacker and
				// worth not handing out either; every consumer is a probe or a
				// capture on the same machine. A non-loopback caller falls through
				// to vite, which answers `index.html` — so it looks to them exactly
				// like a server without the plugin, which is the truthful thing for
				// it to look like.
				if (!isLoopback(req.socket?.remoteAddress)) return next();
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify({ root, ...gitFacts(root) }));
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

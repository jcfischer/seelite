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
function gitFacts(cwd) {
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
 * The vite plugin.
 *
 * The middleware is installed **directly** rather than from a returned
 * function, which is vite's difference between running before the internal
 * middlewares and running after them. After them is too late: the SPA fallback
 * answers an unknown path with `index.html` and a 200, which is exactly the
 * shape the guard has to be able to tell apart from a declaration.
 */
export function treeDeclaration() {
	return {
		name: "seelite-tree-declaration",
		configureServer(server) {
			const root = realpathSync(server.config.root);
			server.middlewares.use((req, res, next) => {
				// The query is split off rather than matched through, so a cache
				// buster on the URL does not read as a different path.
				if ((req.url ?? "").split("?")[0] !== TREE_ENDPOINT) return next();
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify({ root, ...gitFacts(root) }));
			});
		},
	};
}

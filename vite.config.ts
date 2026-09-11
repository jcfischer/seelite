import { defineConfig } from "vite";
import { treeDeclaration } from "./scripts/lib/tree-declaration.mjs";

export default defineConfig({
	/**
	 * The dev server declares which working tree it serves.
	 *
	 * Here rather than only in `scripts/`, because `probe-all.mjs` and every
	 * `npm run dev` load this file — so the declaration exists wherever a probe
	 * or a capture can reach a server, and removing the plugin from this list is
	 * the one act that makes `probe-guard` refuse every server in the repo. The
	 * factory lives in `scripts/lib/tree-declaration.mjs` beside the guard that
	 * reads it.
	 */
	plugins: [treeDeclaration()],
	server: {
		/**
		 * No browser on `npm run dev`. Pass `--open` when you want one.
		 *
		 * Vendored from seekolous with its reason, which applies here from day
		 * one: the probe runner builds its dev server with vite's `createServer`,
		 * which loads this file — so `open: true` would have `npm run probe` open
		 * a tab as well, on top of the Chromium it is already launching. Agent
		 * sessions start servers often and want a browser none of those times.
		 */
		open: false,
		host: true,
	},
	build: {
		target: "es2022",
	},
});

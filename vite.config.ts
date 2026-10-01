import { defineConfig } from "vite";
import { resolve } from "node:path";
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
	/**
	 * The neural voice's runtime loads a sibling file relative to its own
	 * module, which the dependency pre-bundler moves away from it.
	 */
	optimizeDeps: { exclude: ["onnxruntime-web"] },
	/**
	 * The neural voice's worker imports its runtime on demand, which splits
	 * it into chunks; only an ES-module worker can load them (#604).
	 */
	worker: { format: "es" },
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
		rollupOptions: {
			input: {
				home: resolve(import.meta.dirname, "index.html"),
				about: resolve(import.meta.dirname, "about/index.html"),
				fieldNotes: resolve(import.meta.dirname, "field-notes/index.html"),
				manual: resolve(import.meta.dirname, "manual/index.html"),
				trust: resolve(import.meta.dirname, "trust/index.html"),
				credits: resolve(import.meta.dirname, "credits/index.html"),
			},
		},
	},
});

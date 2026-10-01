import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { treeDeclaration } from "./scripts/lib/tree-declaration.mjs";

/**
 * Drop onnxruntime-web's own `.wasm` from the build (#604, the principal's
 * D6). The runtime's bundle names its binary by `new URL(…, import.meta.url)`,
 * so vite emits a copy — 21.9 MB never fetched, because the worker hands
 * the runtime its binary from the voice's checked parts (`wasmBinary`).
 * The build fails if a runtime binary would still ship, so a runtime bump
 * that renames it cannot quietly bring the copy back.
 */
function dropRuntimeWasm(): Plugin {
	return {
		name: "seelite-drop-runtime-wasm",
		apply: "build",
		generateBundle(_, bundle) {
			for (const name of Object.keys(bundle))
				if (/(^|\/)ort-[^/]*\.wasm$/.test(name)) delete bundle[name];
			const left = Object.keys(bundle).filter((n) => n.endsWith(".wasm"));
			if (left.length)
				this.error(`a runtime binary would ship: ${left.join(", ")}`);
		},
	};
}

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
	 * The neural voice's runtime resolves its files by its own module's URL,
	 * and the dependency pre-bundler moved the module away from them: the
	 * #604 prototype's worker could not load it pre-bundled. The worker hands
	 * the runtime its WASM binary (`wasmBinary`), so no binary is fetched by
	 * that resolution; `probe-neural-voice` records every request the voice
	 * makes and holds them to this origin.
	 */
	optimizeDeps: { exclude: ["onnxruntime-web"] },
	/**
	 * The neural voice's worker imports its runtime on demand, which splits
	 * it into chunks; only an ES-module worker can load them (#604).
	 */
	worker: { format: "es", plugins: () => [dropRuntimeWasm()] },
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

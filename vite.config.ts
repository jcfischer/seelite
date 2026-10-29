import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { treeDeclaration } from "./scripts/lib/tree-declaration.mjs";
import { socialPreview } from "./src/social-preview";
import { asyncImportGuard } from "./scripts/lib/async-import-guard.mjs";
import { execFileSync } from "node:child_process";

/** https://github.com/jcfischer/seelite/issues/920 The prototype branch names its commit on the glass. */
const PROTOTYPE_SHA = (() => {
	try {
		const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"])
			.toString()
			.trim();
		const dirty = execFileSync("git", ["status", "--porcelain", "--", "src"])
			.toString()
			.trim();
		return dirty ? `${sha}+DIRTY` : sha;
	} catch {
		return "UNKNOWN";
	}
})();

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
			// The worker's chunk names the WASM backend's loader by a path into
			// the package's private layout: if a runtime bump moved it, the
			// built WASM voice would fail and only a manual run would see it
			// (sage round 6 on #606). The chunk with the voice in it must ship
			// the loader beside it.
			const voiced = Object.keys(bundle).some((n) =>
				/ort\.wasm\.bundle/.test(n),
			);
			const loader = Object.keys(bundle).some((n) =>
				/(^|\/)ort-wasm-simd-threaded-[^/]*\.mjs$/.test(n),
			);
			if (voiced && !loader)
				this.error("the WASM backend's loader module would not ship");
		},
	};
}

export default defineConfig({
	define: { __PROTOTYPE_SHA__: JSON.stringify(PROTOTYPE_SHA) },
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
	plugins: [treeDeclaration(), socialPreview(), asyncImportGuard()],
	/**
	 * The game's models are referenced by URL (`src/model-urls.ts`), so vite
	 * emits each under `assets/` with a content hash in its name (#834).
	 */
	assetsInclude: ["**/*.glb"],
	/**
	 * The neural voice's runtime resolves its files by its own module's URL,
	 * and the dependency pre-bundler moved the module away from them: the
	 * #604 prototype's worker could not load it pre-bundled. The worker hands
	 * the runtime its WASM binary (`wasmBinary`), so no binary is fetched by
	 * that resolution; `scripts/measure-neural-voice.mjs` (by hand) records
	 * every request the voice makes and holds them to this origin.
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
			output: {
				// Startup awaits model loaders. Keep its dependencies out of this
				// async chunk so lazy models can import shared helpers without
				// waiting on the startup that is waiting for them (#1021).
				onlyExplicitManualChunks: true,
				manualChunks: (id) =>
					id === resolve(import.meta.dirname, "src/main.ts")
						? "game"
						: undefined,
			},
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

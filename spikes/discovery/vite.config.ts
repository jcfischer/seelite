import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";

/** Isolate this study's prebundle cache from other worktrees sharing node_modules. */
export default mergeConfig(
	base,
	defineConfig({
		cacheDir: ".dream-loop/vite-cache",
		server: { watch: { usePolling: true, interval: 500 } },
	}),
);

import { defineConfig } from "vite";

export default defineConfig({
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

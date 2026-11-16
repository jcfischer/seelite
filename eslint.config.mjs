import { defineConfig } from "eslint/config";
import { seeliteLint } from "./scripts/eslint/seelite.mjs";

export default defineConfig(
	{ ignores: ["node_modules/", "dist/", "public/", "spikes/", "demos/"] },
	{
		files: [
			"src/**/*.{ts,mjs,js}",
			"tests/**/*.{ts,mjs,js}",
			"scripts/**/*.{ts,mjs,js}",
			"*.{ts,mjs}",
		],
		...seeliteLint,
	},
);

import tsParser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import { seelite } from "./scripts/eslint/seelite.mjs";

export default defineConfig(
	{ ignores: ["node_modules/", "dist/", "public/", "spikes/", "demos/"] },
	{
		files: [
			"src/**/*.{ts,mjs,js}",
			"tests/**/*.{ts,mjs,js}",
			"scripts/**/*.{ts,mjs,js}",
			"*.{ts,mjs}",
		],
		linterOptions: { noInlineConfig: true },
		languageOptions: { parser: tsParser },
		plugins: { seelite },
		rules: { "seelite/no-comments": "error" },
	},
);

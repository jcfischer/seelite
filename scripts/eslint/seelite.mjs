import tsParser from "@typescript-eslint/parser";
import { noComments } from "./no-comments.mjs";

/** @type {import("eslint").ESLint.Plugin} */
export const seelite = { rules: { "no-comments": noComments } };

/**
 * The lint settings for every source file, shared by `eslint.config.mjs` and
 * the rule's tests so the tests run what CI runs.
 * @type {import("eslint").Linter.Config}
 */
export const seeliteLint = {
	linterOptions: { noInlineConfig: true },
	languageOptions: { parser: tsParser },
	plugins: { seelite },
	rules: { "seelite/no-comments": "error" },
};

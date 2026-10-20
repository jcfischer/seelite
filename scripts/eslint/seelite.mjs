import { noComments } from "./no-comments.mjs";

/** @type {import("eslint").ESLint.Plugin} */
export const seelite = { rules: { "no-comments": noComments } };

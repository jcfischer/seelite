import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("the model URLs are literals vite can rewrite to hashed assets", () => {
	const source = readFileSync(
		new URL("../src/model-urls.ts", import.meta.url),
		"utf8",
	);
	const literals = source.match(
		/new URL\(\s*"\.\/models\/[\w-]+\.glb",\s*import\.meta\.url,?\s*\)/g,
	);
	expect(literals?.length).toBe(30);
});

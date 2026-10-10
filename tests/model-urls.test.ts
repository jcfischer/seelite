import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	CORIOLIS_GLB_URL,
	COURIER_COCKPIT_GLB_URL,
	COURIER_HULL_GLB_URL,
	LONGWALL_MINER_GLB_URL,
	STATION_INTERIORS_GLB_URL,
} from "../src/model-urls";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("models are served under hashed names (#834)", () => {
	test("no model is served from public/, at a fixed name", () => {
		expect(existsSync(new URL("public/models", root))).toBe(false);
		const glbs = readdirSync(new URL("public", root), { recursive: true })
			.map(String)
			.filter((name) => name.endsWith(".glb"));
		expect(glbs).toEqual([]);
	});

	test("every shipped model has a URL constant, and every constant a file", () => {
		const shipped = readdirSync(new URL("src/models", root)).filter((n) =>
			n.endsWith(".glb"),
		);
		const urls = [
			CORIOLIS_GLB_URL,
			COURIER_COCKPIT_GLB_URL,
			COURIER_HULL_GLB_URL,
			LONGWALL_MINER_GLB_URL,
			STATION_INTERIORS_GLB_URL,
		];
		expect(urls.map((u) => u.split("/").pop()).sort()).toEqual(shipped.sort());
		for (const url of urls) expect(existsSync(fileURLToPath(url))).toBe(true);
	});

	test("the URLs are literals vite can rewrite to hashed assets", () => {
		// vite rewrites `new URL("<literal>", import.meta.url)` only; a
		// computed path would ship nothing and fail at runtime.
		const source = read("src/model-urls.ts");
		const literals = source.match(
			/new URL\(\s*"\.\/models\/[\w-]+\.glb",\s*import\.meta\.url,?\s*\)/g,
		);
		expect(literals?.length).toBe(5);
	});

	test("no loader names a model by a fixed path", () => {
		for (const file of readdirSync(new URL("src", root)).filter((n) =>
			n.endsWith(".ts"),
		))
			expect(read(`src/${file}`)).not.toMatch(/"\/models\//);
	});

	test("/assets/* alone is immutable for a year", () => {
		const rules = read("public/_headers")
			.split("\n")
			.filter((line) => line.trim() && !line.trimStart().startsWith("#"));
		expect(rules).toEqual([
			"/assets/*",
			"  Cache-Control: public, max-age=31536000, immutable",
		]);
	});
});

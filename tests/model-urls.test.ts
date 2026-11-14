import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ASTEROIDS_GLB_URL,
	ASSEMBLY_GLB_URL,
	BOLLARD_TUG_GLB_URL,
	CORIOLIS_DETAIL_GLB_URL,
	CORIOLIS_GLB_URL,
	COURIER_COCKPIT_GLB_URL,
	COURIER_HULL_GLB_URL,
	DISCOVERY_VOYAGER_GLB_URL,
	DRUM_DETAIL_GLB_URL,
	LANCE_INTERCEPTOR_GLB_URL,
	LONGWALL_MINER_GLB_URL,
	WARDEN_PATROL_GLB_URL,
	SHIV_RAIDER_GLB_URL,
	BASTION_CARRIER_GLB_URL,
	SLUICE_PROSPECTOR_GLB_URL,
	RAMPART_DREADNOUGHT_GLB_URL,
	MINER_COCKPIT_GLB_URL,
	OUTPOST_GLB_URLS,
	PORTER_GLB_URL,
	REFINERY_GLB_URLS,
	SHARED_IMAGES,
	SHIPYARD_GLB_URLS,
	STATION_INTERIORS_GLB_URL,
	TRADE_GLB_URLS,
	RING_DETAIL_GLB_URL,
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
			ASTEROIDS_GLB_URL,
			ASSEMBLY_GLB_URL,
			BOLLARD_TUG_GLB_URL,
			CORIOLIS_DETAIL_GLB_URL,
			CORIOLIS_GLB_URL,
			COURIER_COCKPIT_GLB_URL,
			COURIER_HULL_GLB_URL,
			DISCOVERY_VOYAGER_GLB_URL,
			DRUM_DETAIL_GLB_URL,
			LANCE_INTERCEPTOR_GLB_URL,
			LONGWALL_MINER_GLB_URL,
			WARDEN_PATROL_GLB_URL,
			SHIV_RAIDER_GLB_URL,
			BASTION_CARRIER_GLB_URL,
			SLUICE_PROSPECTOR_GLB_URL,
			RAMPART_DREADNOUGHT_GLB_URL,
			MINER_COCKPIT_GLB_URL,
			PORTER_GLB_URL,
			...Object.values(SHIPYARD_GLB_URLS),
			...Object.values(REFINERY_GLB_URLS),
			...Object.values(OUTPOST_GLB_URLS),
			...Object.values(TRADE_GLB_URLS),
			RING_DETAIL_GLB_URL,
			STATION_INTERIORS_GLB_URL,
		];
		expect(urls.map((u) => u.split("/").pop()).sort()).toEqual(shipped.sort());
		for (const url of urls) expect(existsSync(fileURLToPath(url))).toBe(true);
	});

	test("every shared image names its file and the hash it is registered under", () => {
		const entries = Object.entries(SHARED_IMAGES);
		expect(entries.length).toBeGreaterThan(0);
		for (const [sha, image] of entries) {
			const path = fileURLToPath(image.url);
			expect(basename(path, ".webp")).toBe(image.name);
			expect(existsSync(path)).toBe(true);
			expect(
				createHash("sha256").update(readFileSync(path)).digest("hex"),
			).toBe(sha);
		}
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

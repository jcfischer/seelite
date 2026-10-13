/**
 * Write the refineries' collision proxies (node #819) to
 * `src/refinery-proxies.ts`, from the shipped models. How they are fitted is
 * `scripts/lib/shipyard-proxies.ts` (`fitRefineryProxies`). Run after the
 * models change:
 *
 *   bun scripts/generate-refinery-proxies.ts
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { refineryModelHash } from "./lib/shipped-refineries";
import { fitRefineryProxies, PACK, pack } from "./lib/shipyard-proxies";

const OUT = "src/refinery-proxies.ts";
const fitted = await fitRefineryProxies();
const data: Record<string, { rock: string; plant: string }> = {};
const sources: Record<string, string> = {};
for (const [form, { rock, plant }] of Object.entries(fitted)) {
	data[form] = { rock: pack(rock), plant: pack(plant) };
	sources[form] = refineryModelHash(form as "a" | "b" | "c" | "d");
	console.log(
		`${form}: ${rock.length} rock boxes, ${plant.length} plant boxes`,
	);
}
writeFileSync(
	OUT,
	`/**
 * The refineries' collision proxies (node #819). **Generated** by
 * \`scripts/generate-refinery-proxies.ts\` from \`src/models/refinery-*.glb\`;
 * do not edit. Each form's rock (voxels, held within 20 m) and plant (the
 * 10 m rule) are oriented boxes in the station's frame, packed as the
 * shipyards' are (\`src/shipyard-proxies.ts\`).
 * \`station-proxy.ts\` decodes them; \`REFINERY_PROXY_SOURCES\` is each model's
 * SHA-256 when they were fitted; \`tests/refinery-flight.test.ts\` fails when a
 * model no longer matches.
 */
export const REFINERY_PROXY_PACK = ${JSON.stringify(PACK)} as const;
export const REFINERY_PROXY_SOURCES = ${JSON.stringify(sources)} as const;
export const REFINERY_PROXIES = ${JSON.stringify(data)} as const;
`,
);
spawnSync("npx", ["biome", "format", "--write", OUT], { stdio: "inherit" });

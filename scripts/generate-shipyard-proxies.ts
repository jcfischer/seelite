/**
 * Write the shipyards' collision proxies (node #818) to
 * `src/shipyard-proxies.ts`, from the shipped models. How they are fitted is
 * `scripts/lib/shipyard-proxies.ts`. Run after the models change:
 *
 *   bun scripts/generate-shipyard-proxies.ts
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { shipyardModelHash } from "./lib/shipped-shipyards";
import { fitShipyardProxies, PACK, pack } from "./lib/shipyard-proxies";

const OUT = "src/shipyard-proxies.ts";
const fitted = await fitShipyardProxies();
const data: Record<string, { drum: string; yard: string }> = {};
const sources: Record<string, string> = {};
for (const [form, { drum, yard }] of Object.entries(fitted)) {
	data[form] = { drum: pack(drum), yard: pack(yard) };
	sources[form] = shipyardModelHash(form as "a" | "b" | "c");
	console.log(`${form}: ${drum.length} drum boxes, ${yard.length} yard boxes`);
}
writeFileSync(
	OUT,
	`/**
 * The shipyards' collision proxies (node #818). **Generated** by
 * \`scripts/generate-shipyard-proxies.ts\` from \`src/models/shipyard-*.glb\`;
 * do not edit. Each form's drum (spinning) and yard (static) are oriented
 * boxes in the station's frame, ten 16-bit integers a box in base64: centre
 * in \`centreM\` steps, half-extents in \`halfM\` steps (rounded up), and the
 * rotation as a quaternion over \`rot\`. \`station-proxy.ts\` decodes them;
 * \`SHIPYARD_PROXY_SOURCES\` is each model's SHA-256 when they were fitted;
 * \`tests/shipyard-flight.test.ts\` fails when a model no longer matches.
 */
export const SHIPYARD_PROXY_PACK = ${JSON.stringify(PACK)} as const;
export const SHIPYARD_PROXY_SOURCES = ${JSON.stringify(sources)} as const;
export const SHIPYARD_PROXIES = ${JSON.stringify(data)} as const;
`,
);
spawnSync("npx", ["biome", "format", "--write", OUT], { stdio: "inherit" });
